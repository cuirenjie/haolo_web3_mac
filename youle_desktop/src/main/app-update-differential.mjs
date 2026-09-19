import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const MAX_MAP = 2 * 1024 * 1024;
const MAX_RANGE = 8 * 1024 * 1024;
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

export function parseBlockMap(bytes, expectedSize) {
  if (bytes.length > MAX_MAP) throw Error("blockmap too large");
  const map = JSON.parse(gunzipSync(bytes, { maxOutputLength: 8 * MAX_MAP }).toString("utf8"));
  if (map.version !== "2" || map.files?.length !== 1 || map.files[0].offset !== 0) throw Error("unsupported blockmap");
  const file = map.files[0];
  if (!Array.isArray(file.sizes) || !Array.isArray(file.checksums) || file.sizes.length !== file.checksums.length || file.sizes.length > 100000) throw Error("invalid blockmap");
  let offset = 0;
  const blocks = file.sizes.map((size, index) => {
    const checksum = file.checksums[index];
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_RANGE || typeof checksum !== "string" || !/^[A-Za-z0-9+/=_-]{8,128}$/.test(checksum)) throw Error("invalid block");
    const block = { offset, size, checksum }; offset += size; return block;
  });
  if (offset !== expectedSize || !Number.isSafeInteger(expectedSize) || expectedSize <= 0) throw Error("blockmap size mismatch");
  return blocks;
}

export function differentialPlan(oldBlocks, newBlocks) {
  const index = new Map(oldBlocks.map((b) => [`${b.checksum}:${b.size}`, b]));
  const operations = [];
  for (const block of newBlocks) {
    const old = index.get(`${block.checksum}:${block.size}`);
    const next = { kind: old ? "copy" : "download", source: old?.offset ?? block.offset, target: block.offset, size: block.size };
    const previous = operations.at(-1);
    if (previous && previous.kind === next.kind && previous.source + previous.size === next.source && previous.target + previous.size === next.target && previous.size + next.size <= MAX_RANGE) previous.size += next.size;
    else operations.push(next);
  }
  // Buying a few unchanged bytes is cheaper than many serialized WAN round
  // trips. Merge nearby ranges, still bounded to 8 MiB per request.
  const merged = []; let lastDownload = -1;
  for (const operation of operations) {
    if (operation.kind === "download" && lastDownload >= 0) {
      const previous = merged[lastDownload];
      const gap = operation.target - previous.target - previous.size;
      const span = operation.target + operation.size - previous.target;
      if (gap <= 256 * 1024 && span <= MAX_RANGE) {
        previous.size = span; merged.splice(lastDownload + 1); continue;
      }
    }
    merged.push({ ...operation });
    if (operation.kind === "download") lastDownload = merged.length - 1;
  }
  return merged;
}

async function boundedResponse(response, limit) {
  if (!response.body) throw Error("missing response body");
  const reader = response.body.getReader();
  const parts = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) throw Error("response exceeds byte limit");
      parts.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(parts, length);
}

export async function fetchBlockMap(url, fetchImpl, headers = {}) {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password) throw Error("HTTPS required");
  target.pathname += ".blockmap";
  const response = await fetchImpl(target.toString(), { headers: { ...headers, "Accept-Encoding": "identity" }, redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) { await response.body?.cancel(); throw Error("blockmap unavailable"); }
  return boundedResponse(response, MAX_MAP);
}

