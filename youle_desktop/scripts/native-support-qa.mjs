import { app, BrowserWindow, session, net } from "electron/main";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { once } from "node:events";
import { createSupportUploads } from "../src/main/native-support.mjs";

async function main() {
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "output", "native-support-qa");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await mkdir(output, { recursive: true });
app.setPath("userData", path.join(output, "profile"));
await app.whenReady();
const isolated = session.fromPartition(`native-support-qa-${Date.now()}`);
isolated.webRequest.onBeforeRequest({ urls: ["https://*/*", "http://*/*", "wss://*/*", "ws://*/*"] }, (_details, callback) => callback({ cancel: true }));
const win = new BrowserWindow({ show: true, opacity: 0, skipTaskbar: true, width: 1440, height: 960, webPreferences: { session: isolated, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
const errors = [];
win.webContents.on("console-message", (_event, level, message) => { if (level === 3 && !/ERR_BLOCKED|Failed to fetch|market|WebSocket|net::|TradingView/i.test(message)) errors.push(message); });
const run = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function wait(fn) {
  for (let i = 0; i < 160; i++) { if (await run(fn)) return; await delay(100); }
  throw new Error(`Timed out: ${fn}`);
}
async function click(selector) { await run((s) => { const el = document.querySelector(s); if (!el) throw new Error(`Missing ${s}`); el.click(); }, selector); }
async function draft(selector, text) { await run((s, value) => { const input = document.querySelector(s); input.focus(); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); }, selector, text); }
async function installFixture() {
  await run(() => {
    const id = "11111111-1111-4111-8111-111111111111";
    window.supportQa = { calls: [], modelCalls: [], replies: [{ id: "welcome", role: "assistant", text: "QA support welcome", created_at: new Date().toISOString() }], status: "active", fail: false };
    for (const name of ["sendMessage", "interruptTurn", "updateThreadSettings"]) {
      const original = window.codexDesktop[name];
      if (original) window.codexDesktop[name] = (...args) => { window.supportQa.modelCalls.push({ name, args }); return original(...args); };
    }
    window.codexDesktop.supportRequest = async (params) => {
      const qa = window.supportQa; qa.calls.push(params);
      if (qa.fail) return { ok: false, status: 503 };
      if (params.action === "send") {
        if (!qa.replies.some(message => message.support_event === "joined")) qa.replies.push({ id: "joined", role: "human_support", sender_type: "ai", support_event: "joined", text: "客服 haolo 加入会话", created_at: new Date().toISOString() });
        if (!qa.replies.some((message) => message.id === params.client_message_id)) qa.replies.push({ id: params.client_message_id, role: "user", text: params.content, attachments: params.attachments, created_at: new Date().toISOString() });
        return { ok: true, data: {} };
      }
      return { ok: true, data: { session: { id, status: qa.status, created_at: "2026-10-24T01:00:00Z" }, messages: structuredClone(qa.replies), support_online: true } };
    };
    window.codexDesktop.supportUpload = async (params) => {
      window.supportQa.calls.push(params);
      if (params.action === "begin") return { ok: true, data: { uploadId: "qa-upload" } };
      if (params.action === "finish") return { ok: true, data: { kind: "file", file_name: "diagnostic.json", object_key: "qa/diagnostic", mime_type: "application/json", size_bytes: 2 } };
      return { ok: true, data: {} };
    };
  });
}
const records = [];
try {
  let uploadBytes = 0;
  const uploadServer = createServer(async (request, response) => {
    for await (const chunk of request) uploadBytes += chunk.length;
    response.writeHead(204); response.end();
  });
  uploadServer.listen(0, "127.0.0.1"); await once(uploadServer, "listening");
  const uploadBase = `http://127.0.0.1:${uploadServer.address().port}`;
  const uploadClient = {
    baseUrl: uploadBase, load: async () => {}, sessionSummary: () => ({ authenticated: true, profile: { id: "qa" } }),
    supportRequest: async () => ({ upload_url: "/api/support/attachment-uploads", headers: { "Content-Type": "text/plain", "X-Support-Upload-Token": "qa-local-only" }, kind: "file", object_key: "qa/local-upload", file_name: "qa.txt", mime_type: "text/plain", size_bytes: 1024 * 1024 + 7 }),
    serviceFetch: (url, init) => net.fetch(url, init),
  };
  const uploads = createSupportUploads({ getClient: () => uploadClient, tempRoot: output });
  try {
    const { uploadId } = await uploads.run(1, { action: "begin", sessionId: "11111111-1111-4111-8111-111111111111", file_name: "qa.txt", mime_type: "text/plain", size_bytes: 1024 * 1024 + 7 });
    await uploads.run(1, { action: "chunk", uploadId, offset: 0, bytes: new Uint8Array(1024 * 1024).fill(65) });
    await uploads.run(1, { action: "chunk", uploadId, offset: 1024 * 1024, bytes: new Uint8Array(7).fill(66) });
    await uploads.run(1, { action: "finish", uploadId });
    assert.equal(uploadBytes, 1024 * 1024 + 7);
    records.push({ check: "Electron native streamed upload to local HTTP receiver", bytes: uploadBytes, passed: true });
  } finally { await uploads.disposeOwner(1); uploadServer.closeAllConnections(); uploadServer.close(); }
  await win.loadFile(path.join(root, "dist/renderer/index.html"), { query: { "i18n-layout-qa": "1" } });
  await wait(() => !!document.querySelector('[data-action="open-native-support"]'));
  await delay(600);
  if (await run(() => !!document.querySelector(".settings-close-button"))) await click(".settings-close-button");
  await installFixture();
  await writeFile(path.join(output, "initial.png"), (await win.webContents.capturePage()).toPNG());
  await wait(() => !!document.querySelector("#composerInput"));
  const before = await run(() => ({ thread: document.querySelector("#messageScroller")?.dataset.threadId, model: document.querySelector('[data-action="toggle-composer-model-menu"]')?.textContent?.trim() }));
  await draft("#composerInput", "模型原始草稿 — DO NOT CHANGE");
  await click('[data-action="open-native-support"]');
  await wait(() => document.querySelector(".native-support textarea") && !document.querySelector(".native-support textarea").disabled);
  assert.deepEqual(await run(() => ({ modelComposer: !!document.querySelector("#composerInput"), placeholder: document.querySelector(".native-support textarea").placeholder, exit: document.querySelector("[data-support-exit]").textContent })), { modelComposer: false, placeholder: "您可以描述任何问题", exit: "退出客服" });
  await draft(".native-support textarea", "Native support QA message");
  await click('.native-support [type="submit"]');
  await wait(() => document.querySelector(".native-support-messages")?.textContent.includes("Native support QA message"));
  await draft(".native-support textarea", "客服独立草稿");
  await run(() => window.supportQa.replies.push({ id: "reply-2", role: "assistant", text: "QA reply delivered", created_at: new Date().toISOString() }));
  await wait(() => document.querySelector(".native-support-messages")?.textContent.includes("QA reply delivered"));
  assert.equal(await run(() => document.querySelector(".native-support textarea").value), "客服独立草稿");
  assert.equal(await run(() => window.supportQa.modelCalls.length), 0);
  // Reproduce the old same-transaction ordering, including an older user turn.
  await run(() => {
    const firstUser = window.supportQa.replies.find(message => message.role === "user");
    window.supportQa.replies.find(message => message.support_event === "joined").created_at = firstUser.created_at;
    window.supportQa.replies.push(...Array.from({ length: 35 }, (_, index) => ({ id: `long-${index}`, role: index % 2 ? "user" : "human_support", text: `Long history ${index}\n${"客服历史内容 ".repeat(20)}`, created_at: new Date().toISOString() })));
  });
  await wait(() => document.querySelector(".native-support-messages")?.textContent.includes("Long history 34"));
  await delay(350);
  const atBottom = () => { const el = document.querySelector(".native-support-messages"); return el.scrollHeight > el.clientHeight && el.scrollHeight - el.scrollTop - el.clientHeight <= 2; };
  assert.equal(await run(atBottom), true, "long history stays at bottom after main renderer remount");
  assert.equal(await run(() => { const rows = [...document.querySelectorAll(".native-support-message")]; return rows.indexOf(rows.find(el => el.textContent.includes("Native support QA message"))) < rows.indexOf(rows.find(el => el.classList.contains("is-system"))); }), true);
  for (const sender of ["ai", "human"]) {
    // A new answer must be visible even if the user was reading older history.
    await run(() => { document.querySelector(".native-support-messages").scrollTop = 10; });
    await delay(100);
    await run(sender => window.supportQa.replies.push({ id: `bottom-${sender}`, role: "human_support", sender_type: sender, text: `${sender} bottom reply\n${"详细回复 ".repeat(40)}`, created_at: new Date().toISOString() }), sender);
    await wait(() => document.querySelector(".native-support-messages")?.textContent.includes("bottom reply"));
    await wait(atBottom);
    await delay(500);
    assert.equal(await run(atBottom), true, `${sender} reply survives read acknowledgement and remount`);
  }
  await writeFile(path.join(output, "reply-scroll.png"), (await win.webContents.capturePage()).toPNG());
  records.push({ check: "legacy joined order, long history, AI/human replies stay at bottom after remount", passed: true });
  await click("[data-support-exit]");
  await wait(() => !!document.querySelector("#composerInput"));
  assert.equal(await run(() => document.querySelector("#composerInput").value), "模型原始草稿 — DO NOT CHANGE");
  assert.deepEqual(await run(() => ({ thread: document.querySelector("#messageScroller")?.dataset.threadId, model: document.querySelector('[data-action="toggle-composer-model-menu"]')?.textContent?.trim() })), before);
  await click("[data-support-session]");
  await wait(() => !!document.querySelector(".native-support textarea"));
  assert.equal(await run(() => document.querySelector(".native-support textarea").value), "客服独立草稿");
  await run(() => {
    const files = new DataTransfer(); files.items.add(new File(["{}"], "diagnostic.json", { type: "application/json" }));
    document.querySelector(".native-support textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: files, bubbles: true, cancelable: true }));
  });
  await wait(() => !!document.querySelector(".native-support-attachment"));
  await click('.native-support [type="submit"]');
  await wait(() => !document.querySelector(".native-support-attachment"));
  assert.ok(await run(() => window.supportQa.calls.some((call) => call.action === "send" && call.attachments?.length === 1)));
  await run(() => { window.supportQa.fail = true; });
  await draft(".native-support textarea", "客服断网保留");
  await click('.native-support [type="submit"]');
  await wait(() => !!document.querySelector(".native-support-error"));
  await click("[data-support-exit]");
  await wait(() => !!document.querySelector("#composerInput"));
  assert.equal(await run(() => document.querySelector("#composerInput").value), "模型原始草稿 — DO NOT CHANGE");
  await run(() => { window.supportQa.fail = false; });
  records.push({ check: "isolation, history, polling, attachment, network failure", passed: true });

  // Exercise the real model renderer and its mock notification stream while
  // support occupies the conversation surface, then return via a history row.
  await click('.conversation-row[data-thread-id="mock-thread-1"]');
  await wait(() => document.querySelector("#messageScroller")?.dataset.threadId === "mock-thread-1" && !!document.querySelector("#composerInput"));
  await draft("#composerInput", "existing model history draft");
  await click('[data-action="open-native-support"]');
  await wait(() => !!document.querySelector(".native-support textarea"));
  await click('.conversation-row[data-thread-id="mock-thread-1"]');
  await wait(() => !!document.querySelector("#composerInput"));
  assert.equal(await run(() => document.querySelector("#composerInput").value), "existing model history draft");
  await draft("#composerInput", "MODEL STREAM ISOLATION");
  await run(() => document.querySelector("#composerForm").requestSubmit());
  await wait(() => window.supportQa.modelCalls.some((call) => call.name === "sendMessage"));
  await click('[data-action="open-native-support"]');
  await wait(() => !!document.querySelector(".native-support textarea"));
  await delay(1300);
  assert.equal(await run(() => window.supportQa.modelCalls.filter((call) => call.name === "interruptTurn").length), 0);
  assert.equal(await run(() => document.querySelector(".native-support-messages").textContent.includes("MODEL STREAM ISOLATION")), false);
  await click("[data-support-exit]");
  await wait(() => document.querySelector("#messageScroller")?.textContent.includes("MODEL STREAM"));
  records.push({ check: "same model history navigation and in-flight model stream survives support", passed: true });

  for (const language of ["zh-CN", "en", "zh-TW"]) {
    for (const theme of ["light", "dark"]) {
      await run((lang, mode) => { localStorage.setItem("haolo.appearance.language", lang); localStorage.setItem("haolo.appearance.theme", mode); }, language, theme);
      await win.reload();
      await wait(() => !!document.querySelector('[data-action="open-native-support"]'));
      await delay(400); await installFixture();
      await click('[data-action="open-settings"]');
      await wait(() => !!document.querySelector(".settings-dialog"));
      await click('.settings-language-select [data-haolo-select-trigger]');
      await click(`.settings-language-select [data-haolo-select-value="${language}"]`);
      await click(`[data-settings-theme="${theme}"]`);
      await click('.settings-close-button');
      await click('[data-action="open-native-support"]');
      await wait(() => document.querySelector(".native-support textarea") && !document.querySelector(".native-support textarea").disabled);
      await draft(".native-support textarea", language === "en" ? "My order needs review" : language === "zh-TW" ? "請協助檢查訂單狀態" : "请协助检查订单状态");
      await click('.native-support [type="submit"]');
      await wait(() => document.querySelector(".native-support .is-user"));
      await delay(300);
      const layout = await run(() => {
        const panel = document.querySelector(".native-support-panel"), input = panel.querySelector("textarea"), exit = panel.querySelector("[data-support-exit]");
        const rect = panel.getBoundingClientRect(), exitRect = exit.getBoundingClientRect();
        return { language: document.documentElement.dataset.language, theme: document.documentElement.dataset.theme, placeholder: input.placeholder, exit: exit.textContent, width: rect.width, height: rect.height, overflow: panel.scrollWidth > panel.clientWidth + 1, exitVisible: exitRect.bottom <= rect.bottom && exitRect.width > 0, modelSelectors: panel.querySelectorAll('[data-action="toggle-composer-model-menu"], [data-action="toggle-new-thread-group-picker"]').length };
      });
      assert.equal(layout.language, language); assert.equal(layout.theme, theme); assert.equal(layout.overflow, false); assert.equal(layout.exitVisible, true); assert.equal(layout.modelSelectors, 0);
      await writeFile(path.join(output, `${language}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      records.push(layout);
    }
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify({ passed: true, records, consoleErrors: errors }, null, 2));
  console.log(JSON.stringify({ passed: true, records, consoleErrors: errors }));
  win.destroy(); app.exit(0);
} catch (error) {
  console.error(error);
  if (!win.webContents.getURL()) { win.destroy(); app.exit(1); return; }
  await writeFile(path.join(output, "failure.png"), (await win.webContents.capturePage()).toPNG());
  await writeFile(path.join(output, "failure.json"), JSON.stringify({ error: String(error.stack), errors, body: await run(() => document.body.innerText.slice(0, 12000)) }, null, 2));
  win.destroy(); app.exit(1);
}
}
main().catch((error) => { console.error(error); app.exit(1); });
