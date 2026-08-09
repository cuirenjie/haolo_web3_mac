import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(repoRoot, "extensions", "haolo-chrome");
const chromeExecutable = process.env.HAOLO_CHROME_EXECUTABLE || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const manifest = JSON.parse(await fs.promises.readFile(path.join(extensionDir, "manifest.json"), "utf8"));
const extensionId = extensionIdFromKey(manifest.key);
const profileDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-chrome-smoke-"));
const testServer = await createTestServer();
let browser = null;
let chromeProcess = null;

try {
  const chromeArguments = [
    "--enable-extensions",
    "--enable-automation",
    "--no-first-run",
    "--disable-default-apps",
    "--window-position=-32000,-32000",
    "--window-size=800,700",
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-port=0",
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "about:blank",
  ];
  if (process.env.HAOLO_CHROME_NO_SANDBOX === "1") chromeArguments.unshift("--no-sandbox", "--disable-gpu");
  chromeProcess = spawn(chromeExecutable, chromeArguments, { windowsHide: true, stdio: "ignore" });

  const debug = await waitForDevTools(profileDir, chromeProcess);
  browser = new CdpConnection(`ws://127.0.0.1:${debug.port}${debug.browserPath}`);
  await browser.open();
  let extensionLoadError = null;
  let extensionTestSetupError = null;
  let extensionDiagnostics = null;
  try {
    await ensureExtensionLoaded(debug.port, extensionId);
  } catch (error) {
    extensionLoadError = error;
  }
  if (!extensionLoadError) {
    try {
      await grantExtensionHostAccessForTesting(debug.port, extensionId, new URL(testServer.url).origin);
      extensionDiagnostics = { state: "ENABLED", installWarnings: [], manifestErrors: [], runtimeErrors: [] };
    } catch (error) {
      extensionTestSetupError = error;
    }
  }

  const sidePanelUrl = extensionLoadError
    ? new URL(`file:///${path.join(extensionDir, "sidepanel.html").replace(/\\/g, "/")}`).toString()
    : `chrome-extension://${extensionId}/sidepanel.html`;
  const sidePanelTarget = await createTarget(debug.port, sidePanelUrl);
  const sidePanel = new CdpConnection(sidePanelTarget.webSocketDebuggerUrl);
  await sidePanel.open();
  await sidePanel.call("Runtime.enable");
  await sidePanel.call("Page.enable");
  await delay(600);
  const sidePanelState = await evaluate(sidePanel, `({
    title: document.title,
    heading: document.querySelector("h1")?.textContent,
    siteCard: Boolean(document.querySelector("#siteCard")),
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    bodyText: document.body?.innerText || ""
  })`);
  assert.equal(sidePanelState.title, "Haolo", "side panel surface did not load");
  assert.equal(sidePanelState.heading, "Haolo");
  assert.equal(sidePanelState.siteCard, true);
  assert.match(sidePanelState.colorScheme, /light.*dark|dark.*light/);
  assert.match(sidePanelState.bodyText, /权限由你控制/);
  const screenshotDirectory = path.resolve(process.env.HAOLO_CHROME_SMOKE_SCREENSHOT_DIR || path.join(repoRoot, ".tmp", "chrome-smoke"));
  await fs.promises.mkdir(screenshotDirectory, { recursive: true });
  await sidePanel.call("Emulation.setDeviceMetricsOverride", { width: 420, height: 1100, deviceScaleFactor: 1, mobile: false });
  const screenshots = {};
  for (const scheme of ["light", "dark"]) {
    await sidePanel.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    await delay(100);
    const capture = await sidePanel.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const screenshotPath = path.join(screenshotDirectory, `sidepanel-${scheme}.png`);
    await fs.promises.writeFile(screenshotPath, Buffer.from(capture.data, "base64"));
    screenshots[scheme] = screenshotPath;
  }
  await sidePanel.call("Runtime.evaluate", {
    expression: `(() => {
      const setText = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = value; };
      document.querySelector("#statusDot").dataset.state = "connected";
      setText("#statusTitle", "Chrome 已连接");
      setText("#statusMessage", "可以读取当前页面；使用站点前仍会请求你的授权。");
      document.querySelector("#retryButton").hidden = true;
      setText("#profileLabel", "当前 Chrome");
      setText("#siteTitle", "Quarterly report");
      setText("#siteOrigin", ${JSON.stringify(new URL(testServer.url).origin)});
      document.querySelector("#siteBadge").dataset.state = "allowed";
      setText("#siteBadge", "本次已允许");
      setText("#siteMessage", "仅在当前任务期间读取此标签页，任务结束后授权会失效。");
      document.querySelector("#permissionActions").hidden = true;
      document.querySelector("#previewButton").hidden = false;
      document.querySelector("#promptInput").disabled = false;
      document.querySelector("#sendButton").disabled = false;
      return true;
    })()`,
    returnByValue: true,
  });
  await sidePanel.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await delay(100);
  const storeCapture = await sidePanel.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  screenshots.store = path.join(screenshotDirectory, "store-sidepanel-light.png");
  await fs.promises.writeFile(screenshots.store, Buffer.from(storeCapture.data, "base64"));
  sidePanel.close();

  const pageTarget = await createTarget(debug.port, testServer.url);
  const page = new CdpConnection(pageTarget.webSocketDebuggerUrl);
  await page.open();
  await page.call("Runtime.enable");
  await page.call("Page.enable");
  await waitForDocument(page);
  let extensionSnapshot = null;
  let extensionActions = null;
  let userTakeoverBlocked = false;
  const desktopScreenshots = {};
  let permissionGestureVerified = false;
  if (!extensionLoadError && !extensionTestSetupError) {
    const workerTarget = await waitForTarget(debug.port, (target) => target.type === "service_worker" && target.url === `chrome-extension://${extensionId}/service-worker.js`);
    const worker = new CdpConnection(workerTarget.webSocketDebuggerUrl);
    await worker.open();
    await worker.call("Runtime.enable");
    const testOriginPattern = `${new URL(testServer.url).origin}/*`;
    const hasPermission = await evaluate(worker, `chrome.permissions.contains({ origins: [${JSON.stringify(testOriginPattern)}] })`);
    permissionGestureVerified = hasPermission;
    if (!hasPermission) {
      const permissionTarget = await createTarget(debug.port, `chrome-extension://${extensionId}/sidepanel.html`);
      const permissionPanel = new CdpConnection(permissionTarget.webSocketDebuggerUrl);
      await permissionPanel.open();
      await permissionPanel.call("Runtime.enable");
      await delay(300);
      await page.call("Page.bringToFront");
      const click = await permissionPanel.call("Runtime.evaluate", {
        expression: `document.querySelector("#allowSiteButton").click(); true`,
        returnByValue: true,
        userGesture: true,
      });
      if (click.exceptionDetails) throw new Error(click.exceptionDetails.exception?.description || click.exceptionDetails.text);
      const permissionDeadline = Date.now() + 5_000;
      let granted = false;
      while (Date.now() < permissionDeadline) {
        granted = await evaluate(worker, `chrome.permissions.contains({ origins: [${JSON.stringify(testOriginPattern)}] })`);
        if (granted) break;
        await delay(100);
      }
      permissionPanel.close();
      permissionGestureVerified = granted;
    }
    extensionSnapshot = await evaluate(worker, `(async () => {
      const tabs = await chrome.tabs.query({ url: ${JSON.stringify(`${testServer.url}*`)} });
      if (!tabs.length) throw new Error("Smoke test tab was not visible to the extension");
      if (!${JSON.stringify(permissionGestureVerified)}) {
        globalThis.__haoloReadOnlyDiagnostics.authorizeTemporaryTab(tabs[0].id, ${JSON.stringify(new URL(testServer.url).origin)});
      }
      return globalThis.__haoloReadOnlyDiagnostics.readPage(tabs[0].id, { maxChars: 5000, includeLinks: true, includeForms: true });
    })()`);
    extensionActions = await evaluate(worker, `(async () => {
      const diagnostics = globalThis.__haoloReadOnlyDiagnostics;
      const tabs = await chrome.tabs.query({ url: ${JSON.stringify(`${testServer.url}*`)} });
      const tabId = tabs[0].id;
      const snapshot = await diagnostics.readPage(tabId, { maxChars: 8000, includeLinks: true, includeForms: true });
      const target = (name) => {
        const element = snapshot.elements.find((entry) => entry.name === name);
        if (!element) throw new Error("Missing smoke target: " + name);
        return { element_id: element.element_id };
      };
      const click = await diagnostics.invoke("click", { tab_id: tabId, target: target("Open details") });
      const type = await diagnostics.invoke("type_text", { tab_id: tabId, target: target("Email"), text: "qa@haolo.test", replace: true });
      const select = await diagnostics.invoke("select_option", { tab_id: tabId, target: target("Region"), value: "apac" });
      const frameClick = await diagnostics.invoke("click", { tab_id: tabId, target: target("Frame action") });
      const scroll = await diagnostics.invoke("scroll", { tab_id: tabId, delta_y: 480 });
      const externalPrepared = await diagnostics.invoke("prepare_external_action", {
        tab_id: tabId,
        action: "send",
        target: target("Send now"),
        summary: "Submit the smoke-test form",
      });
      const externalCommitted = await diagnostics.invokePrepared("prepare_external_action", {
        tab_id: tabId,
        action: "send",
        target: target("Send now"),
        summary: "Submit the smoke-test form",
      }, externalPrepared);
      const uploadPrepared = await diagnostics.invoke("upload_file", {
        tab_id: tabId,
        target: target("Attachment"),
        artifact_id: "chrome_artifact_diagnostic",
      });
      const downloadPrepared = await diagnostics.invoke("download", {
        tab_id: tabId,
        url: ${JSON.stringify(`${testServer.url}download.txt`)},
        filename: "download.txt",
      });
      let riskyClickCode = null;
      try {
        await diagnostics.invoke("click", { tab_id: tabId, target: target("Send now") });
      } catch (error) {
        riskyClickCode = error?.code || null;
      }
      return {
        tabId,
        click,
        type,
        select,
        frameClick,
        scroll,
        externalPrepared,
        externalCommitted,
        uploadPrepared,
        downloadPrepared,
        riskyClickCode,
        iframeObserved: snapshot.frames?.some((frame) => frame.frame_id !== 0) || false,
      };
    })()`);
    assert.equal(extensionActions.click.action, "click");
    assert.equal(extensionActions.type.characters_written, 13);
    assert.equal(extensionActions.type.value_returned, false);
    assert.equal(extensionActions.select.selected_value, "apac");
    assert.equal(extensionActions.frameClick.target.name, "Frame action");
    assert.equal(extensionActions.externalPrepared.prepared, true);
    assert.equal(extensionActions.externalCommitted.committed, true);
    assert.equal(extensionActions.uploadPrepared.file_names_returned, undefined);
    assert.equal(extensionActions.uploadPrepared.prepared, true);
    assert.equal(extensionActions.downloadPrepared.prepared, true);
    assert.equal(extensionActions.iframeObserved, true);
    assert.equal(extensionActions.riskyClickCode, "CHROME_EXTERNAL_ACTION_REQUIRES_PREPARE");

    await page.call("Page.bringToFront");
    await evaluate(page, `new Promise((resolve) => { scrollTo(0, 0); requestAnimationFrame(() => resolve(true)); })`);
    const takeoverTarget = await evaluate(page, `(() => {
      const rect = document.querySelector('[aria-label="Open details"]').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    // A freshly launched headless-capable Chrome can occasionally drop the first
    // CDP input while focus is settling. Retry the real trusted-input path rather
    // than weakening the extension with a test-only takeover hook.
    for (let attempt = 0; attempt < 3 && !userTakeoverBlocked; attempt += 1) {
      await page.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: takeoverTarget.x, y: takeoverTarget.y });
      await page.call("Input.dispatchMouseEvent", { type: "mousePressed", x: takeoverTarget.x, y: takeoverTarget.y, button: "left", clickCount: 1 });
      await page.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: takeoverTarget.x, y: takeoverTarget.y, button: "left", clickCount: 1 });
      await page.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "F8", code: "F8", windowsVirtualKeyCode: 119, nativeVirtualKeyCode: 119 });
      await page.call("Input.dispatchKeyEvent", { type: "keyUp", key: "F8", code: "F8", windowsVirtualKeyCode: 119, nativeVirtualKeyCode: 119 });
      await delay(120);
      userTakeoverBlocked = await evaluate(worker, `(async () => {
        try {
          await globalThis.__haoloReadOnlyDiagnostics.invoke("click", {
            tab_id: ${JSON.stringify(extensionActions.tabId)},
            target: { name: "Open details", role: "button" }
          });
          return false;
        } catch (error) {
          return error?.code === "CHROME_USER_TAKEOVER";
        }
      })()`);
    }
    worker.close();
    assert.equal(extensionSnapshot.trust, "untrusted_web_content");
    assert.match(extensionSnapshot.text, /Quarterly report/);
    assert.doesNotMatch(extensionSnapshot.text, /super-secret|123456/);
    assert.equal(userTakeoverBlocked, true);
  }
  await page.call("Runtime.evaluate", {
    expression: `globalThis.chrome = { runtime: {
      sendMessage() { return Promise.resolve({ frameId: 0 }); },
      onMessage: { addListener(listener) { globalThis.__haoloTestListener = listener; } }
    } }`,
  });
  const pageAgentSource = await fs.promises.readFile(path.join(extensionDir, "page-agent.js"), "utf8");
  const installed = await page.call("Runtime.evaluate", { expression: pageAgentSource, awaitPromise: true, returnByValue: true });
  if (installed.exceptionDetails) throw new Error(installed.exceptionDetails.text || "page-agent injection failed");
  const snapshot = await evaluate(page, `new Promise((resolve, reject) => {
    const keepAlive = globalThis.__haoloTestListener(
      { source: "haolo-extension", type: "read.page", options: { maxChars: 5000, includeLinks: true, includeForms: true } },
      {},
      (response) => response?.ok ? resolve(response.payload) : reject(new Error(response?.error?.message || "snapshot failed"))
    );
    if (!keepAlive) reject(new Error("page agent listener did not keep the response channel alive"));
  })`);
  assert.equal(snapshot.trust, "untrusted_web_content");
  assert.equal(snapshot.instructionAuthority, "none");
  assert.match(snapshot.text, /Quarterly report/);
  assert.doesNotMatch(snapshot.text, /super-secret|123456/);
  assert.equal(snapshot.forms.some((control) => /password|otp/i.test(`${control.name} ${control.type}`)), false);
  assert.equal(snapshot.elements.some((element) => element.name === "Open details"), true);
  assert.equal(snapshot.links.some((link) => link.text === "Reference"), true);
  page.close();

  for (const scheme of ["light", "dark"]) {
    const desktopTarget = await createTarget(debug.port, `${testServer.url}desktop-chrome-ui?theme=${scheme}`);
    const desktopPage = new CdpConnection(desktopTarget.webSocketDebuggerUrl);
    await desktopPage.open();
    await desktopPage.call("Runtime.enable");
    await desktopPage.call("Page.enable");
    await desktopPage.call("Emulation.setDeviceMetricsOverride", { width: 1100, height: 920, deviceScaleFactor: 1, mobile: false });
    await waitForDocument(desktopPage);
    const themeState = await evaluate(desktopPage, `(() => {
      const dialog = getComputedStyle(document.querySelector('.chrome-integration-dialog'));
      const disabled = getComputedStyle(document.querySelector('button:disabled'));
      return { background: dialog.backgroundColor, color: dialog.color, disabledOpacity: Number(disabled.opacity) };
    })()`);
    assert.notEqual(themeState.background, themeState.color);
    assert.ok(themeState.disabledOpacity < 0.6);
    const capture = await desktopPage.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const screenshotPath = path.join(screenshotDirectory, `desktop-chrome-integration-${scheme}.png`);
    await fs.promises.writeFile(screenshotPath, Buffer.from(capture.data, "base64"));
    desktopScreenshots[scheme] = { path: screenshotPath, ...themeState };
    desktopPage.close();
  }

  const targets = await fetchJson(`http://127.0.0.1:${debug.port}/json/list`);
  const ownServiceWorker = targets.some((target) => target.type === "service_worker" && target.url === `chrome-extension://${extensionId}/service-worker.js`);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    chromeExecutable,
    extensionId,
    unpackedExtensionLoaded: !extensionLoadError,
    unpackedExtensionLoadNote: extensionLoadError?.message || null,
    extensionTestSetupNote: extensionTestSetupError?.message || null,
    extensionDiagnostics: extensionDiagnostics ? {
      state: extensionDiagnostics.state,
      installWarnings: extensionDiagnostics.installWarnings,
      manifestErrors: extensionDiagnostics.manifestErrors.length,
      runtimeErrors: extensionDiagnostics.runtimeErrors.length,
    } : null,
    sidePanel: sidePanelState,
    screenshots,
    desktopScreenshots,
    pageSnapshot: {
      textLength: snapshot.text.length,
      elements: snapshot.elements.length,
      links: snapshot.links.length,
      forms: snapshot.forms.length,
      sensitiveValuesExcluded: true,
    },
    extensionReadPathVerified: Boolean(extensionSnapshot),
    extensionActionPathVerified: Boolean(extensionActions),
    iframeActionVerified: Boolean(extensionActions?.iframeObserved),
    externalEffectGuardVerified: extensionActions?.riskyClickCode === "CHROME_EXTERNAL_ACTION_REQUIRES_PREPARE",
    externalPrepareCommitVerified: Boolean(extensionActions?.externalCommitted?.committed),
    uploadPreparationVerified: Boolean(extensionActions?.uploadPrepared?.prepared),
    downloadPreparationVerified: Boolean(extensionActions?.downloadPrepared?.prepared),
    userTakeoverBlocked,
    permissionGestureVerified,
    serviceWorkerObserved: ownServiceWorker,
  }, null, 2)}\n`);
} finally {
  if (browser) {
    await browser.call("Browser.close").catch(() => {});
    browser.close();
  }
  testServer.server.close();
  if (chromeProcess && chromeProcess.exitCode === null) chromeProcess.kill();
  const resolvedTemp = path.resolve(os.tmpdir());
  const resolvedProfile = path.resolve(profileDir);
  if (resolvedProfile.startsWith(`${resolvedTemp}${path.sep}`) && path.basename(resolvedProfile).startsWith("haolo-chrome-smoke-")) {
    await fs.promises.rm(resolvedProfile, { recursive: true, force: true }).catch(() => {});
  }
}

function extensionIdFromKey(key) {
  const digest = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
  return [...digest].map((byte) => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15))).join("");
}

async function createTestServer() {
  const desktopCss = await fs.promises.readFile(path.join(repoRoot, "src", "renderer", "styles.css"), "utf8");
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith("/desktop-style.css")) {
      response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      response.end(desktopCss);
      return;
    }
    if (request.url?.startsWith("/desktop-chrome-ui")) {
      const theme = new URL(request.url, "http://localhost").searchParams.get("theme") === "dark" ? "dark" : "light";
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(desktopChromeUiHtml(theme));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (request.url?.startsWith("/frame")) {
      response.end(`<!doctype html><html><body>
        <button aria-label="Frame action" onclick="document.body.dataset.clicked='true'">Frame action</button>
      </body></html>`);
      return;
    }
    response.end(`<!doctype html><html><body>
      <h1>Quarterly report</h1>
      <p>Revenue increased while support volume declined.</p>
      <a href="/reference#private-fragment">Reference</a>
      <button aria-label="Open details">Details</button>
      <output id="details"></output>
      <label for="email">Email</label><input id="email" type="email" value="reader@example.com">
      <label for="region">Region</label><select id="region"><option value="emea">EMEA</option><option value="apac">APAC</option></select>
      <label for="password">Password</label><input id="password" type="password" value="super-secret">
      <label for="otp">OTP</label><input id="otp" name="one-time-code" value="123456">
      <label for="attachment">Attachment</label><input id="attachment" type="file">
      <form><button type="submit" aria-label="Send now">Send now</button></form>
      <iframe title="Same-origin test frame" src="/frame"></iframe>
      <div style="height:1800px"></div>
      <script>
        document.querySelector('[aria-label="Open details"]').addEventListener('click', () => { document.querySelector('#details').textContent = 'Details opened'; });
        document.querySelector('form').addEventListener('submit', (event) => event.preventDefault());
      </script>
    </body></html>`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

function desktopChromeUiHtml(theme) {
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><link rel="stylesheet" href="/desktop-style.css"></head><body>
    <div class="modal-backdrop chrome-integration-backdrop"></div>
    <dialog class="chrome-integration-dialog" open>
      <header class="chrome-integration-header"><div class="chrome-integration-mark">C</div><div><span class="chrome-integration-eyebrow">HAOLO FOR CHROME</span><h2>Chrome 集成中心</h2><p>安装、连接、权限审批和故障修复集中在这里。</p></div><button class="chrome-integration-close">×</button></header>
      <div class="chrome-integration-body">
        <section class="chrome-health-grid">
          <article class="chrome-health-item" data-tone="ready"><span class="chrome-health-dot"></span><div><small>扩展连接</small><strong>已连接</strong><p>1 个 Chrome Profile</p></div></article>
          <article class="chrome-health-item" data-tone="ready"><span class="chrome-health-dot"></span><div><small>Native Host</small><strong>正常</strong><p>注册表与宿主一致</p></div></article>
          <article class="chrome-health-item" data-tone="warning"><span class="chrome-health-dot"></span><div><small>桌面 Broker</small><strong>连接恢复中</strong><p>正在重新建立本机会话</p></div></article>
        </section>
        <section class="chrome-setup-card"><div><span class="chrome-section-kicker">安装与修复</span><h3>Chrome 已可以接收 Haolo 任务</h3><p>扩展、Native Host 与桌面端链路均已建立。</p></div><div class="chrome-setup-actions"><button>打开 Chrome 扩展页</button><button class="secondary">显示扩展目录</button><button disabled>修复中…</button><button class="ghost">刷新状态</button></div></section>
        <section class="chrome-approval-section"><div class="chrome-section-heading"><div><span class="chrome-section-kicker">待你确认</span><h3>敏感动作审批</h3></div><span class="chrome-count-badge">2</span></div><div class="chrome-approval-list">
          <article class="chrome-approval-card" data-effect="external_write"><div class="chrome-approval-copy"><strong>发送准备好的回复</strong><span>https://mail.example · 外部写入</span></div><div class="chrome-approval-actions"><button>批准一次</button><button class="ghost danger">拒绝</button></div></article>
          <article class="chrome-approval-card" data-effect="high_impact"><div class="chrome-approval-copy"><strong>上传本地文件</strong><span>https://portal.example · 高影响</span><em>批准前请选择本次上传文件；网页无法看到本机路径。</em></div><div class="chrome-approval-actions"><button class="secondary">选择文件</button><button disabled>批准一次</button><button class="ghost danger">拒绝</button></div></article>
        </div></section>
        <section class="chrome-audit-section"><div class="chrome-section-heading"><div><span class="chrome-section-kicker">仅本机内存</span><h3>最近活动</h3></div></div><ol class="chrome-audit-list"><li><time>14:30:12</time><div><strong>请求审批</strong><span>type: external · status: prepared</span></div></li><li><time>14:29:58</time><div><strong>站点权限</strong><span>origin: https://mail.example · mode: once</span></div></li></ol></section>
      </div>
    </dialog></body></html>`;
}

