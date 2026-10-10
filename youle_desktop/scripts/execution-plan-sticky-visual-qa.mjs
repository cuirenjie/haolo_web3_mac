import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow } from "electron/main";
import {
  executionPlanStickyBounds,
  executionPlanStickyHtml,
  EXECUTION_PLAN_STICKY_HEIGHT_SCRIPT,
  EXECUTION_PLAN_STICKY_WIDTH_SCRIPT,
  EXECUTION_PLAN_STICKY_MIN_WIDTH,
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

async function capture(theme, fontSize, account = false, language = "zh-CN") {
  const payload = {
    title: "BTC/USDT 币安永续 1H · 多头条件方案",
    theme,
    language,
    fontSize,
    lines: [
      { label: "当前动作：", text: "等待条件触发", directionTone: "", segments: [] },
      { label: "方向判断：", text: "偏多", directionTone: "bullish", segments: [] },
      { label: "策略：", text: "price-action" },
      { label: "多头触发：", text: account ? "82849.635，用 3 倍杠杆开仓 100 USDT 的多单" : "82849.635" },
      { label: "止损与失效：", text: "82620.422" },
      { label: "分批止盈：", text: account
        ? "挂条件委托 83173.299178 市价止盈 33 USDT；预计盈利 +1.11 USDT，挂条件委托 83210.48542333 市价止盈 33 USDT；预计盈利 +2.22 USDT，挂条件委托 83308.061 市价止盈 34 USDT；预计盈利 +3.33 USDT"
        : "第1目标 83173.299178，第2目标 83210.48542333，第3目标 83308.061" },
      { label: "风险收益比：", text: "目标1为 1:0.4，目标2为 1:0.49，目标3为 1:0.74" + (account ? "，如果止损：约 -5.00 USDT，如果全部止盈：约 +6.66 USDT" : "") },
      ...(account ? [
        { label: "仓位大小：", text: "推荐下单 0.001 BTC；名义金额 100 USDT；3 倍杠杆；账户权益 50.51 USDT" },
        { label: "可能盈亏：", text: "止损约 -5.00 USDT；全部止盈约 +6.66 USDT；已计入预估手续费和滑点" },
      ] : []),
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
  const measuredWidth = await window.webContents.executeJavaScript(EXECUTION_PLAN_STICKY_WIDTH_SCRIPT);
  const fittedWidth = Math.max(EXECUTION_PLAN_STICKY_MIN_WIDTH, Math.min(520, measuredWidth));
  window.setSize(fittedWidth, bounds.height);
  const measuredHeight = await window.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(${EXECUTION_PLAN_STICKY_HEIGHT_SCRIPT}))))`);
  window.setSize(fittedWidth, Math.max(180, Math.min(720, measuredHeight)));
  window.showInactive();
  await delay(180);
  const controlsVisible = await window.webContents.executeJavaScript(`(() => {
    document.activeElement?.blur();
    const style = getComputedStyle(document.querySelector(".controls"));
    return style.opacity === "1" && style.pointerEvents === "auto" && style.boxShadow === "none";
  })()`);
  if (!controlsVisible) throw new Error(`Sticky-note controls are not persistently visible and flat in ${theme} at ${fontSize}px.`);
  const layoutFits = await window.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card');
    const content = document.querySelector('.content');
    const controls = document.querySelector('.controls');
    const ratios = Array.from(document.querySelectorAll('.execution-plan-ratio'), el => el.getBoundingClientRect().left);
    const stopLeft = document.querySelectorAll('.execution-plan-metric')[1].getBoundingClientRect().left;
    const profits = Array.from(document.querySelectorAll('.execution-plan-target-profit'), el => el.getBoundingClientRect().left);
    const badge = document.querySelector('.execution-plan-badge.strategy');
    const direction = badge.previousElementSibling;
    const ratioStyle = getComputedStyle(document.querySelector('.execution-plan-ratio'));
    const baseline = (el) => {
      const marker = document.createElement('span');
      marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      el.append(marker);
      const y = marker.getBoundingClientRect().top;
      marker.remove();
      return y;
    };
    const pricesAndRatiosAlign = [...document.querySelectorAll('.execution-plan-target')].every(row => Math.abs(baseline(row.querySelector('strong')) - baseline(row.querySelector('.execution-plan-ratio'))) < 0.5);
    const rightmostText = Math.max(...[...content.querySelectorAll('h2, .execution-plan-badge, .execution-plan-price, .execution-plan-target-main, .execution-plan-ratio, .execution-plan-account-detail')].map(el => {
      if (el.classList.contains('execution-plan-badge')) return el.getBoundingClientRect().right;
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().right;
    }));
    const rightSpace = card.getBoundingClientRect().right - rightmostText;
    const rightColumnEdge = Math.max(...[...content.querySelectorAll('.execution-plan-metric:last-child > *, .execution-plan-ratio, .execution-plan-target-profit')].map(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().right;
    }));
    const leftInset = content.getBoundingClientRect().left - card.getBoundingClientRect().left;
    const rightInset = card.getBoundingClientRect().right - rightColumnEdge;
    const estimateStylesMatch = [...document.querySelectorAll('.execution-plan-estimate, .execution-plan-estimate span')].every(el => {
      const style = getComputedStyle(el);
      return style.color === ratioStyle.color && style.fontSize === ratioStyle.fontSize && style.fontWeight === ratioStyle.fontWeight;
    });
    const displayed = document.querySelector('.execution-plan-card-content').textContent;
    const controlsGap = controls.getBoundingClientRect().top - content.getBoundingClientRect().bottom;
    const controlsContentGap = controls.getBoundingClientRect().top - content.querySelector('.execution-plan-card-content').getBoundingClientRect().bottom;
    const bottomPadding = card.getBoundingClientRect().bottom - controls.getBoundingClientRect().bottom;
    return { fits: card.scrollWidth <= card.clientWidth && content.scrollHeight <= content.clientHeight + 1
      && controls.getBoundingClientRect().top >= content.getBoundingClientRect().bottom - 0.1
      && ratios.length === 3 && ratios.every(left => Math.abs(left - ratios[0]) < 0.1)
      && pricesAndRatiosAlign && rightSpace >= 15 && rightSpace <= 20
      && Math.abs(leftInset - rightInset) < 1
      && [...ratios, ...profits].every(left => Math.abs(left - stopLeft) < 0.1)
      && Array.from(document.querySelectorAll('.execution-plan-target'), el => el.scrollWidth <= el.clientWidth).every(Boolean)
      && !content.textContent.includes('等待条件触发')
      && !/USDT|仓位大小|可能盈亏/.test(displayed)
      && estimateStylesMatch
      && document.querySelectorAll('.execution-plan-estimate').length === ${account ? 4 : 0}
      // Native window dimensions round at fractional Windows display scales.
      && Math.abs(controlsGap) < 0.5 && controlsContentGap >= -0.5 && controlsContentGap <= 2
      && bottomPadding >= 10 && bottomPadding <= 12
      && badge.textContent === ${JSON.stringify(language === "en" ? "Price Action" : "裸K分析")}
      && badge.getBoundingClientRect().left > direction.getBoundingClientRect().right
      && Math.abs(badge.getBoundingClientRect().top - direction.getBoundingClientRect().top) < 0.1
      && getComputedStyle(badge).backgroundColor === 'rgb(154, 103, 0)'
      && getComputedStyle(card).backgroundColor === 'rgb(255, 255, 255)', rightSpace, pricesAndRatiosAlign,
      width: innerWidth, controlsGap, controlsContentGap, leftInset, rightInset, bottomPadding, ratioLefts: ratios, stopLeft,
      contentHeight: content.clientHeight, scrollHeight: content.scrollHeight, cardWidth: card.clientWidth, scrollWidth: card.scrollWidth };
  })()`);
  if (!layoutFits.fits) throw new Error(`Sticky layout failed in ${theme}/${language}/${account} at ${fontSize}px: ${JSON.stringify(layoutFits)}`);
  const image = await window.webContents.capturePage();
  const file = path.join(outputDirectory, `execution-plan-sticky-${theme}-${fontSize}px-${language}-${account ? "account" : "prices"}.png`);
  await writeFile(file, image.toPNG());
  await window.webContents.executeJavaScript('document.querySelector(".card")?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }))');
  await delay(40);
  if (!actionNavigation.includes("zoom-out")) throw new Error("Sticky-note wheel zoom did not reach the main process.");
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

  await first.webContents.executeJavaScript('document.querySelector(".card")?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120 }))');
  await delay(160);
  const linkedFontSize = await second.webContents.executeJavaScript('getComputedStyle(document.querySelector(".execution-plan-card-content")).fontSize');
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
  await first.webContents.executeJavaScript('document.querySelector("a[href*=zoom-in]")?.click()');
  await delay(180);
  const preservedBounds = second.getBounds();
  if (preservedBounds.width !== afterResize.width || preservedBounds.height !== afterResize.height) {
    throw new Error("Content fitting overwrote the user's manually resized sticky note.");
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
    for (const language of ["zh-CN", "zh-TW", "en"]) {
      for (const account of [false, true]) {
        files.push(await capture(theme, 12, account, language));
        files.push(await capture(theme, 20, account, language));
      }
    }
  }
  await verifyGroupedDesktopInteraction();
  await writeFile(path.join(outputDirectory, "report.json"), JSON.stringify({ completedAt: new Date().toISOString(), files, groupedInteraction: "passed" }, null, 2));
  process.stdout.write(`${files.join("\n")}\n`);
}

void run()
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => app.exit(process.exitCode || 0));
