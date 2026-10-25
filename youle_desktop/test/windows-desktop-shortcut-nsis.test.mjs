import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const templates = path.join(path.dirname(builderRequire.resolve("app-builder-lib/package.json")), "templates/nsis");
const cache = path.join(process.env.LOCALAPPDATA || "", "electron-builder/Cache");
const child = (root, prefix) => fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).find((item) => item.isDirectory() && item.name.startsWith(prefix))?.name : null;
const nsisRoot = path.join(cache, "nsis-3.0.4.1", child(path.join(cache, "nsis-3.0.4.1"), "nsis-") || "missing");
const compiler = process.env.HAOLO_NSIS_MAKENSIS || path.join(nsisRoot, "Bin/makensis.exe");
const resourceRoot = path.join(cache, "nsis-resources-3.4.1", child(path.join(cache, "nsis-resources-3.4.1"), "nsis-") || "missing");
const plugins = path.join(resourceRoot, "plugins/x86-unicode");
const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;
const nsisQuote = (value) => value.replace(/\$/g, "$$").replace(/"/g, '$\\"');
const extractMacro = (source, name) => {
  const start = source.indexOf(`!macro ${name}`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("!macroend", start) + 9);
};

test("actual NSIS hooks preserve install-time intent and keep-shortcuts update flags", {
  skip: process.platform !== "win32" || !fs.existsSync(compiler) ? "Windows NSIS diagnostic compiler is required" : false,
  timeout: 180_000,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-shortcut-nsis-"));
  const scopeKey = `Software\\HaoLoShortcutTests\\${path.basename(root)}`;
  // One harmless diagnostic executable, never the product installer. All links,
  // fake payloads and state files stay under root. Only a dedicated test registry
  // key is written, for executing the upstream keep-shortcuts logic verbatim.
  const helper = path.join(root, "fixture.ps1");
  fs.writeFileSync(helper, "\ufeff" + [
    "param([string]$Action,[string]$Scope='CurrentUser',[string]$InstallDir,[string]$SnapshotFile,[switch]$OptOut)",
    `. ${psQuote(path.join(packageRoot, "resources/windows-desktop-shortcut.ps1"))} -Action $Action -Scope $Scope -InstallDir $InstallDir -SnapshotFile $SnapshotFile -OptOut:$OptOut`,
    `$fixtureRoot=${psQuote(root)}`,
    "$config=Get-Content -LiteralPath (Join-Path $fixtureRoot 'config.json') -Raw | ConvertFrom-Json",
    "function Get-HaoloInteractiveSid { Get-HaoloSid }",
    "function Get-HaoloDesktop([string]$scopeName) { Join-Path $fixtureRoot ('desktop-'+$scopeName) }",
    "function Read-HaoloInstallDir([string]$scopeName) { $installedScope=if ($config.scope) { $config.scope } else { 'CurrentUser' }; if ($scopeName -eq $installedScope -and $config.installed) { return (Join-Path $fixtureRoot 'app') }; return '' }",
    "function Read-HaoloShortcutState([string]$scopeName) { $p=Join-Path $fixtureRoot ('state-'+$scopeName+'.json'); if (Test-Path -LiteralPath $p) { Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json } }",
    "function Write-HaoloShortcutState([string]$scopeName,$state) { $state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixtureRoot ('state-'+$scopeName+'.json')) -Encoding UTF8 }",
    "try { $r=Invoke-HaoloShortcutAction; if ($Action -eq 'Snapshot' -and ($config.deleteAfterSnapshot -or $config.consumePending)) {",
    "  $fixtureScope=if ($config.scope) { $config.scope } else { 'CurrentUser' }",
    "  if ($config.consumePending) { $script:Action='Recover'; $script:InstallDir=Join-Path $fixtureRoot 'app'; Invoke-HaoloShortcutAction | Out-Null }",
    "  [IO.File]::Delete((Join-Path (Get-HaoloDesktop $fixtureScope) 'HaoLo.lnk'))",
    "}; $r | ConvertTo-Json -Compress; if ($r.Status -in @('pending','attention')) { exit 2 }; exit 0 } catch { Write-Output $_.Exception.Message; exit 3 }",
  ].join("\r\n"));
  const util = fs.readFileSync(path.join(templates, "include/installUtil.nsh"), "utf8");
  const section = fs.readFileSync(path.join(templates, "installSection.nsh"), "utf8");
  const keepCalculation = section.slice(section.indexOf("Var /GLOBAL keepShortcuts"), section.indexOf("!insertmacro uninstallOldVersion"))
    .replace('ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts', 'ReadRegStr $R1 HKCU "$fixtureScopeKey" KeepShortcuts');
  const flagStart = util.indexOf('  !insertMacro setIsTryToKeepShortcuts', util.indexOf('Function uninstallOldVersion'));
  const flagEnd = util.indexOf('  ${if} ${isDeleteAppData}', flagStart);
  const keepArgs = util.slice(flagStart, flagEnd).replace('!insertmacro readReg $R5 "$rootKey" "${INSTALL_REGISTRY_KEY}" KeepShortcuts', 'ReadRegStr $R5 HKCU "$fixtureScopeKey" KeepShortcuts');
  // Redirect only the machine hive to a separate test subkey. No HKLM writes or
  // administrator privileges are needed; both real lookup branches still run.
  const installerSource = fs.readFileSync(path.join(packageRoot, "resources/installer.nsh"), "utf8");
  const isolatedInstaller = path.join(root, "installer-under-test.nsh");
  fs.writeFileSync(isolatedInstaller, "\ufeff" + installerSource.replace(/^\ufeff/, "")
    .replace('HKEY_LOCAL_MACHINE "${INSTALL_REGISTRY_KEY}" InstallLocation', 'HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}\\machine" InstallLocation'));
  const executable = path.join(root, "diagnostic.exe");
  const source = [
    "Unicode true", "SilentInstall silent", "RequestExecutionLevel user", 'Name "Haolo shortcut hook diagnostic"',
    `OutFile "${nsisQuote(executable)}"`, '!include "LogicLib.nsh"',
    `!addincludedir "${nsisQuote(path.join(templates, "include"))}"`,
    `!addplugindir /x86-unicode "${nsisQuote(plugins)}"`, '!include "StdUtils.nsh"',
    '!define APP_FILENAME "haolo_desktop"', '!define APP_DESCRIPTION "HaoLo diagnostic"',
    '!define APP_ID "local.haolo.shortcut-test"', `!define APP_GUID "${path.basename(root)}"`,
    `!define INSTALL_REGISTRY_KEY "${scopeKey}"`, '!define SHELL_CONTEXT HKCU',
    '!define allowToChangeInstallationDirectory', '!define DO_NOT_CREATE_START_MENU_SHORTCUT',
    `!define HAOLO_SHORTCUT_SCRIPT "${nsisQuote(helper)}"`,
    'Var appExe', 'Var launchLink', 'Var installMode', 'Var rootKey', 'Var fixtureScopeKey',
    '!macro _isUpdated _a _b _t _f', '${StdUtils.TestParameter} $R9 "updated"', 'StrCmp "$R9" "true" `${_t}` `${_f}`', '!macroend', '!define isUpdated `"" isUpdated ""`',
    '!macro _isNoDesktopShortcut _a _b _t _f', '${StdUtils.TestParameter} $R9 "no-desktop-shortcut"', 'StrCmp "$R9" "true" `${_t}` `${_f}`', '!macroend', '!define isNoDesktopShortcut `"" isNoDesktopShortcut ""`',
    `!include "${nsisQuote(isolatedInstaller)}"`,
    '!ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT', '!error "Native default creation must be suppressed for managed desktop links"', '!endif',
    'Var /GLOBAL isTryToKeepShortcuts', extractMacro(util, "setIsTryToKeepShortcuts"),
    'Function .onInit', '!insertmacro customInit', 'FunctionEnd',
    'Section', '${StdUtils.TestParameter} $R8 "fixture-all"',
    '${if} $R8 == "true"', 'StrCpy $installMode "all"', 'StrCpy $fixtureScopeKey "${INSTALL_REGISTRY_KEY}\\machine"',
    '${else}', 'StrCpy $installMode "CurrentUser"', 'StrCpy $fixtureScopeKey "${INSTALL_REGISTRY_KEY}"', '${endif}',
    `StrCpy $INSTDIR "${nsisQuote(path.join(root, "app"))}"`,
    'StrCpy $appExe "$INSTDIR\\haolo_desktop.exe"',
    // Store a preexisting valid install only when the previous payload exists.
    '${if} ${FileExists} "$appExe"', 'WriteRegStr HKCU "$fixtureScopeKey" InstallLocation "$INSTDIR"',
    'WriteRegStr HKCU "$fixtureScopeKey" KeepShortcuts "true"', '${endif}',
    keepCalculation,
    '${if} $installMode == "all"', 'StrCpy $0 "/allusers"', '${else}', 'StrCpy $0 "/currentuser"', '${endif}', keepArgs,
    'FileOpen $1 "$EXEDIR\\keep.txt" w', 'FileWrite $1 "$keepShortcuts|$0"', 'FileClose $1',
    'CreateDirectory "$INSTDIR"', 'FileOpen $1 "$appExe" w', 'FileWrite $1 "dummy target, never executed"', 'FileClose $1',
    // Like registryAddInstallInfo, mutate the install key before customInstall.
    'WriteRegStr HKCU "$fixtureScopeKey" InstallLocation "$INSTDIR"',
    '!insertmacro customInstall',
    'DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"', 'SectionEnd',
  ].join("\r\n");
  const nsi = path.join(root, "diagnostic.nsi");
  fs.writeFileSync(nsi, "\ufeff" + source);
  const build = spawnSync(compiler, ["/V2", nsi], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}\n${root}`);
  const includeLine = `!include "${nsisQuote(isolatedInstaller)}"`;
  const uninstallSource = source.slice(0, source.indexOf(includeLine)).replace(nsisQuote(executable), nsisQuote(path.join(root, "uninstaller-compile-only.exe"))) + [
    '!define BUILD_UNINSTALLER', includeLine,
    '!ifdef DO_NOT_CREATE_DESKTOP_SHORTCUT', '!error "Uninstaller must retain upstream desktop cleanup and pin handling"', '!endif',
    '!ifmacrodef customInit', '!error "Uninstaller must not run shortcut installation hooks"', '!endif',
    'Function compileOnlyNeverCalled', '!insertmacro customUnInstall', 'FunctionEnd', 'Section', 'SectionEnd',
  ].join("\r\n");
  const uninstallNsi = path.join(root, "uninstaller-compile-only.nsi");
  fs.writeFileSync(uninstallNsi, "\ufeff" + uninstallSource);
  const uninstallBuild = spawnSync(compiler, ["/V2", uninstallNsi], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  assert.equal(uninstallBuild.status, 0, `${uninstallBuild.stdout}\n${uninstallBuild.stderr}`);
  // Execute the upstream unpin/delete guard with mutations replaced by a
  // counter. This checks the old uninstaller's side of the parameter contract
  // without ever invoking a Windows pin API or deleting a real shortcut.
  const uninstallTemplate = fs.readFileSync(path.join(templates, "uninstaller.nsh"), "utf8");
  const guard = uninstallTemplate.slice(uninstallTemplate.indexOf('  ${ifNot} ${isKeepShortcuts}'), uninstallTemplate.indexOf('  # refresh the desktop'));
  assert.match(guard, /WinShell::UninstAppUserModelId/);
  const instrumentedGuard = guard
    .replace(/^(\s*)(?:WinShell::\w+|Delete|RMDir) .*$/gm, '$1IntOp $R7 $R7 + 1')
    .replace(/^(\s*)ReadRegStr .*$/gm, '$1StrCpy $R1 ""');
  assert.doesNotMatch(instrumentedGuard, /WinShell::|\bDelete\b|\bRMDir\b|ReadRegStr/);
  const { NsisScriptGenerator } = builderRequire("app-builder-lib/out/targets/nsis/nsisScriptGenerator.js");
  const flags = new NsisScriptGenerator(); flags.flags(["keep-shortcuts"]);
  const probe = path.join(root, "uninstall-guard-probe.exe");
  const probeNsi = path.join(root, "uninstall-guard-probe.nsi");
  fs.writeFileSync(probeNsi, "\ufeff" + [
    'Unicode true', 'SilentInstall silent', 'RequestExecutionLevel user', `OutFile "${nsisQuote(probe)}"`,
    '!include "LogicLib.nsh"', `!addincludedir "${nsisQuote(path.join(templates, "include"))}"`,
    `!addplugindir /x86-unicode "${nsisQuote(plugins)}"`, '!include "StdUtils.nsh"', flags.build(),
    'Section', 'StrCpy $R7 0', instrumentedGuard,
    'FileOpen $1 "$EXEDIR\\pin-actions.txt" w', 'FileWrite $1 "$R7"', 'FileClose $1', 'SectionEnd',
  ].join("\r\n"));
  const probeBuild = spawnSync(compiler, ["/V2", probeNsi], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  assert.equal(probeBuild.status, 0, `${probeBuild.stdout}\n${probeBuild.stderr}`);
  const pinActions = (args) => {
    const result = spawnSync(probe, args, { windowsHide: true, timeout: 10_000 });
    assert.equal(result.status, 0);
    return Number(fs.readFileSync(path.join(root, "pin-actions.txt"), "utf8"));
  };
  assert.ok(pinActions(["/allusers", "--updated"]) > 0, "negative control must reach unpin/delete actions without keep-shortcuts");
  for (const scope of ["CurrentUser", "AllUsers"]) fs.mkdirSync(path.join(root, `desktop-${scope}`));
  const link = path.join(root, "desktop-CurrentUser/HaoLo.lnk");
  let runs = 0;
  const run = (config, args = [], expectedExit = 0) => {
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify(config));
    const result = spawnSync(executable, [...(config.scope === "AllUsers" ? ["--fixture-all"] : []), ...args], { windowsHide: true, timeout: 40_000 });
    assert.equal(result.status, expectedExit, `diagnostic failed: ${result.error?.message}; ${root}`);
    runs++;
    return JSON.parse(fs.readFileSync(path.join(root, `state-${config.scope || "CurrentUser"}.json`), "utf8").replace(/^\ufeff/, ""));
  };
  assert.equal(run({ installed: false }).Status, "verified");
  assert.ok(fs.existsSync(link), "first install failed to create a desktop link");
  const original = fs.readFileSync(link);
  assert.equal(run({ installed: true }, ["--updated"]).Status, "verified");
  assert.deepEqual(fs.readFileSync(link), original, "normal update rewrote the valid shortcut");
  assert.match(fs.readFileSync(path.join(root, "keep.txt"), "utf8"), /true\|\/currentuser --keep-shortcuts/);
  fs.unlinkSync(link);
  assert.equal(run({ installed: true }, ["--updated"]).Status, "preserved-absent");
  assert.ok(!fs.existsSync(link), "automatic update recreated a user-deleted link");
  assert.equal(run({ installed: true }).Status, "preserved-absent");
  assert.ok(!fs.existsSync(link), "manual overwrite recreated a user-deleted link");
  assert.match(fs.readFileSync(path.join(root, "keep.txt"), "utf8"), /true\|\/currentuser --keep-shortcuts/);
  assert.equal(run({ installed: true }, ["--no-desktop-shortcut"]).Status, "opted-out");
  assert.ok(!fs.existsSync(link));
  fs.unlinkSync(path.join(root, "app/haolo_desktop.exe"));
  assert.equal(run({ installed: false }, ["--no-desktop-shortcut"]).Status, "opted-out");
  assert.ok(!fs.existsSync(link), "fresh opt-out created a link");
  fs.unlinkSync(path.join(root, "app/haolo_desktop.exe"));
  // Simulate a completed uninstall before the next genuinely fresh install.
  fs.unlinkSync(path.join(root, "state-CurrentUser.json"));
  fs.rmdirSync(path.join(root, "desktop-CurrentUser")); // Empty, known test directory only.
  assert.equal(run({ installed: false }, [], 2).Status, "pending", "first-install failure was silent");
  fs.mkdirSync(path.join(root, "desktop-CurrentUser"));
  assert.equal(run({ installed: true }, ["--updated"]).Status, "verified", "pending repair did not survive update");
  assert.ok(fs.existsSync(link));
  fs.unlinkSync(link);
  fs.unlinkSync(path.join(root, "app/haolo_desktop.exe"));
  fs.unlinkSync(path.join(root, "state-CurrentUser.json"));
  assert.equal(run({ installed: false }, ["--updated"]).Status, "verified", "updated flag alone misclassified a fresh install");
  assert.ok(fs.existsSync(link));
  // The following matrix reproduces the review findings in the actual hooks.
  const expectKeep = (scope) => {
    const flags = fs.readFileSync(path.join(root, "keep.txt"), "utf8");
    assert.equal(flags, `true|/${scope === "AllUsers" ? "allusers" : "currentuser"} --keep-shortcuts`);
    assert.equal(pinActions([...flags.split('|')[1].split(' '), '--updated']), 0, "update entered the old uninstaller's unpin/delete branch");
  };
  for (const scope of ["CurrentUser", "AllUsers"]) {
    const scopedLink = path.join(root, `desktop-${scope}/HaoLo.lnk`);
    if (scope === "AllUsers") {
      for (const name of ["desktop-CurrentUser/HaoLo.lnk", "state-CurrentUser.json", "app/haolo_desktop.exe"]) fs.unlinkSync(path.join(root, name));
      assert.equal(run({ installed: false, scope }).Status, "verified");
    }
    const bytes = fs.readFileSync(scopedLink);
    for (const args of [[], ["--updated"]]) {
      assert.equal(run({ installed: true, scope }, args).Status, "verified");
      expectKeep(scope);
      assert.deepEqual(fs.readFileSync(scopedLink), bytes, `${scope} valid shortcut changed`);
    }
    // A user may remove the shortcut before or while the installer UI is open.
    for (const args of [[], ["--updated"]]) {
      assert.equal(run({ installed: true, scope, deleteAfterSnapshot: true }, args).Status, "preserved-absent");
      expectKeep(scope);
      assert.ok(!fs.existsSync(scopedLink), `${scope} deletion after snapshot was undone`);
      assert.equal(run({ installed: true, scope }, args).Status, "preserved-absent");
      expectKeep(scope);
      assert.ok(!fs.existsSync(scopedLink), `${scope} preexisting deletion was undone`);
      // Simulate the user explicitly recreating the link for the next case.
      fs.writeFileSync(scopedLink, bytes);
    }
    for (const args of [[], ["--updated"]]) {
      fs.unlinkSync(scopedLink);
      const stateFile = path.join(root, `state-${scope}.json`);
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8").replace(/^\ufeff/, ""));
      state.Status = "pending";
      fs.writeFileSync(stateFile, JSON.stringify(state));
      assert.equal(run({ installed: true, scope, consumePending: true }, args).Status, "preserved-absent");
      expectKeep(scope);
      assert.ok(!fs.existsSync(scopedLink), `${scope} consumed pending was replayed`);
      fs.writeFileSync(scopedLink, bytes);
    }
  }
  assert.equal(runs, 26, "all first-install and update matrix cases must run");
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("haolo-shortcut-nsis-"));
  fs.rmSync(root, { recursive: true, force: true });
});
