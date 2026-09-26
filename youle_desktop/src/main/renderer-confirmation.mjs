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
    return requestInternal(window, options, false);
  }

  function requestStatus(window, options = {}) {
    return requestInternal(window, options, true);
  }

  function requestInternal(window, options, includeStatus) {
    const webContents = window?.webContents;
    if (!webContents || window.isDestroyed?.() || webContents.isDestroyed?.()) {
      return Promise.resolve(confirmationResult(false, "unavailable", includeStatus));
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      let settled = false;
      let loadFailed = false;
      const finishWithReason = (confirmed, reason) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        webContents.off?.("destroyed", onDestroyed);
        webContents.off?.("did-finish-load", sendRequest);
        webContents.off?.("did-fail-load", onFailedLoad);
        pending.delete(requestId);
        resolve(confirmationResult(confirmed, reason, includeStatus));
      };
      const onDestroyed = () => finishWithReason(false, "unavailable");
      const onFailedLoad = (_event, _errorCode, _errorDescription, _url, isMainFrame) => {
        if (isMainFrame === false) return;
        // Keep the request alive. Vite/Electron can recover from a transient
        // navigation failure; the next successful main-frame load will send
        // the dialog to the renderer.
        loadFailed = true;
      };
      const timer = setTimeout(
        () => finishWithReason(false, loadFailed ? "load-failed" : "timeout"),
        Math.max(1_000, Number(timeoutMs) || 0),
      );
      timer.unref?.();
      pending.set(requestId, {
        webContentsId: webContents.id,
        finish: (confirmed) => finishWithReason(
          confirmed,
          confirmed ? "confirmed" : "cancelled",
        ),
      });
      function sendRequest() {
        if (settled) return;
        try {
          webContents.send(APP_CONFIRMATION_REQUEST_CHANNEL, {
            requestId,
            ...normalizeRendererConfirmationOptions(options),
          });
        } catch {
          finishWithReason(false, "unavailable");
        }
      }
      try {
        webContents.once?.("destroyed", onDestroyed);
        // Development updates may be queued before createWindow has finished
        // loading. Wait until the renderer has installed its dialog listener.
        if (webContents.isLoadingMainFrame?.()) {
          webContents.once("did-finish-load", sendRequest);
          webContents.on?.("did-fail-load", onFailedLoad);
        } else {
          sendRequest();
        }
      } catch {
        finishWithReason(false, "unavailable");
      }
    });
  }

  function dispose() {
    for (const entry of pending.values()) entry.finish(false);
    ipcMain.removeHandler?.(APP_CONFIRMATION_RESOLVE_CHANNEL);
  }

  return { request, requestStatus, dispose };
}

function confirmationResult(confirmed, reason, includeStatus) {
  if (!includeStatus) return Boolean(confirmed);
  return {
    confirmed: Boolean(confirmed),
    retryable: reason !== "cancelled" && reason !== "confirmed",
    reason,
  };
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
