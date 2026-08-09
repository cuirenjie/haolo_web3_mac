import assert from "node:assert/strict";
import test from "node:test";

import {
  ClusterWorkflowRuntime,
  workflowNodeLocalContextDecision,
} from "../src/main/workflow/runtime.mjs";

test("node context execution follows the root Codex semantic contract without prompt matching", () => {
  const decision = workflowNodeLocalContextDecision({
    prompt: "这段文字故意提到 README、当前项目和附件，但运行时不应再解析这些词",
    explicitPaths: ["D:/workspace/brief.md"],
    node: {
      contextSelection: {
        needsLocalFiles: false,
        scope: [],
        selectedUploadIds: ["video-1"],
        searchHints: [],
        requiredEvidence: [],
        rationale: "该节点只需理解原生视频。",
        source: "haolo_semantic_plan",
      },
    },
  });

  assert.equal(decision.needed, false);
  assert.equal(decision.reason, "haolo_semantic_plan");
  assert.deepEqual(decision.scope, []);
  assert.deepEqual(decision.selectedUploadIds, ["video-1"]);
});

test("runtime skips workspace scanning when the root Codex semantic plan says the node is self-contained", async () => {
  let contextBuilds = 0;
  let plannerInput = "";
  const providerCalls = [];
  const runtime = new ClusterWorkflowRuntime({
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        contextBuilds += 1;
        return {
          id: "context_should_not_be_used",
          items: [{ path: "plugins/example/README.md", excerpt: "PLUGIN_README_CONTENT" }],
          manifest: [{ path: "plugins/example/README.md" }],
          totalChars: 21,
        };
      },
    },
    async planWithCodex(call) {
      plannerInput = call.prompt;
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "完成短篇小说" },
          nodes: [{
            id: "writer",
            provider: "kimi",
            prompt: "创作完整小说",
            contextSelection: {
              needsLocalFiles: false,
              scope: [],
              selectedUploads: [],
              rationale: "小说创作不依赖本地材料。",
            },
          }],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(call);
      return { text: "小说正文" };
    },
    async executeRootFinal() {
      return { text: "最终小说", turnId: "turn_novel_final" };
    },
  });

  const eventTypes = [];
  let contextStatusWhenWriterStarted = null;
  runtime.on("event", (event) => {
    eventTypes.push(event.type);
    if (event.type === "node.started" && event.payload?.nodeId === "writer") {
      contextStatusWhenWriterStarted = event.run.nodes.find((node) => node.id === "local-context")?.status;
    }
  });
  const terminal = waitForTerminalRun(runtime);
  runtime.start({
    threadId: "thread_novel_without_local_context",
    cwd: "D:/workspace",
    prompt: "请写一篇关于未来 AI 发展的短篇小说",
  });
  const run = await terminal;

  assert.equal(run.status, "succeeded");
  assert.equal(run.metadata.localContextStrategy, "root_semantic_per_node_contract");
  assert.equal(contextBuilds, 0);
  assert.equal(run.contextPackage, null);
  assert.match(plannerInput, /contextSelection/);
  assert.match(plannerInput, /禁止用关键词、正则/);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].node.needsLocalContext, false);
  assert.equal(providerCalls[0].node.localContextDecision.reason, "haolo_semantic_plan");
  assert.equal(providerCalls[0].node.localFileReview.status, "not_used");
  assert.ok(providerCalls[0].node.capabilityManifest.capabilities.some(
    (capability) => capability.id === "local.files.review",
  ));
  assert.doesNotMatch(providerCalls[0].prompt, /PLUGIN_README_CONTENT|显式 ContextPackage/);
  assert.deepEqual(providerCalls[0].node.dependsOn, ["root-plan"]);
  assert.equal(contextStatusWhenWriterStarted, "succeeded");
  assert.ok(eventTypes.indexOf("context.skipped") < eventTypes.indexOf("node.started"));
  assert.match(
    run.nodes.find((node) => node.id === "local-context").result.output.text,
    /已跳过本地材料扫描/,
  );
});

