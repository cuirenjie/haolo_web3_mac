import { readFileSync } from "node:fs";
import { executionPlanCardHeading, executionPlanCardBody } from "./execution-plan-card-view.mjs";
import {normalizeCloudReports, cloudPlanCard} from './cloud-plan-contract.mjs';

const cardStyles = readFileSync(new URL("./execution-plan-card.css", import.meta.url), "utf8");
// Measure intrinsic content width offscreen, including the header and controls.
// Long prose may wrap in the final note; it must not force a wide empty column.
export const EXECUTION_PLAN_STICKY_WIDTH_SCRIPT = `(() => {
  const probe = document.querySelector('.card').cloneNode(true);
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, { position: 'fixed', left: '-10000px', top: '0', width: 'max-content', maxWidth: 'none', height: 'auto', visibility: 'hidden', pointerEvents: 'none' });
  probe.querySelector('.execution-plan-details')?.remove();
  document.body.append(probe);
  try {
    const bodyStyle = getComputedStyle(document.body);
    return Math.ceil(probe.getBoundingClientRect().width + parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight));
  } finally { probe.remove(); }
})()`;
// Read-only measurement of our own template, shared with the visual fixture.
export const EXECUTION_PLAN_STICKY_HEIGHT_SCRIPT = `(() => {
  const content = document.querySelector('.content');
  const controls = document.querySelector('.controls');
  const last = content.querySelector('.execution-plan-card-content');
  const contentHeight = last.getBoundingClientRect().bottom - content.getBoundingClientRect().top + content.scrollTop;
  const card = document.querySelector('.card');
  const verticalInsets = (element) => {
    const style = getComputedStyle(element);
    return ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((total, key) => total + (parseFloat(style[key]) || 0), 0);
  };
  return Math.ceil(contentHeight + controls.offsetHeight + verticalInsets(document.body)
    + verticalInsets(card) + (parseFloat(getComputedStyle(card).rowGap) || 0));
})()`;
export const EXECUTION_PLAN_STICKY_FONT_SIZES = Object.freeze([11, 12, 13, 14, 16, 18, 20]);

const MAX_TITLE_LENGTH = 180;
const MAX_LINE_LABEL_LENGTH = 80;
const MAX_LINE_TEXT_LENGTH = 600;
const MAX_LINES = 24;
export const EXECUTION_PLAN_STICKY_MIN_WIDTH = 240;
export const EXECUTION_PLAN_STICKY_MIN_HEIGHT = 180;
const STICKY_UI_COPY = Object.freeze({
  en: Object.freeze({ lang: "en", defaultTitle: "Execution plan", controls: "Sticky-note controls", zoomIn: "Zoom in", zoomOut: "Zoom out", delete: "Delete" }),
  "zh-CN": Object.freeze({ lang: "zh-CN", defaultTitle: "执行计划", controls: "便利贴操作", zoomIn: "放大", zoomOut: "缩小", delete: "删除" }),
  "zh-TW": Object.freeze({ lang: "zh-TW", defaultTitle: "執行計畫", controls: "便利貼操作", zoomIn: "放大", zoomOut: "縮小", delete: "刪除" }),
});

