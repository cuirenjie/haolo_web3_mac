import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkflowRunStore } from "../src/main/workflow/run-store.mjs";
import {
  compileWorkflowNodeContractPayload,
  hydrateNestedWorkflowNodeContracts,
  nestedWorkflowConnectionIssues,
  reconcileWorkflowNodeContracts,
  validateWorkflowInvocationValues,
  workflowInvocationContract,
  workflowNestedBoundaryContract,
} from "../src/main/workflow/node-contract.mjs";
import {
  applyWorkflowDraftCommand,
  freezeWorkflowDraft,
  validateWorkflowDraft,
  validateWorkflowInvocation,
  workflowDraftFromRun,
  workflowExecutionScope,
  WorkflowDraftConflictError,
} from "../src/main/workflow/workflow-spec.mjs";

function modelNode(id, dependsOn = []) {
  return {
    id,
    kind: "model",
    title: id,
    purpose: `完成 ${id}`,
    prompt: `执行 ${id}`,
    dependsOn,
    acceptance: [`${id} 输出完整`],
  };
}

function editableDraft(overrides = {}) {
  return {
    id: "draft_test",
    workflowKey: "workflow_test",
    threadId: "thread_test",
    revision: 0,
    nodes: [
      modelNode("a"),
      modelNode("b", ["a"]),
      modelNode("c", ["b"]),
    ],
    entryBindings: [{ source: "workflow_input", targetNodeId: "a" }],
    ...overrides,
  };
}

test("historical runs migrate into editable drafts without runtime-only nodes", () => {
  const draft = workflowDraftFromRun({
    id: "run_legacy",
    threadId: "thread_legacy",
    status: "succeeded",
    nodes: [
      { id: "root-plan", kind: "system", prompt: "plan" },
      { id: "review", kind: "model", title: "评审", purpose: "给出评审意见", prompt: "评审", dependsOn: ["root-plan"], acceptance: ["给出评审意见"] },
      { id: "root-acceptance", kind: "system", prompt: "终验" },
    ],
  });

  assert.deepEqual(draft.nodes.map((node) => node.id), ["review"]);
  assert.deepEqual(draft.nodes[0].dependsOn, []);
  assert.deepEqual(draft.nodes[0].outputContract.requirements, []);
  assert.equal(draft.nodes[0].acceptance.length, 0);
  assert.match(draft.nodes[0].prompt, /评审[\s\S]*输出要求：[\s\S]*给出评审意见/);
  assert.deepEqual(draft.entryBindings.map((entry) => entry.targetNodeId), ["review"]);
  assert.equal(validateWorkflowDraft(draft).valid, true);
});

test("draft commands are optimistic, idempotent, and do not bypass deleted nodes by default", () => {
  const draft = editableDraft();
  const deleted = applyWorkflowDraftCommand(draft, {
    commandId: "delete-b",
    baseRevision: 0,
    type: "delete_node",
    payload: { nodeId: "b" },
  });
  assert.deepEqual(deleted.nodes.map((node) => node.id), ["a", "c"]);
  assert.deepEqual(deleted.nodes.find((node) => node.id === "c").dependsOn, []);
  assert.equal(deleted.revision, 1);

  const repeated = applyWorkflowDraftCommand(deleted, {
    commandId: "delete-b",
    baseRevision: 1,
    type: "delete_node",
    payload: { nodeId: "b" },
  });
  assert.deepEqual(repeated, deleted);

  assert.throws(
    () => applyWorkflowDraftCommand(deleted, {
      type: "update_node",
      baseRevision: 0,
      payload: { nodeId: "a", patch: { prompt: "new" } },
    }),
    WorkflowDraftConflictError,
  );
});

