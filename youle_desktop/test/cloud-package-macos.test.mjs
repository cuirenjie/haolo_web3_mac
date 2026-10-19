import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const asar=require('@electron/asar');
const {auditCloudStrategyPackage}=require('../scripts/audit-cloud-strategy-package.cjs');

for(const platform of ['darwin','win32']) test(`${platform}: audit the real ASAR and reject private engines`,async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'haolo-cloud-package-'));
  t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
  const source=path.join(temporary,'source');
  const root=path.join(temporary,platform==='darwin'?'好咯.app':'win-unpacked');
  const resources=path.join(root,...(platform==='darwin'?['Contents','Resources']:['resources']));
  for(const name of ['main.mjs','preload.mjs','execution-plan-card.css','execution-plan-sticky-preload.cjs','trading-strategy-runtime/cloud-runtime.mjs']) {
    const file=path.join(source,'src/main',name);
    await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'/* public runtime fixture */');
  }
  await fs.mkdir(resources,{recursive:true});
  const archive=path.join(resources,'app.asar');
  await asar.createPackage(source,archive);
  const report=auditCloudStrategyPackage(root);
  assert.equal(report.passed,true);assert.equal(report.fileCount,5);assert.match(report.asarSha256,/^[a-f0-9]{64}$/);
  const privateFile=path.join(source,'src/main/trading-analysis/wave-engine.mjs');
  await fs.mkdir(path.dirname(privateFile),{recursive:true});await fs.writeFile(privateFile,'export const privateEngine = true;');
  await asar.createPackage(source,archive);asar.uncache(archive);
  assert.throws(()=>auditCloudStrategyPackage(root),/private asset audit failed/);
});
