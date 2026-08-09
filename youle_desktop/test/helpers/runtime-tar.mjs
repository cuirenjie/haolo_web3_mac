import zlib from "node:zlib";

const TAR_BLOCK_SIZE = 512;

export function createTarGzip(entries, { includeEndMarker = true } = {}) {
  const chunks = [];
  for (const entry of entries) {
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(String(entry.content || ""), "utf8");
    const type = entry.type || "file";
    const size = type === "file" ? content.length : 0;
    const header = createTarHeader({
      name: entry.name,
      size,
      type,
      mode: entry.mode ?? (type === "directory" ? 0o755 : 0o644),
    });
    chunks.push(header);
    if (size) {
      chunks.push(content);
      const padding = size % TAR_BLOCK_SIZE
        ? TAR_BLOCK_SIZE - (size % TAR_BLOCK_SIZE)
        : 0;
      if (padding) chunks.push(Buffer.alloc(padding));
    }
  }
  if (includeEndMarker) chunks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2));
  return zlib.gzipSync(Buffer.concat(chunks));
}

function createTarHeader({ name, size, type, mode }) {
  const header = Buffer.alloc(TAR_BLOCK_SIZE);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1_000));
  header.fill(0x20, 148, 156);
  header[156] = type === "directory" ? "5".charCodeAt(0) : type === "symlink" ? "2".charCodeAt(0) : "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function writeString(buffer, offset, length, value) {
  const encoded = Buffer.from(String(value || ""), "utf8");
  if (encoded.length > length) throw new Error(`TAR field is too long: ${value}`);
  encoded.copy(buffer, offset, 0, encoded.length);
}

function writeOctal(buffer, offset, length, value) {
  const encoded = `${Number(value).toString(8).padStart(length - 2, "0")}\0`;
  buffer.write(encoded, offset, length, "ascii");
}
