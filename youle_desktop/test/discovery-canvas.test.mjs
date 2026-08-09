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

test("the standalone discovery canvas page and planet navigation entry are removed", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);

  assert.doesNotMatch(source, /discovery.?canvas/i);
  assert.doesNotMatch(styles, /discovery.?canvas/i);
  assert.doesNotMatch(source, /HOME_ICON_URL\.skillsPlaza(?:Active)?/);
  assert.match(source, /renderNavIcon\("chat", "消息"/);
  assert.match(source, /renderNavIcon\("contacts", "通讯录"/);
  assert.match(source, /renderNavIcon\("results", "成果库"/);
});

test("canvas creation, editing, revision, and rendering workflows stay available", async () => {
  const [source, canvas] = await Promise.all([rendererSource, workflowCanvasSource]);

  assert.match(source, /async function createBlankWorkflowCanvas\(\)/);
  assert.match(source, /data-action="create-workflow-canvas"/);
  assert.match(
    source,
    /querySelector<HTMLButtonElement>\('\[data-action="create-workflow-canvas"\]'\)[\s\S]*createBlankWorkflowCanvas\(\)/,
  );
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
