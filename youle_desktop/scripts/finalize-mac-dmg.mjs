import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signAsync as signMacApp, walkAsync as walkSignableFiles } from "@electron/osx-sign";
import { verifyPackagedAppTrust, verifyPackagedDmgTrust } from "./mac-release-trust.mjs";
import {
  verifyPackagedAppSecurity,
  verifyPackagedMacApp,
} from "./verify-mac-package.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const releaseDir = path.join(projectRoot, "release");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const displayName = "好咯";
const internalAppName = packageJson.build?.productName || packageJson.name;
const version = packageJson.version;
const allowUntrustedBuild = /^(1|true|yes|on)$/i.test(String(process.env.HAOLO_ALLOW_UNTRUSTED_MAC_DMG || "").trim());
const mainEntitlementsPath = path.join(projectRoot, "resources", "entitlements.mac.plist");
const inheritedEntitlementsPath = path.join(projectRoot, "resources", "entitlements.mac.inherit.plist");

export async function finalizeMacDmgs(options = {}) {
  if (process.platform !== "darwin") {
    console.log("finalize-mac-dmg: skipped on non-macOS host");
    return [];
  }

  if (!fs.existsSync(releaseDir)) {
    console.log("finalize-mac-dmg: no release directory");
    return [];
  }

  const target = normalizeMacDmgTarget(options.target);
  const targetArchitectures = macDmgTargetArchitectures(target);
  const dmgs = fs
    .readdirSync(releaseDir)
    .filter(isCurrentMacDmgArtifact)
    .map((entry) => path.join(releaseDir, entry))
    .filter((dmgPath) => !targetArchitectures || targetArchitectures.has(dmgArchitecture(dmgPath)));

  if (!dmgs.length) {
    console.log("finalize-mac-dmg: no macOS DMG artifacts found");
    return [];
  }

  for (const dmgPath of dmgs) {
    const arch = dmgArchitecture(dmgPath);
    const appPath = resolvePackagedAppPath(dmgPath);
    if (!appPath) {
      throw new Error(`Could not find packaged ${arch} ${internalAppName}.app for ${path.basename(dmgPath)}`);
    }
    const signaturePreparation = await preparePackagedAppSignature(appPath, {
      allowUntrustedBuild: options.allowUntrustedBuild ?? allowUntrustedBuild,
      inspectSignature: options.inspectSignature,
      resignApp: options.resignApp,
      signApp: options.signApp,
      verifyResignedSignatures: options.verifyResignedSignatures,
    });
    verifyPackagedMacApp(appPath, {
      expectedArchitectures: expectedArchitectures(arch),
      expectedVersion: version,
      productName: internalAppName,
      verifyAppSecurity: verifyPackagedAppSecurity,
    });

    if (!signaturePreparation.localAdHocBuild) {
      verifyPackagedDmgTrust(dmgPath);
      verifyDmgContents(dmgPath, appPath, arch, {
        verifyMountedAppTrust: verifyPackagedAppTrust,
      });
      console.log(`finalize-mac-dmg: verified trusted artifact ${path.relative(projectRoot, dmgPath)}`);
      continue;
    }

    rebuildLocalDmg(dmgPath, appPath, arch);
    verifyDmgContents(dmgPath, appPath, arch);
    console.log(`finalize-mac-dmg: verified local artifact ${path.relative(projectRoot, dmgPath)}`);
  }

  cleanupCurrentMacZipArtifacts(releaseDir);

  return dmgs;
}

export function parseFinalizeMacDmgArgs(args) {
  const options = { target: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--target" && args[index + 1]) {
      options.target = args[++index];
    } else if (argument.startsWith("--target=")) {
      options.target = argument.slice("--target=".length);
    } else {
      throw new Error(`Unknown or incomplete macOS DMG finalization argument: ${argument}`);
    }
  }
  options.target = normalizeMacDmgTarget(options.target);
  return options;
}

export async function preparePackagedAppSignature(appPath, options = {}) {
  const inspectSignature = options.inspectSignature || inspectPackagedAppSignature;
  const signature = inspectSignature(appPath);
  const localAdHocBuild = Boolean(options.allowUntrustedBuild && signature.adHoc);
  if (!localAdHocBuild) {
    return { localAdHocBuild: false, resigned: false, signature };
  }

  const resignApp = options.resignApp || resignAdHocPackagedApp;
  await resignApp(appPath, {
    allowedRoot: options.allowedRoot || releaseDir,
    signApp: options.signApp,
  });
  const verifyResignedSignatures = options.verifyResignedSignatures || verifyLaunchCompatibleAdHocSignatures;
  const resignedSignatures = await verifyResignedSignatures(appPath, { inspectSignature });
  return {
    localAdHocBuild: true,
    resigned: true,
    signature: resignedSignatures.find((entry) => path.resolve(entry.filePath) === path.resolve(appPath))?.signature,
    resignedSignatures,
  };
}

