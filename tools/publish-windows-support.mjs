import { openAsBlob } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonical, hashFile, verifyWindowsSupport } from './windows-support-artifact.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function verifyPublication(result, bundle, receipt) {
  const support = result.support;
  if (!result.id || result.platform !== 'windows' || result.arch !== 'x64'
      || result.client_variant !== 'haolo_windows_web3' || result.version !== bundle.version
      || result.file_sha256 !== receipt.artifact_sha256 || support?.status !== 'active'
      || support.bundle_id !== receipt.bundle_id || support.contract_id !== bundle.contract_id
      || support.source_sha !== bundle.source_sha
      || canonical(support.action_versions) !== canonical(receipt.action_versions)) {
    throw Error('Release response did not confirm matching support activation; inspect release state before retrying');
  }
}
export async function publishWindowsSupport(options, dependencies = {}) {
  const artifact = resolve(options.artifact);
  const {bundle, receipt} = await verifyWindowsSupport(artifact, options.bundle);
  const notes = JSON.parse((await readFile(options.notes, 'utf8')).replace(/^\uFEFF/, ''));
  if (!['zh-CN', 'zh-Hant', 'en'].every(key => typeof notes[key] === 'string' && notes[key].trim())) throw Error('Three release-note languages required');
  if (options.version && options.version !== bundle.version) throw Error('Requested version differs from installer');
  const preview = {platform: 'windows', version: bundle.version, artifact: basename(artifact),
    sha256: receipt.artifact_sha256, source_sha: bundle.source_sha, contract_id: bundle.contract_id,
    bundle_id: receipt.bundle_id, action_versions: receipt.action_versions, activated: false};
  if (!options.publish) return preview;
  const key = options.key || process.env.HAOLO_APP_UPDATE_ADMIN_KEY;
  if (!key) throw Error('Missing HAOLO_APP_UPDATE_ADMIN_KEY');
  const verifySignatures = dependencies.verifySignatures || (async () => {
    if (await hashFile(resolve(dirname(artifact), 'win-unpacked/resources/app.asar')) !== receipt.asar_sha256) throw Error('Unpacked app differs from sealed installer build');
    execFileSync(process.execPath,
      [resolve(root, 'youle_desktop/scripts/verify-windows-release.cjs'), dirname(artifact), '--version', bundle.version], {stdio: 'pipe'});
  });
  await verifySignatures();
  // Signature verification must not have changed the bytes we are about to upload.
  await verifyWindowsSupport(artifact, options.bundle);
  const form = new FormData();
  form.set('version', bundle.version); form.set('arch', 'x64'); form.set('client_variant', 'haolo_windows_web3');
  form.set('support_bundle', canonical(bundle)); form.set('release_notes', notes['zh-CN']);
  form.set('force_update', String(Boolean(options.forceUpdate)));
  if (options.minSupportedVersion) form.set('min_supported_version', options.minSupportedVersion);
  form.set('file', await openAsBlob(artifact, {type: 'application/octet-stream'}), basename(artifact));
  const response = await (dependencies.fetch || fetch)('https://haolo.com/api/app-updates/admin/windows/release', {
    method: 'POST', headers: {'X-App-Update-Admin-Key': key}, body: form,
    redirect: 'error', signal: AbortSignal.timeout(1_800_000),
  });
  if (!response.ok) throw Error(`Release request failed: HTTP ${response.status}; inspect release state before retrying`);
  const result = await response.json();
  // Preserve the response even when an old backend returns HTTP 200 without activation.
  await writeFile(artifact + '.support-publication.json', JSON.stringify({...preview, release: result}, null, 2) + '\n');
  verifyPublication(result, bundle, receipt);
  const completed = {...preview, activated: true, release: result};
  await writeFile(artifact + '.support-publication.json', JSON.stringify(completed, null, 2) + '\n');
  if (options.result) await writeFile(options.result, JSON.stringify(result, null, 2) + '\n');
  return {...preview, activated: true, release_id: result.id};
}