test("runtime lets Haolo prepare context only for external nodes that need it", async () => {
  const contextCalls = [];
  const providerCalls = [];
  const runtime = new ClusterWorkflowRuntime({
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextCollector: async (call) => {
      contextCalls.push(call);
      return {
        id: "context_brief",
        root: call.cwd,
        intent: call.prompt,
        selectionPolicy: "haolo_agent_read_only",
        items: [{
          path: "D:/workspace/brief.md",
          excerpt: "LOCAL_BRIEF_CONTENT",
          sha256: "abc",
        }],
        manifest: [{ path: "D:/workspace/brief.md" }],
        totalChars: 19,
      };
    },
    contextBroker: {
      async buildPackage() {
        throw new Error("legacy broker should not run when Haolo succeeds");
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "总结文件" },
          nodes: [{
            id: "reader",
            provider: "kimi",
            prompt: "总结用户文件",
            contextSelection: {
              needsLocalFiles: true,
              scope: ["uploads"],
              selectedUploads: ["folder-1"],
              searchHints: ["提取 brief 的关键结论"],
              rationale: "总结任务依赖上传文档。",
            },
          }, {
            id: "writer",
            provider: "doubao",
            prompt: "根据上游总结润色文案",
            dependsOn: ["reader"],
            contextSelection: {
              needsLocalFiles: false,
              scope: [],
              selectedUploads: [],
              rationale: "只使用上游结构化总结。",
            },
          }],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(call);
      return { text: "文件总结" };
    },
    async executeRootFinal() {
      return { text: "最终总结", turnId: "turn_file_final" };
    },
  });

  const terminal = waitForTerminalRun(runtime);
  runtime.start({
    threadId: "thread_with_file",
    cwd: "D:/workspace",
    prompt: "请总结我附上的文件夹",
    attachments: [{
      id: "folder-1",
      name: "materials",
      mime: "inode/directory",
      local_path: "D:/workspace/materials",
    }],
  });
  const run = await terminal;

  assert.equal(run.status, "succeeded");
  assert.equal(run.metadata.localContextStrategy, "root_semantic_per_node_contract");
  assert.equal(contextCalls.length, 1);
  assert.deepEqual(contextCalls[0].explicitPaths, ["D:/workspace/materials"]);
  assert.equal(contextCalls[0].includeWorkspace, false);
  const readerCall = providerCalls.find((call) => call.node.id === "reader");
  const writerCall = providerCalls.find((call) => call.node.id === "writer");
  assert.equal(readerCall.node.needsLocalContext, true);
  assert.equal(readerCall.node.localFileReview.status, "granted");
  assert.equal(readerCall.node.localFileReview.grant.subjectNodeId, "reader");
  assert.equal(readerCall.node.localFileReview.grant.delegation, false);
  assert.match(readerCall.prompt, /LOCAL_BRIEF_CONTENT/);
  assert.ok(readerCall.node.dependsOn.includes("local-context"));
  assert.equal(writerCall.node.needsLocalContext, false);
  assert.equal(writerCall.node.localFileReview.status, "not_used");
  assert.doesNotMatch(writerCall.prompt, /LOCAL_BRIEF_CONTENT|显式 ContextPackage/);
  assert.equal(run.contextPackage.selectionPolicy, "quality_optimal_read_only_per_node");
  assert.equal(run.contextPackages.reader.id, "context_brief");
  assert.equal(run.nodes.find((node) => node.id === "reader").contextPackage.id, "context_brief");
  assert.equal("items" in run.contextPackages.reader, false);
  assert.doesNotMatch(JSON.stringify(run), /"excerpt"/);
});

