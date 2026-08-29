import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("every scrollable system dashboard renders and binds the jump-to-bottom control", async () => {
  const source = await rendererSource;
  const agentPanel = sourceBlock(
    source,
    "function renderAgentPanel",
    "function renderComposerThreadMentionSearch",
  );
  const subagentBoard = sourceBlock(
    source,
    "function renderSubagentOutputBoard",
    "function selectedPanelSubagent",
  );
  const questionAnswerBoard = sourceBlock(
    source,
    "function renderQuestionAnswerProgressBoard",
    "function questionAnswerProgressStepStatusLabel",
  );
  const bindings = sourceBlock(
    source,
    "function bindAgentPanelEvents",
    "function selectSubagentPanelTab",
  );

  assert.match(
    agentPanel,
    /renderWorkflowScrollArea\(\s*`<section class="workflow">\$\{task \? renderTaskTimeline\(task\) : renderWorkflowEmpty\(\)\}<\/section>`/,
  );
  assert.match(subagentBoard, /class="workflow-scroll-area subagent-output-area"/);
  assert.match(subagentBoard, /renderWorkflowScrollBottomButton\(\)/);
  assert.match(questionAnswerBoard, /class="workflow-scroll-area question-answer-workflow-area"/);
  assert.match(questionAnswerBoard, /renderWorkflowScrollBottomButton\(\)/);
  assert.match(source, /data-action="scroll-workflow-bottom"/);
  assert.match(source, /aria-hidden="true" tabindex="-1"/);
  assert.match(bindings, /querySelector<HTMLElement>\("\.workflow-scroll-area > \.workflow"\)/);
  assert.match(bindings, /updateWorkflowScrollBottomButton\(workflowScroller\)/);
  assert.match(bindings, /scrollWorkflowToBottom\(scroller, \{ smooth: true \}\)/);
});

test("system dashboard jump-to-bottom control covers light and dark interaction states", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.workflow-scroll-area\s*\{[^}]*position:\s*relative;[^}]*display:\s*flex;[^}]*min-height:\s*0;[^}]*flex:\s*1;/s,
  );
  assert.match(styles, /\.message-scroll-bottom-button:hover:not\(:disabled\):not\(\.hidden\)/);
  assert.match(styles, /\.message-scroll-bottom-button:active:not\(:disabled\):not\(\.hidden\)/);
  assert.match(styles, /\.message-scroll-bottom-button:focus-visible\s*\{[^}]*outline:\s*2px solid/s);
  assert.match(styles, /\.message-scroll-bottom-button:disabled\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:\s*0\.42;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.message-scroll-bottom-button\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-scroll-bottom-button:hover:not\(:disabled\):not\(\.hidden\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-scroll-bottom-button:active:not\(:disabled\):not\(\.hidden\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-scroll-bottom-button:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-scroll-bottom-button:disabled/);
  assert.match(styles, /\.agent-panel \.workflow-scroll-bottom-button\s*\{[^}]*--window-resize-hit-zone/s);
});
