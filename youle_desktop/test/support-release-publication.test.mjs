import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical, digest, sealWindowsSupport, verifyWindowsSupport, packagedSupport} from '../../tools/windows-support-artifact.mjs';
import {publishWindowsSupport} from '../../tools/publish-windows-support.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
async function fixture() {
  await mkdir(resolve(root, 'output/support-release-tests'), {recursive: true});
  const dir = await mkdtemp(resolve(root, 'output/support-release-tests/run-'));
  const contract = {schema_version: 1, repository: 'cuirenjie/haolo_windows_web3', surface: 'windows', features: [
    {id: 'candle-colors', status: 'approved', platforms: ['windows'], actions: {set_candle_colors: 1}, sources: ['src/chart.ts']},
  ]};
  const bundle = {schema_version: 1, repository: contract.repository, version: '1.2.3', source_sha: 'a'.repeat(40),
    contract, contract_id: digest(canonical(contract)), source_hashes: {'src/chart.ts': 'b'.repeat(64)}};
  const source = resolve(dir, 'package'), archive = resolve(dir, 'app.asar');
  await mkdir(resolve(source, 'dist/renderer'), {recursive: true});
  await writeFile(resolve(source, 'package.json'), JSON.stringify({version: bundle.version}));
  await writeFile(resolve(source, 'dist/renderer/main.js'), 'const contract=' + JSON.stringify(bundle.contract_id));
  await writeFile(resolve(source, 'dist/renderer/support-bundle.json'), canonical(bundle));
  await asar.createPackage(source, archive);
  const artifact = resolve(dir, `haolo_desktop-${bundle.version}-Setup.exe`);
  await writeFile(artifact, 'isolated test installer; not an executable');
  const receipt = await sealWindowsSupport(artifact, archive);
  const notes = resolve(dir, 'notes.json');
  await writeFile(notes, JSON.stringify({'zh-CN': '测试', 'zh-Hant': '測試', en: 'Test'}));
  const response = {id: 'fixture-release', platform: 'windows', arch: 'x64', client_variant: 'haolo_windows_web3',
    version: bundle.version, file_sha256: receipt.artifact_sha256,
    support: {status: 'active', bundle_id: receipt.bundle_id, contract_id: bundle.contract_id,
      source_sha: bundle.source_sha, action_versions: receipt.action_versions}};
  return {dir, bundle, receipt, artifact, archive, notes, response};
}
test('final installer sidecar comes from its packaged renderer snapshot', async () => {
  const f = await fixture();
  assert.deepEqual(packagedSupport(f.archive), f.bundle);
  assert.deepEqual((await verifyWindowsSupport(f.artifact)).bundle, f.bundle);
  assert.equal(JSON.parse(await readFile(f.artifact + '.support-bundle.json')).contract_id, f.bundle.contract_id);
});
test('builder completion seals the selected prepackaged app and rejects ambiguous architectures', async () => {
  const f = await fixture();
  const hook = require('../scripts/seal-support-artifact.cjs');
  await mkdir(resolve(f.dir, 'selected-app/resources'), {recursive: true});
  await copyFile(f.archive, resolve(f.dir, 'selected-app/resources/app.asar'));
  const event = {file: f.artifact, arch: require('electron-builder').Arch.x64,
    packager: {projectDir: f.dir, packagerOptions: {prepackaged: 'selected-app'}}};
  await hook(event);
  assert.deepEqual((await verifyWindowsSupport(f.artifact)).bundle, f.bundle);
  await assert.rejects(hook({...event, arch: null}), /one x64/);
});
test('missing or stale sidecars and changed installer bytes prevent publication', async () => {
  const f = await fixture();
  await assert.rejects(verifyWindowsSupport(f.artifact, resolve(f.dir, 'missing.json')), /ENOENT/);
  await writeFile(f.artifact, 'different installer');
  await assert.rejects(verifyWindowsSupport(f.artifact), /build mismatch/);
  await sealWindowsSupport(f.artifact, f.archive);
  await writeFile(f.artifact + '.support-bundle.json', canonical({...f.bundle, source_sha: 'd'.repeat(40)}));
  await assert.rejects(verifyWindowsSupport(f.artifact), /build mismatch/);
});
test('preview has no signature or network side effects', async () => {
  const f = await fixture();
  const forbidden = () => assert.fail('preview must be local');
  const result = await publishWindowsSupport({...f, bundle: undefined}, {fetch: forbidden, verifySignatures: forbidden});
  assert.equal(result.activated, false);
  assert.deepEqual(result.action_versions, {set_candle_colors: 1});
});
test('publisher sends installer, matching bundle and explicit channel in one request', async () => {
  const f = await fixture(); let signed = false, requests = 0;
  const result = await publishWindowsSupport({...f, bundle: undefined, publish: true, key: 'test-only'}, {
    verifySignatures: () => {signed = true;},
    fetch: async (url, init) => {
      requests++; assert.equal(signed, true); assert.equal(init.redirect, 'error');
      assert.equal(url, 'https://haolo.com/api/app-updates/admin/windows/release');
      assert.equal(init.body.get('client_variant'), 'haolo_windows_web3');
      assert.deepEqual(JSON.parse(init.body.get('support_bundle')), f.bundle);
      assert.equal(init.body.get('file').name, 'haolo_desktop-1.2.3-Setup.exe');
      return {ok: true, json: async () => f.response};
    },
  });
  assert.equal(requests, 1); assert.equal(result.activated, true);
  assert.equal(JSON.parse(await readFile(f.artifact + '.support-publication.json')).activated, true);
});
test('HTTP 200 without matching activated abilities is not reported as a successful release', async () => {
  for (const change of [r => delete r.support, r => {r.support.action_versions = {};}, r => {r.file_sha256 = 'f'.repeat(64);}, r => {r.support.contract_id = 'e'.repeat(64);}]) {
    const f = await fixture(); change(f.response);
    await assert.rejects(publishWindowsSupport({...f, bundle: undefined, publish: true, key: 'test-only'}, {
      verifySignatures() {}, fetch: async () => ({ok: true, json: async () => f.response}),
    }), /did not confirm/);
    assert.equal(JSON.parse(await readFile(f.artifact + '.support-publication.json')).activated, false);
  }
});
test('failed signature verification never reaches the upload', async () => {
  const f = await fixture();
  await assert.rejects(publishWindowsSupport({...f, bundle: undefined, publish: true, key: 'test-only'}, {
    verifySignatures() {throw Error('invalid signature');}, fetch() {assert.fail('must not upload');},
  }), /invalid signature/);
});
