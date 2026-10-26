// Release entry point: installer and knowledge sidecar are sent in one publication transaction.
// Preview is the default. --publish is only used for an authorized product release.
import { openAsBlob, createReadStream } from 'node:fs';
import { readFile as read, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { publishWindowsSupport } from './publish-windows-support.mjs';
const args=process.argv.slice(2);
function option(name, required=false) {
  const i=args.indexOf('--'+name),value=i<0?'':args[i+1];
  if(required && (!value || value.startsWith('--'))) throw Error('Missing --'+name);
  return value;
}
const platform=option('platform',true),artifact=resolve(option('artifact',true));
if(platform==='windows') {
  try {
    console.log(JSON.stringify(await publishWindowsSupport({artifact, bundle:option('bundle') || undefined,
      notes:option('notes',true), version:option('version'), publish:args.includes('--publish'),
      forceUpdate:args.includes('--force-update'), minSupportedVersion:option('min-supported-version'), result:option('result')})));
  } catch(error) { console.error(error.message); process.exitCode=1; }
  // No legacy Windows upload path is allowed below this point.
  process.exit(process.exitCode || 0);
}
const bundlePath=resolve(option('bundle',true));
if(!['android','ios'].includes(platform))throw Error('Unsupported platform');
const bundle=JSON.parse(await read(bundlePath,'utf8'));
if(bundle.contract.surface!=='mobile')throw Error('Wrong bundle surface');
const notes=JSON.parse(await read(option('notes',true),'utf8'));
if(!['zh-CN','zh-Hant','en'].every(k=>typeof notes[k]==='string'&&notes[k].trim()))throw Error('Three release-note languages required');
const hash=createHash('sha256');for await(const chunk of createReadStream(artifact))hash.update(chunk);
const sha=hash.digest('hex'),form=new FormData();
form.set('support_bundle',JSON.stringify(bundle));
form.set('release_notes',JSON.stringify(notes));
let endpoint;
{
  const match=bundle.version.match(/^(\d+\.\d+\.\d+)\+(\d+)$/);if(!match)throw Error('Invalid mobile build version');
  const channel=option('channel')||(platform==='android'?'direct':'testflight');
  form.set('version',match[1]);form.set('build_number',match[2]);form.set('channel',channel);
  if(option('install-url'))form.set('install_url',option('install-url'));
  if(option('expires-at'))form.set('expires_at',option('expires-at'));
  if(platform==='android') {
    const report=JSON.parse(await read(option('report',true),'utf8'));
    const sidecarSha=createHash('sha256').update(await read(bundlePath)).digest('hex');
    if(report.test_only||!report.signature_verified||report.sha256!==sha||report.support_bundle_sha256!==sidecarSha)throw Error('Verified distribution report does not match package and support bundle');
  }
  endpoint='/api/app-updates/mobile/admin/'+platform+'/releases';
}
const preview={platform,version:bundle.version,artifact:basename(artifact),sha256:sha,source_sha:bundle.source_sha,contract_id:bundle.contract_id,endpoint,activated:false};
if(!args.includes('--publish')){console.log(JSON.stringify(preview));process.exit(0);}
const key=process.env.HAOLO_APP_UPDATE_ADMIN_KEY;if(!key)throw Error('Missing HAOLO_APP_UPDATE_ADMIN_KEY');
form.set('file',await openAsBlob(artifact,{type:'application/octet-stream'}),basename(artifact));
async function request(path,body,isJson=false) {
  const headers={'X-App-Update-Admin-Key':key};if(isJson)headers['Content-Type']='application/json';
  const response=await fetch('https://haolo.com'+path,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(600000)});
  if(!response.ok)throw Error('Release request failed: HTTP '+response.status+'; inspect release state before retrying.');
  return response.json();
}
const uploaded=await request(endpoint,form);
if(uploaded.file_sha256!==sha)throw Error('Uploaded digest mismatch');
const result=await request('/api/app-updates/mobile/admin/releases/'+uploaded.id+'/status',JSON.stringify({action:'publish',sha256:sha}),true);
await writeFile(artifact+'.support-publication.json',JSON.stringify({...preview,activated:true,release:result},null,2)+'\n','utf8');
console.log(JSON.stringify({...preview,activated:true,release_id:result.id}));
