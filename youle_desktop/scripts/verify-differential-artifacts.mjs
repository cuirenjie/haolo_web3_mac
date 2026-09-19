// Reconstruct a real installer using local Range responses; never execute it.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { rememberDifferentialBase } from "../src/main/app-update-differential.mjs";
import { downloadFileFromMirrors } from "../src/main/app-update-downloader.mjs";

const [oldFile, newFile] = process.argv.slice(2).map((p) => path.resolve(p));
if (!oldFile || !newFile) throw Error("usage: node verify-differential-artifacts.mjs OLD.exe NEW.exe");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "haolo-real-delta-"));
const base = path.join(directory, "base.exe"), destinationPath = path.join(directory, "next.exe");
const expected = await fs.readFile(newFile);
const hash = crypto.createHash("sha256").update(expected).digest("hex");
const map = await fs.readFile(newFile + ".blockmap");
let ranges = 0, networkBytes = 0;
try {
  await fs.copyFile(oldFile, base);
  await rememberDifferentialBase({ path: base, sizeBytes: (await fs.stat(base)).size, sha256: "fixture" }, await fs.readFile(oldFile + ".blockmap"));
  const result = await downloadFileFromMirrors({ urls: ["https://local-replay.invalid/next.exe"], destinationPath,
    expectedSha256: hash, expectedSize: expected.length, differential: true, maxAttempts: 1,
    fetchImpl: async (url, init) => {
      if (url.endsWith(".blockmap")) return new Response(map);
      const match = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range || "");
      if (!match) throw Error("unexpected full fallback in artifact acceptance");
      const [, start, end] = match;
      const bytes = expected.subarray(Number(start), Number(end) + 1);
      ranges++; networkBytes += bytes.length;
      return new Response(bytes, { status: 206, headers: { "content-range": `bytes ${start}-${end}/${expected.length}` } });
    } });
  if (!result.differential || result.sha256 !== hash) throw Error("artifact acceptance failed");
  console.log(JSON.stringify({ oldFile, newFile, fullBytes: expected.length, networkBytes, rangeRequests: ranges, savedPercent: 100 * (1 - networkBytes / expected.length), sha256: result.sha256, reconstructed: true }));
} finally {
  // Only exact files inside our freshly allocated test directory.
  for (const name of await fs.readdir(directory)) await fs.unlink(path.join(directory, name));
  await fs.rmdir(directory);
}
