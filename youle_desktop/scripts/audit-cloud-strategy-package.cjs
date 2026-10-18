const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createRequire}=require('node:module');
const builderRequire=createRequire(require.resolve('electron-builder'));
const asar=createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
const {forbiddenPath,privateMarkers,sensitiveAsset}=require('./cloud-strategy-package-policy.cjs');

function auditCloudStrategyPackage(root) {
  const resources=path.join(path.resolve(root),'resources'),archive=path.join(resources,'app.asar');
  if(!fs.existsSync(archive))throw new Error('G3 requires the real packaged app.asar');
  for(const required of ['src/main/main.mjs','src/main/preload.mjs','src/main/execution-plan-card.css',
    'src/main/execution-plan-sticky-preload.cjs','src/main/trading-strategy-runtime/cloud-runtime.mjs']) {
    if(!asar.statFile(archive,path.normalize(required)))throw new Error(`Missing public runtime asset: ${required}`);
  }
  const checked=[],failures=[];
  function inspect(name,read) {
    if(forbiddenPath(name))failures.push({path:name,reason:'private_asset'});
    if(/\.(?:[cm]?js|json|ya?ml|md|txt|toml|html|map|py|pem|key)$/i.test(name)||/(^|[\\/])\.env(?:\.|$)/i.test(name)) {
      const source=read().toString('utf8');
      if(privateMarkers.some(marker=>source.includes(marker)))failures.push({path:name,reason:'private_implementation_or_prompt'});
      if(sensitiveAsset(name,source))failures.push({path:name,reason:'credential_asset'});
    }
    checked.push(name);
  }
  for(const entry of asar.listPackage(archive)) {
    const name=entry.replace(/^[\\/]+/, '');
    const stat=asar.statFile(archive,name);
    if(!stat.files)inspect(name,()=>asar.extractFile(archive,name));
  }
  function walk(dir) {
    for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
      const absolute=path.join(dir,item.name),relative=path.relative(resources,absolute);
      if(item.isSymbolicLink())throw new Error('Unexpected resource link in G3 audit');
      if(item.isDirectory())walk(absolute);
      else if(item.isFile()&&absolute!==archive)inspect(relative,()=>fs.readFileSync(absolute));
    }
  }
  walk(resources);
  const report={schemaVersion:1,checkedAt:new Date().toISOString(),root:path.resolve(root),
    asarSha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    fileCount:checked.length,failures,passed:failures.length===0};
  if(failures.length)throw Object.assign(new Error(`G3 private asset audit failed: ${failures.map(x=>x.path).join(', ')}`),{report});
  return report;
}
module.exports={auditCloudStrategyPackage};
if(require.main===module) {
  const report=auditCloudStrategyPackage(process.argv[2]||path.join(__dirname,'../release/win-unpacked'));
  if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
