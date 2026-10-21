import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function saveExternalTradingPlanImage(params, { app, nativeImage }) {
  const source = params?.dataUrl;
  if (typeof source !== 'string' || source.length > 12_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(source)) {
    throw new Error('INVALID_PLAN_IMAGE');
  }
  const bytes = Buffer.from(source.slice(source.indexOf(',') + 1), 'base64');
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.toString('ascii', 12, 16) !== 'IHDR'
    || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(16) > 4096
    || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(20) > 8192) throw new Error('INVALID_PLAN_IMAGE');
  const image = nativeImage.createFromBuffer(bytes), size = image.getSize();
  if (image.isEmpty() || size.width > 4096 || size.height > 8192) throw new Error('INVALID_PLAN_IMAGE');
  const directory = path.join(app.getPath('temp'), 'haolo-trading-plan-images');
  await fs.mkdir(directory, { recursive: true });
  // Only retire this generator's own expired temporary files. Fresh replies
  // remain available for channel upload retries and local attachment previews.
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^haolo-plan-\d+-[a-f0-9-]{36}\.png$/.test(entry.name)) continue;
    const file = path.join(directory, entry.name);
    try { if (Date.now() - (await fs.stat(file)).mtimeMs > 7 * 86400_000) await fs.unlink(file); } catch { /* Another uploader may hold the file. */ }
  }
  const name = `haolo-plan-${Date.now()}-${crypto.randomUUID()}.png`, filePath = path.join(directory, name);
  await fs.writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
  return { ok: true, path: filePath, name, mime: 'image/png', size: bytes.length, width: size.width, height: size.height };
}