export function inspectPackagedAppSignature(appPath, options = {}) {
  const spawn = options.spawn || spawnSync;
  const result = spawn(
    "/usr/bin/codesign",
    ["--display", "--verbose=4", appPath],
    { encoding: "utf8" },
  );
  const details = commandResultDetails(result);
  if (result.error || result.status !== 0) {
    throw new Error(`Could not inspect code signature for ${appPath}${details ? `: ${details}` : ""}`);
  }
  const hasAdHocSignature = /^Signature=adhoc$/im.test(details);
  const hasNoTeamIdentifier = /^TeamIdentifier=not set$/im.test(details);
  if (hasAdHocSignature !== hasNoTeamIdentifier) {
    throw new Error(`Inconsistent code signature identity for ${appPath}: ${details}`);
  }
  return {
    adHoc: hasAdHocSignature && hasNoTeamIdentifier,
    details,
    hardenedRuntime: /flags=.*\bruntime\b/im.test(details),
  };
}

export async function resignAdHocPackagedApp(appPath, options = {}) {
  const normalizedAppPath = path.resolve(appPath);
  assertPackagedAppSymlinksContained(normalizedAppPath, {
    allowedRoot: options.allowedRoot,
  });
  const signApp = options.signApp || signMacApp;
  const binaries = [
    path.join(normalizedAppPath, "Contents", "Resources", "bin", "haolo_ai"),
    path.join(normalizedAppPath, "Contents", "Resources", "bin", "rg"),
  ];
  for (const binaryPath of binaries) {
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Cannot ad-hoc sign missing packaged binary: ${binaryPath}`);
    }
  }

  console.warn("finalize-mac-dmg: replacing hardened ad-hoc signatures for local launch compatibility");
  await signApp({
    app: normalizedAppPath,
    binaries,
    identity: "-",
    identityValidation: false,
    platform: "darwin",
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile(filePath) {
      return {
        entitlements: path.resolve(filePath) === normalizedAppPath
          ? mainEntitlementsPath
          : inheritedEntitlementsPath,
        hardenedRuntime: false,
        timestamp: "none",
      };
    },
  });
}

export async function verifyLaunchCompatibleAdHocSignatures(appPath, options = {}) {
  const inspectSignature = options.inspectSignature || inspectPackagedAppSignature;
  const listCodeObjects = options.listCodeObjects || listPackagedCodeObjects;
  const codeObjects = await listCodeObjects(appPath);
  const signatures = [];
  for (const filePath of codeObjects) {
    const signature = inspectSignature(filePath);
    if (!signature.adHoc || signature.hardenedRuntime) {
      throw new Error(
        `Local ad-hoc signing did not produce a launch-compatible signature for ${filePath}`,
      );
    }
    signatures.push({ filePath, signature });
  }
  return signatures;
}

export function assertPackagedAppSymlinksContained(appPath, options = {}) {
  const normalizedAppPath = path.resolve(appPath);
  const allowedRootPath = path.resolve(options.allowedRoot || path.dirname(normalizedAppPath));
  let appStats;
  try {
    appStats = fs.lstatSync(normalizedAppPath);
  } catch (error) {
    throw new Error(`Could not inspect packaged app before signing: ${normalizedAppPath}: ${error?.message || error}`);
  }
  if (appStats.isSymbolicLink()) {
    throw new Error(`Refusing to sign a symbolic-link app bundle: ${normalizedAppPath}`);
  }
  if (!appStats.isDirectory()) {
    throw new Error(`Refusing to sign a non-directory app bundle: ${normalizedAppPath}`);
  }

  const appRealPath = fs.realpathSync(normalizedAppPath);
  const allowedRootRealPath = fs.realpathSync(allowedRootPath);
  if (!isPathWithin(appRealPath, allowedRootRealPath)) {
    throw new Error(
      `Refusing to sign an app outside the allowed package root: ${normalizedAppPath} -> ${appRealPath}`,
    );
  }
  const visitDirectory = (directoryPath) => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        let targetPath;
        try {
          targetPath = fs.realpathSync(entryPath);
        } catch (error) {
          throw new Error(`Refusing to sign an app with an unresolved symlink: ${entryPath}: ${error?.message || error}`);
        }
        if (!isPathWithin(targetPath, appRealPath)) {
          throw new Error(`Refusing to sign an app with a symlink outside its bundle: ${entryPath} -> ${targetPath}`);
        }
        continue;
      }
      if (entry.isDirectory()) visitDirectory(entryPath);
    }
  };
  visitDirectory(normalizedAppPath);
  return appRealPath;
}

export async function listPackagedCodeObjects(appPath, options = {}) {
  const normalizedAppPath = path.resolve(appPath);
  const walk = options.walkSignableFiles || walkSignableFiles;
  const discovered = await walk(path.join(normalizedAppPath, "Contents"));
  const requiredCodeObjects = [
    normalizedAppPath,
    path.join(
      normalizedAppPath,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Electron Framework",
    ),
    ...["", " (GPU)", " (Plugin)", " (Renderer)"].map((suffix) =>
      path.join(normalizedAppPath, "Contents", "Frameworks", `${internalAppName} Helper${suffix}.app`),
    ),
    path.join(normalizedAppPath, "Contents", "Resources", "bin", "haolo_ai"),
    path.join(normalizedAppPath, "Contents", "Resources", "bin", "rg"),
  ];
  return [...new Set([...discovered, ...requiredCodeObjects].map((entry) => path.resolve(entry)))];
}

export function isCurrentMacZipArtifact(entry) {
  return [...new Set([displayName, internalAppName])].some((productName) =>
    new RegExp(
      `^${escapeRegExp(productName)}-${escapeRegExp(version)}-(universal|arm64|x64)\\.zip(?:\\.blockmap)?$`,
    ).test(entry),
  );
}

export function isCurrentMacDmgArtifact(entry) {
  return new RegExp(
    `^${escapeRegExp(displayName)}-${escapeRegExp(version)}-(universal|arm64|x64)\\.dmg$`,
  ).test(entry);
}

export function cleanupCurrentMacZipArtifacts(directoryPath = releaseDir) {
  const removed = [];
  for (const entry of fs.readdirSync(directoryPath)) {
    if (!isCurrentMacZipArtifact(entry)) continue;
    fs.rmSync(path.join(directoryPath, entry), { force: true });
    removed.push(entry);
  }
  return removed;
}

export function verifyDmgContents(dmgPath, sourceAppPath, arch, options = {}) {
  const run = options.run || execFileSync;
  const verifyApp = options.verifyPackagedMacApp || verifyPackagedMacApp;
  const verifySecurity = options.verifyPackagedAppSecurity || verifyPackagedAppSecurity;
  const inspectIdentity = options.inspectPackagedAppIdentity || inspectPackagedAppIdentity;
  const isMounted = options.isMountPointMounted || isMountPointMounted;
  const productName = options.productName || internalAppName;
  const architectures = expectedArchitectures(arch);
  const tempRoot = fs.mkdtempSync(path.join(options.tempParent || os.tmpdir(), "haolo-mounted-dmg-"));
  const mountPoint = path.join(tempRoot, "volume");
  fs.mkdirSync(mountPoint);
  let attached = false;
  let attachAttempted = false;
  let primaryError = null;

  try {
    attachAttempted = true;
    run(
      "/usr/bin/hdiutil",
      ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mountPoint, dmgPath],
      commandOptions(),
    );
    attached = true;
    const mountedAppPath = resolveMountedAppPath(mountPoint);
    verifyApp(mountedAppPath, {
      expectedArchitectures: architectures,
      expectedVersion: options.expectedVersion || version,
      productName,
      verifyAppSecurity: verifySecurity,
    });
    options.verifyMountedAppTrust?.(mountedAppPath);

    const sourceIdentity = inspectIdentity(sourceAppPath, architectures);
    const mountedIdentity = inspectIdentity(mountedAppPath, architectures);
    assertExpectedAppVersion(sourceIdentity, options.expectedVersion || version, sourceAppPath);
    assertExpectedAppVersion(mountedIdentity, options.expectedVersion || version, mountedAppPath);
    assertMatchingAppIdentity(sourceIdentity, mountedIdentity, sourceAppPath, mountedAppPath);
    return { mountedIdentity, sourceIdentity };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let detachError = null;
    const mountIsActive = attached || (attachAttempted && isMounted(mountPoint, tempRoot));
    if (mountIsActive) {
      try {
        detachMountedDmg(mountPoint, run);
      } catch (error) {
        detachError = error;
      }
    }
    if (!detachError) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    if (detachError) {
      if (!primaryError) throw detachError;
      primaryError.message = `${primaryError.message}\nAdditionally failed to detach ${mountPoint}: ${detachError.message}`;
    }
  }
}

export function inspectPackagedAppIdentity(appPath, architectures, options = {}) {
  const run = options.run || execFileSync;
  const spawn = options.spawn || spawnSync;
  const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
  const infoPlist = parseJsonObject(
    run(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", infoPlistPath],
      { encoding: "utf8" },
    ),
    `Invalid packaged Info.plist: ${infoPlistPath}`,
  );
  const identity = {
    bundleIdentifier: requiredString(infoPlist.CFBundleIdentifier, "CFBundleIdentifier", infoPlistPath),
    bundleVersion: requiredString(infoPlist.CFBundleVersion, "CFBundleVersion", infoPlistPath),
    shortVersion: requiredString(infoPlist.CFBundleShortVersionString, "CFBundleShortVersionString", infoPlistPath),
    cdHashes: {},
  };

  for (const arch of architectures) {
    const codesignArch = arch === "x64" ? "x86_64" : arch;
    const result = spawn(
      "/usr/bin/codesign",
      ["--display", "--verbose=4", "--arch", codesignArch, appPath],
      { encoding: "utf8" },
    );
    const details = commandResultDetails(result);
    if (result.error || result.status !== 0) {
      throw new Error(`Could not inspect ${codesignArch} code signature for ${appPath}${details ? `: ${details}` : ""}`);
    }
    const cdHash = details.match(/^CDHash=([a-f0-9]+)$/im)?.[1]?.toLowerCase();
    if (!cdHash) {
      throw new Error(`Missing ${codesignArch} CDHash for ${appPath}`);
    }
    identity.cdHashes[arch] = cdHash;
  }

  return identity;
}

export function assertMatchingAppIdentity(source, mounted, sourceAppPath = "source app", mountedAppPath = "mounted app") {
  for (const field of ["bundleIdentifier", "bundleVersion", "shortVersion"]) {
    if (source[field] !== mounted[field]) {
      throw new Error(
        `DMG app identity mismatch for ${field}: ${sourceAppPath} has ${source[field]}, ${mountedAppPath} has ${mounted[field]}`,
      );
    }
  }
  const architectures = [...new Set([...Object.keys(source.cdHashes || {}), ...Object.keys(mounted.cdHashes || {})])].sort();
  for (const arch of architectures) {
    if (!source.cdHashes?.[arch] || source.cdHashes[arch] !== mounted.cdHashes?.[arch]) {
      throw new Error(
        `DMG app CDHash mismatch for ${arch}: ${sourceAppPath} has ${source.cdHashes?.[arch] || "none"}, ${mountedAppPath} has ${mounted.cdHashes?.[arch] || "none"}`,
      );
    }
  }
}

export function assertExpectedAppVersion(identity, expectedVersion, appPath = "packaged app") {
  for (const field of ["bundleVersion", "shortVersion"]) {
    if (identity[field] !== expectedVersion) {
      throw new Error(
        `Packaged app version mismatch for ${field}: expected ${expectedVersion}, ${appPath} has ${identity[field] || "none"}`,
      );
    }
  }
}

function rebuildLocalDmg(dmgPath, appPath, arch) {
  console.warn("finalize-mac-dmg: rebuilding without Gatekeeper trust verification because HAOLO_ALLOW_UNTRUSTED_MAC_DMG is enabled");
  const tempRoot = fs.mkdtempSync(path.join(releaseDir, ".haolo-final-dmg-"));
  const stageDir = path.join(tempRoot, "stage");
  const candidateDmgPath = path.join(tempRoot, path.basename(dmgPath));
  try {
    fs.mkdirSync(stageDir);
    const visibleAppPath = path.join(stageDir, `${displayName}.app`);
    execFileSync("/usr/bin/ditto", [appPath, visibleAppPath], { stdio: "inherit" });
    fs.symlinkSync("/Applications", path.join(stageDir, "Applications"));
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=1", visibleAppPath], { stdio: "inherit" });
    execFileSync("/usr/bin/hdiutil", ["create", "-volname", displayName, "-srcfolder", stageDir, "-ov", "-format", "UDZO", candidateDmgPath], {
      stdio: "inherit",
    });
    verifyDmgContents(candidateDmgPath, appPath, arch);
    fs.renameSync(candidateDmgPath, dmgPath);
    fs.rmSync(`${dmgPath}.blockmap`, { force: true });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function detachMountedDmg(mountPoint, run) {
  try {
    run("/usr/bin/hdiutil", ["detach", mountPoint], commandOptions());
  } catch (initialError) {
    try {
      run("/usr/bin/hdiutil", ["detach", "-force", mountPoint], commandOptions());
    } catch (forceError) {
      throw new Error(
        `hdiutil detach failed normally and with -force: ${commandErrorDetails(initialError)}; ${commandErrorDetails(forceError)}`,
      );
    }
  }
}

function resolveMountedAppPath(mountPoint) {
  const mountRoot = fs.realpathSync(mountPoint);
  const candidates = fs
    .readdirSync(mountPoint, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => path.join(mountPoint, entry.name))
    .filter(isAppBundle);
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one app bundle in mounted DMG ${mountPoint}, found ${candidates.length}: ${candidates.join(", ") || "none"}`,
    );
  }
  assertTreeContainedInMount(candidates[0], mountRoot);
  return candidates[0];
}

