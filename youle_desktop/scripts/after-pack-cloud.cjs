const restoreIcon=require('./restore-windows-icon.cjs');
const path=require('node:path');
const {auditCloudStrategyPackage}=require('./audit-cloud-strategy-package.cjs');
module.exports=async context=>{
  await (restoreIcon.default||restoreIcon)(context);
  const packageRoot=context.electronPlatformName==='darwin'
    ? path.join(context.appOutDir,`${context.packager.appInfo.productFilename}.app`)
    : context.appOutDir;
  if(context.electronPlatformName==='darwin'){
    const {packagedSupport}=await import('../../tools/mac-support-artifact.mjs');
    packagedSupport(path.join(packageRoot,'Contents/Resources/app.asar'));
  }
  const report=auditCloudStrategyPackage(packageRoot);
  console.log(`[G3] ${report.fileCount} packaged files passed; ASAR ${report.asarSha256}`);
};
