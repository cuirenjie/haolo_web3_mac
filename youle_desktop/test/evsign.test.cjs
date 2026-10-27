const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const { loadCredentials, isOwnedExecutable, pePayloadDigest, requestSignature, signFile } = require('../scripts/evsign-client.cjs');
const KEY = '00000000-0000-0000-0000-000000000001';
const credentials = { licenseKey: KEY, password: 'test-password' };

function executable(signed = false) {
  const bytes = Buffer.alloc(signed ? 544 : 512);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128); bytes.writeUInt16LE(0x20b, 152);
  bytes[400] = 42;
  if (signed) { bytes.writeUInt32LE(512, 296); bytes.writeUInt32LE(32, 300); bytes.writeUInt32LE(1234, 216); bytes.fill(17, 512); }
  return bytes;
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'haolo-sign-'));
  t.after(async () => { for (const name of await fs.readdir(root)) await fs.unlink(path.join(root, name)); await fs.rmdir(root); });
  const file = path.join(root, 'haolo_desktop.exe');
  await fs.writeFile(file, executable());
  return { root, file };
}

test('signing permits owned artifacts and never replaces vendor signatures', () => {
  for (const name of ['haolo_desktop.exe', 'haolo-chrome-native-host.exe', 'haolo_desktop-0.1.170-Setup.exe', 'haolo_desktop-0.1.170-Setup.__uninstaller.exe']) assert.equal(isOwnedExecutable(name), true);
  for (const name of ['haolo_ai.exe', 'codex-command-runner.exe', 'other-Setup.exe', 'electron.exe', 'haolo_desktop-evil-Setup.exe']) assert.equal(isOwnedExecutable(name), false);
});
test('credentials are required and errors never reveal invalid credential text', () => {
  assert.equal(loadCredentials({ HAOLO_EVSIGN_LICENSE_KEY: KEY }).licenseKey, KEY);
  assert.throws(() => loadCredentials({ HAOLO_EVSIGN_LICENSE_KEY: 'secret-invalid' }), error => !error.message.includes('secret-invalid'));
  assert.throws(() => loadCredentials({ HAOLO_EVSIGN_LICENSE_FILE: path.join(os.tmpdir(), 'nonexistent-haolo-license.json') }), /Unsigned packaging is disabled/);
});
test('payload comparison ignores only signature fields and rejects changed code or installer overlays', () => {
  assert.equal(pePayloadDigest(executable()), pePayloadDigest(executable(true)));
  const changed = executable(true); changed[400]++;
  assert.notEqual(pePayloadDigest(executable()), pePayloadDigest(changed));
  const malformed = executable(true); malformed.writeUInt32LE(510, 296);
  assert.throws(() => pePayloadDigest(malformed), /certificate layout/);
});
test('PE signing alignment preserves non-aligned installer overlays', () => {
  const original = Buffer.concat([executable(), Buffer.from('abc')]);
  const signed = Buffer.concat([original, Buffer.alloc(5), Buffer.alloc(32, 17)]);
  signed.writeUInt32LE(520, 296); signed.writeUInt32LE(32, 300);
  assert.equal(pePayloadDigest(original), pePayloadDigest(signed));
});
test('the original is replaced only after payload and certificate verification succeed', async t => {
  const {file, root} = await fixture(t); let verified = false;
  await signFile(file, { credentials, transfer: async (_, output) => fs.writeFile(output, executable(true)), verify: async () => {
    assert.deepEqual(await fs.readFile(file), executable()); verified = true;
    return { subject: 'fixture signer' };
  }});
  assert.equal(verified, true); assert.deepEqual(await fs.readFile(file), executable(true));
  assert.deepEqual(await fs.readdir(root), ['haolo_desktop.exe']);
});
test('bad payloads and invalid signatures retain the original artifact', async t => {
  const { file } = await fixture(t);
  const bad = executable(true); bad[401] = 99;
  await assert.rejects(signFile(file, { credentials, transfer: async (_, output) => fs.writeFile(output, bad), verify: () => assert.fail('must reject payload first') }), /changed executable payload/);
  assert.deepEqual(await fs.readFile(file), executable());
  await assert.rejects(signFile(file, { credentials, transfer: async (_, output) => fs.writeFile(output, executable(true)), verify: () => { throw new Error('invalid timestamp'); } }), /invalid timestamp/);
  assert.deepEqual(await fs.readFile(file), executable());
});
test('partial downloads are cleaned and do not alter the original', async t => {
  const { file, root } = await fixture(t);
  await assert.rejects(signFile(file, { credentials, transfer: async (_, output) => { await fs.writeFile(output, 'partial'); throw new Error('connection lost'); } }), /connection lost/);
  assert.deepEqual(await fs.readFile(file), executable()); assert.deepEqual(await fs.readdir(root), ['haolo_desktop.exe']);
});
test('the API receives raw bytes and SHA-256/timestamp headers, never multipart data', async t => {
  const {file, root} = await fixture(t); let seen;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    seen = { bytes: Buffer.concat(chunks), headers: req.headers };
    res.end(executable(true));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await requestSignature(file, path.join(root, 'signed.exe'), credentials, { request: (url, options, callback) => {
    assert.equal(url, 'https://api.evsign.cn/v1');
    return http.request(`http://127.0.0.1:${server.address().port}`, options, callback);
  }});
  assert.deepEqual(seen.bytes, executable()); assert.equal(seen.headers['x-key'], KEY);
  assert.equal(seen.headers['x-action'], 'api-sign'); assert.equal(seen.headers['x-algorithm'], 'sha256');
  assert.equal(seen.headers['x-timestamp'], 'auto'); assert.equal(seen.headers['content-type'], 'application/octet-stream');
});
test('API denial redacts credentials, does not follow redirects and is not retried', async t => {
  const {file, root} = await fixture(t); let requests = 0;
  const server = http.createServer((req, res) => {
    requests++; req.resume(); res.writeHead(302, { Location: 'https://example.invalid/' }); res.end(`Denied ${KEY} ${credentials.password}`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(requestSignature(file, path.join(root, 'signed.exe'), credentials, { request: (_, options, callback) => http.request(`http://127.0.0.1:${server.address().port}`, options, callback) }), error => /HTTP 302/.test(error.message) && !error.message.includes(KEY) && !error.message.includes(credentials.password));
  assert.equal(requests, 1);
});
test('release config requires signing in both local and CI workflows', async () => {
  const pkg = require('../package.json');
  assert.equal(pkg.build.win.forceCodeSigning, true); assert.equal(pkg.build.win.signAndEditExecutable, true);
  assert.deepEqual(pkg.build.win.signtoolOptions.signingHashAlgorithms, ['sha256']);
  assert.equal(pkg.build.win.signtoolOptions.sign, 'scripts/sign-windows.cjs');
  const workflow = await fs.readFile(path.resolve(__dirname, '../../.github/workflows/windows-desktop-build.yml'), 'utf8');
  assert.match(workflow, /secrets\.HAOLO_EVSIGN_LICENSE_KEY/); assert.match(workflow, /verify:win-signatures/);
  assert.match(workflow, /--prepackaged release\/win-unpacked --publish never/);
});

test('installed electron-builder accepts the configuration, resolves the hook and excludes vendor binaries', async () => {
  const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
  builderRequire('app-builder-lib'); // Initialize its circular packager exports through the public entry point.
  const lib = path.dirname(builderRequire.resolve('app-builder-lib/package.json'));
  const config = require('../package.json').build;
  await require(path.join(lib, 'out/util/config/config.js')).validateConfiguration(config, { isEnabled: false });
  const hook = await require(path.join(lib, 'out/util/resolve.js')).resolveFunction('module', path.resolve(__dirname, '../scripts/sign-windows.cjs'), 'sign', path.resolve(__dirname, '../..'));
  assert.equal(typeof hook, 'function');
  await assert.rejects(hook({ hash: 'sha1' }), /require SHA-256/);
  const { WinPackager } = require(path.join(lib, 'out/winPackager.js'));
  const shouldSign = file => WinPackager.prototype.shouldSignFile.call({ platformSpecificBuildOptions: config.win }, file, true);
  for (const name of ['haolo_desktop.exe', 'resources/bin/haolo-chrome-native-host.exe', 'haolo_desktop-0.1.170-Setup.exe', 'haolo_desktop-0.1.170-Setup.__uninstaller.exe']) assert.equal(shouldSign(name), true, name);
  for (const name of ['resources/bin/haolo_ai.exe', 'codex-command-runner.exe', 'codex-windows-sandbox-setup.exe']) assert.equal(shouldSign(name), false, name);
});

test('native host resource copy invokes the real builder signing transformer without changing source or vendor files', async t => {
  const source = await fixture(t), target = await fixture(t);
  await fs.unlink(target.file);
  const nativeName = 'haolo-chrome-native-host.exe';
  await fs.writeFile(path.join(source.root, nativeName), executable());
  await fs.writeFile(path.join(source.root, 'haolo_ai.exe'), 'vendor signature');
  const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
  const { WinPackager } = builderRequire('app-builder-lib');
  const lib = path.dirname(builderRequire.resolve('app-builder-lib/package.json'));
  const { FileMatcher, copyFiles } = require(path.join(lib, 'out/fileMatcher.js'));
  const config = require('../package.json').build;
  const resource = config.extraResources.find(entry => entry.filter?.includes(nativeName));
  assert.ok(resource, 'Native host must use a directory filter; individual-file resources bypass signing');
  const signed = [];
  const packager = {
    platformSpecificBuildOptions: config.win,
    shouldSignFile: WinPackager.prototype.shouldSignFile,
    signIf: async file => { signed.push(file); await fs.writeFile(file, executable(true)); },
  };
  const transformer = WinPackager.prototype.createTransformerForExtraFiles.call(packager, { appOutDir: target.root });
  await copyFiles([new FileMatcher(source.root, target.root, value => value, resource.filter)], transformer);
  assert.deepEqual(signed, [path.join(target.root, nativeName)]);
  assert.deepEqual(await fs.readdir(target.root), [nativeName]);
  assert.deepEqual(await fs.readFile(path.join(target.root, nativeName)), executable(true));
  assert.deepEqual(await fs.readFile(path.join(source.root, nativeName)), executable());
  assert.equal(await fs.readFile(path.join(source.root, 'haolo_ai.exe'), 'utf8'), 'vendor signature');
});

test('CLI signs an isolated copy with the reviewed filename, SHA-256 and trusted timestamp', async t => {
  const { file, root } = await fixture(t);
  const { requestCliSignature } = require('../scripts/evsign-cli.cjs');
  const output = path.join(root, 'signed.exe');
  await requestCliSignature(path.relative(process.cwd(), file), path.relative(process.cwd(), output), credentials, {
    prepare: async () => 'verified-cli.exe', log: () => {},
    run: async (executable, args, options) => {
      assert.equal(executable, 'verified-cli.exe');
      assert.equal(path.basename(args[0]), 'haolo_desktop.exe');
      assert.equal(path.isAbsolute(args[0]), true);
      assert.notEqual(args[0], file);
      assert.deepEqual(args.slice(1), ['-key', KEY, '-sha256', '-t', 'digicert', '-pwd', credentials.password]);
      assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
      assert.equal(options.cwd, path.dirname(args[0]));
      await fs.writeFile(args[0], executableFixture());
    },
  });
  function executableFixture() { return executable(true); }
  assert.deepEqual(await fs.readFile(file), executable());
  assert.deepEqual(await fs.readFile(output), executable(true));
  assert.deepEqual((await fs.readdir(root)).sort(), ['haolo_desktop.exe', 'signed.exe']);
});

test('CLI failure cannot expose command-line credentials or replace the original', async t => {
  const { file, root } = await fixture(t);
  const { requestCliSignature } = require('../scripts/evsign-cli.cjs');
  const output = path.join(root, 'signed.exe');
  await assert.rejects(requestCliSignature(file, output, credentials, {
    prepare: async () => 'verified-cli.exe', log: () => {},
    run: async () => { const error = new Error(`Command failed -key ${KEY} -pwd ${credentials.password}`); error.stderr = `Denied ${KEY} ${credentials.password}`; throw error; },
  }), error => /EV Sign CLI failed/.test(error.message) && !error.message.includes(KEY) && !error.message.includes(credentials.password));
  assert.deepEqual(await fs.readFile(file), executable());
  assert.deepEqual(await fs.readdir(root), ['haolo_desktop.exe']);
});

test('operator-selected automatic timestamps retain CLI isolation and reject disabling timestamps', async t => {
  const { file, root } = await fixture(t);
  const { requestCliSignature } = require('../scripts/evsign-cli.cjs');
  const output = path.join(root, 'signed.exe');
  await requestCliSignature(file, output, credentials, {
    timestamp: 'auto', prepare: async () => 'verified-cli.exe', log: () => {},
    run: async (_, args, options) => {
      assert.equal(path.basename(args[0]), 'haolo_desktop.exe');
      assert.notEqual(args[0], file);
      assert.deepEqual(args.slice(1), ['-key', KEY, '-sha256', '-t', 'auto', '-pwd', credentials.password]);
      assert.equal(options.shell, false);
      await fs.writeFile(args[0], executable(true));
    },
  });
  assert.deepEqual(await fs.readFile(file), executable());
  assert.deepEqual(await fs.readFile(output), executable(true));
  for (const timestamp of ['no', '', 'http://unreviewed.invalid', 'other']) {
    await assert.rejects(requestCliSignature(file, output, credentials, {
      timestamp, prepare: () => assert.fail('Invalid mode must fail before CLI execution'),
    }), /timestamp mode must be digicert or auto/);
  }
});

test('normal signing defaults to CLI and rejects an altered CLI binary before execution', async t => {
  const { file } = await fixture(t);
  const cli = require('../scripts/evsign-cli.cjs');
  await assert.rejects(cli.verifyCliBinary(file), /CLI checksum mismatch/);
  let called = false;
  t.mock.method(cli, 'requestCliSignature', async (input, output) => { called = true; assert.equal(input, file); await fs.writeFile(output, executable(true)); });
  await signFile(file, { credentials, verify: async () => ({ subject: 'fixture signer' }) });
  assert.equal(called, true);
});
