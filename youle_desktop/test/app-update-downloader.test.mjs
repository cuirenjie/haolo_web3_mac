import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadFileWithResume } from "../src/main/app-update-downloader.mjs";

const payload = Buffer.from(Array.from({ length: 32_768 }, (_, index) => `update-block-${index.toString(16).padStart(4, "0")}\n`).join(""));
const payloadSha256 = crypto.createHash("sha256").update(payload).digest("hex");

test("update downloader resumes an existing partial file with a Range request", async (t) => {
  const fixture = await updateFixture(t);
  const resumeAt = Math.floor(payload.length / 3);
  await fs.promises.writeFile(fixture.partialPath, payload.subarray(0, resumeAt));
  const requests = [];

  const result = await downloadFileWithResume({
    url: "https://downloads.example.test/haolo-update.exe",
    destinationPath: fixture.destinationPath,
    partialPath: fixture.partialPath,
    expectedSize: payload.length,
    expectedSha256: payloadSha256,
    fetchImpl: async (_url, init) => {
      requests.push(init);
      assert.equal(init.headers.Range, `bytes=${resumeAt}-`);
      return new Response(payload.subarray(resumeAt), {
        status: 206,
        headers: {
          "content-length": String(payload.length - resumeAt),
          "content-range": `bytes ${resumeAt}-${payload.length - 1}/${payload.length}`,
        },
      });
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(result.sizeBytes, payload.length);
  assert.equal(result.sha256, payloadSha256);
  assert.deepEqual(await fs.promises.readFile(fixture.destinationPath), payload);
  await assert.rejects(fs.promises.stat(fixture.partialPath), { code: "ENOENT" });
});

test("update downloader restarts cleanly when the server ignores Range", async (t) => {
  const fixture = await updateFixture(t);
  const resumeAt = 65_537;
  await fs.promises.writeFile(fixture.partialPath, Buffer.alloc(resumeAt, 0xff));

  const result = await downloadFileWithResume({
    url: "https://downloads.example.test/haolo-update.exe",
    destinationPath: fixture.destinationPath,
    partialPath: fixture.partialPath,
    expectedSize: payload.length,
    expectedSha256: payloadSha256,
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.Range, `bytes=${resumeAt}-`);
      return new Response(payload, {
        status: 200,
        headers: { "content-length": String(payload.length) },
      });
    },
  });

  assert.equal(result.sizeBytes, payload.length);
  assert.deepEqual(await fs.promises.readFile(fixture.destinationPath), payload);
});

test("update downloader retries an interrupted response and resumes the bytes already written", async (t) => {
  const fixture = await updateFixture(t);
  const firstChunkSize = Math.floor(payload.length / 4);
  let requestCount = 0;
  let resumedAt = 0;

  const result = await downloadFileWithResume({
    url: "https://downloads.example.test/haolo-update.exe",
    destinationPath: fixture.destinationPath,
    partialPath: fixture.partialPath,
    expectedSize: payload.length,
    expectedSha256: payloadSha256,
    maxAttempts: 2,
    fetchImpl: async (_url, init) => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(payload.subarray(0, firstChunkSize), {
          status: 200,
          headers: { "content-length": String(payload.length) },
        });
      }

      const match = /^bytes=(\d+)-$/.exec(String(init.headers.Range || ""));
      assert.ok(match, "retry should include a Range header");
      resumedAt = Number(match[1]);
      assert.ok(resumedAt > 0 && resumedAt <= firstChunkSize);
      return new Response(payload.subarray(resumedAt), {
        status: 206,
        headers: {
          "content-length": String(payload.length - resumedAt),
          "content-range": `bytes ${resumedAt}-${payload.length - 1}/${payload.length}`,
        },
      });
    },
  });

  assert.equal(requestCount, 2);
  assert.ok(resumedAt > 0);
  assert.equal(result.sha256, payloadSha256);
  assert.deepEqual(await fs.promises.readFile(fixture.destinationPath), payload);
});

test("main process routes app update requests through Electron net.fetch", async () => {
  const source = await fs.promises.readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  assert.match(source, /fetchImpl:\s*appNetworkFetch/);
  assert.match(source, /function appNetworkFetch[\s\S]*return net\.fetch\(url, options\)/);
  assert.ok(source.includes('const partialPath = `${destination}.part`;'));
});

async function updateFixture(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-update-test-"));
  t.after(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });
  const destinationPath = path.join(root, "haolo-update.exe");
  return {
    destinationPath,
    partialPath: `${destinationPath}.part`,
  };
}
