import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  WINDOWS_UTF8_PIPE_BOOTSTRAP,
  buildWindowsUtf8ShellReminder,
  prependWindowsUtf8ShellReminder,
  stripWindowsUtf8ShellReminder,
  windowsUtf8DesktopInstruction,
} from "../src/main/windows-utf8-guardrails.mjs";

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function powershellPath() {
  const candidate = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return fs.existsSync(candidate) ? candidate : "powershell.exe";
}

test("Windows UTF-8 guardrails call out PowerShell pipeline path corruption", () => {
  const reminder = buildWindowsUtf8ShellReminder("win32");
  assert.match(reminder, /US-ASCII/);
  assert.match(reminder, /D:\\AI\?\?\?/);
  assert.match(reminder, /python -/);
  assert.match(reminder, /\$OutputEncoding/);
  assert.match(windowsUtf8DesktopInstruction(), /argv\/env\/JSON/);
  assert.equal(buildWindowsUtf8ShellReminder("linux"), null);
});

test("Windows UTF-8 reminder is prepended to turn input once", () => {
  const existingReminder = buildWindowsUtf8ShellReminder("win32");
  const prepared = prependWindowsUtf8ShellReminder(`${existingReminder}\n\n继续识别中文路径`, "win32");

  assert.ok(prepared.startsWith("<haolo_windows_utf8_reminder>"));
  assert.equal(prepared.match(/<haolo_windows_utf8_reminder>/g)?.length, 1);
  assert.equal(prepared.match(/<\/haolo_windows_utf8_reminder>/g)?.length, 1);
  assert.ok(prepared.endsWith("继续识别中文路径"));
  assert.equal(stripWindowsUtf8ShellReminder(prepared).trim(), "继续识别中文路径");
  assert.equal(prependWindowsUtf8ShellReminder("继续识别中文路径", "linux"), "继续识别中文路径");
});

test("thread-group memory strips internal UTF-8 reminders before truncating messages", () => {
  const mainSource = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  assert.match(
    mainSource,
    /import \{[\s\S]*?stripWindowsUtf8ShellReminder[\s\S]*?\} from "\.\/windows-utf8-guardrails\.mjs";/,
    "main process must import the reminder stripper used by thread-group memory",
  );
  const start = mainSource.indexOf("function truncateGroupMemoryText(value)");
  const end = mainSource.indexOf("\nfunction buildDesktopDeveloperInstructions", start);
  assert.ok(start >= 0 && end > start, "truncateGroupMemoryText source block should exist");
  const block = mainSource.slice(start, end);

  assert.match(block, /stripWindowsUtf8ShellReminder\(String\(value \|\| ""\)\)/);
  assert.ok(
    block.indexOf("stripWindowsUtf8ShellReminder") < block.indexOf("GROUP_MEMORY_MAX_MESSAGE_CHARS"),
    "internal reminders must be removed before the memory text is truncated",
  );
});

test("Windows UTF-8 bootstrap preserves CJK paths piped into native tools", { skip: process.platform !== "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-cn-path-"));
  try {
    const folder = path.join(root, "中文文件夹");
    const filePath = path.join(folder, "搜索系统.txt");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(filePath, "ok", "utf8");

    const nodeSource = [
      'const fs = require("node:fs");',
      `const p = ${JSON.stringify(filePath)};`,
      "process.stdout.write(JSON.stringify({ path: p, exists: fs.existsSync(p) }));",
    ].join("\n");
    const script = [
      WINDOWS_UTF8_PIPE_BOOTSTRAP,
      "$source = @'",
      nodeSource,
      "'@",
      `$source | & ${psQuote(process.execPath)} -`,
    ].join("\n");

    const result = spawnSync(powershellPath(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });

    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.exists, true);
    assert.equal(parsed.path.includes("?"), false);
    assert.match(parsed.path, /中文文件夹/);
    assert.match(parsed.path, /搜索系统\.txt/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
