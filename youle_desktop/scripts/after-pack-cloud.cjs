const restoreIcon=require('./restore-windows-icon.cjs');
const {auditCloudStrategyPackage}=require('./audit-cloud-strategy-package.cjs');
module.exports=async context=>{
  await (restoreIcon.default||restoreIcon)(context);
  const report=auditCloudStrategyPackage(context.appOutDir);
  console.log(`[G3] ${report.fileCount} packaged files passed; ASAR ${report.asarSha256}`);
};
