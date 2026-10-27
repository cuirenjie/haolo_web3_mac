const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { safeError, verifySignature } = require('./evsign-client.cjs');
const policy = require('./evsign-policy.json').cli;
const execute = promisify(execFile);

function cliPath() {
  return path.resolve(process.env.HAOLO_EVSIGN_CLI_PATH || path.join(os.homedir(), '.codex', 'tools', 'evsign', 'evsign-client.exe'));
}
async function verifyCliBinary(file) {
  const bytes = await fs.readFile(file);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== policy.sha256) throw new Error('EV Sign CLI checksum mismatch; review the official tool before updating its pin');
  await verifySignature(file, policy.certificateThumbprint);
  return file;
}
async function ensureCli() {
  if (process.platform !== 'win32') throw new Error('This EV signing workflow requires Windows');
  const target = cliPath();
  try { await fs.access(target); return await verifyCliBinary(target); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log(`[evsign-cli] Preparing pinned official CLI ${policy.version}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const response = await fetch(policy.downloadUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.url.startsWith('https://')) throw new Error('Official EV Sign CLI download failed');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 30 * 1048576) throw new Error('Official EV Sign CLI download exceeds expected size');
    chunks.push(Buffer.from(chunk));
  }
  const candidate = path.join(path.dirname(target), `.evsign-${crypto.randomUUID()}.exe`);
  try {
    await fs.writeFile(candidate, Buffer.concat(chunks), { flag: 'wx' });
    await verifyCliBinary(candidate);
    await fs.rename(candidate, target);
  } finally { await fs.rm(candidate, { force: true }); }
  return target;
}

async function requestCliSignature(input, output, credentials, { prepare = ensureCli, run = execute, log = console.log, timestamp = process.env.HAOLO_EVSIGN_TIMESTAMP || 'digicert' } = {}) {
  // Operator-selected recovery for a timestamp-provider outage. Never allow
  // the CLI's "no" mode; the outer signature verifier still requires a TSA.
  if (!['digicert', 'auto'].includes(timestamp)) throw new Error('EV Sign timestamp mode must be digicert or auto');
  input = path.resolve(input);
  output = path.resolve(output);
  const executable = await prepare();
  const working = await fs.mkdtemp(path.join(path.dirname(output), '.evsign-cli-'));
  // Keep the reviewed original filename. The official CLI signs in place, so
  // isolate a copy until the outer payload/certificate verification succeeds.
  const candidate = path.join(working, path.basename(input));
  const args = [candidate, '-key', credentials.licenseKey, '-sha256', '-t', timestamp];
  if (credentials.password) args.push('-pwd', credentials.password);
  if (credentials.certificateId) args.push('-cert', String(credentials.certificateId));
  const start = Date.now();
  const timer = setInterval(() => log(`[evsign-cli] Signing ${path.basename(input)} (${Math.round((Date.now() - start) / 1000)}s)`), 30_000);
  try {
    await fs.copyFile(input, candidate);
    // The documented CLI takes -key. Never print argv, raw CLI output or the
    // execFile error object: those can contain credentials or the full command.
    await run(executable, args, { cwd: working, windowsHide: true, shell: false, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 1024 * 1024 });
    if ((await fs.stat(candidate)).size > (await fs.stat(input)).size + 8 * 1048576) throw new Error('CLI output exceeds expected executable size');
    await fs.rename(candidate, output);
    log(`[evsign-cli] Completed ${path.basename(input)} in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  } catch (error) {
    const details = error.stderr || error.stdout || (typeof error.code === 'number' ? `exit code ${error.code}` : 'execution or output validation failed');
    throw new Error(`EV Sign CLI failed: ${safeError(details, credentials)}`);
  } finally {
    clearInterval(timer);
    await fs.rm(candidate, { force: true });
    await fs.rmdir(working).catch(() => {});
  }
}
module.exports = { cliPath, verifyCliBinary, ensureCli, requestCliSignature };
if (require.main === module) ensureCli().then(file => console.log(`[evsign-cli] Verified CLI ${policy.version}: ${file}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
