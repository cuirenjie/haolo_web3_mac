const { signFile } = require('./evsign-client.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { verifyUnpacked } = require('./verify-windows-release.cjs');
const { auditCloudStrategyPackage } = require('./audit-cloud-strategy-package.cjs');
// electron-builder v26 custom signing hook; NSIS signs its uninstaller and
// final installer here before generating the update blockmap.
exports.default = async function signWindows(configuration, packager) {
  if (configuration.hash !== 'sha256') throw new Error('Windows releases require SHA-256 signing');
  if (/-Setup\.exe$/i.test(configuration.path)) {
    // --prepackaged skips afterPack. Verify inner executables before signing
    // an installer, so an old unsigned directory cannot become a release.
    const unpacked = packager?.packagerOptions?.prepackaged || path.join(path.dirname(configuration.path), 'win-unpacked');
    // G3 also applies to a prepackaged rollback or update installer. Valid EV
    // signatures alone do not prove that its strategy assets were removed.
    const audit = auditCloudStrategyPackage(path.resolve(unpacked));
    await fs.writeFile(path.join(path.dirname(configuration.path), 'cloud-strategy-package-audit.json'), JSON.stringify(audit, null, 2));
    await verifyUnpacked(path.resolve(unpacked));
  }
  await signFile(configuration.path);
  if (/-Setup\.__uninstaller\.exe$/i.test(configuration.path)) {
    // NSIS deletes its temporary uninstaller after embedding it. Keep the
    // exact signed bytes as release evidence for the final verification gate.
    const evidence = path.join(path.dirname(configuration.path), 'ev-signing');
    await fs.mkdir(evidence, { recursive: true });
    await fs.copyFile(configuration.path, path.join(evidence, path.basename(configuration.path)));
  }
};