test("multiple composer entries expose cut-boundary inputs and reject historical side inputs", () => {
  const draft = editableDraft({
    nodes: [
      modelNode("a"),
      modelNode("b"),
      modelNode("merge", ["a", "b"]),
      modelNode("finish", ["merge"]),
    ],
    entryBindings: [
      { source: "workflow_input", targetNodeId: "a" },
      { source: "workflow_input", targetNodeId: "b" },
    ],
  });
  const scope = workflowExecutionScope(draft);
  assert.deepEqual(new Set(scope.scopeNodeIds), new Set(["a", "b", "merge", "finish"]));
  assert.deepEqual(scope.sinkNodeIds, ["finish"]);
  assert.deepEqual(scope.boundaryInputs, []);

  const spec = freezeWorkflowDraft(draft, { id: "spec_scope", version: 1 });
  const partial = validateWorkflowInvocation(spec, { entryNodeIds: ["a"] });
  assert.equal(partial.valid, false);
  assert.deepEqual(partial.scope.boundaryInputs, [{ sourceNodeId: "b", targetNodeId: "merge" }]);
  assert.ok(partial.errors.some((error) => error.code === "WORKFLOW_BOUNDARY_INPUT_REQUIRED"));

  const historicalSideInput = validateWorkflowInvocation(spec, {
    entryNodeIds: ["a"],
    pinnedBoundaryInputs: [{ sourceNodeId: "b", targetNodeId: "merge" }],
    resolveRun: () => null,
  });
  assert.equal(historicalSideInput.valid, false);
  assert.ok(historicalSideInput.errors.some((error) => error.code === "WORKFLOW_BOUNDARY_INPUT_REQUIRED"));
  assert.equal(Object.hasOwn(historicalSideInput, "pinnedBoundaryInputs"), false);
});