function text(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function tone(value) {
  return value === "bullish" || value === "bearish" ? value : "";
}

function nearestFontSize(value) {
  if (value == null || String(value).trim() === "") return 12;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 12;
  return EXECUTION_PLAN_STICKY_FONT_SIZES.reduce((nearest, candidate) => (
    Math.abs(candidate - numeric) < Math.abs(nearest - numeric) ? candidate : nearest
  ), EXECUTION_PLAN_STICKY_FONT_SIZES[0]);
}

export function normalizeExecutionPlanStickyPayload(input = {}) {
  const cloudReport=input.cloudReport?normalizeCloudReports([input.cloudReport])[0]:null;
  const language = input.language === "en" || input.language === "zh-TW" ? input.language : "zh-CN";
  const lines = Array.isArray(input.lines)
    ? input.lines.slice(0, MAX_LINES).map((line = {}) => {
        const lineText = text(line.text, MAX_LINE_TEXT_LENGTH);
        const segments = Array.isArray(line.segments)
          ? line.segments.slice(0, 24)
              .map((segment = {}) => ({ text: text(segment.text, MAX_LINE_TEXT_LENGTH), tone: tone(segment.tone) }))
              .filter((segment) => segment.text)
          : [];
        return {
          label: text(line.label, MAX_LINE_LABEL_LENGTH),
          text: lineText,
          directionTone: tone(line.directionTone),
          segments: segments.length ? segments : [{ text: lineText, tone: "" }],
        };
      }).filter((line) => line.label || line.text)
    : [];
  return {
    ...(cloudReport?{cloudReport}:{}),
    groupId: text(input.groupId, 320),
    title: text(input.title, MAX_TITLE_LENGTH) || STICKY_UI_COPY[language].defaultTitle,
    theme: input.theme === "light" ? "light" : "dark",
    language,
    fontSize: nearestFontSize(input.fontSize),
    lines,
  };
}

export function executionPlanStickyFontSize(value, delta) {
  const current = nearestFontSize(value);
  const index = EXECUTION_PLAN_STICKY_FONT_SIZES.indexOf(current);
  const nextIndex = Math.max(0, Math.min(EXECUTION_PLAN_STICKY_FONT_SIZES.length - 1, index + Math.sign(Number(delta) || 0)));
  return EXECUTION_PLAN_STICKY_FONT_SIZES[nextIndex];
}

export function executionPlanStickyBounds(input = {}) {
  const payload = normalizeExecutionPlanStickyPayload(input);
  const width = Math.max(EXECUTION_PLAN_STICKY_MIN_WIDTH, Math.min(440, Math.round(300 + (payload.fontSize - 12) * 16)));
  const contentWidth = width - 40;
  const approximateCharactersPerLine = Math.max(12, Math.floor(contentWidth / (payload.fontSize * 0.95)));
  const visualLines = payload.lines.reduce((count, line) => (
    count + Math.max(1, Math.ceil((line.label.length + line.text.length) / approximateCharactersPerLine))
  ), 0);
  const titleLines = Math.max(1, Math.ceil(payload.title.length / Math.max(12, approximateCharactersPerLine - 3)));
  const height = Math.max(220, Math.min(640, Math.ceil(92 + titleLines * (payload.fontSize + 9) + visualLines * payload.fontSize * 1.76)));
  return { width, height };
}

function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function executionPlanStickyResizedBounds(input = {}) {
  const startBounds = input.startBounds || {};
  const startPoint = input.startPoint || {};
  const currentPoint = input.currentPoint || {};
  const workArea = input.workArea || {};
  const startX = finiteNumber(startBounds.x, 0);
  const startY = finiteNumber(startBounds.y, 0);
  const startWidth = Math.max(EXECUTION_PLAN_STICKY_MIN_WIDTH, finiteNumber(startBounds.width, EXECUTION_PLAN_STICKY_MIN_WIDTH));
  const startHeight = Math.max(EXECUTION_PLAN_STICKY_MIN_HEIGHT, finiteNumber(startBounds.height, EXECUTION_PLAN_STICKY_MIN_HEIGHT));
  const workX = finiteNumber(workArea.x, startX - 10_000);
  const workY = finiteNumber(workArea.y, startY - 10_000);
  const workRight = workX + Math.max(EXECUTION_PLAN_STICKY_MIN_WIDTH, finiteNumber(workArea.width, 20_000));
  const workBottom = workY + Math.max(EXECUTION_PLAN_STICKY_MIN_HEIGHT, finiteNumber(workArea.height, 20_000));
  const deltaX = finiteNumber(currentPoint.x, 0) - finiteNumber(startPoint.x, 0);
  const deltaY = finiteNumber(currentPoint.y, 0) - finiteNumber(startPoint.y, 0);
  const corner = /^(?:nw|ne|sw|se)$/.test(String(input.corner || "")) ? String(input.corner) : "se";
  const anchoredRight = startX + startWidth;
  const anchoredBottom = startY + startHeight;
  let x = startX;
  let y = startY;
  let right = anchoredRight;
  let bottom = anchoredBottom;

  if (corner.includes("w")) x = Math.max(workX, Math.min(startX + deltaX, anchoredRight - EXECUTION_PLAN_STICKY_MIN_WIDTH));
  else right = Math.min(workRight, Math.max(anchoredRight + deltaX, startX + EXECUTION_PLAN_STICKY_MIN_WIDTH));
  if (corner.includes("n")) y = Math.max(workY, Math.min(startY + deltaY, anchoredBottom - EXECUTION_PLAN_STICKY_MIN_HEIGHT));
  else bottom = Math.min(workBottom, Math.max(anchoredBottom + deltaY, startY + EXECUTION_PLAN_STICKY_MIN_HEIGHT));

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(right - x),
    height: Math.round(bottom - y),
  };
}

