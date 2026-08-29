import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_CONNECT_TIMEOUT_MS = 120_000;
const DEFAULT_STALL_TIMEOUT_MS = 60_000;

export async function downloadFileWithResume(options = {}) {
  const url = String(options.url || "").trim();
  const destinationValue = String(options.destinationPath || "").trim();
  if (!destinationValue) throw new Error("更新包目标路径为空。");
  const destinationPath = path.resolve(destinationValue);
  const partialPath = path.resolve(String(options.partialPath || `${destinationPath}.part`));
  const fetchImpl = options.fetchImpl;
  const expectedSize = positiveInteger(options.expectedSize);
  const expectedSha256 = normalizedSha256(options.expectedSha256);
  const maxAttempts = Math.max(1, positiveInteger(options.maxAttempts) || DEFAULT_MAX_ATTEMPTS);
  const connectTimeoutMs = Math.max(1_000, positiveInteger(options.connectTimeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS);
  const stallTimeoutMs = Math.max(1_000, positiveInteger(options.stallTimeoutMs) || DEFAULT_STALL_TIMEOUT_MS);
  const requestHeaders = { ...(options.headers || {}) };
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

  if (!url) throw new Error("更新包下载地址为空。");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (partialPath === destinationPath) throw new Error("更新包临时路径不能与目标路径相同。");

  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const completed = await useCompletePartialFile({
        partialPath,
        destinationPath,
        expectedSize,
        expectedSha256,
      });
      if (completed) {
        onProgress?.({ downloadedBytes: completed.sizeBytes, totalBytes: expectedSize || completed.sizeBytes, attempt, resumed: true });
        return completed;
      }

      const result = await downloadAttempt({
        url,
        partialPath,
        destinationPath,
        fetchImpl,
        requestHeaders,
        expectedSize,
        expectedSha256,
        connectTimeoutMs,
        stallTimeoutMs,
        attempt,
        onProgress,
      });
      return result;
    } catch (error) {
      lastError = error;
      if (error?.nonRetryable || attempt >= maxAttempts) break;
      await retryDelay(attempt);
    }
  }

  throw lastError || new Error("更新包下载失败。");
}

async function downloadAttempt({
  url,
  partialPath,
  destinationPath,
  fetchImpl,
  requestHeaders,
  expectedSize,
  expectedSha256,
  connectTimeoutMs,
  stallTimeoutMs,
  attempt,
  onProgress,
}) {
  let resumedBytes = await fileSize(partialPath);
  if (expectedSize && resumedBytes > expectedSize) {
    await deleteFileQuietly(partialPath);
    resumedBytes = 0;
  }

  const headers = { ...requestHeaders };
  if (resumedBytes > 0) headers.Range = `bytes=${resumedBytes}-`;

  const controller = new AbortController();
  let connectTimer = setTimeout(() => controller.abort(new Error("连接更新服务器超时。")), connectTimeoutMs);
  connectTimer.unref?.();
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(connectTimer);
    connectTimer = null;
  }

  if (response.status === 416 && expectedSize && resumedBytes === expectedSize) {
    return finalizePartialFile({ partialPath, destinationPath, expectedSize, expectedSha256 });
  }
  if (response.status === 416) {
    await deleteFileQuietly(partialPath);
    throw new Error("更新包断点已失效，正在重新下载。");
  }
  if (!response.ok || !response.body) {
    const error = new Error(`更新包下载失败：HTTP ${response.status}`);
    error.nonRetryable = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 416 && response.status !== 429;
    throw error;
  }

  const contentRange = parseContentRange(response.headers.get("content-range"));
  const canAppend = resumedBytes > 0 && response.status === 206 && contentRange?.start === resumedBytes;
  if (resumedBytes > 0 && !canAppend) {
    await deleteFileQuietly(partialPath);
    resumedBytes = 0;
  }
  if (expectedSize && contentRange?.total && contentRange.total !== expectedSize) {
    await deleteFileQuietly(partialPath);
    const error = new Error("更新包远端大小与发布信息不一致。");
    error.nonRetryable = true;
    throw error;
  }

  const contentLength = positiveInteger(response.headers.get("content-length"));
  const totalBytes = expectedSize || contentRange?.total || (contentLength ? resumedBytes + contentLength : 0);
  let downloadedBytes = resumedBytes;
  let stallTimer = null;
  const resetStallTimer = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(new Error("更新包下载长时间没有收到数据。")), stallTimeoutMs);
    stallTimer.unref?.();
  };
  const progressStream = new Transform({
    transform(chunk, _encoding, callback) {
      downloadedBytes += chunk.length;
      resetStallTimer();
      onProgress?.({ downloadedBytes, totalBytes, attempt, resumed: canAppend });
      callback(null, chunk);
    },
  });

  onProgress?.({ downloadedBytes, totalBytes, attempt, resumed: canAppend });
  resetStallTimer();
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      progressStream,
      fs.createWriteStream(partialPath, { flags: canAppend ? "a" : "w" }),
    );
  } finally {
    clearTimeout(stallTimer);
  }

  const actualSize = await fileSize(partialPath);
  if (expectedSize && actualSize < expectedSize) {
    throw new Error(`更新包下载不完整：已下载 ${actualSize} / ${expectedSize} 字节。`);
  }
  if (expectedSize && actualSize > expectedSize) {
    await deleteFileQuietly(partialPath);
    throw new Error("更新包大小校验失败，已重新准备完整下载。");
  }

  return finalizePartialFile({ partialPath, destinationPath, expectedSize, expectedSha256 });
}

async function useCompletePartialFile({ partialPath, destinationPath, expectedSize, expectedSha256 }) {
  if (!expectedSize) return null;
  const sizeBytes = await fileSize(partialPath);
  if (sizeBytes !== expectedSize) return null;
  return finalizePartialFile({ partialPath, destinationPath, expectedSize, expectedSha256 });
}

async function finalizePartialFile({ partialPath, destinationPath, expectedSize, expectedSha256 }) {
  const sizeBytes = await fileSize(partialPath);
  if (!sizeBytes || (expectedSize && sizeBytes !== expectedSize)) {
    throw new Error("更新包大小校验失败，请重试。");
  }
  const sha256 = await sha256File(partialPath);
  if (expectedSha256 && sha256 !== expectedSha256) {
    await deleteFileQuietly(partialPath);
    throw new Error("更新包 SHA-256 校验失败，请重试。");
  }
  await deleteFileQuietly(destinationPath);
  await fs.promises.rename(partialPath, destinationPath);
  return { path: destinationPath, sizeBytes, sha256 };
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), new Writable({
    write(chunk, _encoding, callback) {
      hash.update(chunk);
      callback();
    },
  }));
  return hash.digest("hex").toLowerCase();
}

function parseContentRange(value) {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(value || "").trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === "*" ? 0 : Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  return { start, end, total: Number.isSafeInteger(total) ? total : 0 };
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizedSha256(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : "";
}

async function fileSize(filePath) {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.isFile() ? stats.size : 0;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

async function deleteFileQuietly(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function retryDelay(attempt) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.min(2_000, 400 * 2 ** Math.max(0, attempt - 1)));
  });
}
