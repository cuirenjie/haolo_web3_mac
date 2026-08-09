import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractTarGzipArchive } from "../src/main/runtime-archive.mjs";
import { createTarGzip } from "./helpers/runtime-tar.mjs";

test("runtime archive extraction streams regular files into a private target", async (t) => {
  const fixture = await archiveFixture(t);
  await fs.promises.writeFile(
    fixture.archivePath,
    createTarGzip([
      { name: "bin/", type: "directory" },
      { name: "bin/python.exe", content: "python-runtime" },
      { name: "empty.txt", content: "" },
    ]),
  );

  const result = await extractTarGzipArchive({
    archivePath: fixture.archivePath,
    destinationRoot: fixture.destinationRoot,
  });

  assert.equal(result.entryCount, 3);
  assert.equal(result.totalBytes, Buffer.byteLength("python-runtime"));
  assert.equal(
    await fs.promises.readFile(path.join(fixture.destinationRoot, "bin", "python.exe"), "utf8"),
    "python-runtime",
  );
  assert.equal((await fs.promises.stat(path.join(fixture.destinationRoot, "empty.txt"))).size, 0);
});

test("runtime archive extraction rejects traversal and link entries", async (t) => {
  const fixture = await archiveFixture(t);
  await fs.promises.writeFile(
    fixture.archivePath,
    createTarGzip([{ name: "../outside.txt", content: "escape" }]),
  );
  await assert.rejects(
    extractTarGzipArchive({
      archivePath: fixture.archivePath,
      destinationRoot: fixture.destinationRoot,
    }),
    { code: "HAOLO_RUNTIME_ARCHIVE_UNSAFE_PATH" },
  );
  await assert.rejects(fs.promises.stat(path.join(fixture.root, "outside.txt")), { code: "ENOENT" });

  await fs.promises.rm(fixture.destinationRoot, { recursive: true, force: true });
  await fs.promises.writeFile(
    fixture.archivePath,
    createTarGzip([{ name: "python-link", type: "symlink" }]),
  );
  await assert.rejects(
    extractTarGzipArchive({
      archivePath: fixture.archivePath,
      destinationRoot: fixture.destinationRoot,
    }),
    { code: "HAOLO_RUNTIME_ARCHIVE_UNSUPPORTED_ENTRY" },
  );
});

test("runtime archive extraction requires a TAR end marker", async (t) => {
  const fixture = await archiveFixture(t);
  await fs.promises.writeFile(
    fixture.archivePath,
    createTarGzip([{ name: "tool.txt", content: "tool" }], { includeEndMarker: false }),
  );
  await assert.rejects(
    extractTarGzipArchive({
      archivePath: fixture.archivePath,
      destinationRoot: fixture.destinationRoot,
    }),
    { code: "HAOLO_RUNTIME_ARCHIVE_INVALID" },
  );
});

async function archiveFixture(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-runtime-archive-test-"));
  t.after(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });
  return {
    root,
    archivePath: path.join(root, "runtime.tar.gz"),
    destinationRoot: path.join(root, "extracted"),
  };
}
