import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EXECUTION_PLAN_STICKY_FONT_SIZES,
  EXECUTION_PLAN_STICKY_MIN_HEIGHT,
  EXECUTION_PLAN_STICKY_MIN_WIDTH,
  executionPlanStickyBounds,
  executionPlanStickyFontSize,
  executionPlanStickyHtml,
  executionPlanStickyMovedBounds,
  executionPlanStickyResizedBounds,
  normalizeExecutionPlanStickyPayload,
} from "../src/main/execution-plan-sticky-view.mjs";

const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const stickySource = readFile(new URL("../src/main/execution-plan-sticky.mjs", import.meta.url), "utf8");
const stickyPreloadSource = readFile(new URL("../src/main/execution-plan-sticky-preload.cjs", import.meta.url), "utf8");

test("desktop execution-plan sticky payloads are bounded and normalized", () => {
  const normalized = normalizeExecutionPlanStickyPayload({
    groupId: "thread-a\u0000message-a",
    title: "\u0000ETH 计划",
    theme: "light",
    fontSize: 17,
    lines: [{
      label: "方向判断：",
      text: "偏多",
      directionTone: "bullish",
      segments: [{ text: "偏多", tone: "bullish" }],
    }],
  });

  assert.equal(normalized.title, "ETH 计划");
  assert.equal(normalized.groupId, "thread-a message-a");
  assert.equal(normalized.theme, "light");
  assert.equal(normalized.language, "zh-CN");
  assert.equal(normalized.fontSize, 16);
  assert.equal(normalized.lines[0].directionTone, "bullish");
  assert.deepEqual(EXECUTION_PLAN_STICKY_FONT_SIZES, [11, 12, 13, 14, 16, 18, 20]);
  assert.equal(executionPlanStickyFontSize(20, 1), 20);
  assert.equal(executionPlanStickyFontSize(11, -1), 11);
  assert.ok(executionPlanStickyBounds({ ...normalized, fontSize: 20 }).width > executionPlanStickyBounds(normalized).width);
  assert.deepEqual(
    executionPlanStickyMovedBounds({
      startBounds: { x: 100, y: 100, width: 400, height: 300 },
      startPoint: { x: 300, y: 200 },
      currentPoint: { x: 430, y: 280 },
      workArea: { x: 0, y: 0, width: 1000, height: 800 },
    }),
    { x: 230, y: 180, width: 400, height: 300 },
  );
  assert.deepEqual(
    executionPlanStickyResizedBounds({
      corner: "nw",
      startBounds: { x: 100, y: 100, width: 400, height: 300 },
      startPoint: { x: 100, y: 100 },
      currentPoint: { x: 180, y: 160 },
      workArea: { x: 0, y: 0, width: 1000, height: 800 },
    }),
    { x: 180, y: 160, width: 320, height: 240 },
  );
  assert.deepEqual(
    executionPlanStickyResizedBounds({
      corner: "se",
      startBounds: { x: 100, y: 100, width: 400, height: 300 },
      startPoint: { x: 500, y: 400 },
      currentPoint: { x: 0, y: 0 },
      workArea: { x: 0, y: 0, width: 1000, height: 800 },
    }),
    { x: 100, y: 100, width: EXECUTION_PLAN_STICKY_MIN_WIDTH, height: EXECUTION_PLAN_STICKY_MIN_HEIGHT },
  );
});

