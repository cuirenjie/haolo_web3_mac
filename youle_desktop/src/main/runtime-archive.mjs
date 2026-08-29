import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const TAR_BLOCK_SIZE = 512;
const DEFAULT_MAX_ENTRIES = 50_000;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024;

export async function extractTarGzipArchive({
  archivePath,
  destinationRoot,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxUncompressedBytes = DEFAULT_MAX_UNCOMPRESSED_BYTES,
} = {}) {
  const archive = path.resolve(requiredString(archivePath, "archivePath"));
  const destination = path.resolve(requiredString(destinationRoot, "destinationRoot"));
  assertSafeExtractionRoot(destination);
  await fs.promises.mkdir(destination, { recursive: true });

  const input = fs.createReadStream(archive);
  const gunzip = zlib.createGunzip();
  input.pipe(gunzip);

  let buffer = Buffer.alloc(0);
  let currentFile = null;
  let paddingRemaining = 0;
  let entryCount = 0;
  let totalBytes = 0;
  let sawEndMarker = false;
  const entries = [];

  try {
    for await (const chunk of gunzip) {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);

      while (buffer.length) {
        if (currentFile) {
          if (currentFile.remaining > 0) {
            const writeLength = Math.min(currentFile.remaining, buffer.length);
            if (!writeLength) break;
            const writeBuffer = buffer.subarray(0, writeLength);
            await currentFile.handle.write(writeBuffer);
            currentFile.remaining -= writeLength;
            buffer = buffer.subarray(writeLength);
          }
          if (currentFile.remaining > 0) break;
          await currentFile.handle.close();
          currentFile = null;
          continue;
        }

        if (paddingRemaining > 0) {
          const skipLength = Math.min(paddingRemaining, buffer.length);
          buffer = buffer.subarray(skipLength);
          paddingRemaining -= skipLength;
          if (paddingRemaining > 0) break;
          continue;
        }

        if (buffer.length < TAR_BLOCK_SIZE) break;
        const header = buffer.subarray(0, TAR_BLOCK_SIZE);
        buffer = buffer.subarray(TAR_BLOCK_SIZE);
        if (isZeroTarBlock(header)) {
          sawEndMarker = true;
          continue;
        }
        if (sawEndMarker) {
          throw runtimeArchiveError("运行时压缩包结束标记后仍包含条目。", "HAOLO_RUNTIME_ARCHIVE_INVALID");
        }

        validateTarHeaderChecksum(header);
        const entry = parseTarHeader(header);
        entryCount += 1;
        if (entryCount > maxEntries) {
          throw runtimeArchiveError("运行时压缩包文件数量超过安全限制。", "HAOLO_RUNTIME_ARCHIVE_LIMIT");
        }
        totalBytes += entry.size;
        if (totalBytes > maxUncompressedBytes) {
          throw runtimeArchiveError("运行时压缩包解压后体积超过安全限制。", "HAOLO_RUNTIME_ARCHIVE_LIMIT");
        }

        const targetPath = safeArchiveTarget(destination, entry.name);
        if (entry.type === "directory") {
          await fs.promises.mkdir(targetPath, { recursive: true });
          entries.push({ path: entry.name, type: "directory", size: 0 });
          continue;
        }
        if (entry.type !== "file") {
          throw runtimeArchiveError(
            `运行时压缩包包含不支持的条目类型：${entry.name}`,
            "HAOLO_RUNTIME_ARCHIVE_UNSUPPORTED_ENTRY",
          );
        }

        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        const handle = await fs.promises.open(targetPath, "wx");
        currentFile = {
          handle,
          remaining: entry.size,
        };
        paddingRemaining = tarPadding(entry.size);
        entries.push({ path: entry.name, type: "file", size: entry.size });
        if (entry.mode && process.platform !== "win32") {
          await fs.promises.chmod(targetPath, entry.mode & 0o777).catch(() => {});
        }
      }
    }
  } catch (error) {
    if (currentFile) {
      await currentFile.handle.close().catch(() => {});
      currentFile = null;
    }
    throw error;
  } finally {
    input.destroy();
    gunzip.destroy();
  }

  if (currentFile) {
    const incomplete = currentFile.remaining > 0;
    await currentFile.handle.close().catch(() => {});
    currentFile = null;
    if (incomplete) {
      throw runtimeArchiveError("运行时压缩包中的文件数据不完整。", "HAOLO_RUNTIME_ARCHIVE_INVALID");
    }
  }
  if (!sawEndMarker) {
    throw runtimeArchiveError("运行时压缩包缺少 TAR 结束标记。", "HAOLO_RUNTIME_ARCHIVE_INVALID");
  }
  if (paddingRemaining > 0 || buffer.some((byte) => byte !== 0)) {
    throw runtimeArchiveError("运行时压缩包尾部数据不完整。", "HAOLO_RUNTIME_ARCHIVE_INVALID");
  }

  return {
    entries,
    entryCount,
    totalBytes,
  };
}

