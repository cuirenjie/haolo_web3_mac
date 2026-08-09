import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEV_EXECUTABLE_CACHE_VERSION = 1;

export function prepareWindowsDevelopmentExecutable({
  sourceExecutablePath,
  iconPath,
  setExecutableIcon,
  platform = process.platform,
} = {}) {
  if (platform !== "win32" || path.extname(String(sourceExecutablePath || "")).toLowerCase() !== ".exe") {
    return sourceExecutablePath;
  }
  if (!sourceExecutablePath || !fs.existsSync(sourceExecutablePath)) {
    throw new Error(`Electron executable not found: ${sourceExecutablePath || "<empty>"}`);
  }
  if (!iconPath || !fs.existsSync(iconPath)) {
    throw new Error(`Haolo development icon not found: ${iconPath || "<empty>"}`);
  }
  if (typeof setExecutableIcon !== "function") {
    throw new TypeError("setExecutableIcon must be a function");
  }

  const fingerprint = developmentExecutableFingerprint(sourceExecutablePath, iconPath);
  const executablePath = path.join(
    path.dirname(sourceExecutablePath),
    `haolo_desktop_dev-${fingerprint}.exe`,
  );
  if (fs.existsSync(executablePath)) {
    return executablePath;
  }

  const temporaryPath = `${executablePath}.${process.pid}.tmp`;
  try {
    fs.copyFileSync(sourceExecutablePath, temporaryPath);
    setExecutableIcon(temporaryPath, iconPath);
    try {
      fs.renameSync(temporaryPath, executablePath);
    } catch (error) {
      if (!fs.existsSync(executablePath)) throw error;
    }
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {}
  }

  return executablePath;
}

export function developmentExecutableFingerprint(sourceExecutablePath, iconPath) {
  const sourceStat = fs.statSync(sourceExecutablePath);
  const iconBytes = fs.readFileSync(iconPath);
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        version: DEV_EXECUTABLE_CACHE_VERSION,
        sourceSize: sourceStat.size,
        sourceModifiedAt: sourceStat.mtimeMs,
      }),
    )
    .update(iconBytes)
    .digest("hex")
    .slice(0, 12);
}