test("runtime retries a transient Haolo context stream disconnect before starting the model node", async () => {
  let collectorCalls = 0;
  let brokerCalls = 0;
  const providerCalls = [];
  const retryEvents = [];
  const runtime = new ClusterWorkflowRuntime({
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    retryDelayMs: 0,
    contextCollector: async (call) => {
      collectorCalls += 1;
      if (collectorCalls < 3) {
        throw new Error(
          "stream disconnected before completion: error sending request for url (https://aiapi.youleai.top/v1/responses)",
        );
      }
      return {
        protocolVersion: 1,
        id: "context_after_retry",
        root: call.cwd,
        intent: call.prompt,
        selectionPolicy: "haolo_agent_read_only",
        createdAt: new Date().toISOString(),
        items: [{
          path: "D:/workspace/brief.md",
          excerpt: "RECOVERED_CONTEXT",
          sha256: "retry",
        }],
        manifest: [{ path: "D:/workspace/brief.md", sha256: "retry" }],
        totalChars: 17,
      };
    },
    contextBroker: {
      async buildPackage() {
        brokerCalls += 1;
        throw new Error("the local fallback must not run after a successful retry");
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "complete the task after a transient disconnect" },
          nodes: [{
            id: "reader",
            provider: "kimi",
            prompt: "analyze the authorized local material",
            contextSelection: {
              needsLocalFiles: true,
              scope: ["current_group"],
              selectedUploads: [],
              rationale: "the task depends on the current group material",
            },
          }],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(call);
      return { text: "model result after context retry" };
    },
    async executeRootFinal() {
      return { text: "final result", turnId: "turn_context_retry_final" };
    },
  });
  runtime.on("event", (event) => {
    if (event.type === "context.retry.scheduled") retryEvents.push(event.payload);
  });

  const terminal = waitForTerminalRun(runtime);
  runtime.start({
    threadId: "thread_context_stream_retry",
    cwd: "D:/workspace",
    prompt: "finish this task using the current group material",
  });
  const run = await terminal;

  assert.equal(run.status, "succeeded");
  assert.equal(collectorCalls, 3);
  assert.equal(brokerCalls, 0);
  assert.equal(providerCalls.length, 1);
  assert.equal(retryEvents.length, 2);
  assert.deepEqual(
    retryEvents.map((event) => [event.failedAttempt, event.nextAttempt]),
    [[1, 2], [2, 3]],
  );
  assert.equal(run.nodes.find((node) => node.id === "reader").localFileReview.status, "granted");
  assert.match(providerCalls[0].prompt, /RECOVERED_CONTEXT/);
});

test("runtime uses the read-only broker when the Haolo context collector fails", async () => {
  let collectorCalls = 0;
  let brokerCalls = 0;
  const providerCalls = [];
  const runtime = new ClusterWorkflowRuntime({
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    retryDelayMs: 0,
    contextCollector: async () => {
      collectorCalls += 1;
      throw new Error("Haolo context envelope is invalid");
    },
    contextBroker: {
      async buildPackage(call) {
        brokerCalls += 1;
        return {
          protocolVersion: 1,
          id: "context_from_read_only_broker",
          root: call.cwd,
          intent: call.prompt,
          selectionPolicy: "quality_optimal_read_only",
          createdAt: new Date().toISOString(),
          items: [{
            path: "D:/workspace/brief.md",
            excerpt: "BROKER_FALLBACK_CONTEXT",
            sha256: "broker",
          }],
          manifest: [{ path: "D:/workspace/brief.md", sha256: "broker" }],
          totalChars: 23,
        };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "complete the task with local fallback context" },
          nodes: [{
            id: "reader",
            provider: "kimi",
            prompt: "analyze the authorized local material",
            contextSelection: {
              needsLocalFiles: true,
              scope: ["current_group"],
              selectedUploads: [],
              rationale: "the task depends on the current group material",
            },
          }],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(call);
      return { text: "model result with broker fallback" };
    },
    async executeRootFinal() {
      return { text: "final result", turnId: "turn_context_broker_fallback_final" };
    },
  });

  const terminal = waitForTerminalRun(runtime);
  runtime.start({
    threadId: "thread_context_broker_fallback",
    cwd: "D:/workspace",
    prompt: "finish this task using the current group material",
  });
  const run = await terminal;

  assert.equal(run.status, "succeeded");
  assert.equal(collectorCalls, 1);
  assert.equal(brokerCalls, 1);
  assert.equal(providerCalls.length, 1);
  assert.equal(run.nodes.find((node) => node.id === "reader").localFileReview.status, "granted");
  assert.match(providerCalls[0].prompt, /BROKER_FALLBACK_CONTEXT/);
});