test("parallel entry slots share by default and split only explicit resource differences", () => {
  const imageA = compileWorkflowNodeContractPayload({
    task: "分析产品图",
    inputSlots: [{ type: "image", semanticName: "产品图" }],
    outputSlots: [{ type: "text", semanticName: "分析 A" }],
  }, { nodeId: "a" });
  const imageB = compileWorkflowNodeContractPayload({
    task: "分析品牌图",
    inputSlots: [{
      type: "image",
      semanticName: "品牌图",
      distinctResourceKey: "brand-image-is-different-from-product-image",
    }],
    outputSlots: [{ type: "text", semanticName: "分析 B" }],
  }, { nodeId: "b" });
  const distinct = workflowInvocationContract({
    nodes: [
      { id: "a", displayCode: "A", nodeContract: imageA },
      { id: "b", displayCode: "B", nodeContract: imageB },
    ],
    entryBindings: [
      { source: "workflow_input", targetNodeId: "a" },
      { source: "workflow_input", targetNodeId: "b" },
    ],
  });
  assert.equal(distinct.slots.length, 2);
  assert.notEqual(distinct.slots[0].slotId, distinct.slots[1].slotId);
  assert.deepEqual(distinct.slots.map((slot) => slot.semanticName), ["产品图", "品牌图"]);

  const defaultSharedA = compileWorkflowNodeContractPayload({
    task: "处理同一组运行输入",
    inputSlots: [
      { type: "text", semanticName: "提示词" },
      { type: "file", semanticName: "参考文件", accept: [".pdf"] },
      { type: "image", semanticName: "参考图片", accept: ["image/*"] },
      { type: "video", semanticName: "参考视频", accept: ["video/*"] },
    ],
    outputSlots: [{ type: "text", semanticName: "结果 A" }],
  }, { nodeId: "default-shared-a" });
  const defaultSharedB = compileWorkflowNodeContractPayload({
    task: "复核同一组运行输入",
    inputSlots: [
      { type: "text", semanticName: "提示词" },
      { type: "file", semanticName: "参考文件", accept: [".pdf"] },
      { type: "image", semanticName: "参考图片", accept: ["image/*"] },
      { type: "video", semanticName: "参考视频", accept: ["video/*"] },
    ],
    outputSlots: [{ type: "text", semanticName: "结果 B" }],
  }, { nodeId: "default-shared-b" });
  const defaultShared = workflowInvocationContract({
    nodes: [
      { id: "default-shared-a", displayCode: "A", nodeContract: defaultSharedA },
      { id: "default-shared-b", displayCode: "B", nodeContract: defaultSharedB },
    ],
    entryBindings: [
      { source: "workflow_input", targetNodeId: "default-shared-a" },
      { source: "workflow_input", targetNodeId: "default-shared-b" },
    ],
  });
  assert.deepEqual(
    defaultShared.slots.map((slot) => slot.semanticName),
    ["提示词", "参考文件", "参考图片", "参考视频"],
  );
  assert.deepEqual(
    defaultShared.slots.map((slot) => slot.targetNodeIds),
    Array.from({ length: 4 }, () => ["default-shared-a", "default-shared-b"]),
  );

  const sharedA = compileWorkflowNodeContractPayload({
    task: "分析构图",
    inputSlots: [{ type: "image", semanticName: "共用参考图", sharedResourceKey: "hero-image" }],
    outputSlots: [{ type: "text", semanticName: "构图分析" }],
  }, { nodeId: "shared-a" });
  const sharedB = compileWorkflowNodeContractPayload({
    task: "分析色彩",
    inputSlots: [{ type: "image", semanticName: "共用参考图", sharedResourceKey: "hero-image" }],
    outputSlots: [{ type: "text", semanticName: "色彩分析" }],
  }, { nodeId: "shared-b" });
  const shared = workflowInvocationContract({
    nodes: [
      { id: "shared-a", displayCode: "A", nodeContract: sharedA },
      { id: "shared-b", displayCode: "B", nodeContract: sharedB },
    ],
    entryBindings: [
      { source: "workflow_input", targetNodeId: "shared-a" },
      { source: "workflow_input", targetNodeId: "shared-b" },
    ],
  });
  assert.equal(shared.slots.length, 1);
  assert.deepEqual(shared.slots[0].targetNodeIds, ["shared-a", "shared-b"]);

  const originalInputs = compileWorkflowNodeContractPayload({
    task: "根据提示词处理原始图片并更新 Word 文档",
    inputSlots: [
      { type: "image", semanticName: "原始图片", accept: ["image/*"] },
      { type: "text", semanticName: "提示词" },
      { type: "file", semanticName: "Word文档", accept: [".docx"] },
    ],
    outputSlots: [{ type: "file", semanticName: "处理后的Word文档", accept: [".docx"] }],
  }, { nodeId: "original-entry" });
  const semanticallySharedInputs = compileWorkflowNodeContractPayload({
    task: "复用共享图片和共享提示词，独立更新另一份 Word 文档",
    inputSlots: [
      { type: "image", semanticName: "共享图片", accept: ["image/*"], sharedResourceKey: "shared-image" },
      { type: "text", semanticName: "共享提示词", sharedResourceKey: "shared-prompt" },
      {
        type: "file",
        semanticName: "Word文档",
        accept: [".docx"],
        distinctResourceKey: "independent-word-copy",
      },
    ],
    outputSlots: [{ type: "file", semanticName: "新的Word文档", accept: [".docx"] }],
  }, { nodeId: "shared-entry" });
  const semanticallyDeduplicated = workflowInvocationContract({
    nodes: [
      { id: "original-entry", displayCode: "B", nodeContract: originalInputs },
      { id: "shared-entry", displayCode: "D", nodeContract: semanticallySharedInputs },
    ],
    entryBindings: [
      { source: "workflow_input", targetNodeId: "original-entry" },
      { source: "workflow_input", targetNodeId: "shared-entry" },
    ],
  });
  assert.deepEqual(
    semanticallyDeduplicated.slots.map((slot) => slot.semanticName),
    ["原始图片", "提示词", "Word文档", "Word文档"],
  );
  assert.deepEqual(
    semanticallyDeduplicated.slots.slice(0, 2).map((slot) => slot.targetNodeIds),
    [
      ["original-entry", "shared-entry"],
      ["original-entry", "shared-entry"],
    ],
  );
});

