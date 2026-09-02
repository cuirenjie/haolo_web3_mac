import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const mainSource = readFile(
  new URL("../src/main/main.mjs", import.meta.url),
  "utf8",
);
const installerSource = readFile(
  new URL("../resources/installer.nsh", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("update download progress patches its own DOM without scheduling a full renderer pass", async () => {
  const source = await rendererSource;
  const listenerBlock = sourceBlock(
    source,
    "api.onWindowsUpdateDownloadProgress?.((progress) => {",
    "api.onServerRequest",
  );
  const syncBlock = sourceBlock(
    source,
    "function syncWindowsUpdateProgress()",
    "async function downloadWindowsUpdate",
  );

  assert.match(
    listenerBlock,
    /state\.settings\.update\.downloadProgress = normalizeWindowsUpdateProgress\(progress\)/,
  );
  assert.match(listenerBlock, /syncWindowsUpdateProgress\(\)/);
  assert.doesNotMatch(listenerBlock, /scheduleRender|\brender\(/);
  assert.match(syncBlock, /\[data-update-progress-label\]/);
  assert.match(syncBlock, /\[data-update-progress-bytes\]/);
  assert.match(syncBlock, /\[data-update-progressbar\]/);
  assert.match(syncBlock, /\[data-update-progress-fill\]/);
  assert.match(syncBlock, /\.textContent = progressLabel/);
  assert.match(syncBlock, /fill\.style\.width/);
  assert.doesNotMatch(syncBlock, /innerHTML|scheduleRender|\brender\(/);
});

test("both update progress surfaces expose incremental patch targets", async () => {
  const source = await rendererSource;
  const dialogBlock = sourceBlock(
    source,
    "function renderUpdateDialog()",
    "function renderUpdateDownloadDock()",
  );
  const dockBlock = sourceBlock(
    source,
    "function renderUpdateDownloadDock()",
    "function renderOption",
  );

  for (const block of [dialogBlock, dockBlock]) {
    assert.match(block, /data-update-progress-label/);
    assert.match(block, /data-update-progress-bytes/);
    assert.match(block, /data-update-progressbar/);
    assert.match(block, /data-update-progress-fill/);
  }
});

test("every available desktop update is mandatory and cannot be dismissed", async () => {
  const [renderer, main] = await Promise.all([rendererSource, mainSource]);
  const checkBlock = sourceBlock(
    renderer,
    "async function checkForWindowsUpdate",
    "function normalizeWindowsUpdateProgress",
  );
  const dialogBlock = sourceBlock(
    renderer,
    "function renderUpdateDialog()",
    "function renderUpdateDownloadDock()",
  );
  const downloadBlock = sourceBlock(
    renderer,
    "async function downloadWindowsUpdate",
    "function closeUpdateDialog",
  );
  const listenerBlock = sourceBlock(
    renderer,
    "[data-action=\"check-update\"]",
    "[data-action=\"open-update-dialog\"]",
  );
  const normalizeBlock = sourceBlock(
    main,
    "function normalizeAppUpdateResponse",
    "function normalizeAppUpdateDownload",
  );

  assert.match(checkBlock, /result\.update_available[\s\S]*force_update: true/);
  assert.match(downloadBlock, /if \(!state\.settings\.update\.result\?\.update_available\)/);
  assert.match(dialogBlock, /const force = Boolean\(result\?\.update_available\)/);
  assert.match(dialogBlock, /此版本必须更新后才能继续使用。/);
  assert.match(dialogBlock, /force \? `<button[^`]*data-action="quit-app"/);
  assert.match(dialogBlock, /force \? "" : 'data-action="close-update-dialog"'/);
  assert.match(listenerBlock, /result\?\.update_available\) return/);
  assert.match(normalizeBlock, /force_update: Boolean\(payload\?\.update_available\)/);
});

test("main process rate-limits non-final update progress IPC", async () => {
  const source = await mainSource;
  const downloadBlock = sourceBlock(
    source,
    "async function downloadAppUpdate",
    "function scheduleWindowsUpdateInstallerLaunch",
  );

  assert.match(
    downloadBlock,
    /!force && lastProgressAt > 0 && now - lastProgressAt < 250/,
  );
  assert.match(
    downloadBlock,
    /emitProgress\(\{ downloadedBytes, totalBytes: download\.size_bytes \|\| downloadedBytes \}, true\)/,
  );
  assert.doesNotMatch(
    downloadBlock,
    /Math\.abs\(percent - lastProgressPercent\)/,
  );
});

test("Windows app updates preserve installer shortcuts and taskbar pins", async () => {
  const [source, installer] = await Promise.all([mainSource, installerSource]);
  const launcherBlock = sourceBlock(
    source,
    "function windowsUpdateInstallerLaunchScript",
    "function powerShellSingleQuotedString",
  );

  assert.match(
    launcherBlock,
    /Start-Process -FilePath \$installerPath -ArgumentList '--updated'/,
  );
  assert.match(installer, /!ifndef BUILD_UNINSTALLER[\s\S]*!undef isUpdated/);
  assert.match(
    installer,
    /ReadRegStr \$R9 HKEY_CURRENT_USER "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation/,
  );
});
