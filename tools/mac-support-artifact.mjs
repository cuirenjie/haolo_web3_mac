// Mac adaptation of the upstream build snapshot gate; no publication or Windows identity.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, normalize } from 'node:path';
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
export function validateMacBundle(bundle) {
  if (bundle.schema_version !== 1 || bundle.repository !== 'cuirenjie/haolo_web3_mac'
      || bundle.contract?.repository !== bundle.repository || bundle.contract?.surface !== 'macos'
      || bundle.contract.schema_version !== 1 || !/^\d+\.\d+\.\d+$/.test(bundle.version)
      || !/^[a-f0-9]{40}$/.test(bundle.source_sha)
      || digest(canonical(bundle.contract)) !== bundle.contract_id) throw Error('Invalid Mac support bundle');
  const sources = [...new Set(bundle.contract.features.flatMap(feature => feature.sources))].sort();
  if (canonical(sources) !== canonical(Object.keys(bundle.source_hashes).sort())
      || Object.values(bundle.source_hashes).some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw Error('Invalid support source inventory');
  return bundle;
}
export function actionVersions(bundle) {
  const actions = {};
  for (const feature of bundle.contract.features) {
    if (feature.status !== 'approved' || !feature.platforms.includes('macos')) continue;
    for (const [kind, version] of Object.entries(feature.actions)) {
      if (!Number.isSafeInteger(version) || version < 1 || (actions[kind] && actions[kind] !== version)) throw Error('Conflicting support adapter');
      actions[kind] = version;
    }
  }
  return actions;
}
export function supportBundlePlugin({projectRoot = root} = {}) {
  let bundle;
  return {
    name: 'haolo-support-build-snapshot', apply: 'build',
    async buildStart() {
      bundle = validateMacBundle(JSON.parse(await readFile(resolve(projectRoot, 'youle_desktop/release/support-bundle.json'), 'utf8')));
      const pkg = JSON.parse(await readFile(resolve(projectRoot, 'youle_desktop/package.json'), 'utf8'));
      const source = await readFile(resolve(projectRoot, 'youle_desktop/src/renderer/support-runtime.ts'), 'utf8');
      const match = source.match(/export const supportRuntime = ([\s\S]+) as const;/);
      const expected = {support_protocol: 2, contract_id: bundle.contract_id, action_versions: actionVersions(bundle)};
      if (pkg.version !== bundle.version || !match || canonical(JSON.parse(match[1])) !== canonical(expected)) throw Error('Stale support bundle: run pnpm build');
      // A changed source file after generation must not be described as this build.
      for (const [file, hash] of Object.entries(bundle.source_hashes)) {
        if (file.includes('..') || file.includes('\\') || file.includes(':') || file.startsWith('/')) throw Error('Invalid support source path');
        if (digest((await readFile(resolve(projectRoot, file), 'utf8')).replace(/\r\n/g, '\n')) !== hash) throw Error('Support source changed: ' + file);
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
  // A builder can replace an archive at the same path in one process.
  asar.uncache(archive);
  const bundle = validateMacBundle(JSON.parse(asar.extractFile(archive, normalize('dist/renderer/support-bundle.json'))));
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
  if (pkg.version !== bundle.version) throw Error('Packaged support version mismatch');
  const renderer = asar.listPackage(archive).filter(file => /[\\/]dist[\\/]renderer[\\/].*\.js$/.test(file));
  if (!renderer.some(file => asar.extractFile(archive, file.replace(/^[\\/]+/, '')).includes(bundle.contract_id))) throw Error('Packaged renderer support contract mismatch');
  return bundle;
}