test("graph reconciliation derives downstream input while fixed attachments stay additive", () => {
  const sourceContract = compileWorkflowNodeContractPayload({
    task: "描述图片并保留原图",
    inputSlots: [{ type: "image", semanticName: "原图" }],
    outputSlots: [
      { type: "image", semanticName: "原图" },
      { type: "text", semanticName: "图片描述" },
    ],
    passThroughMappings: [{ inputIndex: 0, outputIndex: 0 }],
  }, { nodeId: "source" });
  const downstreamContract = compileWorkflowNodeContractPayload({
    task: "把描述写入文档",
    inputSlots: [{ type: "video", semanticName: "这项声明不得覆盖连线输入" }],
    outputSlots: [{ type: "file", semanticName: "处理后的文档", accept: [".txt"] }],
  }, { nodeId: "writer" });
  const nodes = reconcileWorkflowNodeContracts([
    {
      id: "source",
      displayCode: "A",
      dependsOn: [],
      prompt: "",
      nodeContract: sourceContract,
      attachmentRefs: [],
    },
    {
      id: "writer",
      displayCode: "B",
      dependsOn: ["source"],
      prompt: "",
      nodeContract: downstreamContract,
      attachmentRefs: [{ id: "guide", name: "写作规范.pdf", mime: "application/pdf" }],
    },
  ], {
    attachments: [{ id: "guide", name: "写作规范.pdf", mime: "application/pdf" }],
  });
  const source = nodes[0];
  const writer = nodes[1];
  assert.equal(source.nodeContract.outputContract.slots[0].passThroughFromSlotId,
    source.nodeContract.inputContract.slots[0].slotId);
  assert.equal(writer.nodeContract.inputContract.mode, "derived");
  assert.deepEqual(
    writer.nodeContract.inputContract.slots.map((slot) => slot.semanticName),
    ["原图", "图片描述", "写作规范.pdf"],
  );
  assert.deepEqual(writer.nodeContract.inputContract.slots[0].origin, {
    kind: "upstream",
    nodeId: "source",
    nodeCode: "A",
    slotId: source.nodeContract.outputContract.slots[0].slotId,
    attachmentId: null,
    attachmentName: null,
  });
  assert.match(writer.prompt, /原图（来自节点 A）/);
  assert.match(writer.prompt, /写作规范\.pdf（固定附件：写作规范\.pdf）/);

  const invocation = workflowInvocationContract({
    nodes,
    entryBindings: [{ source: "workflow_input", targetNodeId: "source" }],
  });
  assert.deepEqual(invocation.slots.map((slot) => slot.semanticName), ["原图"]);
});

