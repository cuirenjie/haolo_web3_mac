import { app, BrowserWindow } from "electron/main";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.resolve(process.env.HAOLO_ALERT_VISUAL_QA_DIR || path.join(ROOT, ".tmp", "trading-alert-visual-qa"));
const INDEX = path.join(ROOT, "dist", "renderer", "index.html");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(window, selector, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, true);
    if (found) return;
    await delay(100);
  }
  throw new Error(`等待元素超时：${selector}`);
}

async function capture(window, name, metadata = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await window.webContents.executeJavaScript(`document.querySelector('[data-action="close-update-dialog"]')?.click()`, true);
    await delay(80);
  }
  await delay(180);
  const image = await window.webContents.capturePage();
  const file = path.join(OUTPUT, `${name}.png`);
  await writeFile(file, image.toPNG());
  const state = await window.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('.trading-alerts-page');
    const active = document.activeElement;
    const card = document.querySelector('.trading-alert-card');
    const style = card ? getComputedStyle(card) : null;
    const rgb = (value) => (String(value).match(/[0-9.]+/g) || []).slice(0, 3).map(Number);
    const luminance = (value) => {
      const channels = rgb(value).map((channel) => { const normalized = channel / 255; return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4; });
      return channels.length === 3 ? channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 : null;
    };
    const foreground = style ? luminance(style.color) : null;
    const background = style ? luminance(style.backgroundColor) : null;
    return {
      theme: document.documentElement.dataset.theme,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      document: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      pageVisible: Boolean(root), cards: document.querySelectorAll('.trading-alert-card').length,
      gaps: document.querySelectorAll('.trading-alert-gap').length,
      evidence: document.querySelectorAll('.trading-alert-evidence article').length,
      dialogs: document.querySelectorAll('dialog[open]').length,
      errors: document.querySelectorAll('[role="alert"]').length,
      loading: document.querySelectorAll('.trading-alert-loading').length,
      focus: active ? { tag: active.tagName, label: active.getAttribute('aria-label') || active.textContent?.trim().slice(0, 80), outline: getComputedStyle(active).outlineStyle, boxShadow: getComputedStyle(active).boxShadow } : null,
      cardStyle: style ? { color: style.color, background: style.backgroundColor, border: style.borderColor, contrast: foreground === null || background === null ? null : (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) } : null,
    };
  })()`, true);
  return { name, file, ...metadata, state };
}

async function main() {
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(path.join(OUTPUT, "boot.json"), `${JSON.stringify({ startedAt: new Date().toISOString(), argv: process.argv, versions: process.versions }, null, 2)}\n`, "utf8");
  await Promise.race([
    app.whenReady(),
    delay(15_000).then(() => { throw new Error("Electron app.whenReady() 15 秒内未完成"); }),
  ]);
  await readFile(INDEX);
  const window = new BrowserWindow({
    width: 1600, height: 1000, show: false, backgroundColor: "#111317",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const captures = [];
  try {
  await window.loadFile(INDEX, { query: { "trading-alert-visual-qa": "1" } });
  await waitFor(window, '[data-conversation-static-action="alerts"]');
  await delay(800);
  await window.webContents.executeJavaScript(`document.querySelector('[data-action="close-update-dialog"]')?.click()`, true);
  await window.webContents.executeJavaScript(`document.querySelector('[data-conversation-static-action="alerts"]').click()`, true);
  await waitFor(window, ".trading-alert-card");
  await delay(300);
  await window.webContents.capturePage();
  await delay(180);
  for (const zoom of [1, 1.25, 1.5]) {
    window.webContents.setZoomFactor(zoom);
    for (const theme of ["light", "dark"]) {
      await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`, true);
      await window.webContents.executeJavaScript(`document.querySelector('.trading-alert-filters button')?.focus()`, true);
      captures.push(await capture(window, `list-${theme}-${Math.round(zoom * 100)}`, { surface: "list", theme, zoom }));
    }
  }
  window.webContents.setZoomFactor(1);
  await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = 'light'; document.querySelector('[data-trading-alert-card="qa-triggered"] [data-trading-alert-action="view"]')?.click()`, true);
  await waitFor(window, ".trading-alert-detail");
  for (const theme of ["light", "dark"]) {
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.querySelector('.trading-alert-detail button')?.focus()`, true);
    captures.push(await capture(window, `detail-${theme}`, { surface: "detail", theme, zoom: 1 }));
  }
  await window.webContents.executeJavaScript(`document.querySelector('[data-trading-alert-action="back"]')?.click()`, true);
  await waitFor(window, ".trading-alert-card");
  await window.webContents.executeJavaScript(`document.querySelector('[data-trading-alert-action="edit"]')?.click()`, true);
  await waitFor(window, ".trading-alert-editor");
  for (const theme of ["light", "dark"]) {
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.querySelector('.trading-alert-editor input')?.focus()`, true);
    captures.push(await capture(window, `editor-${theme}`, { surface: "editor", theme, zoom: 1 }));
  }
  await window.webContents.executeJavaScript(`document.querySelector('[data-trading-alert-action="close-editor"]')?.click(); window.__haoloTradingAlertsQa.setMode('error')`, true);
  await waitFor(window, ".trading-alert-page-error");
  for (const theme of ["light", "dark"]) {
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.querySelector('.trading-alert-page-error button')?.focus()`, true);
    captures.push(await capture(window, `error-${theme}`, { surface: "error", theme, zoom: 1 }));
  }
  await window.webContents.executeJavaScript(`window.__haoloTradingAlertsQa.setMode('loading'); document.querySelector('.trading-alert-page-error button')?.click()`, true);
  await waitFor(window, ".trading-alert-loading");
  for (const theme of ["light", "dark"]) {
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`, true);
    captures.push(await capture(window, `loading-${theme}`, { surface: "loading", theme, zoom: 1 }));
  }
  const failures = [];
  for (const entry of captures) {
    if (!entry.state.pageVisible) failures.push(`${entry.name}: page missing`);
    if (entry.state.document.scrollWidth > entry.state.document.clientWidth + 1) failures.push(`${entry.name}: horizontal overflow`);
    if (entry.surface === "list" && entry.state.dialogs !== 0) failures.push(`${entry.name}: unrelated modal obscures the page`);
    if (entry.surface === "list" && entry.state.cards < 4) failures.push(`${entry.name}: status cards missing`);
    if (entry.state.cardStyle?.contrast !== null && entry.state.cardStyle?.contrast < 4.5) failures.push(`${entry.name}: card text contrast below 4.5`);
    if (entry.surface === "detail" && entry.state.evidence < 1) failures.push(`${entry.name}: evidence missing`);
    if (entry.surface === "editor" && entry.state.dialogs !== 1) failures.push(`${entry.name}: expected one editor dialog, got ${entry.state.dialogs}`);
    if (entry.surface === "error" && entry.state.errors !== 1) failures.push(`${entry.name}: error state missing`);
    if (entry.surface === "loading" && entry.state.loading !== 1) failures.push(`${entry.name}: loading state missing`);
  }
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), platform: process.platform, electron: process.versions.electron, chromium: process.versions.chrome, index: INDEX, output: OUTPUT, captures, failures, status: failures.length ? "failed" : "passed" };
  await writeFile(path.join(OUTPUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(OUTPUT, "report.md"), `# Trading Alert Windows 视觉验收\n\n- 状态：${report.status}\n- Electron：${report.electron}\n- Chromium：${report.chromium}\n- 截图：${captures.length}\n- 亮暗主题：均覆盖\n- 缩放：100% / 125% / 150%\n- 页面：列表 / 详情 / 编辑 / 错误 / 加载\n- 失败：${failures.length ? failures.join("；") : "无"}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: report.status, captures: captures.length, output: OUTPUT, failures }, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
}

void main().catch(async (error) => {
  const message = error instanceof Error ? `${error.stack || error.message}` : String(error);
  await mkdir(OUTPUT, { recursive: true }).catch(() => {});
  await writeFile(path.join(OUTPUT, "fatal-error.log"), `${message}\n`, "utf8").catch(() => {});
  process.stderr.write(`${message}\n`);
  app.exit(1);
});