test("desktop execution-plan sticky HTML is escaped, draggable, themed, and fully interactive", () => {
  const html = executionPlanStickyHtml({
    title: '<script>alert("x")</script>',
    theme: "dark",
    fontSize: 14,
    lines: [{ label: "当前动作：", text: "等待 <条件>", segments: [] }],
  });

  assert.match(html, /html lang="zh-CN" data-theme="dark"/);
  assert.match(html, /html\[data-theme="dark"\]/);
  assert.match(html, /\.card\s*\{[^}]*cursor:\s*grab[^}]*-webkit-app-region:\s*no-drag/s);
  assert.doesNotMatch(html, /\.card\s*\{[^}]*box-shadow:/s);
  assert.match(html, /\.controls\s*\{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto[^}]*transform:\s*none/s);
  assert.doesNotMatch(html, /\.controls\s*\{[^}]*box-shadow:/s);
  assert.doesNotMatch(html, /\.card:hover \.controls|@media \((?:any-)?hover:\s*none\)/);
  assert.match(html, /data-resize-corner="nw"[\s\S]*data-resize-corner="ne"[\s\S]*data-resize-corner="sw"[\s\S]*data-resize-corner="se"/);
  assert.match(html, /\.resize-handle:hover, \.resize-handle\.active[\s\S]*opacity: 1/);
  assert.doesNotMatch(html, /\.resize-handle::before\s*\{[^}]*\b(?:border|border-radius|background|box-shadow):/s);
  assert.doesNotMatch(html, /\.resize-handle:hover, \.resize-handle\.active\s*\{[^}]*background:/s);
  assert.match(html, /pointerdown[\s\S]*startPoint = \{ x: event\.screenX, y: event\.screenY \}/);
  assert.match(html, /pointermove/);
  assert.match(html, /resizeApi\.resizeLive\(payload\(\)\)/);
  assert.match(html, /requestAnimationFrame\(sendMove\)/);
  assert.match(html, /resizeApi\.resizeCommit\(payload\(\)\)[\s\S]*pointerup/);
  assert.match(html, /resizeApi\.moveLive\(movePayload\(\)\)[\s\S]*card\.addEventListener\("pointerdown"/);
  assert.match(html, /resizeApi\.moveCommit\(movePayload\(\)\)[\s\S]*card\.addEventListener\("pointerup"/);
  assert.match(html, /card\.addEventListener\("wheel"[\s\S]*event\.preventDefault\(\)[\s\S]*wheelDistance < 0 \? "zoom-in" : "zoom-out"[\s\S]*haolo-execution-plan-sticky:\/\/[\s\S]*\{ passive: false \}/);
  assert.match(html, /html\[data-theme="dark"\][\s\S]*--control:/);
  assert.match(html, /p strong \{[^}]*font-weight: 700/s);
  assert.match(html, /haolo-execution-plan-sticky:\/\/zoom-in[\s\S]*放大/);
  assert.match(html, /haolo-execution-plan-sticky:\/\/zoom-out[\s\S]*缩小/);
  assert.match(html, /haolo-execution-plan-sticky:\/\/delete[\s\S]*删除/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /等待 &lt;条件&gt;/);
  assert.doesNotMatch(html, /<script>alert/);

  const english = executionPlanStickyHtml({ language: "en", theme: "light", lines: [] });
  assert.match(english, /html lang="en" data-theme="light"/);
  assert.match(english, />Zoom in<[^]*>Zoom out<[^]*>Delete</);
});

test("desktop execution-plan sticky windows stay above the desktop, synchronize grouped zoom, resize, and delete individually", async () => {
  const [main, preload, sticky, stickyPreload] = await Promise.all([mainSource, preloadSource, stickySource, stickyPreloadSource]);

  assert.match(preload, /createExecutionPlanSticky: \(params\) => ipcRenderer\.invoke\("executionPlanSticky:create", params\)/);
  assert.match(main, /ipcMain\.handle\("executionPlanSticky:create"[\s\S]*createExecutionPlanStickyWindow/);
  assert.match(main, /closeExecutionPlanStickyWindows\(\)/);
  assert.match(sticky, /frame: false[\s\S]*transparent: true[\s\S]*hasShadow: false[\s\S]*alwaysOnTop: true[\s\S]*resizable: true/);
  assert.match(sticky, /minWidth: EXECUTION_PLAN_STICKY_MIN_WIDTH[\s\S]*minHeight: EXECUTION_PLAN_STICKY_MIN_HEIGHT/);
  assert.match(sticky, /preload: STICKY_PRELOAD_PATH/);
  assert.match(stickyPreload, /contextBridge\.exposeInMainWorld\("haoloExecutionPlanSticky"/);
  assert.match(stickyPreload, /moveLive:[\s\S]*ipcRenderer\.send\("executionPlanSticky:move-live"/);
  assert.match(stickyPreload, /moveCommit:[\s\S]*ipcRenderer\.send\("executionPlanSticky:move-commit"/);
  assert.match(stickyPreload, /resizeLive:[\s\S]*ipcRenderer\.send\("executionPlanSticky:resize-live"/);
  assert.match(stickyPreload, /resizeCommit:[\s\S]*ipcRenderer\.send\("executionPlanSticky:resize-commit"/);
  assert.match(sticky, /window\.setAlwaysOnTop\(true, "screen-saver"\)/);
  assert.match(sticky, /movable: true/);
  assert.match(sticky, /window\.showInactive\(\)/);
  assert.match(sticky, /function zoomExecutionPlanStickyGroup[\s\S]*state\.payload\.groupId !== sourceState\.payload\.groupId[\s\S]*renderStickyWindow\(state\)/);
  assert.match(sticky, /action === "zoom-in"[\s\S]*zoomExecutionPlanStickyGroup\(state, action === "zoom-in" \? 1 : -1\)/);
  assert.match(sticky, /ipcMain\.on\("executionPlanSticky:resize-live"[\s\S]*resizeStickyWindowFromSender/);
  assert.match(sticky, /ipcMain\.on\("executionPlanSticky:resize-commit"[\s\S]*resizeStickyWindowFromSender\(event\.sender, params, true\)/);
  assert.match(sticky, /executionPlanStickyResizedBounds/);
  assert.match(sticky, /ipcMain\.on\("executionPlanSticky:move-live"[\s\S]*moveStickyWindowFromSender/);
  assert.match(sticky, /ipcMain\.on\("executionPlanSticky:move-commit"[\s\S]*moveStickyWindowFromSender\(event\.sender, params, true\)/);
  assert.match(sticky, /executionPlanStickyMovedBounds/);
  assert.match(sticky, /action === "delete"[\s\S]*window\.close\(\)/);
  assert.doesNotMatch(sticky, /action === "delete"[\s\S]*for \(const state of stickyWindows\.values\(\)\)/);
});
