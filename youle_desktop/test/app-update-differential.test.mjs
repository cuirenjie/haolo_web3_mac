import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { parseBlockMap, rememberDifferentialBase } from "../src/main/app-update-differential.mjs";
import { downloadFileFromMirrors } from "../src/main/app-update-downloader.mjs";

const digest = (body) => crypto.createHash("sha256").update(body).digest("hex");
function fixtureMap(parts) {
  return gzipSync(JSON.stringify({ version: "2", files: [{ offset: 0, sizes: parts.map((b) => b.length), checksums: parts.map(digest) }] }));
}

for (const failure of ["none", "range-ignored", "base-corrupt", "map-missing", "truncated", "wrong-range", "oversized"]) {
  test(`differential download and safe full fallback: ${failure}`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "haolo-delta-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const blocks = ["a", "b", "c", "d"].map((x) => Buffer.from(x.repeat(4096)));
    const next = [blocks[0], Buffer.from("e".repeat(4096)), blocks[2], blocks[3]];
    const original = Buffer.concat(blocks), expected = Buffer.concat(next);
    const oldPath = path.join(directory, "old.exe"), destinationPath = path.join(directory, "new.exe");
    await fs.writeFile(oldPath, original);
    await rememberDifferentialBase({ path: oldPath, sha256: digest(original), sizeBytes: original.length }, fixtureMap(blocks));
    if (failure === "base-corrupt") await fs.writeFile(oldPath, Buffer.alloc(original.length));
    let fullRequests = 0, downloaded = 0;
    const result = await downloadFileFromMirrors({
      urls: ["https://assets.example.test/new.exe"], destinationPath,
      expectedSize: expected.length, expectedSha256: digest(expected), differential: true, maxAttempts: 1,
      fetchImpl: async (url, init) => {
        if (url.endsWith(".blockmap")) return failure === "map-missing" ? new Response("missing", { status: 404 }) : new Response(fixtureMap(next));
        if (init.headers.Range) {
          if (failure === "range-ignored") return new Response(expected);
          const [, start, end] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
          let body = expected.subarray(Number(start), Number(end) + 1);
          if (failure === "truncated") body = body.subarray(0, 2);
          if (failure === "oversized") body = Buffer.concat([body, Buffer.alloc(1)]);
          downloaded += body.length;
          return new Response(body, { status: 206, headers: { "content-range": failure === "wrong-range" ? "bytes 0-1/2" : `bytes ${start}-${end}/${expected.length}` } });
        }
        fullRequests++; return new Response(expected);
      },
    });
    assert.deepEqual(await fs.readFile(destinationPath), expected);
    assert.equal(result.sha256, digest(expected));
    assert.equal(fullRequests, failure === "none" ? 0 : 1);
    if (failure === "none") { assert.equal(result.differential, true); assert.equal(downloaded, 4096); }
    await assert.rejects(fs.stat(destinationPath + ".differential-part"), { code: "ENOENT" });
  });
}

test("hostile blockmaps fail closed", () => {
  assert.throws(() => parseBlockMap(gzipSync(Buffer.alloc(17 * 1024 * 1024)), 1));
  assert.throws(() => parseBlockMap(fixtureMap([Buffer.from("x")]), 2), /size mismatch/);
});

test("a missing baseline downloads the full installer without waiting for optional metadata", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "haolo-cold-update-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const payload = Buffer.from("cold-installer");
  let releaseMap;
  const pendingMap = new Promise((resolve) => { releaseMap = resolve; });
  try {
    const result = await downloadFileFromMirrors({ urls: ["https://assets.example.test/cold.exe"],
      destinationPath: path.join(directory, "cold.exe"), expectedSize: payload.length,
      expectedSha256: digest(payload), differential: true,
      fetchImpl: async (url) => url.endsWith(".blockmap") ? pendingMap : new Response(payload),
    });
    assert.equal(result.sha256, digest(payload));
  } finally { releaseMap(new Response("not found", { status: 404 })); }
});
