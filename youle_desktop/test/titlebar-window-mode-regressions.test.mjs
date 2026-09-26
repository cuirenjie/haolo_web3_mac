import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { translateAppText } from "../src/renderer/app-language.mjs";

const renderer = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("titlebar channel trigger keeps focus across the shell render", () => {
  const render = sourceBlock(renderer, "function render()", "function scheduleRender");
  const bindings = sourceBlock(renderer, "function bindEvents()", "function bindWindowResizeHandles");

  assert.match(render, /hadTitlebarChannelTriggerFocus = document\.activeElement instanceof HTMLElement/);
  assert.match(render, /querySelector<HTMLButtonElement>\('\[data-action="toggle-external-channel-menu"\]'\)[\s\S]*?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(bindings, /if \(!event\.currentTarget \|\| !\(event\.currentTarget as HTMLElement\)\.isConnected\) return;/);
  assert.match(bindings, /state\.profileMenuOpen = false;[\s\S]*state\.skillSortMenuOpen = false;[\s\S]*state\.autoTaskMenuTaskId = null;[\s\S]*render\(\);/);
});

test("the new titlebar label is translated in English and Traditional Chinese", () => {
  assert.equal(translateAppText("连手机", "en"), "Connect phone");
  assert.equal(translateAppText("连手机", "zh-TW"), "連接手機");
});

test("window mode failures retry the requested mode without resetting repair attempts", () => {
  const setter = sourceBlock(renderer, "function setDesktopWindowMode", "function scheduleWindowModeReveal");

  assert.match(setter, /setDesktopWindowMode\(mode, \{ repair: true \}\)/);
  assert.match(setter, /\.catch\(retry\)/);
  assert.match(setter, /try \{[\s\S]*result = api\.setWindowMode\(mode, \{ center: shouldCenter \}\);[\s\S]*\} catch \{[\s\S]*retry\(\);/);
  assert.match(setter, /if \(windowModeRepairTimer !== null \|\| windowModeRepairAttempts >= 3\)/);
});
