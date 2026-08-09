import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repoRoot, "extensions", "haolo-chrome");
const outputRoot = path.join(repoRoot, "release", "chrome-extension");
const storeMode = process.argv.includes("--store");
const outputPath = path.join(outputRoot, storeMode ? "haolo-chrome-store.zip" : "haolo-chrome.zip");

await fs.promises.mkdir(outputRoot, { recursive: true });
const files = await collect(sourceRoot);
const entries = files.map((file) => {
  const name = path.relative(sourceRoot, file).replace(/\\/g, "/");
  let data = fs.readFileSync(file);
  if (storeMode && name === "manifest.json") {
    const manifest = JSON.parse(data.toString("utf8"));
    delete manifest.key;
    manifest.version_name = manifest.version;
    data = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  return { name, data };
});
assertReleaseEntries(entries, { storeMode });
const archive = buildZip(entries);
fs.writeFileSync(outputPath, archive);
const sha256 = crypto.createHash("sha256").update(archive).digest("hex");
fs.writeFileSync(`${outputPath}.sha256`, `${sha256}  ${path.basename(outputPath)}\n`, "utf8");
fs.writeFileSync(`${outputPath}.json`, `${JSON.stringify({
  schemaVersion: 1,
  channel: storeMode ? "store" : "development",
  artifact: path.basename(outputPath),
  bytes: archive.length,
  sha256,
  files: entries.length,
  createdAt: new Date().toISOString(),
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, sha256, bytes: archive.length, files: entries.length, storeMode }, null, 2));

async function collect(root) {
  const result = [];
  for (const entry of await fs.promises.readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await collect(fullPath));
    else if (entry.isFile() && entry.name !== "README.md") result.push(fullPath);
  }
  return result.sort();
}

function assertReleaseEntries(entries, { storeMode }) {
  const names = new Set(entries.map((entry) => entry.name));
  for (const required of ["manifest.json", "service-worker.js", "sidepanel.html", "icons/icon-128.png"]) {
    if (!names.has(required)) throw new Error(`Chrome package is missing ${required}`);
  }
  const forbidden = entries.find((entry) => /(?:^|\/)(?:\.env|.*\.(?:pem|key|p12|pfx|map))$/i.test(entry.name));
  if (forbidden) throw new Error(`Chrome package contains forbidden release file: ${forbidden.name}`);
  const manifest = JSON.parse(entries.find((entry) => entry.name === "manifest.json").data.toString("utf8"));
  if (storeMode && Object.hasOwn(manifest, "key")) throw new Error("Chrome Web Store package must not embed the development key");
  if (manifest.optional_permissions?.includes("bookmarks")) throw new Error("Chrome package requests unused bookmarks permission");
}

function buildZip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const compressed = zlib.deflateRawSync(file.data, { level: 9 });
    const crc = crc32(file.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    local.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