export function executionPlanStickyMovedBounds(input = {}) {
  const startBounds = input.startBounds || {};
  const startPoint = input.startPoint || {};
  const currentPoint = input.currentPoint || {};
  const workArea = input.workArea || {};
  const startX = finiteNumber(startBounds.x, 0);
  const startY = finiteNumber(startBounds.y, 0);
  const width = Math.max(EXECUTION_PLAN_STICKY_MIN_WIDTH, finiteNumber(startBounds.width, EXECUTION_PLAN_STICKY_MIN_WIDTH));
  const height = Math.max(EXECUTION_PLAN_STICKY_MIN_HEIGHT, finiteNumber(startBounds.height, EXECUTION_PLAN_STICKY_MIN_HEIGHT));
  const workX = finiteNumber(workArea.x, startX - 10_000);
  const workY = finiteNumber(workArea.y, startY - 10_000);
  const workRight = workX + Math.max(width, finiteNumber(workArea.width, 20_000));
  const workBottom = workY + Math.max(height, finiteNumber(workArea.height, 20_000));
  const deltaX = finiteNumber(currentPoint.x, 0) - finiteNumber(startPoint.x, 0);
  const deltaY = finiteNumber(currentPoint.y, 0) - finiteNumber(startPoint.y, 0);
  return {
    x: Math.round(Math.max(workX, Math.min(startX + deltaX, workRight - width))),
    y: Math.round(Math.max(workY, Math.min(startY + deltaY, workBottom - height))),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function actionLink(action, label, disabled) {
  if (disabled) return `<span class="sticky-action disabled" aria-disabled="true">${label}</span>`;
  return `<a class="sticky-action" href="haolo-execution-plan-sticky://${action}" role="button">${label}</a>`;
}

export function executionPlanStickyHtml(input = {}) {
  const payload = normalizeExecutionPlanStickyPayload(input);
  const cloudCard=payload.cloudReport?.executionPolicy!=='right-legacy-v1'&&payload.cloudReport?cloudPlanCard(payload.cloudReport):null;
  const copy = STICKY_UI_COPY[payload.language];
  const minFont = EXECUTION_PLAN_STICKY_FONT_SIZES[0];
  const maxFont = EXECUTION_PLAN_STICKY_FONT_SIZES.at(-1);
  const lines = cloudCard?.html||executionPlanCardBody(payload.lines, payload.language);
  return `<!doctype html>
<html lang="${copy.lang}" data-theme="${payload.theme}" data-execution-plan-sticky>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-haolo-sticky-resize';" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif; }
    body { padding: 8px; }
    .card { position: relative; display: flex; width: 100%; height: 100%; flex-direction: column; gap: 0; overflow: hidden; border: 1px solid var(--plan-line); border-radius: 16px; background: var(--plan-bg); color: var(--plan-text); padding: 16px 16px 10px; cursor: grab; -webkit-app-region: no-drag; user-select: none; --plan-font-size: ${payload.fontSize}px; }
    .card.dragging { cursor: grabbing; }
    .content { flex: 1; min-height: 0; overflow: auto; scrollbar-color: color-mix(in srgb, var(--plan-muted) 42%, transparent) transparent; scrollbar-width: thin; }
    .content > .execution-plan-heading { margin-bottom: 14px; }
    .controls { position: relative; z-index: 5; display: flex; flex-wrap: wrap; justify-content: flex-end; align-self: flex-end; flex-shrink: 0; gap: 6px; border-radius: 7px; background: var(--plan-bg); padding: 0; opacity: 1; pointer-events: auto; transform: none; -webkit-app-region: no-drag; }
    .sticky-action { display: grid; min-width: 34px; height: 24px; place-items: center; border-radius: 5px; padding: 0 6px; color: var(--plan-muted); font-size: 10px; font-weight: 500; line-height: 1; text-decoration: none; cursor: pointer; -webkit-app-region: no-drag; }
    .sticky-action:hover { background: var(--plan-hover); color: var(--plan-text); }
    .sticky-action:active { background: var(--plan-active); transform: translateY(1px); }
    .sticky-action:focus-visible { outline: 2px solid var(--plan-focus); outline-offset: 0; color: var(--plan-text); }
    .sticky-action.disabled { color: var(--plan-muted); cursor: not-allowed; opacity: .38; }
    .resize-handle { position: fixed; z-index: 6; display: grid; width: 28px; height: 28px; place-items: center; border: 0; color: var(--plan-muted); background: none; opacity: 0; pointer-events: auto; transition: opacity 120ms ease, color 120ms ease; -webkit-app-region: no-drag; touch-action: none; }
    .resize-handle::before { display: block; font: 18px/1 "Segoe UI Symbol", "Segoe UI", sans-serif; transition: transform 90ms ease; }
    .resize-handle.nw { top: 0; left: 0; cursor: nwse-resize; }
    .resize-handle.ne { top: 0; right: 0; cursor: nesw-resize; }
    .resize-handle.sw { bottom: 0; left: 0; cursor: nesw-resize; }
    .resize-handle.se { right: 0; bottom: 0; cursor: nwse-resize; }
    .resize-handle:is(.nw, .se)::before { content: "⤡"; }
    .resize-handle:is(.ne, .sw)::before { content: "⤢"; }
    .resize-handle:hover, .resize-handle.active { color: var(--plan-text); opacity: 1; }
    .resize-handle.active::before { transform: scale(.9); }
    @media (prefers-reduced-motion: reduce) { .controls, .sticky-action, .resize-handle { transition: none; } }
    ${cardStyles}
  </style>
</head>
<body>
  <article class="card execution-plan-surface" aria-label="${escapeHtml(payload.title)}">
    <div class="content">
      ${cloudCard?'':executionPlanCardHeading(payload.title, payload.lines, payload.language)}
      <div class="execution-plan-card-content">${lines}</div>
    </div>
    <nav class="controls" aria-label="${copy.controls}">
      ${actionLink("zoom-in", copy.zoomIn, payload.fontSize >= maxFont)}
      ${actionLink("zoom-out", copy.zoomOut, payload.fontSize <= minFont)}
      ${actionLink("delete", copy.delete, false)}
    </nav>
  </article>
  <span class="resize-handle nw" data-resize-corner="nw" aria-hidden="true"></span>
  <span class="resize-handle ne" data-resize-corner="ne" aria-hidden="true"></span>
  <span class="resize-handle sw" data-resize-corner="sw" aria-hidden="true"></span>
  <span class="resize-handle se" data-resize-corner="se" aria-hidden="true"></span>
  <script nonce="haolo-sticky-resize">
    (() => {
      const card = document.querySelector(".card");
      if (!card) return;
      let wheelDistance = 0;
      let wheelResetTimer = 0;
      // This document belongs to one note, including its corner resize handles.
      document.addEventListener("wheel", (event) => {
        const deltaY = Number(event.deltaY);
        if (!Number.isFinite(deltaY) || deltaY === 0) return;
        event.preventDefault();
        const deltaScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(window.innerHeight, 1) : 1;
        wheelDistance += deltaY * deltaScale;
        if (wheelResetTimer) clearTimeout(wheelResetTimer);
        wheelResetTimer = setTimeout(() => { wheelDistance = 0; }, 180);
        if (Math.abs(wheelDistance) < 18) return;
        const action = wheelDistance < 0 ? "zoom-in" : "zoom-out";
        wheelDistance = 0;
        document.querySelector('a[href="haolo-execution-plan-sticky://' + action + '"]')?.click();
      }, { passive: false });
      const resizeApi = window.haoloExecutionPlanSticky;
      if (!resizeApi) return;
      document.querySelectorAll("[data-resize-corner]").forEach((handle) => {
        let pointerId = null;
        let sessionId = "";
        let startPoint = null;
        let latestPoint = null;
        let animationFrame = 0;
        const payload = () => ({
          corner: handle.dataset.resizeCorner,
          sessionId,
          startPoint,
          point: latestPoint,
        });
        const sendMove = () => {
          animationFrame = 0;
          if (pointerId === null || !latestPoint) return;
          resizeApi.resizeLive(payload());
        };
        handle.addEventListener("pointerdown", (event) => {
          if (pointerId !== null) return;
          event.preventDefault();
          event.stopPropagation();
          pointerId = event.pointerId;
          sessionId = "sticky-resize-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
          startPoint = { x: event.screenX, y: event.screenY };
          latestPoint = startPoint;
          handle.setPointerCapture(pointerId);
          handle.classList.add("active");
        });
        handle.addEventListener("pointermove", (event) => {
          if (event.pointerId !== pointerId) return;
          latestPoint = { x: event.screenX, y: event.screenY };
          if (!animationFrame) animationFrame = requestAnimationFrame(sendMove);
        });
        const finish = (event) => {
          if (pointerId === null || (event.pointerId != null && event.pointerId !== pointerId)) return;
          if (Number.isFinite(event.screenX) && Number.isFinite(event.screenY)) {
            latestPoint = { x: event.screenX, y: event.screenY };
          }
          if (animationFrame) cancelAnimationFrame(animationFrame);
          animationFrame = 0;
          if (latestPoint) resizeApi.resizeCommit(payload());
          if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
          handle.classList.remove("active");
          pointerId = null;
          sessionId = "";
          startPoint = null;
          latestPoint = null;
        };
        handle.addEventListener("pointerup", finish);
        handle.addEventListener("pointercancel", finish);
        handle.addEventListener("lostpointercapture", finish);
        window.addEventListener("pointerup", finish, true);
        window.addEventListener("pointercancel", finish, true);
        window.addEventListener("blur", finish);
      });
      if (!resizeApi.moveLive || !resizeApi.moveCommit) return;
      let movePointerId = null;
      let moveSessionId = "";
      let moveStartPoint = null;
      let latestMovePoint = null;
      let moveAnimationFrame = 0;
      const movePayload = () => ({
        sessionId: moveSessionId,
        startPoint: moveStartPoint,
        point: latestMovePoint,
      });
      const sendMove = () => {
        moveAnimationFrame = 0;
        if (movePointerId === null || !latestMovePoint) return;
        resizeApi.moveLive(movePayload());
      };
      card.addEventListener("pointerdown", (event) => {
        if (movePointerId !== null || event.button !== 0 || event.target.closest(".controls")) return;
        event.preventDefault();
        movePointerId = event.pointerId;
        moveSessionId = "sticky-move-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
        moveStartPoint = { x: event.screenX, y: event.screenY };
        latestMovePoint = moveStartPoint;
        card.setPointerCapture(movePointerId);
        card.classList.add("dragging");
      });
      card.addEventListener("pointermove", (event) => {
        if (event.pointerId !== movePointerId) return;
        latestMovePoint = { x: event.screenX, y: event.screenY };
        if (!moveAnimationFrame) moveAnimationFrame = requestAnimationFrame(sendMove);
      });
      const finishMove = (event) => {
        if (movePointerId === null || (event.pointerId != null && event.pointerId !== movePointerId)) return;
        if (Number.isFinite(event.screenX) && Number.isFinite(event.screenY)) {
          latestMovePoint = { x: event.screenX, y: event.screenY };
        }
        if (moveAnimationFrame) cancelAnimationFrame(moveAnimationFrame);
        moveAnimationFrame = 0;
        if (latestMovePoint) resizeApi.moveCommit(movePayload());
        if (card.hasPointerCapture(movePointerId)) card.releasePointerCapture(movePointerId);
        card.classList.remove("dragging");
        movePointerId = null;
        moveSessionId = "";
        moveStartPoint = null;
        latestMovePoint = null;
      };
      card.addEventListener("pointerup", finishMove);
      card.addEventListener("pointercancel", finishMove);
      card.addEventListener("lostpointercapture", finishMove);
      window.addEventListener("pointerup", finishMove, true);
      window.addEventListener("pointercancel", finishMove, true);
      window.addEventListener("blur", finishMove);
    })();
  </script>
</body>
</html>`;
}