test("runtime continues model execution with empty context when both context readers fail", async () => {
  let collectorCalls = 0;
  let brokerCalls = 0;
  let finalCalls = 0;
  const providerCalls = [];
  const runtime = new ClusterWorkflowRuntime({
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    retryDelayMs: 0,
    contextCollector: async () => {
      collectorCalls += 1;
      throw new Error(
        "stream disconnected before completion: error sending request for url (https://aiapi.youleai.top/v1/responses)",
      );
    },
    contextBroker: {
      async buildPackage() {
        brokerCalls += 1;
        throw new Error("local read-only fallback unavailable");
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "complete the task despite unavailable optional context" },
          nodes: [{
            id: "analyst",
            provider: "qwen",
            prompt: "complete the analysis with the available information",
            contextSelection: {
              needsLocalFiles: true,
              scope: ["current_group"],
              selectedUploads: [],
              rationale: "local context would improve the analysis",
            },
          }],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(call);
      return { text: "best-effort model result without local context" };
    },
    async executeRootFinal() {
      finalCalls += 1;
      return { text: "final best-effort result", turnId: "turn_empty_context_final" };
    },
  });

  const terminal = waitForTerminalRun(runtime);
  runtime.start({
    threadId: "thread_empty_context_fallback",
    cwd: "D:/workspace",
    prompt: "finish this task even if optional local context is unavailable",
  });
  const run = await terminal;
  const analystNode = run.nodes.find((node) => node.id === "analyst");

  assert.equal(run.status, "succeeded");
  assert.equal(collectorCalls, 3);
  assert.equal(brokerCalls, 1);
  assert.equal(providerCalls.length, 1);
  assert.equal(finalCalls, 1);
  assert.equal(analystNode.status, "succeeded");
  assert.equal(analystNode.localFileReview.status, "failed");
  assert.equal(run.contextPackage.failedPackageCount, 1);
  assert.equal(run.contextPackages.analyst.totalChars, 0);
  assert.match(run.contextPackages.analyst.error.message, /stream disconnected/);
  assert.match(run.contextPackages.analyst.error.message, /local read-only fallback unavailable/);
});

