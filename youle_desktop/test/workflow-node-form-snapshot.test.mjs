import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadWorkflowNodeFormSnapshotModule() {
  const source = await readFile(
    new URL("../src/renderer/workflow-node-form-snapshot.ts", import.meta.url),
    "utf8",
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`
  );
}

function fakeWorkflowNodeForm({
  threadId = "thread-1",
  nodeId = "node-1",
  inputDefinition = "",
  taskDefinition = "",
  outputDefinition = "",
  executor = "external_model|openai|gpt-5.6-sol",
  dialogScrollTop = 0,
} = {}) {
  const ownerDocument = { activeElement: null };
  const createControl = (value) => ({
    value,
    defaultValue: value,
    disabled: false,
    readOnly: false,
    selectionStart: value.length,
    selectionEnd: value.length,
    scrollTop: 0,
    focus() {
      ownerDocument.activeElement = this;
    },
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  });
  const controls = {
    inputDefinition: createControl(inputDefinition),
    taskDefinition: createControl(taskDefinition),
    outputDefinition: createControl(outputDefinition),
    executor: {
      ...createControl(executor),
      options: [{ value: executor, defaultSelected: true }],
    },
  };
  const dialogBody = { scrollTop: dialogScrollTop };
  const form = {
    dataset: { workflowThreadId: threadId, workflowNodeId: nodeId },
    elements: {
      namedItem(name) {
        return controls[name] || null;
      },
    },
    ownerDocument,
    querySelector(selector) {
      return selector === ".workflow-node-dialog-body" ? dialogBody : null;
    },
  };
  return { form, controls, dialogBody, ownerDocument };
}

const snapshotModule = loadWorkflowNodeFormSnapshotModule();

test("workflow node prompt values survive an asynchronous full-render replacement", async () => {
  const {
    captureWorkflowNodeFormSnapshot,
    restoreWorkflowNodeFormFocus,
    restoreWorkflowNodeFormSnapshot,
  } = await snapshotModule;
  const beforeRender = fakeWorkflowNodeForm({
    inputDefinition: "两张图、一个视频、一个 Word 文档",
    taskDefinition: "比较输入材料并生成总结",
    outputDefinition: "一份 Markdown 报告",
    executor: "external_model|openai|gpt-5.6-sol",
    dialogScrollTop: 128,
  });
  beforeRender.controls.taskDefinition.selectionStart = 4;
  beforeRender.controls.taskDefinition.selectionEnd = 9;
  beforeRender.controls.taskDefinition.scrollTop = 32;
  beforeRender.ownerDocument.activeElement =
    beforeRender.controls.taskDefinition;

  const snapshot = captureWorkflowNodeFormSnapshot(beforeRender.form);
  const afterRender = fakeWorkflowNodeForm({
    inputDefinition: "",
    taskDefinition: "",
    outputDefinition: "",
    executor: "external_model|deepseek|deepseek-v4-pro",
  });

  assert.equal(
    restoreWorkflowNodeFormSnapshot(afterRender.form, snapshot),
    true,
  );
  assert.equal(
    afterRender.controls.inputDefinition.value,
    "两张图、一个视频、一个 Word 文档",
  );
  assert.equal(
    afterRender.controls.taskDefinition.value,
    "比较输入材料并生成总结",
  );
  assert.equal(
    afterRender.controls.outputDefinition.value,
    "一份 Markdown 报告",
  );
  assert.equal(
    afterRender.controls.executor.value,
    "external_model|openai|gpt-5.6-sol",
  );
  assert.equal(afterRender.dialogBody.scrollTop, 128);

  assert.equal(restoreWorkflowNodeFormFocus(afterRender.form, snapshot), true);
  assert.equal(
    afterRender.ownerDocument.activeElement,
    afterRender.controls.taskDefinition,
  );
  assert.equal(afterRender.controls.taskDefinition.selectionStart, 4);
  assert.equal(afterRender.controls.taskDefinition.selectionEnd, 9);
  assert.equal(afterRender.controls.taskDefinition.scrollTop, 32);
});

test("workflow node form snapshots never leak into a different node", async () => {
  const { captureWorkflowNodeFormSnapshot, restoreWorkflowNodeFormSnapshot } =
    await snapshotModule;
  const source = fakeWorkflowNodeForm({ inputDefinition: "私有草稿" });
  const snapshot = captureWorkflowNodeFormSnapshot(source.form);
  const otherNode = fakeWorkflowNodeForm({
    nodeId: "node-2",
    inputDefinition: "另一个节点",
  });

  assert.equal(
    restoreWorkflowNodeFormSnapshot(otherNode.form, snapshot),
    false,
  );
  assert.equal(otherNode.controls.inputDefinition.value, "另一个节点");
});

test("workflow node forms detect whether editable values changed", async () => {
  const { workflowNodeFormMatchesInitialValues } = await snapshotModule;
  const unchanged = fakeWorkflowNodeForm({
    inputDefinition: "一张待处理图片",
    taskDefinition: "把图片处理成蓝色风格",
    outputDefinition: "处理后的图片",
  });

  assert.equal(workflowNodeFormMatchesInitialValues(unchanged.form), true);

  unchanged.controls.taskDefinition.value = "把图片处理成红色风格";
  assert.equal(workflowNodeFormMatchesInitialValues(unchanged.form), false);

  unchanged.controls.taskDefinition.value = unchanged.controls.taskDefinition.defaultValue;
  unchanged.controls.executor.value = "codex_subagent|openai|gpt-5.6-sol";
  assert.equal(workflowNodeFormMatchesInitialValues(unchanged.form), false);

  unchanged.controls.executor.value = unchanged.controls.executor.options[0].value;
  assert.equal(workflowNodeFormMatchesInitialValues(unchanged.form), true);
});

test("renderer restores node drafts around full renders", async () => {
  const source = await readFile(
    new URL("../src/renderer/main.ts", import.meta.url),
    "utf8",
  );
  const captureIndex = source.indexOf(
    "captureActiveWorkflowNodeFormSnapshot();",
  );
  const rootReplacementIndex = source.indexOf(
    "root.innerHTML = `",
    captureIndex,
  );
  const restoreIndex = source.indexOf(
    "restoreActiveWorkflowNodeFormSnapshot(workflowNodeFormSnapshot);",
    rootReplacementIndex,
  );
  const bindIndex = source.indexOf("bindEvents();", restoreIndex);

  assert.ok(captureIndex >= 0);
  assert.ok(rootReplacementIndex > captureIndex);
  assert.ok(restoreIndex > rootReplacementIndex);
  assert.ok(bindIndex > restoreIndex);
  assert.match(
    source,
    /restoreActiveWorkflowNodeFormFocus\(workflowNodeFormSnapshot\);/,
  );
  assert.match(source, /syncWorkflowNodeEditorAvatar\(form, selectedOption\);/);
  assert.doesNotMatch(source, /reset-workflow-node-draft|skipWorkflowNodeFormSnapshotOnNextRender/);
});