function assertTreeContainedInMount(directoryPath, mountRoot, visited = new Set()) {
  const directoryRealPath = fs.realpathSync(directoryPath);
  if (!isPathWithin(directoryRealPath, mountRoot)) {
    throw new Error(`Mounted DMG app escapes its volume: ${directoryPath} -> ${directoryRealPath}`);
  }
  if (visited.has(directoryRealPath)) return;
  visited.add(directoryRealPath);
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isSymbolicLink()) {
      const targetPath = fs.realpathSync(entryPath);
      if (!isPathWithin(targetPath, mountRoot)) {
        throw new Error(`Mounted DMG app symlink escapes its volume: ${entryPath} -> ${targetPath}`);
      }
      if (fs.statSync(entryPath).isDirectory()) {
        assertTreeContainedInMount(targetPath, mountRoot, visited);
      }
      continue;
    }
    if (entry.isDirectory()) {
      assertTreeContainedInMount(entryPath, mountRoot, visited);
    }
  }
}

function isPathWithin(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function isMountPointMounted(mountPoint, parentPath) {
  try {
    return fs.statSync(mountPoint).dev !== fs.statSync(parentPath).dev;
  } catch {
    return false;
  }
}

function resolvePackagedAppPath(dmgPath) {
  const arch = dmgArchitecture(dmgPath);
  const preferredDirs = arch === "universal"
    ? ["mac-universal"]
    : arch === "arm64"
      ? ["mac-arm64"]
      : arch === "x64"
        ? ["mac", "mac-x64"]
        : [];

  for (const dirName of preferredDirs) {
    const candidate = path.join(releaseDir, dirName, `${internalAppName}.app`);
    if (isAppBundle(candidate)) return candidate;
  }
  return null;
}

function dmgArchitecture(dmgPath) {
  const arch = path.basename(dmgPath).match(new RegExp(`^${escapeRegExp(displayName)}-${escapeRegExp(version)}-(universal|arm64|x64)\\.dmg$`))?.[1];
  if (!arch) throw new Error(`Unsupported macOS DMG artifact name: ${path.basename(dmgPath)}`);
  return arch;
}

function expectedArchitectures(arch) {
  return arch === "universal" ? ["arm64", "x64"] : [arch];
}

function normalizeMacDmgTarget(value) {
  const target = String(value || "").trim().toLowerCase();
  if (!target) return null;
  if (["all", "arm64", "split", "universal", "x64"].includes(target)) return target;
  throw new Error(`Unsupported macOS DMG target: ${value}. Use universal, x64, arm64, split, or all.`);
}

function macDmgTargetArchitectures(target) {
  if (!target || target === "all") return null;
  if (target === "split") return new Set(["arm64", "x64"]);
  return new Set([target]);
}

function isAppBundle(candidate) {
  return fs.existsSync(path.join(candidate, "Contents", "Info.plist"));
}

function commandOptions() {
  return { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
}

function commandResultDetails(result) {
  return [result?.error?.message, result?.stdout, result?.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function commandErrorDetails(error) {
  return [error?.message, error?.stdout, error?.stderr]
    .filter(Boolean)
    .map(String)
    .join("\n")
    .trim();
}

function requiredString(value, key, source) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Missing ${key} in ${source}`);
  return normalized;
}

function parseJsonObject(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(String(value || ""));
  } catch (error) {
    throw new Error(`${label}: ${error?.message || error}`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${label}: expected an object.`);
  }
  return parsed;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await finalizeMacDmgs(parseFinalizeMacDmgArgs(process.argv.slice(2)));
}