function parseTarHeader(header) {
  const name = tarString(header, 0, 100);
  const prefix = tarString(header, 345, 155);
  const fullName = [prefix, name].filter(Boolean).join("/");
  const size = tarOctal(header, 124, 12, "文件大小");
  const mode = tarOctal(header, 100, 8, "文件权限");
  const typeFlag = String.fromCharCode(header[156] || 0);
  const type =
    typeFlag === "\0" || typeFlag === "0"
      ? "file"
      : typeFlag === "5"
        ? "directory"
        : "unsupported";
  if (!fullName) {
    throw runtimeArchiveError("运行时压缩包包含空路径。", "HAOLO_RUNTIME_ARCHIVE_INVALID");
  }
  return {
    name: normalizeArchiveEntryName(fullName),
    size,
    mode,
    type,
  };
}

function validateTarHeaderChecksum(header) {
  const expected = tarOctal(header, 148, 8, "校验和");
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) {
    throw runtimeArchiveError("运行时压缩包 TAR 校验和不正确。", "HAOLO_RUNTIME_ARCHIVE_INVALID");
  }
}

function tarString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset);
  const limit = end >= offset && end < offset + length ? end : offset + length;
  return buffer.subarray(offset, limit).toString("utf8").trim();
}

function tarOctal(buffer, offset, length, label) {
  const raw = buffer
    .subarray(offset, offset + length)
    .toString("ascii")
    .replace(/\0.*$/, "")
    .trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) {
    throw runtimeArchiveError(`运行时压缩包 ${label} 无效。`, "HAOLO_RUNTIME_ARCHIVE_INVALID");
  }
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw runtimeArchiveError(`运行时压缩包 ${label} 超出范围。`, "HAOLO_RUNTIME_ARCHIVE_INVALID");
  }
  return value;
}

function isZeroTarBlock(block) {
  return block.every((byte) => byte === 0);
}

function tarPadding(size) {
  const remainder = size % TAR_BLOCK_SIZE;
  return remainder ? TAR_BLOCK_SIZE - remainder : 0;
}

function safeArchiveTarget(destinationRoot, entryName) {
  const normalized = normalizeArchiveEntryName(entryName);
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.startsWith("\\")
    || /^[a-z]:/i.test(normalized)
  ) {
    throw runtimeArchiveError("运行时压缩包包含不安全路径。", "HAOLO_RUNTIME_ARCHIVE_UNSAFE_PATH");
  }
  const parts = normalized.split("/").filter(Boolean);
  if (
    !parts.length
    || parts.some((part) => part === "." || part === ".." || unsafeWindowsPathSegment(part))
  ) {
    throw runtimeArchiveError("运行时压缩包包含不安全路径。", "HAOLO_RUNTIME_ARCHIVE_UNSAFE_PATH");
  }
  const root = path.resolve(destinationRoot);
  const target = path.resolve(root, ...parts);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw runtimeArchiveError("运行时压缩包路径越界。", "HAOLO_RUNTIME_ARCHIVE_UNSAFE_PATH");
  }
  return target;
}

function unsafeWindowsPathSegment(value) {
  if (process.platform !== "win32") return false;
  if (/[<>:"|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value)) return true;
  const baseName = String(value).split(".")[0].toUpperCase();
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(baseName);
}

function normalizeArchiveEntryName(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
}

function assertSafeExtractionRoot(destination) {
  const parsed = path.parse(destination);
  if (comparablePath(parsed.root) === comparablePath(destination)) {
    throw runtimeArchiveError("运行时解压目标目录不安全。", "HAOLO_RUNTIME_ARCHIVE_UNSAFE_TARGET");
  }
}

function comparablePath(value) {
  const normalized = path.resolve(String(value || "")).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function requiredString(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}

function runtimeArchiveError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
