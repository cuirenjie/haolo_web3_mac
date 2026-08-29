import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  QuestionAnswerFileContextGateway,
  issueQuestionAnswerCurrentGroupGrant,
  providerMessagesWithQuestionAnswerFileContext,
  publicQuestionAnswerFileAccess,
  questionAnswerContextLimits,
} from "../src/main/workflow/question-answer-file-context.mjs";

async function temporaryWorkspace(name) {
  const directory = path.join(
    os.tmpdir(),
    `haolo-question-answer-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "README.md"), "# Local project\n", "utf8");
  return directory;
}

test("question-answer context preparation does not continue after cancellation", async () => {
  const cwd = await temporaryWorkspace("cancelled");
  const controller = new AbortController();
  let brokerCalled = false;
  const gateway = new QuestionAnswerFileContextGateway({
    intentResolver: {
      async resolve() {
        controller.abort();
        return {
          needsLocalFiles: true,
          scope: ["current_group"],
          strategy: "broad_context_then_on_demand",
        };
      },
    },
    contextBroker: {
      async buildPackage() {
        brokerCalled = true;
        return { items: [], manifest: [], totalChars: 0 };
      },
    },
  });

  try {
    await assert.rejects(
      gateway.prepare({
        cwd,
        prompt: "检查项目",
        signal: controller.signal,
      }),
      (error) => error?.name === "AbortError",
    );
    assert.equal(brokerCalled, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("question-answer gateway follows Haolo's semantic decision instead of a text regex", async () => {
  const cwd = await temporaryWorkspace("gateway");
  const brokerCalls = [];
  const decisions = [
    {
      needsLocalFiles: false,
      intent: "self_contained_greeting",
      scope: [],
      strategy: "none",
      searchHints: [],
      requiredEvidence: [],
    },
    {
      needsLocalFiles: true,
      intent: "repository_review",
      scope: ["current_group"],
      strategy: "broad_context_then_on_demand",
      searchHints: ["architecture"],
      requiredEvidence: ["entry points"],
    },
    {
      needsLocalFiles: true,
      intent: "repository_review",
      scope: ["current_group"],
      strategy: "broad_context_then_on_demand",
      searchHints: ["architecture"],
      requiredEvidence: ["entry points"],
    },
    {
      needsLocalFiles: true,
      intent: "uploaded_document_analysis",
      scope: ["uploads"],
      strategy: "targeted_read",
      selectedUploadIds: ["upload-1"],
      searchHints: ["brief"],
      requiredEvidence: [],
    },
  ];
  const resolverCalls = [];
  const progressEvents = [];
  const deniedProgressEvents = [];
  const gateway = new QuestionAnswerFileContextGateway({
    intentResolver: {
      async resolve(call) {
        resolverCalls.push(call);
        return decisions.shift();
      },
    },
    contextBroker: {
      async buildPackage(call) {
        brokerCalls.push(call);
        return {
          id: "context_gateway",
          items: [],
          manifest: [],
          catalog: ["README.md"],
          candidateCount: 1,
          totalChars: 0,
        };
      },
    },
  });

  try {
    const noContext = await gateway.prepare({ cwd, prompt: "你好" });
    const groupDenied = await gateway.prepare({
      cwd,
      prompt: "请审查这个项目并找出架构问题",
      onProgress: (event) => deniedProgressEvents.push(event),
    });
    const groupRequestId = "interaction-group-granted";
    const groupPrepared = await gateway.prepare({
      cwd,
      prompt: "请审查这个项目并找出架构问题",
      requestId: groupRequestId,
      currentGroupGrant: issueQuestionAnswerCurrentGroupGrant({
        cwd,
        requestId: groupRequestId,
        groupId: "project-group",
      }),
      onProgress: (event) => progressEvents.push(event),
    });
    const uploadedPath = path.join(cwd, "brief.md");
    const uploadPrepared = await gateway.prepare({
      cwd,
      prompt: "分析我刚才提供的材料",
      explicitPaths: [uploadedPath, uploadedPath],
      uploads: [{
        id: "upload-1",
        name: "brief.md",
        kind: "file",
        delivery: "host_read_through",
        path: uploadedPath,
      }],
    });

    assert.equal(noContext.contextPackage, null);
    assert.equal(noContext.workspaceTools, null);
    assert.equal(groupDenied.contextPackage, null);
    assert.equal(groupDenied.decision.needsLocalFiles, false);
    assert.equal(groupDenied.decision.authorization.currentGroup.granted, false);
    assert.equal(groupPrepared.contextPackage.id, "context_gateway");
    assert.equal(groupPrepared.decision.authorization.currentGroup.granted, true);
    assert.equal(groupPrepared.decision.authorization.currentGroup.groupId, "project-group");
    assert.equal(uploadPrepared.contextPackage.id, "context_gateway");
    assert.equal(resolverCalls.length, 4);
    assert.equal(resolverCalls[2].workspaceSummary, undefined);
    assert.equal(brokerCalls.length, 2);
    assert.equal(brokerCalls[0].cwd, cwd);
    assert.equal(brokerCalls[0].prompt, "请审查这个项目并找出架构问题");
    assert.deepEqual(brokerCalls[0].explicitPaths, []);
    assert.deepEqual(brokerCalls[0].searchHints, ["architecture", "entry points"]);
    assert.equal(brokerCalls[0].extractPromptPaths, false);
    assert.equal(brokerCalls[0].includeWorkspace, true);
    assert.equal(brokerCalls[0].maxEnumeratedFiles, 5_000);
    assert.equal(brokerCalls[0].maxSelectedFiles, 32);
    assert.equal(brokerCalls[0].maxContextChars, 240_000);
    assert.equal(brokerCalls[0].minimumCandidateScore, 0);
    assert.deepEqual(brokerCalls[1].explicitPaths, [uploadedPath]);
    assert.equal(brokerCalls[1].includeWorkspace, false);
    assert.equal(groupPrepared.workspaceTools, null);
    assert.deepEqual(groupPrepared.contextDelivery, {
      protocolVersion: 2,
      mode: "single_complete_context",
      statefulContinuation: false,
      repeatedHistorySubmission: false,
      explicitSourcePlan: true,
    });
    assert.deepEqual(
      deniedProgressEvents.map((event) => `${event.stepId}:${event.status}`),
      [
        "context-intent:running",
        "context-intent:completed",
      ],
    );
    assert.deepEqual(
      progressEvents.map((event) => `${event.stepId}:${event.status}`),
      [
        "context-intent:running",
        "context-intent:completed",
        "workspace-scan:running",
        "workspace-scan:completed",
        "context-build:running",
        "context-build:completed",
      ],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("question-answer gateway lets Haolo recursively prepare an uploaded folder context", async () => {
  const cwd = await temporaryWorkspace("folder-collector");
  const folderPath = path.join(cwd, "materials");
  await mkdir(folderPath, { recursive: true });
  await writeFile(path.join(folderPath, "brief.md"), "# Folder brief\n", "utf8");
  const collectorCalls = [];
  const gateway = new QuestionAnswerFileContextGateway({
    intentResolver: {
      async resolve(call) {
        assert.equal(call.currentGroupAuthorized, false);
        return {
          needsLocalFiles: true,
          intent: "uploaded_folder_summary",
          scope: ["uploads"],
          strategy: "targeted_read",
          selectedUploadIds: ["folder-1"],
          searchHints: ["brief"],
          requiredEvidence: [],
          sourcePlan: {
            localFiles: {
              includeCurrentGroup: false,
              attachmentIds: ["folder-1"],
            },
          },
        };
      },
    },
    contextCollector: async (call) => {
      collectorCalls.push(call);
      return {
        protocolVersion: 1,
        id: "context_haolo_folder",
        root: cwd,
        totalChars: 23,
        catalog: ["materials/brief.md"],
        items: [{
          path: folderPath,
          excerpt: "SOURCE brief.md\nFolder brief",
          sha256: "folder-context",
        }],
        manifest: [],
      };
    },
    contextBroker: {
      async buildPackage() {
        throw new Error("legacy broker should not run when Haolo succeeds");
      },
    },
  });

  try {
    const prepared = await gateway.prepare({
      cwd,
      prompt: "总结这个文件夹里的材料",
      explicitPaths: [folderPath],
      uploads: [{
        id: "folder-1",
        name: "materials",
        mime: "inode/directory",
        kind: "folder",
        delivery: "host_read_through",
        path: folderPath,
      }],
    });

    assert.equal(prepared.contextPackage.id, "context_haolo_folder");
    assert.equal(collectorCalls.length, 1);
    assert.equal(collectorCalls[0].includeWorkspace, false);
    assert.deepEqual(collectorCalls[0].explicitPaths, [folderPath]);
    assert.equal(collectorCalls[0].decision.intent, "uploaded_folder_summary");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("question-answer workspace limits stay conservative even when the model window is large", () => {
  const limits = questionAnswerContextLimits({
    currentContextTokens: 1_000,
    modelContextWindow: 2_000_000,
    messageTokens: 20,
    includeWorkspace: true,
  });

  assert.deepEqual(limits, {
    maxEnumeratedFiles: 5_000,
    maxSelectedFiles: 32,
    maxFileChars: 48_000,
    maxContextChars: 240_000,
  });
});

test("a follow-up to a previous video reuses that artifact without scanning the group", async () => {
  const cwd = await temporaryWorkspace("historical-video");
  const progressEvents = [];
  let brokerCalls = 0;
  const conversationTurns = [
    {
      turnId: "turn-video",
      role: "user",
      text: "描述这个视频",
      isCurrent: false,
      attachments: [{
        id: "video-1",
        name: "clip.mp4",
        mime: "video/mp4",
        kind: "video",
        delivery: "native_media",
        source: "conversation_history",
        local_path: "D:/uploads/clip.mp4",
        path: "D:/uploads/clip.mp4",
      }],
    },
    {
      turnId: "turn-answer",
      role: "assistant",
      text: "视频里有几个孩子在水沟捕鱼。",
      isCurrent: false,
      attachments: [],
    },
    {
      turnId: "turn-current",
      role: "user",
      text: "帮我标记出几分几秒分别是什么片段",
      isCurrent: true,
      attachments: [],
    },
  ];
  const gateway = new QuestionAnswerFileContextGateway({
    intentResolver: {
      async resolve() {
        return {
          protocolVersion: 2,
          needsLocalFiles: false,
          intent: "video_timeline_follow_up",
          scope: [],
          strategy: "none",
          sourcePlan: {
            protocolVersion: 2,
            relation: "follow_up_previous_attachment",
            conversation: {
              mode: "referenced_turns",
              selectedTurnIds: ["turn-video", "turn-answer"],
              recentTurnCount: 4,
            },
            attachments: {
              currentAttachmentIds: [],
              historicalAttachmentIds: ["video-1"],
            },
            localFiles: {
              includeCurrentGroup: false,
              attachmentIds: [],
              strategy: "none",
              searchHints: [],
              requiredEvidence: [],
            },
          },
        };
      },
    },
    contextBroker: {
      async buildPackage() {
        brokerCalls += 1;
        throw new Error("group files must not be read");
      },
    },
  });

  try {
    const prepared = await gateway.prepare({
      cwd,
      prompt: "帮我标记出几分几秒分别是什么片段",
      conversationTurns,
      onProgress: (event) => progressEvents.push(event),
    });

    assert.equal(prepared.contextPackage, null);
    assert.equal(brokerCalls, 0);
    assert.deepEqual(
      prepared.providerAttachments.map((attachment) => attachment.id),
      ["video-1"],
    );
    assert.equal(progressEvents.at(-1).title, "已识别为历史附件追问");
    assert.match(progressEvents.at(-1).detail, /历史对话、1 个历史附件/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a self-contained video request sends native media without scanning or attaching group files", async () => {
  const cwd = await temporaryWorkspace("native-video");
  const progressEvents = [];
  let brokerCalls = 0;
  const gateway = new QuestionAnswerFileContextGateway({
    intentResolver: {
      async resolve(call) {
        assert.equal(call.uploads.length, 1);
        assert.equal(call.uploads[0].kind, "video");
        assert.equal(call.uploads[0].delivery, "native_media");
        return {
          needsLocalFiles: false,
          intent: "self_contained_video_description",
          scope: [],
          strategy: "none",
          selectedUploadIds: [],
          searchHints: [],
          requiredEvidence: [],
        };
      },
    },
    contextBroker: {
      async buildPackage() {
        brokerCalls += 1;
        throw new Error("group files must not be read");
      },
    },
  });

  try {
    const videoPath = path.join(cwd, "clip.mp4");
    const prepared = await gateway.prepare({
      cwd,
      prompt: "描述一下这个视频说了什么",
      explicitPaths: [videoPath],
      uploads: [{
        id: "video-1",
        name: "clip.mp4",
        mime: "video/mp4",
        kind: "video",
        delivery: "native_media",
        path: videoPath,
      }],
      onProgress: (event) => progressEvents.push(event),
    });

    assert.equal(prepared.contextPackage, null);
    assert.equal(prepared.decision.needsLocalFiles, false);
    assert.equal(brokerCalls, 0);
    assert.deepEqual(
      progressEvents.map((event) => `${event.stepId}:${event.status}`),
      [
        "context-intent:running",
        "context-intent:completed",
      ],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("question-answer file context identifies the Haolo-prepared read-only source bundle", () => {
  const prepared = {
    decision: {
      needsLocalFiles: true,
      intent: "repository_review",
      scope: ["current_group"],
      strategy: "broad_context_then_on_demand",
      source: "haolo_semantic",
    },
    contextPackage: {
      protocolVersion: 1,
      id: "context_question_answer",
      root: "D:/workspace/group-a",
      intent: "review local project",
      selectionPolicy: "quality_optimal_read_only",
      createdAt: "2026-07-27T00:00:00.000Z",
      totalChars: 16,
      candidateCount: 2,
      catalog: ["brief.md", "src/main.ts"],
      items: [{
        path: "D:/workspace/group-a/brief.md",
        relativePath: "brief.md",
        excerpt: "LOCAL_QA_CONTENT",
        sha256: "abc",
      }],
      manifest: [{
        path: "D:/workspace/group-a/brief.md",
        relativePath: "brief.md",
        sha256: "abc",
      }],
    },
    workspaceTools: null,
    contextDelivery: {
      protocolVersion: 1,
      mode: "single_complete_context",
      statefulContinuation: false,
      repeatedHistorySubmission: false,
    },
  };
  const messages = providerMessagesWithQuestionAnswerFileContext(
    [{ role: "user", content: "请审查项目" }],
    prepared,
  );
  const audit = publicQuestionAnswerFileAccess(prepared);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /read-only local context agent/);
  assert.match(messages[0].content, /external model has no direct filesystem access/);
  assert.match(messages[0].content, /Host-selected group directory boundary/);
  assert.match(messages[0].content, /LOCAL_QA_CONTENT/);
  assert.match(messages[0].content, /src\/main\.ts/);
  assert.equal(audit.accessMode, "question_answer_host_read_through");
  assert.equal(audit.rootCodexGrantRequired, false);
  assert.equal(audit.contextDecision.intent, "repository_review");
  assert.equal(audit.toolAccess, null);
  assert.equal(audit.contextDelivery.mode, "single_complete_context");
  assert.equal(audit.contextDelivery.repeatedHistorySubmission, false);
  assert.equal(audit.contextPackage.manifest.length, 1);
  assert.equal("items" in audit.contextPackage, false);
  assert.doesNotMatch(JSON.stringify(audit), /LOCAL_QA_CONTENT/);
});

test("question-answer messages are unchanged when semantic decision skips files", () => {
  const source = [{ role: "user", content: "你好" }];
  const prepared = {
    decision: {
      needsLocalFiles: false,
      intent: "self_contained_greeting",
      strategy: "none",
    },
    contextPackage: null,
    workspaceTools: null,
  };
  assert.equal(providerMessagesWithQuestionAnswerFileContext(source, prepared), source);
  assert.equal(publicQuestionAnswerFileAccess(null), null);
  assert.equal(
    publicQuestionAnswerFileAccess(prepared).contextDecision.needsLocalFiles,
    false,
  );
});
