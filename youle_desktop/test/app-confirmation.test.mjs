import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  APP_CONFIRMATION_REQUEST_CHANNEL,
  APP_CONFIRMATION_RESOLVE_CHANNEL,
  createRendererConfirmationBroker,
} from "../src/main/renderer-confirmation.mjs";

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
    invoke(channel, event, params) {
      return handlers.get(channel)?.(event, params);
    },
    has(channel) {
      return handlers.has(channel);
    },
  };
}

function fakeWindow({ id = 7, throwOnSend = false } = {}) {
  const webContents = new EventEmitter();
  webContents.id = id;
  webContents.isDestroyed = () => false;
  webContents.sent = [];
  webContents.send = (channel, payload) => {
    if (throwOnSend) throw new Error("renderer unavailable");
    webContents.sent.push({ channel, payload });
  };
  return {
    isDestroyed: () => false,
    webContents,
  };
}

test("renderer confirmation broker resolves only from the requesting window", async () => {
  const ipcMain = fakeIpcMain();
  const window = fakeWindow();
  const broker = createRendererConfirmationBroker({ ipcMain, timeoutMs: 10_000 });
  try {
    const resultPromise = broker.request(window, {
      title: "删除预警",
      message: "确定删除这个预警吗？",
      confirmLabel: "删除",
      cancelLabel: "取消",
      tone: "danger",
    });
    const sent = window.webContents.sent[0];
    assert.equal(sent.channel, APP_CONFIRMATION_REQUEST_CHANNEL);
    assert.equal(sent.payload.title, "删除预警");
    assert.equal(sent.payload.tone, "danger");

    const rejected = await ipcMain.invoke(
      APP_CONFIRMATION_RESOLVE_CHANNEL,
      { sender: { id: 99 } },
      { requestId: sent.payload.requestId, confirmed: true },
    );
    assert.deepEqual(rejected, { ok: false });

    const accepted = await ipcMain.invoke(
      APP_CONFIRMATION_RESOLVE_CHANNEL,
      { sender: window.webContents },
      { requestId: sent.payload.requestId, confirmed: true },
    );
    assert.deepEqual(accepted, { ok: true });
    assert.equal(await resultPromise, true);
  } finally {
    broker.dispose();
  }
  assert.equal(ipcMain.has(APP_CONFIRMATION_RESOLVE_CHANNEL), false);
});

test("renderer confirmation broker fails closed when the renderer disappears", async () => {
  const ipcMain = fakeIpcMain();
  const broker = createRendererConfirmationBroker({ ipcMain, timeoutMs: 10_000 });
  try {
    const unavailable = fakeWindow({ throwOnSend: true });
    assert.equal(await broker.request(unavailable, { message: "test" }), false);

    const destroyed = fakeWindow({ id: 8 });
    const resultPromise = broker.request(destroyed, { message: "test" });
    destroyed.webContents.emit("destroyed");
    assert.equal(await resultPromise, false);
  } finally {
    broker.dispose();
  }
});