test("nested canvases inherit immutable entry and sink contracts and reject incompatible neighbors", () => {
  const childContract = compileWorkflowNodeContractPayload({
    task: "根据提示词生成 Word 文档",
    inputSlots: [{ type: "text", semanticName: "提示词" }],
    outputSlots: [{ type: "file", semanticName: "Word文档", accept: [".docx"] }],
  }, { nodeId: "child-writer" });
  const child = {
    id: "spec_child_text_to_word",
    version: 1,
    graphHash: "child-text-to-word-hash",
    nodes: [{
      id: "child-writer",
      displayCode: "A",
      kind: "model",
      dependsOn: [],
      nodeContract: childContract,
    }],
    entryBindings: [{ source: "workflow_input", targetNodeId: "child-writer" }],
  };
  const boundary = workflowNestedBoundaryContract(child, { nodeId: "nested" });
  assert.equal(boundary.valid, true);
  assert.deepEqual(
    boundary.nodeContract.inputContract.slots.map((slot) => [slot.type, slot.semanticName]),
    [["text", "提示词"]],
  );
  assert.deepEqual(
    boundary.nodeContract.outputContract.slots.map((slot) => [slot.type, slot.semanticName, slot.accept]),
    [["file", "Word文档", [".docx"]]],
  );

  const textOutput = compileWorkflowNodeContractPayload({
    task: "生成提示词",
    inputSlots: [{ type: "text", semanticName: "请求" }],
    outputSlots: [{ type: "text", semanticName: "提示词" }],
  }, { nodeId: "source" });
  const wordInput = compileWorkflowNodeContractPayload({
    task: "读取 Word 文档",
    inputSlots: [{
      type: "file",
      semanticName: "Word文档",
      accept: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    }],
    outputSlots: [{ type: "text", semanticName: "正文" }],
  }, { nodeId: "target" });
  const tamperedNestedContract = compileWorkflowNodeContractPayload({
    task: "被父画布错误改写的契约",
    inputSlots: [{ type: "file", semanticName: "错误输入" }],
    outputSlots: [{ type: "text", semanticName: "错误输出" }],
  }, { nodeId: "nested" });
  const nodes = [
    { ...modelNode("source"), nodeContract: textOutput },
    {
      ...modelNode("nested", ["source"]),
      kind: "workflow",
      executorType: "nested_workflow",
      nodeContract: tamperedNestedContract,
      workflowRef: {
        specId: child.id,
        version: child.version,
        graphHash: child.graphHash,
      },
    },
    { ...modelNode("target", ["nested"]), nodeContract: wordInput },
  ];
  const hydrated = hydrateNestedWorkflowNodeContracts(nodes, {
    resolveSpec: (specId, version) => (
      specId === child.id && version === child.version ? child : null
    ),
  });
  assert.deepEqual(nestedWorkflowConnectionIssues(hydrated), []);
  assert.equal(
    hydrated.find((node) => node.id === "nested").nodeContract.outputContract.slots[0].type,
    "file",
  );
  assert.deepEqual(
    hydrated.find((node) => node.id === "nested").outputContract,
    { format: "artifact", requirements: [], requiredArtifactTypes: [".docx"] },
  );

  const updated = applyWorkflowDraftCommand(editableDraft({
    nodes,
    entryBindings: [{ source: "workflow_input", targetNodeId: "source" }],
  }), {
    baseRevision: 0,
    type: "replace_definition",
    payload: {
      nodes,
      entryBindings: [{ source: "workflow_input", targetNodeId: "source" }],
    },
  }, {
    resolveSpec: (specId, version) => (
      specId === child.id && version === child.version ? child : null
    ),
  });
  assert.equal(
    updated.nodes.find((node) => node.id === "nested").nodeContract.inputContract.mode,
    "declared",
  );

  const fileSource = compileWorkflowNodeContractPayload({
    task: "生成 PDF",
    inputSlots: [{ type: "text", semanticName: "请求" }],
    outputSlots: [{ type: "file", semanticName: "PDF", accept: [".pdf"] }],
  }, { nodeId: "source" });
  const invalidInputNodes = nodes.map((node) => (
    node.id === "source" ? { ...node, nodeContract: fileSource } : node
  ));
  assert.throws(
    () => applyWorkflowDraftCommand(editableDraft({
      nodes: invalidInputNodes,
      entryBindings: [{ source: "workflow_input", targetNodeId: "source" }],
    }), {
      baseRevision: 0,
      type: "replace_definition",
      payload: { nodes: invalidInputNodes, entryBindings: [] },
    }, {
      resolveSpec: () => child,
    }),
    (error) => error?.code === "WORKFLOW_NESTED_INPUT_CONTRACT_MISMATCH",
  );

  const textInput = compileWorkflowNodeContractPayload({
    task: "只读取文字",
    inputSlots: [{ type: "text", semanticName: "文字" }],
    outputSlots: [{ type: "text", semanticName: "结果" }],
  }, { nodeId: "target" });
  const invalidOutputNodes = nodes.map((node) => (
    node.id === "target" ? { ...node, nodeContract: textInput } : node
  ));
  assert.throws(
    () => applyWorkflowDraftCommand(editableDraft({
      nodes: invalidOutputNodes,
      entryBindings: [{ source: "workflow_input", targetNodeId: "source" }],
    }), {
      baseRevision: 0,
      type: "replace_definition",
      payload: { nodes: invalidOutputNodes, entryBindings: [] },
    }, {
      resolveSpec: () => child,
    }),
    (error) => error?.code === "WORKFLOW_NESTED_OUTPUT_CONTRACT_MISMATCH",
  );
});

test("invocation slot validation rejects missing, excessive, and unknown inputs deterministically", () => {
  const contract = {
    slots: [{ slotId: "image-slot", type: "image", semanticName: "产品图", minCount: 1, maxCount: 2 }],
  };
  assert.equal(validateWorkflowInvocationValues(contract, {}).valid, false);
  assert.equal(validateWorkflowInvocationValues(contract, {
    "image-slot": [{ id: 1 }, { id: 2 }, { id: 3 }],
  }).valid, false);
  const unknown = validateWorkflowInvocationValues(contract, {
    "image-slot": [{ id: 1 }],
    extra: [{ id: 2 }],
  });
  assert.equal(unknown.valid, false);
  assert.ok(unknown.errors.some((error) => error.code === "WORKFLOW_INPUT_SLOT_UNKNOWN"));
});

