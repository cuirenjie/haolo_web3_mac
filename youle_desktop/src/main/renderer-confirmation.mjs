import crypto from "node:crypto";

export const APP_CONFIRMATION_REQUEST_CHANNEL = "app:confirmation-request";
export const APP_CONFIRMATION_RESOLVE_CHANNEL = "app:confirmation-resolve";

export function createRendererConfirmationBroker({
  ipcMain,
  timeoutMs = 5 * 60 * 1000,
} = {}) {
  const pending = new Map();

  ipcMain.handle(APP_CONFIRMATION_RESOLVE_CHANNEL, (event, params = {}) => {
    const requestId = String(params.requestId || "");
    const entry = pending.get(requestId);
    if (!entry || entry.webContentsId !== event.sender.id) return { ok: false };
    entry.finish(params.confirmed === true);
    return { ok: true };
  });

  function request(window, options = {}) {
    const webContents = window?.webContents;
    if (!webContents || window.isDestroyed?.() || webContents.isDestroyed?.()) {
      return Promise.resolve(false);
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (confirmed) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        webContents.off?.("destroyed", onDestroyed);
        pending.delete(requestId);
        resolve(Boolean(confirmed));
      };
      const onDestroyed = () => finish(false);
      const timer = setTimeout(() => finish(false), Math.max(1_000, Number(timeoutMs) || 0));
      timer.unref?.();
      webContents.once?.("destroyed", onDestroyed);
      pending.set(requestId, {
        webContentsId: webContents.id,
        finish,
      });
      try {
        webContents.send(APP_CONFIRMATION_REQUEST_CHANNEL, {
          requestId,
          ...normalizeRendererConfirmationOptions(options),
        });
      } catch {
        finish(false);
      }
    });
  }

  function dispose() {
    for (const entry of pending.values()) entry.finish(false);
    ipcMain.removeHandler?.(APP_CONFIRMATION_RESOLVE_CHANNEL);
  }

  return { request, dispose };
}

function normalizeRendererConfirmationOptions(options) {
  return {
    title: boundedText(options.title, "请确认", 120),
    message: boundedText(options.message, "", 4_000),
    detail: boundedText(options.detail, "", 8_000),
    confirmLabel: boundedText(options.confirmLabel, "确定", 32),
    cancelLabel: options.cancelLabel === null
      ? null
      : boundedText(options.cancelLabel, "取消", 32),
    tone: options.tone === "danger" ? "danger" : "primary",
  };
}

function boundedText(value, fallback, maxLength) {
  const text = String(value || "").trim();
  return (text || fallback).slice(0, maxLength);
}