test("runtime keeps parallel dependency outputs out of the reviewer's local-source contract", async () => {
  const contextCalls = [];
  const providerCalls = [];
  let plannerInput = "";
  const runtime = new ClusterWorkflowRuntime({
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextCollector: async (call) => {
      contextCalls.push(call);
      return {
        protocolVersion: 1,
        id: "reviewer_local_source_context",
        root: call.cwd,
        intent: call.prompt,
        selectionPolicy: "haolo_agent_read_only",
        createdAt: new Date().toISOString(),
        items: [{
          path: "D:/workspace/ancient-culture.md",
          excerpt: "AUTHORIZED_ANCIENT_CULTURE_SOURCE",
          sha256: "ancient",
        }],
        manifest: [{
          path: "D:/workspace/ancient-culture.md",
          sha256: "ancient",
        }],
        totalChars: 35,
      };
    },
    async planWithCodex(call) {
      plannerInput = call.prompt;
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "produce a reviewed ancient-culture draft" },
          nodes: [{
            id: "candidate-a",
            provider: "kimi",
            prompt: "prepare the first independent draft",
            contextSelection: {
              needsLocalFiles: false,
              scope: [],
              selectedUploads: [],
              rationale: "the first candidate uses the supplied task",
            },
            coordination: {
              mode: "parallel_candidate",
              parallelGroup: "ancient-culture",
            },
          }, {
            id: "candidate-b",
            provider: "qwen",
            prompt: "prepare the second independent draft",
            contextSelection: {
              needsLocalFiles: false,
              scope: [],
              selectedUploads: [],
              rationale: "the second candidate uses the supplied task",
            },
            coordination: {
              mode: "parallel_candidate",
              parallelGroup: "ancient-culture",
            },
          }, {
            id: "review",
            provider: "claude",
            prompt: "compare both parallel candidate-node outputs against the ancient-culture source",
            dependsOn: ["candidate-a", "candidate-b"],
            contextSelection: {
              needsLocalFiles: true,
              scope: ["current_group"],
              selectedUploads: [],
              searchHints: ["ancient-culture source draft"],
              requiredEvidence: [
                "candidate-a output",
                "candidate-b output",
                "existing ancient-culture source draft",
              ],
              rationale: "the review should verify the candidates against the source",
            },
            coordination: {
              mode: "review_gate",
              parallelGroup: "ancient-culture",
              reviewTargets: ["candidate-a", "candidate-b"],
            },
          }],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(call);
      if (call.node.id === "candidate-a") return { text: "CANDIDATE_A_RUNTIME_OUTPUT" };
      if (call.node.id === "candidate-b") return { text: "CANDIDATE_B_RUNTIME_OUTPUT" };
      assert.equal(call.node.id, "review");
      assert.match(call.prompt, /CANDIDATE_A_RUNTIME_OUTPUT/);
      assert.match(call.prompt, /CANDIDATE_B_RUNTIME_OUTPUT/);
      assert.match(call.prompt, /AUTHORIZED_ANCIENT_CULTURE_SOURCE/);
      return { text: "reviewed candidate result" };
    },
    async executeRootFinal() {
      return { text: "final reviewed result", turnId: "turn_runtime_dependency_boundary_final" };
    },
  });

  const terminal = waitForTerminalRun(runtime);
  runtime.start({
    threadId: "thread_runtime_dependency_boundary",
    cwd: "D:/workspace",
    prompt: "review two independent drafts using the current-group ancient-culture source",
  });
  const run = await terminal;

  assert.equal(run.status, "succeeded");
  assert.match(plannerInput, /requiredEvidence.*dependsOn/s);
  assert.match(plannerInput, /历史用户\/助手反馈/);
  assert.equal(contextCalls.length, 1);
  assert.deepEqual(contextCalls[0].runtimeDependencyNodeIds.sort(), ["candidate-a", "candidate-b"]);
  assert.deepEqual(contextCalls[0].requiredEvidence, []);
  assert.deepEqual(
    contextCalls[0].searchHints,
    [
      "ancient-culture source draft",
      "candidate-a output",
      "candidate-b output",
      "existing ancient-culture source draft",
    ],
  );
  assert.match(contextCalls[0].prompt, /运行时依赖边界/);
  assert.match(contextCalls[0].prompt, /不得在授权目录中查找/);
  assert.equal(providerCalls.length, 3);
  assert.equal(run.nodes.find((node) => node.id === "review").status, "succeeded");
});

