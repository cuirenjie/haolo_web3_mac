import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const workflowCanvasSource = readFile(
  new URL("../src/renderer/workflow-canvas.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

test("the standalone discovery canvas page and legacy vertical navigation are removed", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);

  assert.doesNotMatch(source, /discovery.?canvas/i);
  assert.doesNotMatch(styles, /discovery.?canvas/i);
  assert.doesNotMatch(source, /HOME_ICON_URL\.skillsPlaza(?:Active)?/);
  assert.doesNotMatch(source, /renderAppSidebar|renderNavIcon|data-nav=/);
  assert.doesNotMatch(styles, /\.app-sidebar|\.nav-icon|\.nav-stack/);
});

test("the blank-canvas shortcut is removed while executed canvas editing, revision, and rendering stay available", async () => {
  const [source, canvas] = await Promise.all([rendererSource, workflowCanvasSource]);

  assert.doesNotMatch(source, /createBlankWorkflowCanvas|create-workflow-canvas|blankWorkflowCanvas|isBlankWorkflowCanvas/);
  assert.match(source, /function createWorkflowCanvasRevisionDraft\(/);
  assert.match(source, /async function updateWorkflowNodeRevisionDraft\(/);
  assert.match(source, /api\.createWorkflowRevisionDraft/);
  assert.match(source, /api\.applyWorkflowRevisionCommand/);
  assert.match(source, /api\.freezeWorkflowRevisionDraft/);
  assert.match(canvas, /export function renderWorkflowCanvas\(/);
  assert.match(canvas, /export function renderWorkflowNodeDialog\(/);
  assert.match(canvas, /export function insertWorkflowCanvasNode\(/);
  assert.match(canvas, /export function connectWorkflowCanvasEdge\(/);
  assert.match(canvas, /export function deleteWorkflowCanvasNode\(/);
});

test("the retained workflow canvas keeps complete light and dark interaction styling", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.workflow-node\s*\{[^}]*border:[^}]*background:[^}]*box-shadow:/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.workflow-node\s*\{[^}]*border-color:[^}]*background:[^}]*box-shadow:/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.workflow-node:hover:not\(:disabled\),\s*html\[data-theme="dark"\] \.workflow-node\.selected\s*\{[^}]*border-color:/s,
  );
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-edit-button\.primary/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-attachment-trigger:disabled/);
});
