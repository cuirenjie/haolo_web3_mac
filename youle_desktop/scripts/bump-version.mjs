import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultVersionSourceDir = path.join(os.homedir(), "Desktop", "\u597d\u54af\u6700\u65b0\u5b89\u88c5\u5305");
const bumpKind = process.argv.find((arg) => ["major", "minor", "patch"].includes(arg)) || "patch";
const dryRun = process.argv.includes("--dry-run");

const packageJsonPath = path.join(projectRoot, "package.json");
const packageLockPath = path.join(projectRoot, "package-lock.json");

const packageJson = readJson(packageJsonPath);
const currentVersion = parseVersion(packageJson.version, "package.json");
const releaseVersions = readReleaseVersions(packageJson);
const baselineVersion = [currentVersion, ...releaseVersions].sort(compareVersions).at(-1);
const nextVersion = formatVersion(bumpVersion(baselineVersion, bumpKind));

packageJson.version = nextVersion;
if (!dryRun) {
  writeJson(packageJsonPath, packageJson);
  updatePackageLock(nextVersion);
}

const suffix = dryRun ? " (dry run)" : "";
console.log(`bump-version${suffix}: ${formatVersion(baselineVersion)} -> ${nextVersion}`);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function updatePackageLock(version) {
  if (!fs.existsSync(packageLockPath)) return;

  const packageLock = readJson(packageLockPath);
  packageLock.version = version;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = version;
  }
  writeJson(packageLockPath, packageLock);
}

function readReleaseVersions(pkg) {
  const releaseDir = resolveVersionSourceDir();
  if (!fs.existsSync(releaseDir)) return [];

  const productName = pkg.build?.productName || pkg.name;
  const artifactPattern = new RegExp(`^${escapeRegExp(productName)}-(\\d+)\\.(\\d+)\\.(\\d+)-Setup\\.exe$`);

  return fs
    .readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name.match(artifactPattern))
    .filter(Boolean)
    .map((match) => ({
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
    }));
}

function resolveVersionSourceDir() {
  const configured = String(process.env.HAOLO_VERSION_SOURCE_DIR || process.env.YOULE_VERSION_SOURCE_DIR || "").trim();
  return configured ? path.resolve(configured) : defaultVersionSourceDir;
}

function parseVersion(version, source) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version || "");
  if (!match) {
    throw new Error(`${source} version must use x.y.z format, got: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function bumpVersion(version, kind) {
  if (kind === "major") {
    return { major: version.major + 1, minor: 0, patch: 0 };
  }
  if (kind === "minor") {
    return { major: version.major, minor: version.minor + 1, patch: 0 };
  }
  return { major: version.major, minor: version.minor, patch: version.patch + 1 };
}

function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
