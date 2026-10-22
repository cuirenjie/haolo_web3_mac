import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { runDesktopShortcutAction } from "../src/main/windows-desktop-shortcut.mjs";
import { translateAppText } from "../src/renderer/app-language.mjs";

test("real Windows ShellLink creation, validation, upgrade and recovery lifecycle", { skip: process.platform !== "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-shortcut-tests-"));
  const script = fileURLToPath(new URL("./support/windows-desktop-shortcut-tests.ps1", import.meta.url));
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Root", root], {
    encoding: "utf8", windowsHide: true, timeout: 90_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\nFixture: ${root}`);
  assert.match(result.stdout, /PASSED 33 cases/);
  // Never remove a computed Windows path without checking its resolved parent.
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("haolo-shortcut-tests-"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("desktop action quotes paths and never elevates or runs an installer", async () => {
  let command;
  const result = await runDesktopShortcutAction({ action: "Recover", scriptPath: "C:/A user's folder/helper.ps1", installDir: "C:/程序/HaoLo", runPowerShell: async (value) => {
    command = value; return { stdout: '{"Status":"unchanged"}' };
  } });
  assert.equal(result.Status, "unchanged");
  assert.match(command, /A user''s folder/);
  assert.doesNotMatch(command, /Start-Process|RunAs|Setup\.exe/);
});

test("helper errors from the existing PowerShell runner retain the diagnostic", async () => {
  await assert.rejects(runDesktopShortcutAction({ action: "Restore", scriptPath: "helper.ps1", installDir: "app", runPowerShell: async () => {
    throw new Error('{"Status":"pending","Error":"desktop is read-only"}');
  } }), /desktop is read-only/);
});

test("a deletion during recovery is preserved without claiming a manual restore succeeded", async () => {
  const options = { scriptPath: "helper.ps1", installDir: "app", runPowerShell: async () => ({ stdout: '{"Status":"preserved-absent"}' }) };
  assert.equal((await runDesktopShortcutAction({ ...options, action: "Recover" })).Status, "preserved-absent");
  await assert.rejects(runDesktopShortcutAction({ ...options, action: "Restore" }), /could not be verified/);
});

test("invalid actions and malformed or absent helper replies fail closed", async () => {
  const options = { scriptPath: "helper.ps1", installDir: "app", runPowerShell: async () => ({ stdout: "" }) };
  await assert.rejects(runDesktopShortcutAction({ ...options, action: "Install" }), /Unknown/);
  await assert.rejects(runDesktopShortcutAction({ ...options, action: "Recover" }), /could not be verified/);
  await assert.rejects(runDesktopShortcutAction({ ...options, action: "Recover", runPowerShell: async () => { throw new Error("PowerShell unavailable"); } }), /PowerShell unavailable/);
});

test("startup repair never falls back to create when an existing link disappears", async () => {
  const source = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8").replace(/\r/g, "");
  const code = source.slice(source.indexOf("async function writeAppShortcut("), source.indexOf("async function migrateLegacyPackagedWindowsShortcuts("));
  const calls = [];
  const context = vm.createContext({
    fs: { promises: { mkdir: async () => { throw new Error("repair must not create directories"); } } }, path,
    shortcutExists: async () => true, shortcutNeedsRepair: () => true, shortcutDetails: () => ({}),
    shell: { readShortcutLink: () => ({}), writeShortcutLink: (_path, operation) => { calls.push(operation); return false; } },
  });
  vm.runInContext(code, context);
  await assert.rejects(context.repairAppShortcut("removed.lnk"));
  assert.deepEqual(calls, ["replace"]);
});

test("manual shortcut action and errors are localized in all three UI languages", () => {
  for (const phrase of ["桌面快捷方式", "创建桌面快捷方式", "桌面快捷方式已就绪", "无法更新桌面快捷方式，请检查桌面目录权限后重试。"] ) {
    assert.equal(translateAppText(phrase, "zh-CN"), phrase);
    assert.doesNotMatch(translateAppText(phrase, "en"), /[\u3400-\u9fff]/u);
    assert.notEqual(translateAppText(phrase, "zh-TW"), phrase);
  }
});

test("startup leaves legacy desktop leftovers alone while migrating both Start Menus", async () => {
  const source = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const pathsCode = source.slice(source.indexOf("function packagedWindowsShortcutPaths("), source.indexOf("function systemIntegrationSourceShortcutPath("));
  const migrationCode = source.slice(source.indexOf("async function migrateLegacyPackagedWindowsShortcuts("), source.indexOf("function ensureWindowsNotificationShortcut("));
  const writes = [], removed = [];
  const context = vm.createContext({
    path: path.win32, shortcutBaseName: () => "HaoLo", legacyShortcutBaseName: () => "legacy",
    commonAppDataPath: () => "C:\\Common", publicUserPath: () => "C:\\Public",
    systemIntegrationShortcutPath: (kind, name) => `C:\\User\\${kind}\\${name}.lnk`,
    uniqueSystemIntegrationPaths: (paths) => paths, shortcutExists: async () => true,
    shell: { readShortcutLink: () => ({}) }, shortcutDetailsMatchApp: () => true,
    writeAppShortcut: async (p) => { writes.push(p); },
    fs: { promises: { rm: async (p) => {
      if (/desktop/i.test(p)) throw new Error("Legacy desktop removal denied");
      removed.push(p);
    } } }, notifyWindowsShortcutChanged: async () => {},
  });
  vm.runInContext(pathsCode + migrationCode, context);
  // Repeat like consecutive starts after the user removed the current HaoLo link.
  for (let i = 0; i < 2; i++) {
    writes.length = 0; removed.length = 0;
    await context.migrateLegacyPackagedWindowsShortcuts();
    assert.equal(writes.length, 2, "only the user and public Start Menus may migrate");
    assert.equal(removed.length, 2);
    assert.ok(writes.every((p) => !/desktop/i.test(p)), "desktop migration bypassed deletion policy");
  }
});
