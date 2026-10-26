// Bind the knowledge snapshot to the renderer build and the final signed installer.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, basename, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function validateWindowsBundle(bundle) {
  if (bundle.schema_version !== 1 || bundle.repository !== 'cuirenjie/haolo_windows_web3'
      || bundle.contract?.repository !== bundle.repository || bundle.contract?.surface !== 'windows'
      || bundle.contract.schema_version !== 1 || !/^\d+\.\d+\.\d+$/.test(bundle.version)
      || !/^[a-f0-9]{40}$/.test(bundle.source_sha)
      || digest(canonical(bundle.contract)) !== bundle.contract_id) throw Error('Invalid Windows support bundle');
  const sources = [...new Set(bundle.contract.features.flatMap(feature => feature.sources))].sort();
  if (canonical(sources) !== canonical(Object.keys(bundle.source_hashes).sort())
      || Object.values(bundle.source_hashes).some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw Error('Invalid support source inventory');
  return bundle;
}
export function actionVersions(bundle) {
  const actions = {};
  for (const feature of bundle.contract.features) {
    if (feature.status !== 'approved' || !feature.platforms.includes('windows')) continue;
    for (const [kind, version] of Object.entries(feature.actions)) {
      if (!Number.isSafeInteger(version) || version < 1 || (actions[kind] && actions[kind] !== version)) throw Error('Conflicting support adapter');
      actions[kind] = version;
    }
  }
  return actions;
}
export function supportBundlePlugin() {
  let bundle;
  return {
    name: 'haolo-support-build-snapshot', apply: 'build',
    async buildStart() {
      bundle = validateWindowsBundle(JSON.parse(await readFile(resolve(root, 'youle_desktop/release/support-bundle.json'), 'utf8')));
      const pkg = JSON.parse(await readFile(resolve(root, 'youle_desktop/package.json'), 'utf8'));
      const source = await readFile(resolve(root, 'youle_desktop/src/renderer/support-runtime.ts'), 'utf8');
      const match = source.match(/export const supportRuntime = ([\s\S]+) as const;/);
      const expected = {support_protocol: 2, contract_id: bundle.contract_id, action_versions: actionVersions(bundle)};
      if (pkg.version !== bundle.version || !match || canonical(JSON.parse(match[1])) !== canonical(expected)) throw Error('Stale support bundle: run pnpm build');
      // A changed source file after generation must not be described as this build.
      for (const [file, hash] of Object.entries(bundle.source_hashes)) {
        if (file.includes('..') || file.includes('\\') || file.includes(':') || file.startsWith('/')) throw Error('Invalid support source path');
        if (digest((await readFile(resolve(root, file), 'utf8')).replace(/\r\n/g, '\n')) !== hash) throw Error('Support source changed: ' + file);
      }
    },
    generateBundle(_, output) {
      if (!Object.values(output).some(item => item.type === 'chunk' && item.code.includes(bundle.contract_id))) throw Error('Renderer support contract missing');
      this.emitFile({type: 'asset', fileName: 'support-bundle.json', source: canonical(bundle) + '\n'});
    },
  };
}
export function packagedSupport(archive) {
  const require = createRequire(resolve(root, 'youle_desktop/package.json'));
  const builderRequire = createRequire(require.resolve('electron-builder'));
  const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
  const bundle = validateWindowsBundle(JSON.parse(asar.extractFile(archive, normalize('dist/renderer/support-bundle.json'))));
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
  if (pkg.version !== bundle.version) throw Error('Packaged support version mismatch');
  const renderer = asar.listPackage(archive).filter(file => /[\\/]dist[\\/]renderer[\\/].*\.js$/.test(file));
  if (!renderer.some(file => asar.extractFile(archive, file.replace(/^[\\/]+/, '')).includes(bundle.contract_id))) throw Error('Packaged renderer support contract mismatch');
  return bundle;
}
export async function sealWindowsSupport(artifact, archive) {
  const bundle = packagedSupport(archive);
  if (basename(artifact) !== `haolo_desktop-${bundle.version}-Setup.exe`) throw Error('Installer/support version mismatch');
  const bytes = canonical(bundle) + '\n';
  const receipt = {schema_version: 1, version: bundle.version, artifact: basename(artifact),
    artifact_sha256: await hashFile(artifact), asar_sha256: await hashFile(archive),
    bundle_sha256: digest(bytes), bundle_id: digest(canonical(bundle)), contract_id: bundle.contract_id,
    source_sha: bundle.source_sha, action_versions: actionVersions(bundle)};
  await writeFile(artifact + '.support-bundle.json', bytes);
  await writeFile(artifact + '.support-build.json', JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
export async function verifyWindowsSupport(artifact, bundlePath = artifact + '.support-bundle.json') {
  const bytes = await readFile(bundlePath);
  const bundle = validateWindowsBundle(JSON.parse(bytes));
  const receipt = JSON.parse(await readFile(artifact + '.support-build.json', 'utf8'));
  if (receipt.schema_version !== 1 || receipt.artifact !== basename(artifact)
      || basename(artifact) !== `haolo_desktop-${bundle.version}-Setup.exe`
      || receipt.version !== bundle.version || receipt.contract_id !== bundle.contract_id
      || receipt.source_sha !== bundle.source_sha || receipt.bundle_sha256 !== digest(bytes)
      || receipt.bundle_id !== digest(canonical(bundle)) || receipt.artifact_sha256 !== await hashFile(artifact)
      || canonical(receipt.action_versions) !== canonical(actionVersions(bundle))) throw Error('Installer/support build mismatch; rebuild together');
  return {bundle, receipt};
}
