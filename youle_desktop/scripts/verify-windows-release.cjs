const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { verifySignature } = require('./evsign-client.cjs');
const policy = require('./evsign-policy.json');

async function verifyFiles(files) {
  if (!policy.certificateThumbprint) throw new Error('EV signing certificate must be pinned before release');
  const report = [];
  for (const file of files) {
    const signature = await verifySignature(file);
    const bytes = await fs.readFile(file);
    report.push({ file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), ...signature });
  }
  return report;
}
async function verifyUnpacked(root) {
  return verifyFiles([path.join(root, 'haolo_desktop.exe'), path.join(root, 'resources', 'bin', 'haolo-chrome-native-host.exe')]);
}
async function verifyRelease(root = path.resolve(__dirname, '..', 'release')) {
  const pkg = require('../package.json');
  const report = await verifyUnpacked(path.join(root, 'win-unpacked'));
  report.push(...await verifyFiles([
    path.join(root, `haolo_desktop-${pkg.version}-Setup.exe`),
    path.join(root, 'ev-signing', `haolo_desktop-${pkg.version}-Setup.__uninstaller.exe`),
  ]));
  await fs.writeFile(path.join(root, `ev-signatures-${pkg.version}.json`), JSON.stringify(report, null, 2) + '\n');
  return report;
}
module.exports = { verifyRelease, verifyUnpacked };
if (require.main === module) {
  const task = process.argv[2] === '--unpacked' ? verifyUnpacked(path.resolve(process.argv[3] || 'release/win-unpacked')) : verifyRelease(process.argv[2]);
  task.then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