test("an explicit all-model request builds an independent context package for every model node", async () => {
  const contextCalls = [];
  const providerCalls = [];
  const runtime = new ClusterWorkflowRuntime({
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage(call) {
        contextCalls.push(call);
        return {
          protocolVersion: 1,
          id: `context_${call.nodeId}`,
          root: call.cwd,
          intent: call.prompt,
          selectionPolicy: "quality_optimal_read_only",
          createdAt: new Date().toISOString(),
          items: [{
            path: `D:/workspace/${call.nodeId}.md`,
            relativePath: `${call.nodeId}.md`,
            excerpt: `LOCAL_CONTENT_FOR_${call.nodeId}`,
            sha256: call.nodeId,
          }],
          manifest: [{
            path: `D:/workspace/${call.nodeId}.md`,
            relativePath: `${call.nodeId}.md`,
            sha256: call.nodeId,
          }],
          totalChars: 24,
        };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "完成本地材料交叉分析" },
          nodes: [{
            id: "facts",
            title: "事实核验",
            provider: "kimi",
            prompt: "独立核验事实",
            contextSelection: {
              needsLocalFiles: true,
              scope: ["current_group"],
              selectedUploads: ["upload-1"],
              rationale: "用户要求每个节点独立审查分组材料。",
            },
          }, {
            id: "risks",
            title: "风险审查",
            provider: "doubao",
            prompt: "独立审查风险",
            contextSelection: {
              needsLocalFiles: true,
              scope: ["current_group"],
              selectedUploads: ["upload-1"],
              rationale: "用户要求每个节点独立审查分组材料。",
            },
          }],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(call);
      return { text: `${call.node.id} result` };
    },
    async executeRootFinal() {
      return { text: "最终分析", turnId: "turn_all_model_files_final" };
    },
  });

  const terminal = waitForTerminalRun(runtime);
  runtime.start({
    threadId: "thread_all_model_files",
    cwd: "D:/workspace",
    prompt: "让所有群聊模型都审查当前分组文件夹里的材料并给出结论",
    attachments: [{
      name: "diagram.png",
      mime: "image/png",
      size: 1234,
      local_path: "D:/workspace/diagram.png",
      url: "https://files.example.test/diagram.png",
    }],
  });
  const run = await terminal;

  assert.equal(run.status, "succeeded");
  assert.equal(contextCalls.length, 2);
  assert.deepEqual(contextCalls.map((call) => call.nodeId).sort(), ["facts", "risks"]);
  assert.ok(contextCalls.every((call) => call.capabilityGrant.capability === "local.files.review"));
  assert.ok(contextCalls.every((call) => call.capabilityGrant.delegation === false));
  for (const call of providerCalls) {
    assert.equal(call.node.localContextDecision.reason, "haolo_semantic_plan");
    assert.equal(call.node.localFileReview.status, "granted");
    assert.match(call.prompt, new RegExp(`LOCAL_CONTENT_FOR_${call.node.id}`));
    const otherNodeId = call.node.id === "facts" ? "risks" : "facts";
    assert.doesNotMatch(call.prompt, new RegExp(`LOCAL_CONTENT_FOR_${otherNodeId}`));
    assert.deepEqual(call.attachments, [{
      id: "upload-1",
      name: "diagram.png",
      mime: "image/png",
      kind: "image",
      delivery: "native_media",
      size: 1234,
      local_path: "D:/workspace/diagram.png",
      url: "https://files.example.test/diagram.png",
      object_key: null,
      material_id: null,
    }]);
  }
  assert.deepEqual(Object.keys(run.contextPackages).sort(), ["facts", "risks"]);
  assert.equal(run.contextPackage.packageCount, 2);
  assert.equal(run.contextPackage.manifest.length, 2);
  assert.doesNotMatch(JSON.stringify(run), /LOCAL_CONTENT_FOR_/);
});

test("a media-only cluster node receives only its semantically selected video and no group context", async () => {
  let contextBuilds = 0;
  const providerCalls = [];
  const runtime = new ClusterWorkflowRuntime({
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        contextBuilds += 1;
        throw new Error("group context must not be built for a media-only node");
      },
    },
    async planWithCodex(call) {
      assert.match(call.prompt, /video-1/);
      assert.match(call.prompt, /brief-1/);
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "准确描述上传视频" },
          nodes: [{
            id: "video-reader",
            provider: "gemini",
            prompt: "查看所选视频并准确描述内容",
            contextSelection: {
              needsLocalFiles: false,
              scope: [],
              selectedUploads: ["video-1"],
              rationale: "用户问题仅依赖原生视频，不需要分组或文档。",
            },
          }],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(call);
      return { text: "视频描述" };
    },
    async executeRootFinal() {
      return { text: "最终视频描述", turnId: "turn_video_final" };
    },
  });

  const terminal = waitForTerminalRun(runtime);
  runtime.start({
    threadId: "thread_cluster_video_only",
    cwd: "D:/workspace",
    prompt: "描述一下这个视频说了什么",
    explicitPaths: ["D:/workspace/brief.md"],
    attachments: [{
      id: "video-1",
      name: "demo.mp4",
      mime: "video/mp4",
      local_path: "D:/uploads/demo.mp4",
    }, {
      id: "brief-1",
      name: "brief.md",
      mime: "text/markdown",
      local_path: "D:/workspace/brief.md",
    }],
  });
  const run = await terminal;

  assert.equal(run.status, "succeeded");
  assert.equal(contextBuilds, 0);
  assert.equal(providerCalls.length, 1);
  assert.deepEqual(providerCalls[0].attachments.map((attachment) => attachment.id), ["video-1"]);
  assert.equal(providerCalls[0].node.needsLocalContext, false);
  assert.deepEqual(providerCalls[0].node.localContextDecision.selectedUploadIds, ["video-1"]);
});

function waitForTerminalRun(runtime) {
  return new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
}
