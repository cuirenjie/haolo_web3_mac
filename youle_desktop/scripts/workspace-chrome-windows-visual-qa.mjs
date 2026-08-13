import { app, BrowserWindow } from "electron/main";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.resolve(
  process.env.HAOLO_WORKSPACE_CHROME_QA_DIR
    || path.join(ROOT, ".tmp", "workspace-chrome-visual-qa"),
);
const INDEX = path.join(ROOT, "dist", "renderer", "index.html");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(window, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`, true)) return;
    await delay(100);
  }
  throw new Error(`等待工作区界面超时：${expression}`);
}

async function settleTheme(window, theme) {
  await window.webContents.executeJavaScript(`new Promise((resolve) => {
    let style = document.getElementById('workspace-chrome-visual-qa-motion');
    if (!style) {
      style = document.createElement('style');
      style.id = 'workspace-chrome-visual-qa-motion';
      style.textContent = '*, *::before, *::after { transition: none !important; }';
      document.head.append(style);
    }
    document.documentElement.dataset.theme = ${JSON.stringify(theme)};
    void document.body.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })`, true);
  await delay(120);
}

async function capture(window, name, surface, theme) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await window.webContents.executeJavaScript(`document.querySelector('[data-action="close-update-dialog"]')?.click()`, true);
    await delay(80);
  }
  const image = await window.webContents.capturePage();
  const file = path.join(OUTPUT, `${name}.png`);
  await writeFile(file, image.toPNG());
  const state = await window.webContents.executeJavaScript(`(() => {
    const favoriteHost = document.querySelector('[data-titlebar-market-favorites-host]');
    const leftToggle = document.querySelector('[data-action="toggle-left-panel"]');
    const profileAvatar = document.querySelector('.titlebar-profile-avatar');
    const workspace = document.querySelector(
      '.trading-expert-chat-panel, .binance-account-page, .trading-alerts-page, .skills-plaza-page'
    );
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, width: value.width, height: value.height };
    };
    const workspaceStyle = workspace ? getComputedStyle(workspace) : null;
    const workspaceBackdropStyle = workspace?.parentElement
      ? getComputedStyle(workspace.parentElement)
      : null;
    const appChromeStyle = getComputedStyle(document.querySelector('.app-titlebar'));
    return {
      theme: document.documentElement.dataset.theme,
      maximized: document.documentElement.classList.contains('window-maximized'),
      favoriteHostVisible: Boolean(
        favoriteHost
        && !favoriteHost.hidden
        && getComputedStyle(favoriteHost).display !== 'none'
      ),
      leftToggleInBody: leftToggle?.parentElement?.classList.contains('desktop-body') || false,
      leftToggleInTitlebar: Boolean(leftToggle?.closest('.app-titlebar')),
      leftToggleRect: rect(leftToggle),
      profileAvatarRect: rect(profileAvatar),
      workspaceRect: rect(workspace),
      workspaceTopLeftRadius: workspaceStyle?.borderTopLeftRadius || null,
      workspaceCornerBackdrop: workspaceBackdropStyle?.backgroundColor || null,
      appChromeBackground: appChromeStyle.backgroundColor,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`, true);
  return { name, surface, theme, file, state };
}

function validate(entry) {
  const failures = [];
  const expectsFavorites = entry.surface === "new-task";
  if (entry.state.favoriteHostVisible !== expectsFavorites) {
    failures.push(`${entry.name}: 收藏交易对可见范围错误`);
  }
  if (!entry.state.leftToggleInBody || entry.state.leftToggleInTitlebar) {
    failures.push(`${entry.name}: 左栏收起按钮未固定在内容区`);
  }
  if (entry.state.workspaceTopLeftRadius !== "16px") {
    failures.push(`${entry.name}: 中央工作区左上圆角不是 16px`);
  }
  if (
    (entry.surface === "alerts" || entry.surface === "skills")
    && entry.state.workspaceCornerBackdrop !== entry.state.appChromeBackground
  ) {
    failures.push(`${entry.name}: 圆角背后的底层未与应用框架背景对齐`);
  }
  const toggleLeft = entry.state.leftToggleRect?.left;
  const workspaceLeft = entry.state.workspaceRect?.left;
  if (!Number.isFinite(toggleLeft) || !Number.isFinite(workspaceLeft) || Math.abs(toggleLeft - workspaceLeft - 4) > 2) {
    failures.push(`${entry.name}: 左栏收起按钮未贴合中央工作区左边缘`);
  }
  if (entry.state.horizontalOverflow) failures.push(`${entry.name}: 页面出现横向溢出`);
  return failures;
}

async function main() {
  await mkdir(OUTPUT, { recursive: true });
  await app.whenReady();
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false,
    backgroundColor: "#101216",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const captures = [];
  try {
    await window.loadFile(INDEX, { query: { "workspace-chrome-visual-qa": "1" } });
    await waitFor(window, `document.querySelector('[data-action="new-chat"]')`);
    await window.webContents.executeJavaScript(`document.querySelector('[data-action="close-update-dialog"]')?.click()`, true);
    await window.webContents.executeJavaScript(`document.querySelector('[data-action="new-chat"]')?.click()`, true);
    await waitFor(window, `document.querySelector('.trading-expert-chat-panel')`);
    await window.webContents.executeJavaScript(`new Promise((resolve) => {
      const startedAt = Date.now();
      const closeWhenReady = () => {
        const close = document.querySelector('.update-dialog [data-action="close-update-dialog"]');
        if (close) {
          close.click();
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= 4_000) {
          resolve(false);
          return;
        }
        setTimeout(closeWhenReady, 100);
      };
      closeWhenReady();
    })`, true);
    await delay(200);
    for (const theme of ["light", "dark"]) {
      await settleTheme(window, theme);
      captures.push(await capture(window, `new-task-${theme}`, "new-task", theme));
    }

    await window.webContents.executeJavaScript(`document.querySelector('[data-conversation-static-action="account"]')?.click()`, true);
    await waitFor(window, `document.querySelector('.binance-account-page')`);
    for (const theme of ["light", "dark"]) {
      await settleTheme(window, theme);
      captures.push(await capture(window, `account-${theme}`, "account", theme));
    }

    await window.webContents.executeJavaScript(`document.querySelector('[data-conversation-static-action="alerts"]')?.click()`, true);
    await waitFor(window, `document.querySelector('.trading-alerts-page')`);
    await window.webContents.executeJavaScript(`document.documentElement.classList.add('window-maximized')`, true);
    for (const theme of ["light", "dark"]) {
      await settleTheme(window, theme);
      captures.push(await capture(window, `alerts-${theme}`, "alerts", theme));
    }

    await window.webContents.executeJavaScript(`document.querySelector('[data-conversation-static-action="skills"]')?.click()`, true);
    await waitFor(window, `document.querySelector('.skills-plaza-page')`);
    for (const theme of ["light", "dark"]) {
      await settleTheme(window, theme);
      captures.push(await capture(window, `skills-${theme}`, "skills", theme));
    }

    const failures = captures.flatMap(validate);
    const avatarAnchor = captures[0]?.state.profileAvatarRect;
    for (const entry of captures) {
      const avatarRect = entry.state.profileAvatarRect;
      if (
        !avatarAnchor
        || !avatarRect
        || Math.abs(avatarRect.left - avatarAnchor.left) > 0.1
        || Math.abs(avatarRect.top - avatarAnchor.top) > 0.1
      ) {
        failures.push(`${entry.name}: 页面切换后标题栏头像发生位移`);
      }
    }
    const report = {
      generatedAt: new Date().toISOString(),
      status: failures.length ? "failed" : "passed",
      captures,
      failures,
    };
    await writeFile(path.join(OUTPUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ status: report.status, captures: captures.length, failures }, null, 2)}\n`);
    if (failures.length) process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
}

main().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${error?.stack || error}\n`);
  app.quit();
});