test("skill bindings require a real Haolo subagent executor", () => {
  const externalDraft = editableDraft({
    nodes: [{
      ...modelNode("skilled"),
      executorType: "external_model",
      skillBindings: [{ name: "Presentations", source: "prompt_mention" }],
    }],
    entryBindings: [{ source: "workflow_input", targetNodeId: "skilled" }],
  });
  const invalid = validateWorkflowDraft(externalDraft);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.code === "WORKFLOW_SKILL_REQUIRES_AGENT"));

  const agentDraft = {
    ...externalDraft,
    nodes: externalDraft.nodes.map((node) => ({
      ...node,
      kind: "agent",
      executorType: "codex_subagent",
    })),
  };
  assert.equal(validateWorkflowDraft(agentDraft).valid, true);
});

test("drafts, immutable specs, layouts, and runs persist independently", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-workflow-spec-store-"));
  const store = new WorkflowRunStore(path.join(root, "workflow.sqlite"));
  t.after(() => store.close());
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));

  const savedDraft = store.saveDraft(editableDraft());
  const spec = freezeWorkflowDraft(savedDraft, {
    id: "spec_saved",
    version: store.nextSpecVersion(savedDraft.workflowKey),
  });
  const savedSpec = store.saveSpec(spec);
  store.saveLayout("draft", savedDraft.id, { positions: { a: { x: 10, y: 20 } } });

  assert.equal(store.getDraft(savedDraft.id).revision, 0);
  assert.equal(store.latestDraftForThread(savedDraft.threadId).id, savedDraft.id);
  assert.equal(store.getSpec(savedSpec.id, savedSpec.version).graphHash, savedSpec.graphHash);
  assert.equal(store.latestSpecForThread(savedSpec.threadId).id, savedSpec.id);
  assert.deepEqual(store.listReusableSpecs().map((item) => item.id), [savedSpec.id]);
  assert.deepEqual(store.getLayout("draft", savedDraft.id), { positions: { a: { x: 10, y: 20 } } });
  assert.equal(store.nextSpecVersion(savedDraft.workflowKey), 2);

  const changed = {
    ...savedSpec,
    nodes: savedSpec.nodes.map((node) => node.id === "a" ? { ...node, prompt: "changed" } : node),
  };
  assert.throws(
    () => store.saveSpec(changed),
    (error) => error?.code === "WORKFLOW_SPEC_IMMUTABLE",
  );
});

test("draft definition and layout are committed atomically", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-workflow-atomic-draft-"));
  const store = new WorkflowRunStore(path.join(root, "workflow.sqlite"));
  t.after(() => store.close());
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));

  const original = store.saveDraft(editableDraft());
  store.saveLayout("draft", original.id, { positions: { a: { x: 10, y: 20 } } });
  const updated = {
    ...original,
    revision: 1,
    updatedAt: new Date(Date.now() + 1_000).toISOString(),
    nodes: original.nodes.map((node) => (
      node.id === "a" ? { ...node, prompt: "updated atomically" } : node
    )),
  };
  const originalSaveLayout = store.saveLayout.bind(store);
  store.saveLayout = () => {
    throw new Error("simulated layout write failure");
  };

  assert.throws(
    () => store.saveDraftWithLayout(updated, { positions: { a: { x: 30, y: 40 } } }),
    /simulated layout write failure/,
  );
  assert.equal(store.getDraft(original.id).revision, 0);
  assert.equal(
    store.getDraft(original.id).nodes.find((node) => node.id === "a").prompt,
    original.nodes.find((node) => node.id === "a").prompt,
  );
  assert.deepEqual(store.getLayout("draft", original.id), {
    positions: { a: { x: 10, y: 20 } },
  });

  store.saveLayout = originalSaveLayout;
  store.saveDraftWithLayout(updated, { positions: { a: { x: 30, y: 40 } } });
  assert.equal(store.getDraft(original.id).revision, 1);
  assert.equal(store.getDraft(original.id).nodes.find((node) => node.id === "a").prompt, "updated atomically");
  assert.deepEqual(store.getLayout("draft", original.id), {
    positions: { a: { x: 30, y: 40 } },
  });
});
