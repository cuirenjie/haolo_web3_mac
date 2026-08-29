import assert from "node:assert/strict";
import test from "node:test";

import { ClusterWorkflowRuntime } from "../src/main/workflow/runtime.mjs";
import { normalizeExecutionResult } from "../src/main/workflow/protocol.mjs";
import {
  compileWorkflowNodeContractPayload,
  workflowInvocationContract,
} from "../src/main/workflow/node-contract.mjs";
import { freezeWorkflowDraft } from "../src/main/workflow/workflow-spec.mjs";

function definitionNode(id, dependsOn = [], overrides = {}) {
  return {
    id,
    kind: "model",
    executorType: "external_model",
    title: id,
    purpose: `execute ${id}`,
    provider: "claude",
    model: "test-model",
    prompt: `execute ${id}`,
    dependsOn,
    acceptance: [`${id} complete`],
    outputContract: { format: "text", requirements: [`${id} complete`] },
    ...overrides,
  };
}

function fullAccessCapabilityRequest() {
  return {
    permissionProfile: "full_access",
    capabilities: [
      "filesystem.read",
      "filesystem.create",
      "filesystem.update",
      "command.execute",
      "network.access",
    ],
    resourceScope: {
      workspace: "current_group",
      paths: [],
      uploads: [],
      network: ["haolo.pro"],
      applications: [],
    },
    actions: ["read", "create", "update", "execute"],
    sideEffectPolicy: "reversible",
    delegation: false,
    rationale: "生成媒体并更新文档",
  };
}

function frozenSpec(id, nodes, entryNodeIds, options = {}) {
  return freezeWorkflowDraft({
    id: `draft_${id}`,
    workflowKey: id,
    threadId: `source_${id}`,
    revision: 0,
    goalContract: { deliverable: `${id} deliverable` },
    finalAcceptancePrompt: `accept ${id}`,
    nodes,
    entryBindings: entryNodeIds.map((targetNodeId) => ({ source: "workflow_input", targetNodeId })),
  }, {
    id: `spec_${id}`,
    version: 1,
    resolveSpec: options.resolveSpec,
  });
}

function memoryStore(specs = []) {
  const specMap = new Map(specs.map((spec) => [`${spec.id}:${spec.version}`, structuredClone(spec)]));
  const runs = new Map();
  return {
    saveSpec(spec) {
      specMap.set(`${spec.id}:${spec.version}`, structuredClone(spec));
      return structuredClone(spec);
    },
    getSpec(specId, version) {
      const value = specMap.get(`${specId}:${Number(version)}`);
      return value ? structuredClone(value) : null;
    },
    save(run) {
      runs.set(run.id, structuredClone(run));
    },
    get(runId) {
      const value = runs.get(runId);
      return value ? structuredClone(value) : null;
    },
    latestForThread(threadId) {
      return [...runs.values()]
        .filter((run) => run.threadId === threadId)
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] || null;
    },
    nonTerminalRuns() {
      return [];
    },
  };
}

function runtimeForSpecs(store, executeProvider, overrides = {}) {
  return new ClusterWorkflowRuntime({
    store,
    async planWithCodex() {
      return { text: JSON.stringify({ accepted: true, confidence: 1, reason: "accepted" }) };
    },
    async executeProvider(call) {
      return executeProvider(call);
    },
    async executeRootFinal(call) {
      return { text: `accepted ${call.run.id}`, turnId: `turn_${call.run.id}` };
    },
    ...overrides,
  });
}

function revisionDraftStore(draft) {
  let current = structuredClone(draft);
  let layout = null;
  let atomicSaves = 0;
  return {
    getDraft(draftId) {
      return current?.id === draftId ? structuredClone(current) : null;
    },
    saveDraft(value) {
      current = structuredClone(value);
      return structuredClone(current);
    },
    saveDraftWithLayout(value, nextLayout) {
      current = structuredClone(value);
      layout = structuredClone(nextLayout);
      atomicSaves += 1;
      return { draft: structuredClone(current), layout: structuredClone(layout) };
    },
    getLayout(kind, ownerId) {
      return kind === "draft" && ownerId === current?.id && layout
        ? structuredClone(layout)
        : null;
    },
    nonTerminalRuns() {
      return [];
    },
    snapshot() {
      return { current: structuredClone(current), layout: structuredClone(layout), atomicSaves };
    },
  };
}

test("a frozen workflow can start at an arbitrary entry and runs only its downstream scope", async () => {
  const spec = frozenSpec("partial", [
    definitionNode("a"),
    definitionNode("b", ["a"]),
    definitionNode("c", ["b"]),
  ], ["a"]);
  const store = memoryStore([spec]);
  const calls = [];
  const runtime = runtimeForSpecs(store, async (call) => {
    calls.push(call.nodeId);
    return { text: `${call.nodeId} result` };
  });

  const started = runtime.startSpec({
    threadId: "thread_partial",
    specId: spec.id,
    version: spec.version,
    entryNodeIds: ["b"],
    prompt: "run from b",
  });
  const completed = await runtime.waitForRun(started.id);

  assert.equal(completed.status, "succeeded");
  assert.deepEqual(calls, ["b", "c"]);
  assert.deepEqual(completed.metadata.workflowInvocation.entryNodeIds, ["b"]);
  assert.deepEqual(completed.metadata.workflowInvocation.scopeNodeIds, ["b", "c"]);
});

test("re-running a frozen canvas executes its nodes without invoking root planning", async () => {
  const spec = frozenSpec("rerun_without_replanning", [
    definitionNode("edit"),
    definitionNode("review", ["edit"]),
  ], ["edit"]);
  const calls = [];
  let planningCalls = 0;
  const runtime = runtimeForSpecs(memoryStore([spec]), async (call) => {
    calls.push(call.nodeId);
    return { text: `${call.nodeId} result`, confidence: 0.99 };
  }, {
    async planWithCodex() {
      planningCalls += 1;
      throw new Error("root planning must not run for a frozen canvas");
    },
  });

  const started = runtime.startSpec({
    threadId: "thread_rerun_without_replanning",
    specId: spec.id,
    version: spec.version,
    entryNodeIds: ["edit"],
    prompt: "execute the existing canvas",
  });
  const completed = await runtime.waitForRun(started.id);

  assert.equal(completed.status, "succeeded");
  assert.equal(planningCalls, 0);
  assert.deepEqual(calls, ["edit", "review"]);
  assert.equal(completed.specId, spec.id);
  assert.equal(completed.specVersion, spec.version);
});