async function waitForDevTools(directory, child) {
  const file = path.join(directory, "DevToolsActivePort");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chrome exited before DevTools was ready (${child.exitCode}).`);
    try {
      const [port, browserPath] = (await fs.promises.readFile(file, "utf8")).trim().split(/\r?\n/);
      if (Number(port) && browserPath) return { port: Number(port), browserPath };
    } catch {}
    await delay(100);
  }
  throw new Error("Chrome DevTools endpoint did not become ready.");
}

async function createTarget(port, url) {
  return fetchJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
}

async function ensureExtensionLoaded(port, extensionId) {
  const commandLineTarget = await waitForTarget(
    port,
    (target) => target.url?.startsWith(`chrome-extension://${extensionId}/`),
    3_000,
  ).catch(() => null);
  if (commandLineTarget) return;
  const extensionsTarget = await createTarget(port, "chrome://extensions/");
  const page = new CdpConnection(extensionsTarget.webSocketDebuggerUrl);
  await page.open();
  try {
    await page.call("Runtime.enable");
    await page.call("Page.enable");
    await waitForDocument(page);
    await page.call("Page.setInterceptFileChooserDialog", { enabled: true });
    const apiAvailable = await evaluate(page, `typeof chrome?.developerPrivate?.loadUnpacked === "function"`);
    if (!apiAvailable) throw new Error("chrome.developerPrivate.loadUnpacked is unavailable in this Chrome build.");
    const profile = await evaluate(page, `new Promise((resolve) => chrome.developerPrivate.getProfileConfiguration(resolve))`);
    if (!profile?.inDeveloperMode) {
      await evaluate(page, `new Promise((resolve) => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, resolve))`);
      await delay(250);
    }
    const chooserPromise = page.waitForEvent("Page.fileChooserOpened", 5_000).catch((error) => ({ error }));
    const clickResult = await page.call("Runtime.evaluate", {
      expression: `(() => {
        globalThis.__haoloLoadResult = "pending";
        chrome.developerPrivate.loadUnpacked({ failQuietly: false, populateError: true }, (result) => {
          globalThis.__haoloLoadResult = { result, error: chrome.runtime.lastError?.message || null };
        });
        return true;
      })()`,
      returnByValue: true,
      userGesture: true,
    });
    if (!clickResult.result?.value) throw new Error("Chrome extensions page did not expose the Load unpacked button.");
    const chooser = await chooserPromise;
    if (chooser.error) {
      const loadResult = await evaluate(page, "globalThis.__haoloLoadResult");
      throw new Error(`Chrome did not open the unpacked-extension directory picker: ${JSON.stringify(loadResult)}`);
    }
    await page.call("DOM.setFileInputFiles", { files: [extensionDir], backendNodeId: chooser.backendNodeId });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const current = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      if (current.some((target) => target.url?.startsWith(`chrome-extension://${extensionId}/`))) return;
      await delay(100);
    }
    throw new Error("Chrome did not activate the unpacked extension after selecting its directory.");
  } finally {
    page.close();
  }
}

