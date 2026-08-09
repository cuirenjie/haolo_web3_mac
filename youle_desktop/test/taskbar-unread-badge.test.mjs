import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createTaskbarUnreadBadgeBitmap,
  normalizeTaskbarUnreadCount,
  taskbarUnreadBadgeLabel,
} from "../src/main/taskbar-unread-badge.mjs";

test("taskbar unread counts are normalized and capped", () => {
  assert.equal(normalizeTaskbarUnreadCount(undefined), 0);
  assert.equal(normalizeTaskbarUnreadCount(-1), 0);
  assert.equal(normalizeTaskbarUnreadCount(2.9), 2);
  assert.equal(normalizeTaskbarUnreadCount(50_000), 9999);
});

test("taskbar badge labels show exact counts through 99 and then 99+", () => {
  assert.equal(taskbarUnreadBadgeLabel(0), "");
  assert.equal(taskbarUnreadBadgeLabel(1), "1");
  assert.equal(taskbarUnreadBadgeLabel(42), "42");
  assert.equal(taskbarUnreadBadgeLabel(100), "99+");
});

test("taskbar badge bitmap is a high-DPI BGRA image with transparent corners", () => {
  const badge = createTaskbarUnreadBadgeBitmap(8);
  assert.ok(badge);
  assert.equal(badge.width, 48);
  assert.equal(badge.height, 48);
  assert.equal(badge.scaleFactor, 3);
  assert.equal(badge.buffer.length, 48 * 48 * 4);
  assert.equal(badge.buffer[3], 0, "top-left corner should remain transparent");

  const bluePixelOffset = (24 * 48 + 8) * 4;
  assert.equal(badge.buffer[bluePixelOffset], 255, "blue channel should be stored first in BGRA order");
  assert.equal(badge.buffer[bluePixelOffset + 1], 119);
  assert.equal(badge.buffer[bluePixelOffset + 2], 22);
  assert.equal(badge.buffer[bluePixelOffset + 3], 255);

  const centerOffset = (24 * 48 + 24) * 4;
  assert.deepEqual([...badge.buffer.subarray(centerOffset, centerOffset + 4)], [255, 255, 255, 255]);
});

test("renderer and preload synchronize unread conversation count with the main process", async () => {
  const [rendererSource, preloadSource, mainSource] = await Promise.all([
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(rendererSource, /function taskbarUnreadConversationCount\(\)/);
  assert.match(rendererSource, /new Set<string>\(\)/);
  assert.match(rendererSource, /numberValue\(thread\.unread\)/);
  assert.match(rendererSource, /Object\.keys\(unviewedFinalResultThreadIds\)/);
  assert.match(rendererSource, /api\.setTaskbarUnreadCount\(\{ count \}\)/);
  assert.match(preloadSource, /app:setTaskbarUnreadCount/);
  assert.match(mainSource, /ipcMain\.handle\("app:setTaskbarUnreadCount"/);
  assert.match(mainSource, /mainWindow\.setOverlayIcon/);
});

test("background completion stays unread until its active conversation regains focus", async () => {
  const rendererSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

  assert.match(rendererSource, /function isDesktopWindowActivelyViewed\(\)[\s\S]*document\.visibilityState === "visible"[\s\S]*document\.hasFocus\(\)/);
  assert.match(rendererSource, /function shouldMarkFinalResultUnviewed[\s\S]*!isConversationThreadActivelyViewed\(threadId\)/);
  assert.match(rendererSource, /window\.addEventListener\("focus", markActiveConversationViewed/);
  assert.match(rendererSource, /document\.addEventListener\("visibilitychange", markActiveConversationViewed/);
  assert.match(rendererSource, /function markActiveConversationViewed[\s\S]*clearUnviewedFinalResult\(threadId\)/);
  assert.match(rendererSource, /isConversationThreadActivelyViewed\(channelThreadId\(msgChannelId\)\)/);
});