test("one shared prompt value is delivered to every compatible parallel entry node", async () => {
  const entryContract = (nodeId) => compileWorkflowNodeContractPayload({
    task: `使用提示词执行 ${nodeId}`,
    inputSlots: [{ type: "text", semanticName: "提示词" }],
    outputSlots: [{ type: "text", semanticName: `${nodeId} 结果` }],
  }, { nodeId });
  const spec = frozenSpec("shared_parallel_prompt", [
    definitionNode("entry-a", [], { nodeContract: entryContract("entry-a") }),
    definitionNode("entry-b", [], { nodeContract: entryContract("entry-b") }),
    definitionNode("merge", ["entry-a", "entry-b"]),
  ], ["entry-a", "entry-b"]);
  const contract = workflowInvocationContract(spec);
  assert.equal(contract.slots.length, 1);
  assert.deepEqual(contract.slots[0].targetNodeIds, ["entry-a", "entry-b"]);

  const runtime = runtimeForSpecs(memoryStore([spec]), async (call) => ({
    text: `${call.nodeId} complete`,
    confidence: 0.99,
  }));
  const promptValue = "为同一个主题分别生成两个候选结果";
  const started = runtime.startSpec({
    threadId: "thread_shared_parallel_prompt",
    specId: spec.id,
    version: spec.version,
    prompt: promptValue,
    invocationInputs: {
      [contract.slots[0].slotId]: [{ type: "text", text: promptValue }],
    },
  });
  const completed = await runtime.waitForRun(started.id);

  assert.equal(completed.status, "succeeded");
  for (const nodeId of ["entry-a", "entry-b"]) {
    const node = completed.nodes.find((candidate) => candidate.id === nodeId);
    assert.equal(node.invocationInputs.length, 1);
    assert.deepEqual(node.invocationInputs[0].values, [{ type: "text", text: promptValue }]);
  }
});

test("pass-through output preserves the original invocation artifact and lineage without model regeneration", async () => {
  const contract = compileWorkflowNodeContractPayload({
    task: "描述图片并保留原图",
    inputSlots: [{
      type: "image",
      semanticName: "产品图",
      minCount: 1,
      maxCount: 1,
      required: true,
      accept: ["image/*"],
    }],
    outputSlots: [{
      type: "image",
      semanticName: "原图",
      minCount: 1,
      maxCount: 1,
      required: true,
      accept: ["image/*"],
    }, {
      type: "text",
      semanticName: "图片描述",
      minCount: 1,
      maxCount: 1,
      required: true,
      accept: [],
    }],
    passThroughMappings: [{ inputIndex: 0, outputIndex: 0 }],
  }, { nodeId: "source" });
  const spec = frozenSpec("pass_through_lineage", [
    definitionNode("source", [], {
      nodeContract: contract,
      outputContract: { format: "auto", requirements: [] },
    }),
  ], ["source"]);
  const runtime = runtimeForSpecs(memoryStore([spec]), async () => ({
    text: "画面中是一件蓝色产品。",
    artifacts: [],
  }));
  const inputSlotId = contract.inputContract.slots[0].slotId;
  const outputImageSlotId = contract.outputContract.slots[0].slotId;

  const started = runtime.startSpec({
    threadId: "thread_pass_through_lineage",
    specId: spec.id,
    version: spec.version,
    prompt: "describe and preserve",
    invocationInputs: {
      [inputSlotId]: [{ attachmentId: "product-image" }],
    },
    attachments: [{
      id: "product-image",
      name: "product.png",
      mime: "image/png",
      local_path: "C:\\fixtures\\product.png",
    }],
  });
  const completed = await runtime.waitForRun(started.id);
  const source = completed.nodes.find((node) => node.id === "source");
  const artifact = source.result.output.artifacts[0];

  assert.equal(completed.status, "succeeded");
  assert.equal(artifact.uri, "C:\\fixtures\\product.png");
  assert.equal(artifact.slotId, outputImageSlotId);
  assert.equal(artifact.sourceSlotId, inputSlotId);
  assert.equal(artifact.passThrough, true);
  assert.equal(artifact.generated, false);
  assert.equal(source.result.output.slotValues[outputImageSlotId][0].resourceId, "product-image");
});

test("semantic file slots accept recovered generic artifacts by MIME inferred from extension", async () => {
  const workbookMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const contract = compileWorkflowNodeContractPayload({
    task: "generate an analysis workbook",
    inputSlots: [],
    outputSlots: [{
      type: "file",
      semanticName: "analysis workbook",
      minCount: 1,
      maxCount: 1,
      required: true,
      accept: [workbookMime],
    }],
  }, { nodeId: "build-workbook" });
  const spec = frozenSpec("recovered_generic_artifact_mime", [
    definitionNode("build-workbook", [], {
      kind: "agent",
      executorType: "codex_subagent",
      provider: "haolo-codex-agent",
      model: "gpt-5.6-sol",
      nodeContract: contract,
      capabilityRequest: fullAccessCapabilityRequest(),
      outputContract: { format: "artifact", requirements: [] },
    }),
  ], ["build-workbook"]);
  const workbookPath = "C:\\outputs\\analysis.xlsx";
  const runtime = runtimeForSpecs(memoryStore([spec]), async () => ({ text: "unused" }), {
    async executeSubAgent() {
      return {
        text: `Workbook delivered: ${workbookPath}`,
        confidence: 0.99,
        artifacts: [{ type: "file", name: "analysis.xlsx", uri: workbookPath }],
      };
    },
  });

  const started = runtime.startSpec({
    threadId: "thread_recovered_generic_artifact_mime",
    specId: spec.id,
    version: spec.version,
    prompt: "build the workbook",
  });
  const completed = await runtime.waitForRun(started.id);
  const node = completed.nodes.find((candidate) => candidate.id === "build-workbook");
  const outputSlotId = contract.outputContract.slots[0].slotId;

  assert.equal(completed.status, "succeeded");
  assert.equal(node.status, "succeeded");
  assert.equal(node.result.output.slotValues[outputSlotId][0].uri, workbookPath);
});

