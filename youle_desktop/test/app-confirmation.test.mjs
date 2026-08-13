import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
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
  assert.equal(renderer.match(/\bconfirmInApp\s*\(/g)?.length, 8);
  assert.match(main, /createRendererConfirmationBroker\(\{ ipcMain \}\)/);
  assert.match(preload, /onAppConfirmationRequested/);
  assert.match(preload, /resolveAppConfirmation/);
  assert.match(devUpdate, /requestConfirmation\(\{/);
  assert.match(userDataTransfer, /requestConfirmation\(\{/);
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
  assert.match(styles, /\.thread-dialog-secondary:hover/);
  assert.match(styles, /\.thread-dialog-primary:hover/);
  assert.match(styles, /\.thread-dialog-danger:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.app-confirmation-dialog \.app-confirmation-detail/);
  assert.match(styles, /html\[data-theme="dark"\] \.app-confirmation-dialog footer button:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.app-confirmation-dialog footer \.thread-dialog-danger:hover:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] dialog\[open\] footer button:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.app-confirmation-dialog footer\.single-action/);
});