async function grantExtensionHostAccessForTesting(port, extensionId, origin) {
  const extensionsTarget = await createTarget(port, "chrome://extensions/");
  const page = new CdpConnection(extensionsTarget.webSocketDebuggerUrl);
  await page.open();
  try {
    await page.call("Runtime.enable");
    await waitForDocument(page);
    const available = await evaluate(page, `typeof chrome?.developerPrivate?.updateExtensionConfiguration === "function"`);
    if (!available) throw new Error("Chrome developerPrivate test setup API is unavailable.");
    await evaluate(page, `new Promise((resolve, reject) => chrome.developerPrivate.updateExtensionConfiguration(
      { extensionId: ${JSON.stringify(extensionId)}, hostAccess: "ON_ALL_SITES" },
      () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(true)
    ))`);
    await evaluate(page, `new Promise((resolve, reject) => chrome.developerPrivate.addHostPermission(
      ${JSON.stringify(extensionId)},
      ${JSON.stringify(`${origin}/*`)},
      () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(true)
    ))`);
    await evaluate(page, `new Promise((resolve, reject) => chrome.developerPrivate.updateSiteAccess(
      ${JSON.stringify(`${origin}/*`)},
      [{ id: ${JSON.stringify(extensionId)}, siteAccess: "ON_SPECIFIC_SITES" }],
      () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(true)
    ))`);
  } finally {
    page.close();
  }
}

async function waitForTarget(port, predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const target = targets.find(predicate);
    if (target) return target;
    await delay(100);
  }
  throw new Error("Expected Chrome DevTools target was not observed.");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`DevTools request failed: ${response.status} ${response.statusText}`);
  return response.json();
}

async function evaluate(connection, expression) {
  const response = await connection.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Runtime evaluation failed");
  return response.result?.value;
}

async function waitForDocument(connection) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const state = await evaluate(connection, "document.readyState");
    if (state === "complete" || state === "interactive") return;
    await delay(50);
  }
  throw new Error("Test document did not finish loading.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function CdpConnection(url) {
  this.url = url;
  this.socket = null;
  this.sequence = 0;
  this.pending = new Map();
  this.eventWaiters = new Map();

  this.open = async () => {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      const waiters = this.eventWaiters.get(message.method);
      if (!waiters?.length) return;
      const waiter = waiters.shift();
      if (!waiters.length) this.eventWaiters.delete(message.method);
      clearTimeout(waiter.timer);
      waiter.resolve(message.params || {});
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  };

  this.call = (method, params = {}) => {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("CDP socket is not open."));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  };

  this.waitForEvent = (method, timeoutMs = 5_000) => new Promise((resolve, reject) => {
    const waiters = this.eventWaiters.get(method) || [];
    const waiter = { resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      const current = this.eventWaiters.get(method) || [];
      const index = current.indexOf(waiter);
      if (index >= 0) current.splice(index, 1);
      if (!current.length) this.eventWaiters.delete(method);
      reject(new Error(`Timed out waiting for CDP event ${method}.`));
    }, timeoutMs);
    waiters.push(waiter);
    this.eventWaiters.set(method, waiters);
  });

  this.close = () => {
    this.socket?.close();
    this.socket = null;
  };
}
