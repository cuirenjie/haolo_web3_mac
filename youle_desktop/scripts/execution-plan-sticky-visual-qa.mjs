import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow } from "electron/main";
import {
  executionPlanStickyBounds,
  executionPlanStickyHtml,
} from "../src/main/execution-plan-sticky-view.mjs";
import {
  closeExecutionPlanStickyWindows,
  createExecutionPlanStickyWindow,
} from "../src/main/execution-plan-sticky.mjs";

const outputDirectory = path.resolve(process.argv[2] || path.join(process.cwd(), ".tmp", "execution-plan-sticky-visual-qa"));

function dataUrl(html) {
  return `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function capture(theme, fontSize) {
  const payload = {
    title: "SNDK/USDT 币安永续 1D · 多头条件方案",
    theme,
    language: "zh-CN",
    fontSize,
    lines: [
      { label: "当前动作：", text: "等待条件触发", directionTone: "", segments: [] },
      { label: "方向判断：", text: "偏多", directionTone: "bullish", segments: [] },
      { label: "多头触发：", text: "1580", directionTone: "", segments: [] },
      { label: "止损与失效：", text: "1310.01", directionTone: "", segments: [] },
      { label: "分批止盈：", text: "第1目标 1984.985", directionTone: "", segments: [] },
      { label: "风险收益比：", text: "目标1为 1:1.47，止损约 -23.85 USDT，止盈约 +36.15 USDT", directionTone: "", segments: [
        { text: "目标1为 1:1.47，止损约 ", tone: "" },
        { text: "-23.85", tone: "bearish" },
        { text: " USDT，止盈约 ", tone: "" },
        { text: "+36.15", tone: "bullish" },
        { text: " USDT", tone: "" },
      ] },
    ],
  };
  const bounds = executionPlanStickyBounds(payload);
  const window = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  let actionNavigation = "";
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("haolo-execution-plan-sticky:")) return;
    event.preventDefault();
    actionNavigation = url;
  });
  await window.loadURL(dataUrl(executionPlanStickyHtml(payload)));
  window.showInactive();
  await window.webContents.executeJavaScript('document.querySelector("a[href*=zoom-in]")?.focus()');
  window.webContents.sendInputEvent({ type: "mouseMove", x: bounds.width - 2, y: bounds.height - 2 });
  await delay(180);
  const image = await window.webContents.capturePage();
  const file = path.join(outputDirectory, `execution-plan-sticky-${theme}-${fontSize}px.png`);
  await writeFile(file, image.toPNG());
  await window.webContents.executeJavaScript('document.querySelector("a[href*=zoom-out]")?.click()');
  await delay(40);
  if (!actionNavigation.includes("zoom-out")) throw new Error("Sticky-note action navigation did not reach the main process.");
  window.close();
  return file;
}

async function verifyGroupedDesktopInteraction() {
  const base = {
    groupId: "execution-plan-sticky-visual-qa-group",
    theme: "dark",
    language: "zh-CN",
    fontSize: 12,
    lines: [{ label: "当前动作：", text: "等待条件触发", directionTone: "", segments: [] }],
  };
  createExecutionPlanStickyWindow({ ...base, title: "桌面联动便利贴 A" });
  createExecutionPlanStickyWindow({ ...base, title: "桌面联动便利贴 B" });
  await delay(260);
  const [first, second] = BrowserWindow.getAllWindows();
  if (!first || !second) throw new Error("Grouped sticky-note smoke test did not create two windows.");

  await first.webContents.executeJavaScript('document.querySelector("a[href*=zoom-in]")?.click()');
  await delay(160);
  const linkedFontSize = await second.webContents.executeJavaScript('getComputedStyle(document.querySelector(".content")).fontSize');
  if (linkedFontSize !== "13px") throw new Error(`Grouped sticky-note zoom did not synchronize: ${linkedFontSize}`);

  second.setPosition(480, 180);
  await delay(80);
  const beforeResize = second.getBounds();
  second.focus();
  await delay(80);
  const startX = beforeResize.x + beforeResize.width - 8;
  const startY = beforeResize.y + beforeResize.height - 8;
  const dispatchResizePointer = (type, x, y) => second.webContents.executeJavaScript(`(() => {
    const handle = document.querySelector('[data-resize-corner="se"]');
    handle.setPointerCapture = () => {};
    handle.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, {
      bubbles: true,
      cancelable: true,
      pointerId: 7,
      screenX: ${x},
      screenY: ${y},
    }));
  })()`);
  await dispatchResizePointer("pointerdown", startX, startY);
  const observedBounds = [];
  for (let step = 1; step <= 4; step += 1) {
    await dispatchResizePointer("pointermove", startX + step * 18, startY + step * 13.5);
    await delay(34);
    observedBounds.push(second.getBounds());
  }
  await dispatchResizePointer("pointerup", startX + 72, startY + 54);
  await delay(120);
  const afterResize = second.getBounds();
  if (afterResize.width <= beforeResize.width || afterResize.height <= beforeResize.height) {
    throw new Error(`Sticky-note corner drag did not enlarge the target window: ${JSON.stringify({ beforeResize, afterResize })}`);
  }
  if (!observedBounds.every((bounds, index) => (
    bounds.width > (observedBounds[index - 1]?.width ?? beforeResize.width)
    && bounds.height > (observedBounds[index - 1]?.height ?? beforeResize.height)
  ))) {
    throw new Error(`Sticky-note live resize did not follow each pointer frame: ${JSON.stringify(observedBounds)}`);
  }

  await first.webContents.executeJavaScript('document.querySelector("a[href*=delete]")?.click()');
  await delay(120);
  if (!first.isDestroyed() || second.isDestroyed()) throw new Error("Deleting one sticky note affected its grouped sibling.");
  closeExecutionPlanStickyWindows();
}

async function run() {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "execution-plan-sticky-qa-started.txt"), new Date().toISOString());
  await app.whenReady();
  const files = [];
  for (const theme of ["light", "dark"]) {
    files.push(await capture(theme, 12));
    files.push(await capture(theme, 20));
  }
  await verifyGroupedDesktopInteraction();
  process.stdout.write(`${files.join("\n")}\n`);
}

void run()
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => app.exit(process.exitCode || 0));
