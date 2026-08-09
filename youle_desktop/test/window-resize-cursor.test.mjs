import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = await readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

test("window resize cursors are scoped to the edge handles", () => {
  assert.doesNotMatch(styles, /html\.window-resize-cursor-/);
  assert.match(
    styles,
    /\.window-resize-handle\.n[\s\S]*?cursor:\s*ns-resize\s*!important;/,
  );
  assert.match(
    styles,
    /\.window-resize-handle\.se[\s\S]*?cursor:\s*nwse-resize\s*!important;/,
  );
});

test("right-edge scrollbars take pointer priority over resize handles", () => {
  assert.match(
    styles,
    /#windowResizeRoot\.right-scrollbar-interaction \.window-resize-handle\.e,[\s\S]*?\.window-resize-handle\.ne,[\s\S]*?\.window-resize-handle\.se\s*{[^}]*pointer-events:\s*none;/,
  );
  assert.match(rendererSource, /function rightEdgeScrollbarAtPoint/);
  assert.match(
    rendererSource,
    /root\.querySelectorAll<HTMLElement>\("\*"\)[\s\S]*?supportsVisibleWindowScrollbar\(style\.overflowY\)/,
  );
  assert.doesNotMatch(
    rendererSource,
    /const selector = state\.rightCollapsed[\s\S]*?message-scroller/,
  );
  assert.match(rendererSource, /scroller\.scrollHeight <= scroller\.clientHeight \+ 1/);
  assert.match(rendererSource, /scroller\.offsetWidth - scroller\.clientWidth/);
  assert.match(rendererSource, /candidate\.direction === "rtl"/);
  assert.match(rendererSource, /classList\.toggle\(\s*"right-scrollbar-interaction"/);
  assert.match(rendererSource, /bindWindowResizeScrollbarPassthrough\(\);/);
});

test("bottom workflow scrollbar takes pointer priority over resize handles", () => {
  assert.match(
    styles,
    /#windowResizeRoot\.bottom-scrollbar-interaction \.window-resize-handle\.s,[\s\S]*?\.window-resize-handle\.se,[\s\S]*?\.window-resize-handle\.sw\s*{[^}]*pointer-events:\s*none;/,
  );
  assert.match(rendererSource, /function bottomEdgeScrollbarAtPoint/);
  assert.match(
    rendererSource,
    /supportsVisibleWindowScrollbar\(style\.overflowX\)/,
  );
  assert.match(
    rendererSource,
    /scroller\.scrollWidth <= scroller\.clientWidth \+ 1/,
  );
  assert.match(
    rendererSource,
    /scroller\.offsetHeight - scroller\.clientHeight/,
  );
  assert.match(
    rendererSource,
    /classList\.toggle\(\s*"bottom-scrollbar-interaction"/,
  );
});

test("all current and future scroll surfaces share one cached discovery path", () => {
  assert.match(rendererSource, /type WindowScrollbarCandidate =/);
  assert.match(rendererSource, /let windowScrollbarCandidatesDirty = true;/);
  assert.match(rendererSource, /function activeWindowScrollbarCandidates/);
  assert.match(rendererSource, /new MutationObserver\(\(\) => \{\s*windowScrollbarCandidatesDirty = true;/);
  assert.match(
    rendererSource,
    /attributeFilter: \["class", "hidden", "style"\],[\s\S]*?childList: true,[\s\S]*?subtree: true/,
  );
  assert.doesNotMatch(
    rendererSource,
    /rightEdgeScrollbarAtPoint[\s\S]*?library-preview-body/,
  );
});

test("pointerdown rechecks scrollbar priority before starting a resize", () => {
  assert.match(rendererSource, /function windowResizeEdgeOverlapsScrollbar/);
  assert.match(
    rendererSource,
    /if \(windowResizeEdgeOverlapsScrollbar\(edge, event\.clientX, event\.clientY\)\) \{\s*return;\s*\}\s*event\.preventDefault\(\);/,
  );
});

test("window resize always cleans up when pointer capture or focus is lost", () => {
  assert.match(
    rendererSource,
    /handle\.addEventListener\("lostpointercapture", finish\);/,
  );
  assert.match(
    rendererSource,
    /window\.addEventListener\("pointerup", finish, true\);/,
  );
  assert.match(
    rendererSource,
    /window\.addEventListener\("pointercancel", finish, true\);/,
  );
  assert.match(rendererSource, /window\.addEventListener\("blur", finish\);/);
  assert.match(rendererSource, /if \(finished\) return;\s*finished = true;/);
});
