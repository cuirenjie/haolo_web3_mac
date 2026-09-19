const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');
const run = promisify(execFile);
const policy = require('./evsign-policy.json');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function loadCredentials(env = process.env) {
  let saved = {};
  if (!env.HAOLO_EVSIGN_LICENSE_KEY) {
    const file = env.HAOLO_EVSIGN_LICENSE_FILE || path.join(os.homedir(), '.codex', 'secrets', 'haolo-evsign-license.json');
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
    catch { throw new Error('EV Sign license is unavailable; set HAOLO_EVSIGN_LICENSE_FILE or HAOLO_EVSIGN_LICENSE_KEY. Unsigned packaging is disabled.'); }
  }
  const licenseKey = env.HAOLO_EVSIGN_LICENSE_KEY || saved.licenseKey;
  if (!UUID.test(licenseKey || '')) throw new Error('Invalid EV Sign license format');
  return { licenseKey, password: env.HAOLO_EVSIGN_PASSWORD || saved.password || '', certificateId: env.HAOLO_EVSIGN_CERT_ID || saved.certificateId || '' };
}

function isOwnedExecutable(file) {
  const name = path.basename(file).toLowerCase();
  return policy.ownedExecutableNames.includes(name) || /^haolo_desktop-\d+\.\d+\.\d+-setup(?:\.__uninstaller)?\.exe$/.test(name);
}

// A signing service may alter only the checksum, certificate directory and
// trailing certificate table (plus its 8-byte alignment). Compare all payload
// bytes, including installer overlays, before replacing the original.
function pePayloadDigest(bytes) {
  if (bytes.length < 128 || bytes.readUInt16LE(0) !== 0x5a4d) throw new Error('Not a PE executable');
  const pe = bytes.readUInt32LE(60), optional = pe + 24;
  if (optional + 160 > bytes.length || bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw new Error('Invalid PE header');
  const magic = bytes.readUInt16LE(optional);
  const directory = optional + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : NaN) + 32;
  if (!Number.isFinite(directory)) throw new Error('Unsupported PE format');
  const checksum = optional + 64;
  const offset = bytes.readUInt32LE(directory), size = bytes.readUInt32LE(directory + 4);
  if ((offset === 0) !== (size === 0) || (offset && (offset < directory + 8 || offset + size !== bytes.length || offset % 8))) throw new Error('Unsupported PE certificate layout');
  const end = offset || bytes.length;
  const hash = crypto.createHash('sha256');
  hash.update(bytes.subarray(0, checksum));
  hash.update(bytes.subarray(checksum + 4, directory));
  hash.update(bytes.subarray(directory + 8, end));
  hash.update(Buffer.alloc((8 - end % 8) % 8));
  return hash.digest('hex');
}

function safeError(message, credentials) {
  let text = String(message).slice(0, 4096);
  for (const secret of [credentials.licenseKey, credentials.password]) if (secret) text = text.split(secret).join('[redacted]');
  return text.replace(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/gi, '[redacted]').slice(0, 500);
}

async function requestSignature(input, output, credentials, { request = https.request, timeoutMs = 15 * 60_000, log = console.log } = {}) {
  const size = (await fsp.stat(input)).size;
  const headers = { 'X-Key': credentials.licenseKey, 'X-Action': 'api-sign', 'X-Algorithm': 'sha256', 'X-Timestamp': 'auto', 'X-Append': 'no', 'X-File-Name': encodeURIComponent(path.basename(input)), 'Content-Type': 'application/octet-stream', 'Content-Length': size };
  if (credentials.password) headers['X-Password'] = credentials.password;
  if (credentials.certificateId) headers['X-Cert'] = String(credentials.certificateId);
  let sent = 0, received = 0;
  const progress = setInterval(() => log(`[evsign] ${path.basename(input)}: uploaded ${(sent / 1048576).toFixed(1)} MB; received ${(received / 1048576).toFixed(1)} MB`), 30_000);
  let req, timer;
  try {
    const response = new Promise((resolve, reject) => {
      // Native HTTPS intentionally does not follow redirects with the license.
      req = request(policy.endpoint, { method: 'POST', headers }, resolve);
      req.on('error', reject);
      timer = setTimeout(() => req.destroy(new Error('EV Sign request timed out')), timeoutMs);
      req.setTimeout(90_000, () => req.destroy(new Error('EV Sign connection timed out')));
    });
    const source = fs.createReadStream(input);
    source.on('data', chunk => { sent += chunk.length; });
    const upload = pipeline(source, req);
    upload.catch(() => {});
    const res = await response;
    if (res.statusCode !== 200) {
      let body = '';
      for await (const chunk of res) { body += chunk.toString(); if (body.length > 4096) break; }
      req.destroy();
      await upload.catch(() => {});
      throw new Error(`EV Sign HTTP ${res.statusCode}: ${safeError(body, credentials)}`);
    }
    res.on('data', chunk => {
      received += chunk.length;
      if (received > size + 8 * 1048576) res.destroy(new Error('EV Sign response exceeds expected size'));
    });
    await Promise.all([upload, pipeline(res, fs.createWriteStream(output, { flags: 'wx' }))]);
  } catch (error) {
    req?.destroy();
    throw new Error(safeError(error.message, credentials));
  } finally {
    clearTimeout(timer); clearInterval(progress);
  }
}

async function verifySignature(file, thumbprint = policy.certificateThumbprint) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'verify-ev-signature.ps1'), '-Target', path.resolve(file)];
  if (thumbprint) args.push('-ExpectedThumbprint', thumbprint);
  try {
    // A PowerShell 7 parent can pass an incompatible PSModulePath to Windows
    // PowerShell 5.1; let that runtime initialize its own built-in modules.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
    const { stdout } = await run('powershell.exe', args, { env, windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  } catch (error) { throw new Error(`EV signature verification failed for ${path.basename(file)}: ${String(error.stderr || error.message).slice(0, 1200)}`); }
}

async function signFile(file, options = {}) {
  if (!isOwnedExecutable(file)) throw new Error('Refusing to replace a third-party executable signature');
  const thumbprint = options.thumbprint ?? policy.certificateThumbprint;
  if (!thumbprint && !options.bootstrap) throw new Error('EV Sign certificate fingerprint is not configured');
  const credentials = options.credentials || loadCredentials();
  const verify = options.verify || verifySignature;
  const transfer = options.transfer || require('./evsign-cli.cjs').requestCliSignature;
  const candidate = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.signed.exe`);
  const before = pePayloadDigest(await fsp.readFile(file));
  let downloaded = false;
  try {
    console.log(`[evsign] Signing ${path.basename(file)} with SHA-256 and timestamp`);
    await transfer(file, candidate, credentials);
    downloaded = true;
    if (pePayloadDigest(await fsp.readFile(candidate)) !== before) throw new Error('Signing response changed executable payload; original retained');
    const result = await verify(candidate, thumbprint);
    await fsp.rename(candidate, file);
    console.log(`[evsign] Verified ${path.basename(file)}: ${result.subject}`);
    return result;
  } catch (error) {
    if (downloaded) console.error(`[evsign] Unaccepted response retained for diagnosis: ${candidate}`);
    throw error;
  } finally { if (!downloaded) await fsp.rm(candidate, { force: true }); }
}

module.exports = { loadCredentials, isOwnedExecutable, pePayloadDigest, safeError, requestSignature, verifySignature, signFile };
if (require.main === module) {
  const file = process.argv[2];
  (file ? signFile(path.resolve(file), { bootstrap: process.argv.includes('--bootstrap') }) : Promise.reject(new Error('Usage: node evsign-client.cjs FILE')))
    .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
