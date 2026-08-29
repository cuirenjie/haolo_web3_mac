import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const HAOLO_RUNTIME_EXECUTABLE = process.platform === "win32" ? "haolo_ai.exe" : "haolo_ai";
export const HAOLO_RUNTIME_MANIFEST = "codex-runtime.json";
export const HAOLO_RUNTIME_READY_MARKER = ".haolo-runtime-ready.json";
export const WINDOWS_HAOLO_RUNTIME_FILES = Object.freeze([
  "haolo_ai.exe",
  "codex-command-runner.exe",
  "codex-windows-sandbox-setup.exe",
]);
export const INHERITED_CODEX_DESKTOP_RUNTIME_ENV_KEYS = Object.freeze([
  "CODEX_INSTALL_DIR",
  "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
  "CODEX_PERMISSION_PROFILE",
  "CODEX_SQLITE_HOME",
  "CODEX_THREAD_ID",
]);

const RUNTIME_READY_SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export function materializeHaoloRuntime({
  sourceBinDir,
  targetBinDir,
  platform = process.platform,
} = {}) {
  const sourceRoot = requiredDirectory(sourceBinDir, "sourceBinDir");
  const targetRoot = requiredDirectory(targetBinDir, "targetBinDir", { create: true });
  const manifest = readAndValidateRuntimeManifest(sourceRoot, { platform });
  const manifestPath = path.join(sourceRoot, HAOLO_RUNTIME_MANIFEST);
  const hasManifestFile = fs.existsSync(manifestPath);
  const manifestSha256 = hasManifestFile
    ? sha256File(manifestPath)
    : sha256Text(JSON.stringify(manifest));
  const marker = readReadyMarker(targetRoot);

  if (readyMarkerMatches(marker, targetRoot, manifest, manifestSha256)) {
    return runtimeResult(targetRoot, manifest, "verified", platform);
  }

  const installedFiles = [];
  for (const entry of manifest.files) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    assertRegularFile(sourcePath, `Bundled Haolo runtime file is missing: ${entry.name}`);
    const sourceSha256 = sha256File(sourcePath);
    if (sourceSha256 !== entry.sha256) {
      throw runtimeError(
        `Bundled Haolo runtime hash mismatch for ${entry.name}: expected ${entry.sha256}, got ${sourceSha256}.`,
        "HAOLO_RUNTIME_SOURCE_HASH_MISMATCH",
      );
    }
    if (!fileMatches(targetPath, entry.sha256)) {
      copyFileAtomic(sourcePath, targetPath);
    }
    const targetSha256 = sha256File(targetPath);
    if (targetSha256 !== entry.sha256) {
      throw runtimeError(
        `Prepared Haolo runtime hash mismatch for ${entry.name}: expected ${entry.sha256}, got ${targetSha256}.`,
        "HAOLO_RUNTIME_TARGET_HASH_MISMATCH",
      );
    }
    const stat = fs.statSync(targetPath);
    installedFiles.push({
      name: entry.name,
      sha256: entry.sha256,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }

  if (hasManifestFile) {
    copyTextFileAtomic(manifestPath, path.join(targetRoot, HAOLO_RUNTIME_MANIFEST));
  }
  writeJsonAtomic(path.join(targetRoot, HAOLO_RUNTIME_READY_MARKER), {
    schemaVersion: RUNTIME_READY_SCHEMA_VERSION,
    runtimeVersion: manifest.version,
    manifestSha256,
    files: installedFiles,
  });
  verifyHaoloRuntimeInstallation(path.join(targetRoot, runtimeExecutableName(platform)), { platform });
  return runtimeResult(targetRoot, manifest, "prepared", platform);
}

export function verifyHaoloRuntimeInstallation(executablePath, { platform = process.platform } = {}) {
  const command = String(executablePath || "").trim();
  if (!command || path.basename(command).toLowerCase() !== runtimeExecutableName(platform).toLowerCase()) {
    return { ok: true, action: "not-haolo-runtime", executablePath: command || null };
  }
  assertRegularFile(command, `Haolo runtime executable is missing: ${command}`);
  if (platform !== "win32") {
    return { ok: true, action: "verified", executablePath: command };
  }

  const binDir = path.dirname(command);
  const manifest = readAndValidateRuntimeManifest(binDir, { platform });
  const manifestPath = path.join(binDir, HAOLO_RUNTIME_MANIFEST);
  const manifestSha256 = sha256File(manifestPath);
  const marker = readReadyMarker(binDir);
  if (!readyMarkerMatches(marker, binDir, manifest, manifestSha256)) {
    for (const entry of manifest.files) {
      const filePath = path.join(binDir, entry.name);
      assertRegularFile(filePath, `Haolo Windows runtime file is missing: ${entry.name}`);
      const actualSha256 = sha256File(filePath);
      if (actualSha256 !== entry.sha256) {
        throw runtimeError(
          `Haolo Windows runtime hash mismatch for ${entry.name}: expected ${entry.sha256}, got ${actualSha256}.`,
          "HAOLO_RUNTIME_TARGET_HASH_MISMATCH",
        );
      }
    }
    return runtimeResult(binDir, manifest, "verified-direct", platform);
  }
  return runtimeResult(binDir, manifest, "verified", platform);
}

export function prependRuntimeBinToPath(env = {}, runtimeBinDir, { platform = process.platform } = {}) {
  const binDir = String(runtimeBinDir || "").trim();
  if (!binDir) return env;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || (platform === "win32" ? "Path" : "PATH");
  const current = String(env[pathKey] || "");
  // `path.delimiter` reflects the running host (and is `;` in an actual
  // Windows process). `path.win32` deliberately has no delimiter property.
  const delimiter = path.delimiter;
  const parts = current.split(delimiter).map((entry) => entry.trim()).filter(Boolean);
  const normalizedBinDir = comparablePath(binDir, platform);
  const filtered = parts.filter((entry) => comparablePath(entry, platform) !== normalizedBinDir);
  env[pathKey] = [binDir, ...filtered].join(delimiter);
  return env;
}

export function isolateHaoloRuntimeEnvironment(env = {}, runtimeBinDir, options = {}) {
  for (const key of INHERITED_CODEX_DESKTOP_RUNTIME_ENV_KEYS) {
    delete env[key];
  }
  const binDir = String(runtimeBinDir || "").trim();
  if (binDir) {
    env.HAOLO_DESKTOP_RUNTIME_BIN_DIR = binDir;
    prependRuntimeBinToPath(env, binDir, options);
  }
  return env;
}

function readAndValidateRuntimeManifest(binDir, { platform }) {
  if (platform !== "win32") {
    const executable = runtimeExecutableName(platform);
    assertRegularFile(path.join(binDir, executable), `Bundled Haolo runtime file is missing: ${executable}`);
    return {
      version: "unversioned",
      files: [{
        name: executable,
        sha256: sha256File(path.join(binDir, executable)),
      }],
    };
  }

  const manifestPath = path.join(binDir, HAOLO_RUNTIME_MANIFEST);
  assertRegularFile(manifestPath, `Bundled Haolo runtime manifest is missing: ${manifestPath}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw runtimeError(`Bundled Haolo runtime manifest is invalid: ${error.message}`, "HAOLO_RUNTIME_MANIFEST_INVALID");
  }
  if (!manifest || typeof manifest !== "object" || !String(manifest.version || "").trim()) {
    throw runtimeError("Bundled Haolo runtime manifest must declare a version.", "HAOLO_RUNTIME_MANIFEST_INVALID");
  }
  if (!Array.isArray(manifest.files)) {
    throw runtimeError("Bundled Haolo runtime manifest must declare files.", "HAOLO_RUNTIME_MANIFEST_INVALID");
  }

  const seen = new Set();
  const files = manifest.files.map((entry) => {
    const name = String(entry?.name || "").trim();
    const sha256 = String(entry?.sha256 || "").trim().toLowerCase();
    if (!name || path.basename(name) !== name || name === "." || name === "..") {
      throw runtimeError(`Bundled Haolo runtime contains an unsafe file name: ${name || "<empty>"}.`, "HAOLO_RUNTIME_MANIFEST_INVALID");
    }
    if (!SHA256_PATTERN.test(sha256)) {
      throw runtimeError(`Bundled Haolo runtime contains an invalid hash for ${name}.`, "HAOLO_RUNTIME_MANIFEST_INVALID");
    }
    const normalizedName = name.toLowerCase();
    if (seen.has(normalizedName)) {
      throw runtimeError(`Bundled Haolo runtime contains duplicate file ${name}.`, "HAOLO_RUNTIME_MANIFEST_INVALID");
    }
    seen.add(normalizedName);
    return { name, sha256 };
  });
  const missing = WINDOWS_HAOLO_RUNTIME_FILES.filter((name) => !seen.has(name.toLowerCase()));
  if (missing.length) {
    throw runtimeError(
      `Bundled Haolo Windows runtime is missing required files: ${missing.join(", ")}.`,
      "HAOLO_RUNTIME_MANIFEST_INCOMPLETE",
    );
  }
  return { ...manifest, files };
}

function readyMarkerMatches(marker, binDir, manifest, manifestSha256) {
  if (
    !marker
    || marker.schemaVersion !== RUNTIME_READY_SCHEMA_VERSION
    || marker.runtimeVersion !== manifest.version
    || marker.manifestSha256 !== manifestSha256
    || !Array.isArray(marker.files)
  ) {
    return false;
  }
  const markerFiles = new Map(marker.files.map((entry) => [String(entry?.name || "").toLowerCase(), entry]));
  return manifest.files.every((entry) => {
    const recorded = markerFiles.get(entry.name.toLowerCase());
    if (!recorded || recorded.sha256 !== entry.sha256) return false;
    const filePath = path.join(binDir, entry.name);
    try {
      const stat = fs.statSync(filePath);
      return stat.isFile()
        && stat.size === recorded.size
        && Math.abs(stat.mtimeMs - recorded.mtimeMs) < 1;
    } catch {
      return false;
    }
  });
}

function runtimeResult(binDir, manifest, action, platform = process.platform) {
  return {
    ok: true,
    action,
    binDir,
    executablePath: path.join(binDir, runtimeExecutableName(platform)),
    runtimeVersion: manifest.version,
    files: manifest.files.map((entry) => path.join(binDir, entry.name)),
  };
}

function runtimeExecutableName(platform) {
  return platform === "win32" ? "haolo_ai.exe" : "haolo_ai";
}

function readReadyMarker(binDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(binDir, HAOLO_RUNTIME_READY_MARKER), "utf8"));
  } catch {
    return null;
  }
}

function fileMatches(filePath, expectedSha256) {
  try {
    return fs.statSync(filePath).isFile() && sha256File(filePath) === expectedSha256;
  } catch {
    return false;
  }
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function copyFileAtomic(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.copyFileSync(source, temp);
    replaceFile(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function copyTextFileAtomic(source, target) {
  const sourceText = fs.readFileSync(source, "utf8");
  try {
    if (fs.readFileSync(target, "utf8") === sourceText) return;
  } catch {
    // Create or replace below.
  }
  writeTextAtomic(target, sourceText);
}

function writeJsonAtomic(target, value) {
  writeTextAtomic(target, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTextAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, value, "utf8");
    replaceFile(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function replaceFile(temp, target) {
  fs.rmSync(target, { force: true });
  fs.renameSync(temp, target);
}

function requiredDirectory(value, name, { create = false } = {}) {
  const resolved = path.resolve(String(value || ""));
  if (!value) throw runtimeError(`${name} is required.`, "HAOLO_RUNTIME_PATH_INVALID");
  if (create) fs.mkdirSync(resolved, { recursive: true });
  try {
    if (!fs.statSync(resolved).isDirectory()) throw new Error("not a directory");
  } catch {
    throw runtimeError(`${name} is not an accessible directory: ${resolved}`, "HAOLO_RUNTIME_PATH_INVALID");
  }
  return resolved;
}

function assertRegularFile(filePath, message) {
  try {
    if (fs.statSync(filePath).isFile()) return;
  } catch {
    // Throw the stable runtime error below.
  }
  throw runtimeError(message, "HAOLO_RUNTIME_FILE_MISSING");
}

function comparablePath(value, platform) {
  const resolved = platform === "win32" ? path.win32.resolve(value) : path.resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function runtimeError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
