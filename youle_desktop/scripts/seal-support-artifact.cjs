const path = require('node:path');
module.exports = async event => {
  if (!event.file || !/^haolo_desktop-\d+\.\d+\.\d+-Setup\.exe$/.test(path.basename(event.file))) return;
  const {Arch} = require('electron-builder');
  if (event.arch !== Arch.x64) throw new Error('Windows support publication requires one x64 installer');
  const prepackaged = event.packager.packagerOptions.prepackaged;
  const unpacked = prepackaged ? path.resolve(event.packager.projectDir, prepackaged) : path.join(path.dirname(event.file), 'win-unpacked');
  const {sealWindowsSupport} = await import('../../tools/windows-support-artifact.mjs');
  await sealWindowsSupport(event.file, path.join(unpacked, 'resources/app.asar'));
};
