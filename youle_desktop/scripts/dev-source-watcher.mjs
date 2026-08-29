import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".scss",
  ".svg",
  ".ts",
  ".tsx",
]);

export async function snapshotDevelopmentSources(sourceRoot, options = {}) {
  const extensions = options.extensions || DEFAULT_SOURCE_EXTENSIONS;
  const files = new Map();
  await visitDirectory(path.resolve(sourceRoot), "");
  return files;

  async function visitDirectory(directoryPath, relativeDirectory) {
    let entries;
    try {
      entries = await fs.promises.readdir(directoryPath, {
        withFileTypes: true,
      });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.join(relativeDirectory, entry.name)
        : entry.name;
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visitDirectory(absolutePath, relativePath);
        continue;
      }
      if (
        !entry.isFile() ||
        !extensions.has(path.extname(entry.name).toLowerCase())
      )
        continue;
      try {
        const contents = await fs.promises.readFile(absolutePath);
        files.set(
          normalizeRelativePath(relativePath),
          crypto.createHash("sha256").update(contents).digest("hex"),
        );
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
}

export function changedDevelopmentSourceFiles(previousSnapshot, nextSnapshot) {
  const changed = new Set();
  for (const [filePath, fingerprint] of nextSnapshot) {
    if (previousSnapshot.get(filePath) !== fingerprint) changed.add(filePath);
  }
  for (const filePath of previousSnapshot.keys()) {
    if (!nextSnapshot.has(filePath)) changed.add(filePath);
  }
  return [...changed].sort((left, right) => left.localeCompare(right));
}

export async function watchDevelopmentSources(
  sourceRoot,
  onChange,
  options = {},
) {
  const debounceMs = Math.max(50, Number(options.debounceMs) || 800);
  const onError =
    typeof options.onError === "function" ? options.onError : () => {};
  const extensions = options.extensions || DEFAULT_SOURCE_EXTENSIONS;
  let snapshot = await snapshotDevelopmentSources(sourceRoot, { extensions });
  let timer = null;
  let closed = false;
  let scanRunning = false;
  let scanQueued = false;

  const watcher = fs.watch(
    path.resolve(sourceRoot),
    { recursive: true },
    (_eventType, filename) => {
      if (!shouldScanWatchEvent(filename, extensions)) return;
      scheduleScan();
    },
  );
  watcher.on("error", onError);

  function scheduleScan() {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void scan();
    }, debounceMs);
  }

  async function scan() {
    if (closed) return;
    if (scanRunning) {
      scanQueued = true;
      return;
    }
    scanRunning = true;
    try {
      do {
        scanQueued = false;
        const nextSnapshot = await snapshotDevelopmentSources(sourceRoot, {
          extensions,
        });
        const changedFiles = changedDevelopmentSourceFiles(
          snapshot,
          nextSnapshot,
        );
        snapshot = nextSnapshot;
        if (changedFiles.length) {
          await onChange(changedFiles);
        }
      } while (scanQueued && !closed);
    } catch (error) {
      onError(error);
    } finally {
      scanRunning = false;
    }
  }

  return {
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      watcher.close();
    },
    scanNow: scan,
  };
}

function shouldScanWatchEvent(filename, extensions) {
  if (filename == null) return true;
  const name = String(filename);
  const extension = path.extname(name).toLowerCase();
  return !extension || extensions.has(extension);
}

function normalizeRelativePath(filePath) {
  return String(filePath).split(path.sep).join("/");
}
