import { fileURLToPath } from "node:url";
import { BrowserWindow, ipcMain, screen } from "electron/main";
import {
  EXECUTION_PLAN_STICKY_MIN_HEIGHT,
  EXECUTION_PLAN_STICKY_MIN_WIDTH,
  executionPlanStickyBounds,
  executionPlanStickyFontSize,
  executionPlanStickyHtml,
  executionPlanStickyMovedBounds,
  executionPlanStickyResizedBounds,
  normalizeExecutionPlanStickyPayload,
} from "./execution-plan-sticky-view.mjs";

const stickyWindows = new Map();
const STICKY_PRELOAD_PATH = fileURLToPath(new URL("./execution-plan-sticky-preload.cjs", import.meta.url));

function dataUrl(html) {
  return `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
}

function stickyWindowPosition(bounds) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = display.workArea;
  const offset = (stickyWindows.size % 7) * 22;
  return {
    x: Math.round(Math.max(workArea.x, workArea.x + workArea.width - bounds.width - 24 - offset)),
    y: Math.round(Math.min(workArea.y + workArea.height - bounds.height, workArea.y + 24 + offset)),
  };
}

function renderStickyWindow(state) {
  const { window } = state;
  if (window.isDestroyed()) return;
  const nextBounds = state.autoSize ? executionPlanStickyBounds(state.payload) : state.bounds;
  if (nextBounds.width !== state.bounds.width || nextBounds.height !== state.bounds.height) {
    const current = window.getBounds();
    const workArea = screen.getDisplayMatching(current).workArea;
    const centeredX = Math.round(current.x + (state.bounds.width - nextBounds.width) / 2);
    const centeredY = Math.round(current.y + (state.bounds.height - nextBounds.height) / 2);
    window.setBounds({
      x: Math.max(workArea.x, Math.min(centeredX, workArea.x + workArea.width - nextBounds.width)),
      y: Math.max(workArea.y, Math.min(centeredY, workArea.y + workArea.height - nextBounds.height)),
      ...nextBounds,
    });
    state.bounds = nextBounds;
  }
  void window.loadURL(dataUrl(executionPlanStickyHtml(state.payload)));
}

function stickyResizePoint(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function resizeStickyWindow(state, params = {}, finish = false) {
  const corner = /^(?:nw|ne|sw|se)$/.test(String(params.corner || "")) ? String(params.corner) : "";
  const sessionId = String(params.sessionId || "").slice(0, 120);
  const startPoint = stickyResizePoint(params.startPoint);
  const point = stickyResizePoint(params.point);
  if (!corner || !sessionId || !startPoint || !point) return { ok: false };
  if (!state.resize || state.resize.sessionId !== sessionId || state.resize.corner !== corner) {
    const startBounds = state.window.getBounds();
    state.resize = {
      sessionId,
      corner,
      startBounds,
      startPoint,
      workArea: screen.getDisplayMatching(startBounds).workArea,
    };
  }
  const nextBounds = executionPlanStickyResizedBounds({
    ...state.resize,
    currentPoint: point,
  });
  state.autoSize = false;
  state.bounds = { width: nextBounds.width, height: nextBounds.height };
  state.window.setBounds(nextBounds);
  if (finish) state.resize = null;
  return { ok: true };
}

function resizeStickyWindowFromSender(sender, params, finish = false) {
  const window = BrowserWindow.fromWebContents(sender);
  const state = window ? stickyWindows.get(window) : null;
  if (!state || window.isDestroyed()) return { ok: false };
  return resizeStickyWindow(state, params, finish);
}

function moveStickyWindow(state, params = {}, finish = false) {
  const sessionId = String(params.sessionId || "").slice(0, 120);
  const startPoint = stickyResizePoint(params.startPoint);
  const point = stickyResizePoint(params.point);
  if (!sessionId || !startPoint || !point) return { ok: false };
  if (!state.move || state.move.sessionId !== sessionId) {
    const startBounds = state.window.getBounds();
    state.move = {
      sessionId,
      startBounds,
      startPoint,
      workArea: screen.getDisplayNearestPoint(startPoint).workArea,
    };
  }
  const nextBounds = executionPlanStickyMovedBounds({
    ...state.move,
    currentPoint: point,
  });
  state.window.setBounds(nextBounds);
  if (finish) state.move = null;
  return { ok: true };
}

function moveStickyWindowFromSender(sender, params, finish = false) {
  const window = BrowserWindow.fromWebContents(sender);
  const state = window ? stickyWindows.get(window) : null;
  if (!state || window.isDestroyed()) return { ok: false };
  return moveStickyWindow(state, params, finish);
}

ipcMain.on("executionPlanSticky:move-live", (event, params = {}) => {
  moveStickyWindowFromSender(event.sender, params);
});

ipcMain.on("executionPlanSticky:move-commit", (event, params = {}) => {
  moveStickyWindowFromSender(event.sender, params, true);
});

ipcMain.on("executionPlanSticky:resize-live", (event, params = {}) => {
  resizeStickyWindowFromSender(event.sender, params);
});

ipcMain.on("executionPlanSticky:resize-commit", (event, params = {}) => {
  resizeStickyWindowFromSender(event.sender, params, true);
});

function zoomExecutionPlanStickyGroup(sourceState, delta) {
  const nextFontSize = executionPlanStickyFontSize(sourceState.payload.fontSize, delta);
  for (const state of stickyWindows.values()) {
    if (sourceState.payload.groupId && state.payload.groupId !== sourceState.payload.groupId) continue;
    if (!sourceState.payload.groupId && state !== sourceState) continue;
    state.payload = { ...state.payload, fontSize: nextFontSize };
    renderStickyWindow(state);
  }
}

export function createExecutionPlanStickyWindow(input = {}) {
  const payload = normalizeExecutionPlanStickyPayload(input);
  const bounds = executionPlanStickyBounds(payload);
  const position = stickyWindowPosition(bounds);
  const window = new BrowserWindow({
    ...bounds,
    ...position,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: EXECUTION_PLAN_STICKY_MIN_WIDTH,
    minHeight: EXECUTION_PLAN_STICKY_MIN_HEIGHT,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: STICKY_PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  });
  const state = {
    window,
    payload,
    bounds,
    autoSize: true,
    move: null,
    resize: null,
  };
  stickyWindows.set(window, state);
  window.removeMenu();
  window.setAlwaysOnTop(true, "screen-saver");

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (String(url || "").startsWith("data:text/html")) return;
    event.preventDefault();
    let action = "";
    try {
      const target = new URL(url);
      if (target.protocol === "haolo-execution-plan-sticky:") {
        action = target.hostname || target.pathname.replace(/^\/+/, "");
      }
    } catch {
      return;
    }
    if (action === "delete") {
      window.close();
      return;
    }
    if (action === "zoom-in" || action === "zoom-out") {
      zoomExecutionPlanStickyGroup(state, action === "zoom-in" ? 1 : -1);
      return;
    }
  });
  window.on("will-resize", (_event, nextBounds) => {
    state.autoSize = false;
    state.bounds = { width: nextBounds.width, height: nextBounds.height };
  });
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.showInactive();
  });
  window.on("closed", () => stickyWindows.delete(window));
  renderStickyWindow(state);
  return { ok: true, created: true };
}

export function closeExecutionPlanStickyWindows() {
  for (const window of stickyWindows.keys()) {
    if (!window.isDestroyed()) window.close();
  }
  stickyWindows.clear();
}