test("node contract compilation rejects malformed semantic output without persisting a partial draft", async () => {
  const draft = {
    id: "draft_compile_reject",
    workflowKey: "compile_reject",
    threadId: "thread_compile_reject",
    revision: 0,
    nodes: [{
      id: "entry",
      kind: "model",
      executorType: "external_model",
      title: "entry",
      purpose: "describe image",
      provider: "gpt",
      model: "test-model",
      prompt: "输入：\n一张产品图\n\n任务：\n描述图片\n\n输出：\n一段图片描述",
      dependsOn: [],
      attachmentRefs: [],
    }],
    resources: { attachments: [] },
    entryBindings: [{ source: "workflow_input", targetNodeId: "entry" }],
  };
  const store = revisionDraftStore(draft);
  const runtime = runtimeForSpecs(store, async () => ({ text: "unused" }), {
    async planWithCodex() {
      return {
        text: JSON.stringify({
          accepted: true,
          clarificationRequired: false,
          taskDefinition: { text: "描述产品图" },
          inputSlots: [{
            semanticName: "产品图",
            type: "spreadsheet",
            minCount: 1,
            maxCount: 1,
            required: true,
            accept: [],
            sharedResourceKey: null,
          }],
          outputSlots: [{
            semanticName: "图片描述",
            type: "text",
            minCount: 1,
            maxCount: 1,
            required: true,
            accept: [],
            sharedResourceKey: null,
            passThroughFromSlotId: null,
          }],
          passThroughMappings: [],
        }),
      };
    },
  });

  await assert.rejects(
    runtime.compileRevisionNode({
      draftId: draft.id,
      nodeId: "entry",
      baseRevision: 0,
      prompt: draft.nodes[0].prompt,
      layout: { positions: { entry: { x: 10, y: 20 } } },
    }),
    (error) => error?.code === "WORKFLOW_NODE_CONTRACT_AMBIGUOUS",
  );
  const snapshot = store.snapshot();
  assert.equal(snapshot.current.revision, 0);
  assert.equal(snapshot.layout, null);
  assert.equal(snapshot.atomicSaves, 0);
});

