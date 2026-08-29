import fs from "node:fs";
import path from "node:path";

const HISTORY_DIR_NAMES = ["sessions", "archived_sessions"];

export function migrateLegacyDefaultCodexHome({ legacyHomes = [], targetHome, logger = console } = {}) {
  const target = targetHome ? path.resolve(String(targetHome)) : "";
  if (!target) return { action: "skipped", reason: "missing-target" };
  if (codexHomeHasHistory(target)) return { action: "skipped", reason: "target-has-history" };

  for (const legacyHome of legacyHomes) {
    const source = legacyHome ? path.resolve(String(legacyHome)) : "";
    if (!source || source === target) continue;
    if (!codexHomeHasHistory(source)) continue;
    try {
      fs.mkdirSync(target, { recursive: true });
      const copied = copyMissingHistoryDirs(source, target);
      if (copied.length) {
        return { action: "migrated", source, target, copied };
      }
    } catch (error) {
      logger?.warn?.("[user-data] failed to migrate legacy Haolo history", error?.message || error);
      return { action: "failed", source, target, error: error?.message || String(error) };
    }
  }

  return { action: "skipped", reason: "no-legacy-history" };
}

export function codexHomeHasHistory(codexHome) {
  const home = codexHome ? path.resolve(String(codexHome)) : "";
  if (!home) return false;
  return HISTORY_DIR_NAMES.some((dirName) => directoryHasFiles(path.join(home, dirName)));
}

function copyMissingHistoryDirs(sourceHome, targetHome) {
  const copied = [];
  for (const dirName of HISTORY_DIR_NAMES) {
    const source = path.join(sourceHome, dirName);
    if (!directoryHasFiles(source)) continue;
    const target = path.join(targetHome, dirName);
    if (directoryHasFiles(target)) continue;
    copyDirectoryWithoutOverwrite(source, target);
    copied.push(dirName);
  }
  return copied;
}

function directoryHasFiles(dirPath) {
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const childPath = path.join(dirPath, entry.name);
      if (entry.isFile()) return true;
      if (entry.isDirectory() && directoryHasFiles(childPath)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function copyDirectoryWithoutOverwrite(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryWithoutOverwrite(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile() || fs.existsSync(targetPath)) continue;
    fs.copyFileSync(sourcePath, targetPath);
  }
}
