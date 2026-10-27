import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import asar from '@electron/asar';
import {canonical, digest, validateMacBundle, actionVersions, supportBundlePlugin, packagedSupport} from '../../tools/mac-support-artifact.mjs';

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'haolo-mac-support-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const put=async(path,text)=>{const p=join(root,path);await mkdir(dirname(p),{recursive:true});await writeFile(p,text);};
  const contract={schema_version:1,repository:'cuirenjie/haolo_web3_mac',surface:'macos',features:[
    {id:'colors',status:'approved',platforms:['macos'],actions:{set_candle_colors:1},sources:['src/chart.ts']},
    {id:'candidate',status:'pending',platforms:['macos'],actions:{unreleased:2},sources:['src/chart.ts']},
  ]};
  const bundle={schema_version:1,repository:contract.repository,version:'0.1.180',source_sha:'a'.repeat(40),
    contract,contract_id:digest(canonical(contract)),source_hashes:{'src/chart.ts':digest('fixture\n')}};
  await put('src/chart.ts','fixture\r\n');
  await put('youle_desktop/package.json',JSON.stringify({version:bundle.version}));
  await put('youle_desktop/release/support-bundle.json',canonical(bundle));
  await put('youle_desktop/src/renderer/support-runtime.ts','export const supportRuntime = '+JSON.stringify({
    support_protocol:2,contract_id:bundle.contract_id,action_versions:{set_candle_colors:1}})+' as const;');
  const archive=join(root,'app.asar');
  const pack=async({version=bundle.version,id=bundle.contract_id}={})=>{
    await put('package/package.json',JSON.stringify({version}));
    await put('package/dist/renderer/support-bundle.json',canonical(bundle));
    await put('package/dist/renderer/main.js','const contract='+JSON.stringify(id));
    await asar.createPackage(join(root,'package'),archive);
  };
  return {root,put,bundle,archive,pack};
}
test('Mac build embeds the verified snapshot and only advertises approved Mac adapters',async t=>{
  const f=await fixture(t),plugin=supportBundlePlugin({projectRoot:f.root});
  await plugin.buildStart();
  const emitted=[];plugin.generateBundle.call({emitFile:x=>emitted.push(x)}, {}, {main:{type:'chunk',code:f.bundle.contract_id}});
  assert.deepEqual(JSON.parse(emitted[0].source),f.bundle);
  assert.deepEqual(actionVersions(f.bundle),{set_candle_colors:1});
  await f.pack();assert.deepEqual(packagedSupport(f.archive),f.bundle);
});
test('Windows identity, tampered contracts and incomplete source inventories cannot pass the Mac gate',async t=>{
  const {bundle}=await fixture(t);
  for(const change of [b=>b.repository='cuirenjie/haolo_windows_web3',b=>b.contract.surface='windows',
    b=>b.contract.features[0].actions.set_candle_colors=2,b=>b.source_hashes={}]) {
    const bad=structuredClone(bundle);change(bad);assert.throws(()=>validateMacBundle(bad));
  }
});
test('source changes and stale renderer bindings stop the build before packaging',async t=>{
  const f=await fixture(t);
  await f.put('src/chart.ts','changed');
  await assert.rejects(supportBundlePlugin({projectRoot:f.root}).buildStart(),/source changed/);
  await f.put('src/chart.ts','fixture\n');
  await f.put('youle_desktop/src/renderer/support-runtime.ts','export const supportRuntime = {} as const;');
  await assert.rejects(supportBundlePlugin({projectRoot:f.root}).buildStart(),/Stale support/);
});
test('the packaged app must match both its version and renderer contract',async t=>{
  const f=await fixture(t);
  await f.pack({version:'0.1.181'});assert.throws(()=>packagedSupport(f.archive),/version mismatch/);
  await f.pack({id:'wrong'});assert.throws(()=>packagedSupport(f.archive),/contract mismatch/);
});