export async function tryDifferentialDownload(options, newMapBytes) {
  const { destinationPath, expectedSize, expectedSha256, fetchImpl, url } = options;
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256 || "")) return null;
  const receiptPath = path.join(path.dirname(destinationPath), "differential-base.json");
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  // Receipt cannot point outside the updater's own directory.
  if (typeof receipt.file !== "string" || path.basename(receipt.file) !== receipt.file || !receipt.file.endsWith(".exe")) return null;
  const basePath = path.join(path.dirname(destinationPath), receipt.file);
  if (path.resolve(basePath) === path.resolve(destinationPath)) return null;
  const baseStat = await fs.stat(basePath);
  if ((await fs.stat(basePath + ".blockmap")).size > MAX_MAP) return null;
  const oldMapBytes = await fs.readFile(basePath + ".blockmap");
  const oldBlocks = parseBlockMap(oldMapBytes, baseStat.size);
  const newBlocks = parseBlockMap(newMapBytes, expectedSize);
  const operations = differentialPlan(oldBlocks, newBlocks);
  const downloads = operations.filter((x) => x.kind === "download");
  const networkBytes = downloads.reduce((sum, x) => sum + x.size, 0);
  if (networkBytes > expectedSize * 0.8 || downloads.length > 256) return null;
  const temporary = destinationPath + ".differential-part";
  const input = await fs.open(basePath, "r");
  let output;
  let complete = 0;
  const hash = crypto.createHash("sha256");
  const controller = new AbortController();
  const pending = new Map(); let nextDownload = 0;
  const readRange = async (operation) => {
    const end = operation.source + operation.size - 1;
    const response = await fetchImpl(url, {
      headers: { ...options.headers, "Accept-Encoding": "identity", Range: `bytes=${operation.source}-${end}` },
      redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
    });
    if (response.status !== 206 || response.headers.get("content-range") !== `bytes ${operation.source}-${end}/${expectedSize}`) {
      await response.body?.cancel(); throw Error("exact Range response required");
    }
    const bytes = await boundedResponse(response, operation.size);
    if (bytes.length !== operation.size) throw Error("truncated Range response");
    return bytes;
  };
  const prefetch = () => {
    while (pending.size < 3 && nextDownload < downloads.length) {
      const operation = downloads[nextDownload++];
      const work = readRange(operation);
      work.catch(() => {}); // May reject while an earlier range is being written.
      pending.set(operation, work);
    }
  };
  try {
    output = await fs.open(temporary, "w");
    prefetch();
    // Ordered writes keep hashing/progress constant-memory. Contiguous changed
    // blocks are combined into bounded ranges instead of one GET per block.
    for (const operation of operations) {
      let bytes;
      if (operation.kind === "copy") {
        bytes = Buffer.allocUnsafe(operation.size);
        const result = await input.read(bytes, 0, bytes.length, operation.source);
        if (result.bytesRead !== bytes.length) throw Error("base installer truncated");
      } else {
        bytes = await pending.get(operation);
        pending.delete(operation); prefetch();
      }
      let written = 0;
      while (written < bytes.length) {
        const result = await output.write(bytes, written, bytes.length - written, operation.target + written);
        if (!result.bytesWritten) throw Error("short disk write");
        written += result.bytesWritten;
      }
      hash.update(bytes); complete += bytes.length;
      options.onProgress?.({ downloadedBytes: complete, totalBytes: expectedSize, differential: true, networkBytes });
    }
    if (complete !== expectedSize || hash.digest("hex") !== expectedSha256.toLowerCase()) throw Error("differential SHA-256 mismatch");
    await output.sync(); await output.close(); output = null;
    await fs.rename(temporary, destinationPath);
    return { path: destinationPath, sizeBytes: expectedSize, sha256: expectedSha256.toLowerCase(), differential: true, networkBytes };
  } finally {
    controller.abort();
    await Promise.allSettled(pending.values());
    await input.close(); await output?.close();
    await fs.unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function rememberDifferentialBase(result, mapBytes) {
  if (!mapBytes) return;
  parseBlockMap(mapBytes, result.sizeBytes);
  await fs.writeFile(result.path + ".blockmap", mapBytes);
  const receipt = path.join(path.dirname(result.path), "differential-base.json");
  await fs.writeFile(receipt + ".tmp", JSON.stringify({ file: path.basename(result.path), sha256: result.sha256, mapSha256: sha(mapBytes) }));
  await fs.rename(receipt + ".tmp", receipt);
}