test("node contract compilation commits the compiled contract and layout through one atomic store call", async () => {
  const draft = {
    id: "draft_compile_atomic",
    workflowKey: "compile_atomic",
    threadId: "thread_compile_atomic",
    revision: 0,
    nodes: [{
      id: "entry",
      kind: "model",
      executorType: "external_model",
      title: "entry",
      purpose: "describe image",
      provider: "gpt",
      model: "test-model",
      prompt: "输入：\n一张产品图\n\n任务：\n描述图片\n\n输出：\n一段图片描述",
      dependsOn: [],
      attachmentRefs: [],
    }],
    resources: { attachments: [] },
    entryBindings: [{ source: "workflow_input", targetNodeId: "entry" }],
  };
  const store = revisionDraftStore(draft);
  let compilerPrompt = "";
  const runtime = runtimeForSpecs(store, async () => ({ text: "unused" }), {
    async planWithCodex(call) {
      compilerPrompt = call.prompt;
      return {
        text: JSON.stringify({
          accepted: true,
          clarificationRequired: false,
          taskDefinition: {
            text: "Given the user's runtime prompt text, produce a text output that follows and answers that prompt.",
          },
          inputSlots: [{
            semanticName: "产品图",
            type: "image",
            minCount: 1,
            maxCount: 1,
            required: true,
            accept: ["image/*"],
            sharedResourceKey: null,
          }],
          outputSlots: [{
            semanticName: "图片描述",
            type: "text",
            minCount: 1,
            maxCount: 1,
            required: true,
            accept: [],
            sharedResourceKey: null,
            passThroughFromSlotId: null,
          }],
          passThroughMappings: [],
        }),
      };
    },
  });

  const result = await runtime.compileRevisionNode({
    draftId: draft.id,
    nodeId: "entry",
    baseRevision: 0,
    prompt: draft.nodes[0].prompt,
    layout: { positions: { entry: { x: 30, y: 40 } } },
  });
  const snapshot = store.snapshot();
  assert.equal(snapshot.atomicSaves, 1);
  assert.equal(snapshot.current.revision, 1);
  assert.deepEqual(snapshot.layout, { positions: { entry: { x: 30, y: 40 } } });
  assert.equal(result.contract.compiled, true);
  assert.equal(result.contract.taskDefinition.text, "描述图片");
  assert.equal(result.contract.inputContract.slots[0].type, "image");
  assert.equal(snapshot.current.nodes[0].purpose, "描述图片");
  assert.match(snapshot.current.nodes[0].prompt, /输入：[\s\S]*产品图[\s\S]*任务：[\s\S]*描述图片/);
  assert.doesNotMatch(snapshot.current.nodes[0].prompt, /Given the user's runtime prompt text/);
  assert.match(compilerPrompt, /taskDefinition\.text is user-visible[\s\S]*never translate a Chinese task into English/);
});

test("semantic compilation shares parallel inputs by default and marks only explicit differences", async () => {
  const originalContract = compileWorkflowNodeContractPayload({
    task: "根据提示词处理原始图片并更新 Word 文档",
    inputSlots: [
      { type: "image", semanticName: "原始图片", accept: ["image/*"] },
      { type: "text", semanticName: "提示词" },
      { type: "file", semanticName: "Word文档", accept: [".docx"] },
    ],
    outputSlots: [{ type: "file", semanticName: "处理后的Word文档", accept: [".docx"] }],
  }, { nodeId: "original-entry" });
  const [originalImage, originalPrompt] = originalContract.inputContract.slots;
  const draft = {
    id: "draft_parallel_semantic_share",
    workflowKey: "parallel_semantic_share",
    threadId: "thread_parallel_semantic_share",
    revision: 0,
    nodes: [
      {
        id: "original-entry",
        displayCode: "B",
        kind: "agent",
        executorType: "codex_subagent",
        title: "原始处理",
        purpose: "处理原始图片",
        prompt: "输入：\n- 原始图片\n- 提示词\n- Word文档\n\n任务：\n处理原始图片\n\n输出：\n处理后的Word文档",
        dependsOn: [],
        attachmentRefs: [],
        nodeContract: originalContract,
      },
      {
        id: "shared-entry",
        displayCode: "D",
        kind: "agent",
        executorType: "codex_subagent",
        title: "共享处理",
        purpose: "复用共享输入",
        prompt: "输入：\n- 共享图片\n- 共享提示词\n- Word文档\n\n任务：\n复用共享图片和提示词处理文档\n\n输出：\n新的Word文档",
        dependsOn: [],
        attachmentRefs: [],
      },
    ],
    resources: { attachments: [] },
    entryBindings: [
      { source: "workflow_input", targetNodeId: "original-entry" },
      { source: "workflow_input", targetNodeId: "shared-entry" },
    ],
  };
  const store = revisionDraftStore(draft);
  let compilerPrompt = "";
  const runtime = runtimeForSpecs(store, async () => ({ text: "unused" }), {
    async planWithCodex({ prompt }) {
      compilerPrompt = prompt;
      return {
        text: JSON.stringify({
          accepted: true,
          clarificationRequired: false,
          taskDefinition: { text: "复用共享图片和提示词处理文档" },
          inputSlots: [
            {
              semanticName: "共享图片",
              type: "image",
              minCount: 1,
              maxCount: 1,
              required: true,
              accept: ["image/*"],
              sharedResourceKey: originalImage.slotId,
            },
            {
              semanticName: "共享提示词",
              type: "text",
              minCount: 1,
              maxCount: 1,
              required: true,
              accept: [],
              sharedResourceKey: originalPrompt.slotId,
            },
            {
              semanticName: "Word文档",
              type: "file",
              minCount: 1,
              maxCount: 1,
              required: true,
              accept: [".docx"],
              sharedResourceKey: null,
              distinctResourceKey: "shared-entry-own-word-document",
            },
          ],
          outputSlots: [{
            semanticName: "新的Word文档",
            type: "file",
            minCount: 1,
            maxCount: 1,
            required: true,
            accept: [".docx"],
            sharedResourceKey: null,
            passThroughFromSlotId: null,
          }],
          passThroughMappings: [],
          capabilityRequest: fullAccessCapabilityRequest(),
        }),
      };
    },
  });

  await runtime.compileRevisionNode({
    draftId: draft.id,
    nodeId: "shared-entry",
    baseRevision: 0,
    prompt: draft.nodes[1].prompt,
    layout: { positions: {} },
  });

  assert.match(compilerPrompt, /Compatible parallel text, file, image, or video inputs use the same resource by default/);
  assert.match(compilerPrompt, /Only when the source definition explicitly requires a different resource, set distinctResourceKey/);
  assert.match(compilerPrompt, /Existing parallel entry inputs and their reusable shareKey values/);
  assert.match(compilerPrompt, /compile the least CapabilityRequest/);
  assert.match(compilerPrompt, new RegExp(originalImage.slotId));
  assert.match(compilerPrompt, new RegExp(originalPrompt.slotId));
  const invocation = workflowInvocationContract(store.snapshot().current);
  assert.deepEqual(
    invocation.slots.map((slot) => slot.semanticName),
    ["原始图片", "提示词", "Word文档", "Word文档"],
  );
  assert.equal(
    store.snapshot().current.nodes.find((node) => node.id === "shared-entry")
      .capabilityRequest.permissionProfile,
    "full_access",
  );
  assert.deepEqual(
    store.snapshot().current.nodes.find((node) => node.id === "shared-entry")
      .capabilityRequest.resourceScope.network,
    ["haolo.pro"],
  );
});

test("a legacy frozen agent compiles missing semantic capability without replanning its graph", async () => {
  const contract = compileWorkflowNodeContractPayload({
    task: "调用媒体服务编辑图片并写入 Word 文档",
    inputSlots: [{ type: "image", semanticName: "待修改图片", accept: ["image/*"] }],
    outputSlots: [{ type: "file", semanticName: "汇集后的Word文档", accept: [".docx"] }],
  }, { nodeId: "legacy-agent" });
  const spec = frozenSpec("legacy_agent_capability", [
    definitionNode("legacy-agent", [], {
      kind: "agent",
      executorType: "codex_subagent",
      provider: "haolo-codex-agent",
      model: "gpt-5.6-sol",
      nodeContract: contract,
      capabilityRequest: null,
    }),
  ], ["legacy-agent"]);
  let capabilityCompilerCalls = 0;
  let grantedProfile = null;
  const runtime = runtimeForSpecs(memoryStore([spec]), async () => ({ text: "unused" }), {
    async planWithCodex({ prompt }) {
      assert.match(prompt, /capability compiler/);
      assert.doesNotMatch(prompt, /JSON schema:[\s\S]*goalContract/);
      capabilityCompilerCalls += 1;
      return {
        text: JSON.stringify({
          accepted: true,
          reason: "",
          capabilityRequest: fullAccessCapabilityRequest(),
        }),
      };
    },
    async executeSubAgent(call) {
      grantedProfile = call.capabilityGrant.permissionProfile;
      return {
        text: "legacy-agent complete",
        confidence: 0.99,
        artifacts: [{ type: "file", name: "result.docx", uri: "D:/result.docx" }],
      };
    },
  });

  const started = runtime.startSpec({
    threadId: "thread_legacy_agent_capability",
    specId: spec.id,
    version: spec.version,
    prompt: "执行当前旧画布",
    invocationInputs: {
      [contract.inputContract.slots[0].slotId]: [{ type: "image", uri: "D:/input.png" }],
    },
  });
  const completed = await runtime.waitForRun(started.id);

  assert.equal(completed.status, "succeeded");
  assert.equal(capabilityCompilerCalls, 1);
  assert.equal(grantedProfile, "full_access");
});

test("downstream video agents receive direct upstream media artifacts as executor attachments", async () => {
  const source = definitionNode("image-source", [], {
    kind: "agent",
    executorType: "codex_subagent",
    provider: "haolo-image-agent",
    model: "gpt-image-2",
    capabilityRequest: fullAccessCapabilityRequest(),
    outputContract: { format: "auto", requirements: [] },
  });
  const video = definitionNode("video-target", ["image-source"], {
    kind: "agent",
    executorType: "codex_subagent",
    provider: "haolo-video-agent",
    model: "omni-fast-no-water",
    capabilityRequest: fullAccessCapabilityRequest(),
    outputContract: { format: "auto", requirements: [] },
  });
  const spec = frozenSpec("upstream_media_transport", [source, video], ["image-source"]);
  const calls = [];
  const runtime = runtimeForSpecs(memoryStore([spec]), async () => ({ text: "unused" }), {
    async executeSubAgent(call) {
      calls.push(call);
      if (call.nodeId === "image-source") {
        return {
          text: "image complete",
          confidence: 0.99,
          artifacts: [{
            type: "file",
            name: "character.png",
            uri: "C:\\outputs\\character.png",
          }],
        };
      }
      return { text: "video complete", confidence: 0.99 };
    },
  });

  const started = runtime.startSpec({
    threadId: "thread_upstream_media_transport",
    specId: spec.id,
    version: spec.version,
    prompt: "generate a character video",
  });
  const completed = await runtime.waitForRun(started.id);
  const videoCall = calls.find((call) => call.nodeId === "video-target");
  const upstreamImage = videoCall.attachments.find((attachment) => attachment.name === "character.png");

  assert.equal(completed.status, "succeeded");
  assert.equal(upstreamImage.local_path, "C:\\outputs\\character.png");
  assert.equal(upstreamImage.mime, "image/png");
  assert.equal(upstreamImage.kind, "image");
  assert.equal(upstreamImage.sourceNodeId, "image-source");
});

test("ready Haolo agents remain serial even when canvas entry branches are parallel", async () => {
  const agent = (id) => definitionNode(id, [], {
    kind: "agent",
    executorType: "codex_subagent",
    provider: "haolo-codex-agent",
    model: "gpt-5.6-sol",
    capabilityRequest: fullAccessCapabilityRequest(),
  });
  const spec = frozenSpec("serial_effect_agents", [
    agent("left"),
    agent("right"),
    definitionNode("merge", ["left", "right"]),
  ], ["left", "right"]);
  let activeAgents = 0;
  let maxActiveAgents = 0;
  const executionOrder = [];
  const runtime = runtimeForSpecs(memoryStore([spec]), async (call) => ({
    text: `${call.nodeId} complete`,
    confidence: 0.99,
  }), {
    async executeSubAgent(call) {
      activeAgents += 1;
      maxActiveAgents = Math.max(maxActiveAgents, activeAgents);
      executionOrder.push(call.nodeId);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeAgents -= 1;
      return { text: `${call.nodeId} complete`, confidence: 0.99 };
    },
  });

  const started = runtime.startSpec({
    threadId: "thread_serial_effect_agents",
    specId: spec.id,
    version: spec.version,
    prompt: "执行并行入口画布",
  });
  const completed = await runtime.waitForRun(started.id);

  assert.equal(completed.status, "succeeded");
  assert.equal(maxActiveAgents, 1);
  assert.deepEqual(executionOrder, ["left", "right"]);
});

test("a fatal node failure immediately stops the remaining manually created frozen workflow", async () => {
  const agent = (id) => definitionNode(id, [], {
    kind: "agent",
    executorType: "codex_subagent",
    provider: "haolo-codex-agent",
    model: "gpt-5.6-sol",
    capabilityRequest: fullAccessCapabilityRequest(),
  });
  const spec = frozenSpec("fatal_fail_fast", [
    agent("image-failure"),
    agent("unnecessary-image"),
    definitionNode("video-sink", ["image-failure", "unnecessary-image"]),
  ], ["image-failure", "unnecessary-image"]);
  const agentCalls = [];
  const providerCalls = [];
  let rootCall = null;
  const runtime = runtimeForSpecs(memoryStore([spec]), async (call) => {
    providerCalls.push(call.nodeId);
    return { text: `${call.nodeId} complete` };
  }, {
    async executeSubAgent(call) {
      agentCalls.push(call.nodeId);
      return {
        status: "failed",
        error: {
          code: "IMAGE_SERVICE_UNAVAILABLE",
          message: "图像服务连接中断且没有返回任务编号。",
          retryable: false,
        },
      };
    },
    async executeRootFinal(call) {
      rootCall = call;
      return { text: "已报告冻结工作流节点失败。" };
    },
  });

  const started = runtime.startSpec({
    threadId: "thread_fatal_fail_fast",
    specId: spec.id,
    version: spec.version,
    prompt: "运行手工创建的画布",
  });
  const completed = await runtime.waitForRun(started.id);
  const failed = completed.nodes.find((node) => node.id === "image-failure");
  const unnecessary = completed.nodes.find((node) => node.id === "unnecessary-image");
  const sink = completed.nodes.find((node) => node.id === "video-sink");

  assert.deepEqual(agentCalls, ["image-failure"]);
  assert.deepEqual(providerCalls, []);
  assert.equal(failed.status, "failed");
  assert.equal(unnecessary.status, "cancelled");
  assert.equal(unnecessary.result.error.code, "FROZEN_WORKFLOW_FAIL_FAST");
  assert.equal(sink.status, "cancelled");
  assert.equal(completed.metadata.workflowFailFast.failedNodeId, "image-failure");
  assert.deepEqual(
    new Set(completed.metadata.workflowFailFast.cancelledNodeIds),
    new Set(["unnecessary-image", "video-sink"]),
  );
  assert.equal(completed.status, "failed");
  assert.equal(completed.error.code, "FROZEN_WORKFLOW_FATAL_NODE_FAILED");
  assert.match(completed.error.message, /图像服务连接中断且没有返回任务编号/);
  assert.match(rootCall.additionalContext, /手工创建的工作流已立即停止/);
});

test("strict frozen joins fail fast when a terminal failure makes the sink unreachable", async () => {
  const spec = frozenSpec("strict_join", [
    definitionNode("a"),
    definitionNode("b"),
    definitionNode("merge", ["a", "b"], {
      joinPolicy: { mode: "all_required" },
    }),
  ], ["a", "b"]);
  const store = memoryStore([spec]);
  const calls = [];
  let siblingAborted = false;
  const runtime = runtimeForSpecs(store, async (call) => {
    calls.push(call.nodeId);
    if (call.nodeId === "a") {
      return { status: "failed", error: { code: "A_FAILED", message: "a failed", retryable: false } };
    }
    await new Promise((resolve) => {
      call.signal.addEventListener("abort", () => {
        siblingAborted = true;
        resolve();
      }, { once: true });
    });
    return { text: `${call.nodeId} should not complete` };
  });

  const started = runtime.startSpec({
    threadId: "thread_strict_join",
    specId: spec.id,
    version: spec.version,
    prompt: "run strict join",
  });
  const completed = await runtime.waitForRun(started.id);
  const merge = completed.nodes.find((node) => node.id === "merge");

  assert.deepEqual(new Set(calls), new Set(["a", "b"]));
  assert.equal(siblingAborted, true);
  assert.equal(completed.nodes.find((node) => node.id === "b").status, "cancelled");
  assert.equal(merge.status, "cancelled");
  assert.equal(merge.result.error.code, "FROZEN_WORKFLOW_FAIL_FAST");
});

test("frozen final acceptance cannot bypass a failed sink or fabricate a replacement deliverable", async () => {
  const spec = frozenSpec("failed_sink_is_final", [definitionNode("sink")], ["sink"]);
  let rootCall = null;
  const runtime = runtimeForSpecs(memoryStore([spec]), async () => ({
    status: "failed",
    error: { code: "IMAGE_FAILED", message: "image generation failed", retryable: false },
  }), {
    async executeRootFinal(call) {
      rootCall = call;
      return {
        text: "我另外生成了一张图片，任务已完成。",
        confidence: 1,
      };
    },
  });

  const started = runtime.startSpec({
    threadId: "thread_failed_sink_is_final",
    specId: spec.id,
    version: spec.version,
    prompt: "必须按当前画布输出汇集后的 Word 文档",
  });
  const completed = await runtime.waitForRun(started.id);

  assert.equal(rootCall.allowSideEffects, false);
  assert.match(rootCall.additionalContext, /report-only final acceptance/);
  assert.equal(completed.status, "failed");
  assert.equal(completed.error.code, "FROZEN_WORKFLOW_FATAL_NODE_FAILED");
  assert.match(completed.error.message, /IMAGE_FAILED|image generation failed/);
});

test("successful frozen sink uses its output contract instead of the invocation prompt as the final goal", async () => {
  const entryContract = compileWorkflowNodeContractPayload({
    task: "根据一句话提示词写小说正文",
    inputSlots: [{
      type: "text",
      semanticName: "一句话提示词",
      minCount: 1,
      maxCount: 1,
    }],
    outputSlots: [{
      type: "text",
      semanticName: "小说正文",
      minCount: 1,
      maxCount: 1,
    }],
  }, { nodeId: "story" });
  const videoContract = compileWorkflowNodeContractPayload({
    task: "使用上游结果生成角色打斗视频",
    outputSlots: [{
      type: "video",
      semanticName: "角色打斗视频",
      minCount: 1,
      maxCount: 1,
      accept: ["video/mp4"],
    }],
  }, { nodeId: "video-sink", inputMode: "derived" });
  const spec = frozenSpec("sink_contract_goal", [
    definitionNode("story", [], { nodeContract: entryContract }),
    definitionNode("video-sink", ["story"], {
      kind: "agent",
      title: "生成打斗视频",
      executorType: "codex_subagent",
      provider: "haolo-codex-agent",
      model: "gpt-5.6-sol",
      capabilityRequest: fullAccessCapabilityRequest(),
      nodeContract: videoContract,
    }),
  ], ["story"]);
  assert.equal(spec.goalContract.deliverable, "角色打斗视频");
  assert.match(spec.finalAcceptancePrompt, /入口消息仅用于填充画布入口输入/);
  const entrySlotId = spec.nodes.find((node) => node.id === "story")
    .nodeContract.inputContract.slots[0].slotId;
  let rootCall = null;
  const runtime = runtimeForSpecs(memoryStore([spec]), async (call) => ({
    text: call.nodeId === "story" ? "《10年后的AI》小说正文" : `${call.nodeId} complete`,
  }), {
    async executeSubAgent() {
      return {
        text: "角色打斗视频已生成。",
        artifacts: [{
          type: "video/mp4",
          uri: "C:\\outputs\\fight.mp4",
          name: "fight.mp4",
        }],
        confidence: 0.99,
      };
    },
    async executeRootFinal(call) {
      rootCall = call;
      return {
        status: "failed",
        text: "错误地按入口消息判断缺少小说正文。",
        confidence: 0.99,
        error: {
          code: "WORKFLOW_GOAL_NOT_ACHIEVED",
          message: "冻结工作流缺少小说正文产物。",
          retryable: false,
        },
      };
    },
  });

  const started = runtime.startSpec({
    threadId: "thread_sink_contract_goal",
    specId: spec.id,
    version: spec.version,
    prompt: "写一篇短篇小说题目是：10年后的ai",
    invocationInputs: {
      [entrySlotId]: [{ type: "text", text: "写一篇短篇小说题目是：10年后的ai" }],
    },
  });
  const completed = await runtime.waitForRun(started.id);

  assert.equal(completed.status, "succeeded");
  assert.equal(completed.goalContract.deliverable, "角色打斗视频");
  assert.equal(rootCall.run.goalContract.deliverable, "角色打斗视频");
  assert.match(rootCall.additionalContext, /冻结画布入口输入（仅填充入口槽位，不是最终交付目标）/);
  assert.match(rootCall.additionalContext, /冻结汇点确定性预检已通过/);
  assert.match(rootCall.additionalContext, /必须返回 goalAchieved=true/);
  assert.match(rootCall.prompt, /冻结画布只读终验/);
  assert.doesNotMatch(rootCall.prompt, /写一篇短篇小说/);
  assert.match(completed.finalResult.output.text, /最终汇点“生成打斗视频”已成功/);
  assert.doesNotMatch(completed.finalResult.output.text, /缺少小说正文/);
  assert.deepEqual(completed.finalResult.output.artifacts, [{
    type: "video/mp4",
    uri: "C:\\outputs\\fight.mp4",
    name: "fight.mp4",
    resourceId: "C:\\outputs\\fight.mp4",
    slotId: videoContract.outputContract.slots[0].slotId,
    sourceNodeId: "video-sink",
    sourceSlotId: null,
    passThrough: false,
    generated: true,
  }]);
});

test("file-only frozen workflows recover invalid final metadata and deliver only contract-bound sink artifacts", async () => {
  const inputContract = compileWorkflowNodeContractPayload({
    task: "读取输入 Word 文档",
    inputSlots: [{
      type: "file",
      semanticName: "Word文档",
      minCount: 1,
      maxCount: 1,
      accept: [".docx"],
    }],
    outputSlots: [{
      type: "file",
      semanticName: "最终Word文档",
      minCount: 1,
      maxCount: 1,
      accept: [".docx"],
    }],
  }, { nodeId: "word-sink" });
  const spec = frozenSpec("file_only_word", [
    definitionNode("word-sink", [], {
      kind: "agent",
      title: "生成最终Word",
      executorType: "codex_subagent",
      provider: "haolo-codex-agent",
      model: "gpt-5.6-sol",
      capabilityRequest: fullAccessCapabilityRequest(),
      nodeContract: inputContract,
    }),
  ], ["word-sink"]);
  const inputSlotId = spec.nodes[0].nodeContract.inputContract.slots[0].slotId;
  const outputSlotId = spec.nodes[0].nodeContract.outputContract.slots[0].slotId;
  let rootCall = null;
  const runtime = runtimeForSpecs(memoryStore([spec]), async () => ({ text: "unused" }), {
    async executeSubAgent() {
      const document = {
        type: "file",
        uri: "C:\\outputs\\final.docx",
        name: "final.docx",
      };
      return {
        text: "最终 Word 文档已生成并校验。",
        artifacts: [
          { type: "file", uri: "C:\\outputs\\build_doc.py", name: "build_doc.py" },
          document,
        ],
        slotValues: { [outputSlotId]: [document] },
        confidence: 0.99,
      };
    },
    async executeRootFinal(call) {
      rootCall = call;
      return {
        status: "failed",
        text: "收到你发的文件了，想让我怎么处理？",
        turnId: "turn_file_only_invalid_meta",
        error: {
          code: "WORKFLOW_FINAL_ACCEPTANCE_INVALID",
          message: "Final acceptance envelope is missing.",
          retryable: false,
          category: "final_acceptance",
        },
      };
    },
  });

  const started = runtime.startSpec({
    threadId: "thread_file_only_word",
    specId: spec.id,
    version: spec.version,
    prompt: [
      "用户只发送了附件，没有输入文字说明。请用一句话简短确认收到，并询问用户想怎么处理。",
      "不要输出附件路径。",
    ].join("\n"),
    invocationInputs: {
      [inputSlotId]: [{ type: "file", name: "source.docx", uri: "C:\\input\\source.docx" }],
    },
  });
  const completed = await runtime.waitForRun(started.id);

  assert.equal(completed.status, "succeeded");
  assert.match(rootCall.prompt, /冻结画布只读终验/);
  assert.doesNotMatch(rootCall.prompt, /用户只发送了附件/);
  assert.match(completed.finalResult.output.text, /最终汇点“生成最终Word”已成功/);
  assert.doesNotMatch(completed.finalResult.output.text, /想让我怎么处理/);
  assert.deepEqual(completed.finalResult.output.artifacts, [{
    type: "file",
    uri: "C:\\outputs\\final.docx",
    name: "final.docx",
    resourceId: "C:\\outputs\\final.docx",
    slotId: outputSlotId,
    sourceNodeId: "word-sink",
    sourceSlotId: null,
    passThrough: false,
    generated: true,
  }]);
});

test("partial and blocked execution envelopes remain explicit and never release downstream nodes", async () => {
  assert.equal(normalizeExecutionResult({ status: "partial", text: "some work" }).status, "partial");
  assert.equal(normalizeExecutionResult({ status: "blocked", text: "waiting" }).status, "blocked");
  for (const status of ["partial", "blocked"]) {
    const spec = frozenSpec(`terminal_${status}`, [
      definitionNode("source"),
      definitionNode("after", ["source"]),
    ], ["source"]);
    const calls = [];
    const runtime = runtimeForSpecs(memoryStore([spec]), async (call) => {
      calls.push(call.nodeId);
      return { status, text: `${status} result` };
    });
    const started = runtime.startSpec({
      threadId: `thread_${status}`,
      specId: spec.id,
      version: spec.version,
      prompt: `run ${status}`,
    });
    const completed = await runtime.waitForRun(started.id);
    const source = completed.nodes.find((node) => node.id === "source");
    const after = completed.nodes.find((node) => node.id === "after");
    assert.deepEqual(calls, ["source"]);
    assert.equal(source.status, "failed");
    assert.equal(source.result.status, status);
    assert.equal(after.status, "cancelled");
  }
});

test("a nested workflow node executes the exact frozen child spec and returns one boundary result", async () => {
  const child = frozenSpec("child", [definitionNode("inner")], ["inner"]);
  const specs = new Map([[`${child.id}:${child.version}`, child]]);
  const resolveSpec = (specId, version) => specs.get(`${specId}:${version}`) || null;
  const parent = frozenSpec("parent", [
    definitionNode("nested", [], {
      kind: "workflow",
      executorType: "nested_workflow",
      provider: null,
      model: null,
      workflowRef: {
        specId: child.id,
        version: child.version,
        graphHash: child.graphHash,
      },
    }),
    definitionNode("after", ["nested"]),
  ], ["nested"], { resolveSpec });
  specs.set(`${parent.id}:${parent.version}`, parent);
  const store = memoryStore([...specs.values()]);
  const calls = [];
  const runtime = runtimeForSpecs(store, async (call) => {
    calls.push(call.nodeId);
    return { text: `${call.nodeId} result` };
  });

  const started = runtime.startSpec({
    threadId: "thread_parent",
    specId: parent.id,
    version: parent.version,
    prompt: "invoke parent",
  });
  const completed = await runtime.waitForRun(started.id);
  const nested = completed.nodes.find((node) => node.id === "nested");

  assert.equal(completed.status, "succeeded");
  assert.deepEqual(calls, ["inner", "after"]);
  assert.equal(nested.status, "succeeded");
  assert.equal(nested.executorType, "nested_workflow");
  assert.equal(nested.result.output.data.specId, child.id);
  assert.ok(nested.childWorkflow.runId);
});

test("nested workflow entries receive explicit parent artifacts instead of only serialized paths", async () => {
  const child = frozenSpec("child_artifact_input", [definitionNode("inner")], ["inner"]);
  const specs = new Map([[`${child.id}:${child.version}`, child]]);
  const resolveSpec = (specId, version) => specs.get(`${specId}:${version}`) || null;
  const parent = frozenSpec("parent_artifact_input", [
    definitionNode("produce"),
    definitionNode("nested", ["produce"], {
      kind: "workflow",
      executorType: "nested_workflow",
      provider: null,
      model: null,
      workflowRef: { specId: child.id, version: child.version, graphHash: child.graphHash },
    }),
  ], ["produce"], { resolveSpec });
  specs.set(`${parent.id}:${parent.version}`, parent);
  const calls = [];
  const runtime = runtimeForSpecs(memoryStore([...specs.values()]), async (call) => {
    calls.push(call);
    if (call.nodeId === "produce") {
      return {
        text: "artifact ready",
        artifacts: [{ type: "application/pdf", uri: "C:\\evidence\\report.pdf", name: "report.pdf" }],
      };
    }
    return { text: "child consumed input" };
  });
  const started = runtime.startSpec({
    threadId: "thread_nested_artifact_input",
    specId: parent.id,
    version: parent.version,
    prompt: "pass artifact into child",
  });
  const completed = await runtime.waitForRun(started.id);
  const innerCall = calls.find((call) => call.nodeId === "inner");

  assert.equal(completed.status, "succeeded");
  assert.ok(innerCall);
  assert.equal(innerCall.attachments.length, 1);
  assert.equal(innerCall.attachments[0].local_path, "C:\\evidence\\report.pdf");
});

test("nested workflow output is fixed by the child sink and cannot be overridden by the parent", async () => {
  const child = frozenSpec("child_without_artifact", [definitionNode("inner")], ["inner"]);
  const specs = new Map([[`${child.id}:${child.version}`, child]]);
  const resolveSpec = (specId, version) => specs.get(`${specId}:${version}`) || null;
  const parent = frozenSpec("parent_requires_artifact", [
    definitionNode("nested", [], {
      kind: "workflow",
      executorType: "nested_workflow",
      provider: null,
      model: null,
      outputContract: {
        format: "artifact",
        requirements: ["return PDF"],
        requiredArtifactTypes: ["pdf"],
      },
      workflowRef: { specId: child.id, version: child.version, graphHash: child.graphHash },
    }),
    definitionNode("after", ["nested"]),
  ], ["nested"], { resolveSpec });
  specs.set(`${parent.id}:${parent.version}`, parent);
  const calls = [];
  const runtime = runtimeForSpecs(memoryStore([...specs.values()]), async (call) => {
    calls.push(call.nodeId);
    return { text: `${call.nodeId} text only` };
  });
  const started = runtime.startSpec({
    threadId: "thread_nested_contract",
    specId: parent.id,
    version: parent.version,
    prompt: "require nested artifact",
  });
  const completed = await runtime.waitForRun(started.id);
  const nested = completed.nodes.find((node) => node.id === "nested");
  const after = completed.nodes.find((node) => node.id === "after");

  assert.deepEqual(calls, ["inner", "after"]);
  assert.equal(nested.status, "succeeded");
  assert.equal(nested.outputContract.format, "text");
  assert.equal(nested.nodeContract.outputContract.slots[0].type, "text");
  assert.equal(after.status, "succeeded");
});

test("a frozen node enforces its structured output boundary before downstream execution", async () => {
  const spec = frozenSpec("structured_output", [
    definitionNode("structured", [], {
      outputContract: {
        format: "structured_data",
        requirements: ["return machine-readable data"],
      },
    }),
    definitionNode("after", ["structured"]),
  ], ["structured"]);
  const store = memoryStore([spec]);
  const calls = [];
  const runtime = runtimeForSpecs(store, async (call) => {
    calls.push(call.nodeId);
    return { text: "this is not json", confidence: 0.9 };
  });

  const started = runtime.startSpec({
    threadId: "thread_structured_output",
    specId: spec.id,
    version: spec.version,
    prompt: "require structured data",
  });
  const completed = await runtime.waitForRun(started.id);
  const structured = completed.nodes.find((node) => node.id === "structured");
  const after = completed.nodes.find((node) => node.id === "after");

  assert.deepEqual(calls, ["structured"]);
  assert.equal(structured.status, "failed");
  assert.equal(structured.result.error.code, "WORKFLOW_OUTPUT_CONTRACT_NOT_SATISFIED");
  assert.equal(after.status, "cancelled");
});

test("an auto-output node accepts structured data from the unified result envelope", async () => {
  const spec = frozenSpec("auto_output", [
    definitionNode("structured", [], {
      outputContract: {
        format: "auto",
      },
    }),
  ], ["structured"]);
  const store = memoryStore([spec]);
  const runtime = runtimeForSpecs(store, async () => ({
    data: { status: "success", items: [{ id: 1 }] },
    confidence: 0.9,
  }));

  const started = runtime.startSpec({
    threadId: "thread_auto_output",
    specId: spec.id,
    version: spec.version,
    prompt: "return the data requested by the node prompt",
  });
  const completed = await runtime.waitForRun(started.id);
  const structured = completed.nodes.find((node) => node.id === "structured");

  assert.equal(completed.status, "succeeded");
  assert.equal(structured.status, "succeeded");
  assert.deepEqual(structured.result.output.data, {
    status: "success",
    items: [{ id: 1 }],
  });
  assert.deepEqual(structured.outputContract, {
    format: "auto",
    requirements: [],
    requiredArtifactTypes: [],
  });
});

test("low-confidence frozen node output is semantically accepted by the root orchestrator", async () => {
  const spec = frozenSpec("low_confidence", [definitionNode("review")], ["review"]);
  const store = memoryStore([spec]);
  const validationPrompts = [];
  const runtime = runtimeForSpecs(store, async () => ({
    text: "uncertain but useful result",
    confidence: 0.4,
  }), {
    async planWithCodex(call) {
      validationPrompts.push(call.prompt);
      return { text: JSON.stringify({ accepted: true, confidence: 0.86, reason: "meets contract" }) };
    },
  });

  const started = runtime.startSpec({
    threadId: "thread_low_confidence",
    specId: spec.id,
    version: spec.version,
    prompt: "validate uncertain output",
  });
  const completed = await runtime.waitForRun(started.id);
  const review = completed.nodes.find((node) => node.id === "review");

  assert.equal(completed.status, "succeeded");
  assert.equal(review.status, "succeeded");
  assert.equal(review.outputValidation.mode, "root_semantic");
  assert.equal(review.result.confidence, 0.86);
  assert.equal(validationPrompts.length, 1);
  assert.match(validationPrompts[0], /Node prompt:[\s\S]*输出要求：[\s\S]*review complete/);
  assert.match(validationPrompts[0], /Infer the required output from the node prompt/);
  assert.doesNotMatch(validationPrompts[0], /Required output contract|"requirements"/);
});