test("all application confirmations use the shared in-app dialog", async () => {
  const [renderer, main, preload, devUpdate, userDataTransfer] = await Promise.all([
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/dev-source-update.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/user-data-transfer.mjs", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(renderer, /\bwindow\.(?:confirm|alert|prompt)\s*\(/);
  assert.doesNotMatch(`${main}\n${devUpdate}\n${userDataTransfer}`, /showMessageBox(?:Sync)?\s*\(/);
  assert.match(renderer, /import \{ confirmInApp, confirmSelectionInApp,/);
  assert.match(renderer, /\bconfirmSelectionInApp\s*\(/);
  assert.match(main, /createRendererConfirmationBroker\(\{ ipcMain \}\)/);
  assert.match(preload, /onAppConfirmationRequested/);
  assert.match(preload, /resolveAppConfirmation/);
  assert.match(devUpdate, /requestConfirmation\(\{/);
  assert.match(userDataTransfer, /requestConfirmation\(\{/);
});

async function selectionDialogHarness() {
  const documentListeners = new Map();
  let document;
  class ElementStub {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.listeners = new Map();
      this.className = "";
      this.classList = { add: (name) => { this.className += ` ${name}`; } };
      this.inert = false;
      this.disabled = false;
      this.checked = false;
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    remove() { this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
    get isConnected() { return this === document.body || Boolean(this.parent?.isConnected); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    focus() { document.activeElement = this; }
    descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
    querySelectorAll(selector) {
      return this.descendants().filter((child) => selector.split(",").some((part) => (
        part.trim().startsWith(child.tagName) && (!part.includes(":not(:disabled)") || !child.disabled)
      )));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest() { return this.dataset.appConfirmationAction ? this : this.parent?.closest() || null; }
  }
  const app = new ElementStub("main");
  const opener = new ElementStub("button");
  app.append(opener);
  document = {
    body: new ElementStub("body"), activeElement: opener,
    querySelector: () => app,
    createElement: (tag) => new ElementStub(tag),
    addEventListener: (type, callback) => documentListeners.set(type, callback),
    removeEventListener: (type) => documentListeners.delete(type),
  };
  document.body.append(app);
  const context = {
    exports: {}, document, HTMLElement: ElementStub, Element: ElementStub,
    window: { requestAnimationFrame: (callback) => callback() },
  };
  const source = await readFile(new URL("../src/renderer/app-confirmation.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  const find = (predicate) => document.body.descendants().find(predicate);
  return {
    ...context.exports, app, opener, document,
    dialog: () => find((node) => node.tagName === "dialog"),
    checkboxes: () => document.body.descendants().filter((node) => node.tagName === "input"),
    button: (action) => find((node) => node.tagName === "button" && node.dataset.appConfirmationAction === action),
    summary: () => find((node) => node.attributes.role === "status").textContent,
    toggle(index) {
      const checkbox = this.checkboxes()[index];
      checkbox.checked = !checkbox.checked;
      checkbox.listeners.get("change")({ target: checkbox });
    },
    click(action) {
      find((node) => node.className === "app-confirmation-host").listeners.get("click")({ target: this.button(action) });
    },
    key(key, { target = document.activeElement, shiftKey = false } = {}) {
      const event = { key, target, shiftKey, preventDefault() { this.defaultPrevented = true; } };
      documentListeners.get("keydown")?.(event);
      return event;
    },
  };
}

test("selection confirmation starts unchecked, blocks empty confirmation and returns only checked IDs", async () => {
  const ui = await selectionDialogHarness();
  const result = ui.confirmSelectionInApp({ title: "删除指定会话", message: "请选择要删除的会话，可多选。", tone: "danger" }, [
    { id: "a", label: "<img src=x onerror=alert(1)>" }, { id: "b", label: "会话 B" }, { id: "c", label: "会话 C" },
  ]);
  assert.equal(ui.app.inert, true);
  assert.equal(ui.button("confirm").disabled, true);
  assert.equal(ui.summary(), "已选择：0 / 3");
  assert.ok(ui.checkboxes().every((input) => !input.checked && input.type === "checkbox"));
  const title = ui.checkboxes()[0].parent.children[1];
  assert.equal(title.textContent, "<img src=x onerror=alert(1)>");
  assert.equal(title.attributes["data-i18n-skip"], "");
  ui.click("confirm");
  ui.key("Enter", { target: ui.dialog() });
  assert.ok(ui.dialog(), "empty selection cannot be submitted by clicking or Enter");
  ui.toggle(0);
  ui.toggle(2);
  ui.toggle(0);
  assert.equal(ui.summary(), "已选择：1 / 3");
  assert.equal(ui.button("confirm").disabled, false);
  ui.toggle(2);
  assert.equal(ui.button("confirm").disabled, true, "clearing the selection disables deletion again");
  ui.toggle(2);
  ui.click("confirm");
  assert.deepEqual(Array.from(await result), ["c"]);
  assert.equal(ui.dialog(), undefined);
  assert.equal(ui.app.inert, false);
  assert.equal(ui.document.activeElement, ui.opener);
});

test("selection dialog traps keyboard focus across checkboxes and buttons, and resets on cancel", async () => {
  const ui = await selectionDialogHarness();
  const items = [{ id: "a", label: "会话 A" }, { id: "b", label: "会话 B" }];
  const cancelled = ui.confirmSelectionInApp({ title: "删除指定会话", message: "选择" }, items);
  assert.equal(ui.document.activeElement, ui.button("cancel"));
  ui.key("Tab");
  assert.equal(ui.document.activeElement, ui.checkboxes()[0]);
  ui.key("Tab", { shiftKey: true });
  assert.equal(ui.document.activeElement, ui.button("cancel"));
  ui.toggle(1);
  ui.button("confirm").focus();
  ui.key("Tab");
  assert.equal(ui.document.activeElement, ui.checkboxes()[0]);
  const next = ui.confirmSelectionInApp({ title: "删除指定会话", message: "选择" }, items);
  ui.key("Escape");
  assert.equal(await cancelled, null);
  assert.equal(ui.app.inert, true, "the queued dialog still keeps the app inert");
  assert.equal(ui.summary(), "已选择：0 / 2");
  assert.equal(ui.button("confirm").disabled, true);
  ui.click("cancel");
  assert.equal(await next, null);
  const plain = ui.confirmInApp({ title: "普通确认", message: "继续？" });
  assert.equal(ui.checkboxes().length, 0);
  assert.equal(ui.button("confirm").disabled, false);
  ui.click("confirm");
  assert.equal(await plain, true, "ordinary confirmation retains its boolean API");
});

test("selection list has a fixed scroll area and theme-aware square checkbox interaction states", async () => {
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const selection = styles.slice(styles.indexOf("/* The selection list and its controls"), styles.indexOf(".thread-group-backdrop {"));
  assert.match(selection, /height: 240px;[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain/s);
  assert.match(selection, /scrollbar-gutter: stable;/);
  assert.match(selection, /width: 16px;\s*height: 16px;/);
  assert.match(selection, /border-radius: 3px;/);
  assert.match(selection, /:checked::after\s*\{[^}]*border-bottom: 2px solid var\(--surface-primary\);[^}]*border-left: 2px solid var\(--surface-primary\);/s, "the tick must not inherit the global dark input text color");
  for (const state of [":hover", ":has(:checked)", ":active", ":checked::after", ":focus-visible", ":disabled"]) {
    assert.ok(selection.includes(state), `missing ${state} styling`);
  }
  assert.doesNotMatch(selection, /#[0-9a-f]{3,8}|rgba?\(/i);
  const light = styles.slice(0, styles.indexOf('html[data-font-size="small"]'));
  const dark = styles.slice(styles.indexOf('html[data-theme="dark"] {'), styles.indexOf("* {"));
  for (const token of new Set(Array.from(selection.matchAll(/var\((--[\w-]+)\)/g), (match) => match[1]))) {
    assert.ok(light.includes(`${token}:`), `missing light ${token}`);
    assert.ok(dark.includes(`${token}:`) || token === "--app-font-size-offset", `missing dark ${token}`);
  }
});

test("in-app confirmation preserves the reference dialog and both theme states", async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL("../src/renderer/app-confirmation.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /thread-delete-dialog app-confirmation-dialog/);
  assert.match(component, /setAttribute\("role", "alertdialog"\)/);
  assert.match(component, /setAttribute\("aria-modal", "true"\)/);
  assert.match(component, /\.textContent = options\.(?:title|message)/);
  assert.match(component, /appRoot\.inert = true/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /event\.key !== "Tab"/);
  assert.match(component, /confirmationQueue\.shift\(\)/);

  assert.match(styles, /\.app-confirmation-backdrop\s*\{[^}]*z-index:\s*1400;/s);
  assert.match(styles, /\.app-confirmation-dialog footer button:active:not\(:disabled\)/);
  assert.match(styles, /\.app-confirmation-dialog footer button:focus-visible/);
  assert.match(styles, /\.app-confirmation-dialog footer button:disabled/);
  assert.match(styles, /\.app-confirmation-dialog \.app-confirmation-detail\s*\{[^}]*color: var\(--text-secondary\)/s);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.app-confirmation-dialog footer \.thread-dialog-danger:not\(:disabled\)\s*\{[^}]*background: color-mix\(in srgb, var\(--danger\) 80%, var\(--text-primary\)\)/s);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.app-confirmation-dialog footer \.thread-dialog-danger:hover:not\(:disabled\)/);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.app-confirmation-dialog footer \.thread-dialog-danger:active:not\(:disabled\)/);
  assert.match(styles, /\.thread-dialog-secondary:hover/);
  assert.match(styles, /\.thread-dialog-primary:hover/);
  assert.match(styles, /\.thread-dialog-danger:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.app-confirmation-dialog \.app-confirmation-detail/);
  assert.match(styles, /html\[data-theme="dark"\] \.app-confirmation-dialog footer button:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.app-confirmation-dialog footer \.thread-dialog-danger:hover:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] dialog\[open\] footer button:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.app-confirmation-dialog footer\.single-action/);
});
