const restoreIcon=require('./restore-windows-icon.cjs');
const {auditCloudStrategyPackage}=require('./audit-cloud-strategy-package.cjs');
module.exports=async context=>{
  const {packagedSupport}=await import('../../tools/windows-support-artifact.mjs');
  packagedSupport(require('node:path').join(context.appOutDir,'resources/app.asar'));
  await (restoreIcon.default||restoreIcon)(context);
  const report=auditCloudStrategyPackage(context.appOutDir);
  console.log(`[G3] ${report.fileCount} packaged files passed; ASAR ${report.asarSha256}`);
};
