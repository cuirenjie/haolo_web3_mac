import assert from "node:assert/strict";
import test from "node:test";

import {
  QuestionAnswerContextIntentResolver,
  normalizeSemanticDecision,
  semanticDecisionPrompt,
} from "../src/main/workflow/question-answer-context-intent.mjs";

test("Haolo semantic context resolver accepts a structured code-review decision", async () => {
  let decisionRequest = null;
  const resolver = new QuestionAnswerContextIntentResolver({
    decide: async (request) => {
      decisionRequest = request;
      return {
        text: JSON.stringify({
          protocolVersion: 1,
          needsLocalFiles: true,
          intent: "repository_code_review",
          scope: ["current_group"],
          strategy: "broad_context_then_on_demand",
          searchHints: ["entry points", "error handling"],
          requiredEvidence: ["implementation", "tests"],
          confidence: 0.96,
          rationale: "The answer depends on the imported project.",
        }),
      };
    },
  });

  const decision = await resolver.resolve({
    cwd: "D:/project",
    prompt: "帮我 review 一下代码，指出潜在问题",
    workspaceSummary: {
      available: true,
      readableFileCount: 400,
      topLevel: [{ name: "src", kind: "directory" }],
    },
    threadReferences: [{
      threadId: "referenced-thread",
      title: "此前的架构讨论",
      selectionMode: "selected",
      selectedTurnIds: ["turn-1", "turn-2"],
    }],
  });

  assert.equal(decision.needsLocalFiles, true);
  assert.equal(decision.intent, "repository_code_review");
  assert.equal(decision.strategy, "broad_context_then_on_demand");
  assert.deepEqual(decision.searchHints, ["entry points", "error handling"]);
  assert.match(decisionRequest.prompt, /semantic decision/i);
  assert.match(decisionRequest.prompt, /Do not use keyword or regular-expression matching/);
  assert.match(decisionRequest.prompt, /帮我 review 一下代码/);
  assert.match(decisionRequest.prompt, /referenced-thread/);
  assert.match(decisionRequest.prompt, /"selectedTurnCount":2/);
});

test("semantic decision failure preserves recent conversation without scanning the group", async () => {
  const resolver = new QuestionAnswerContextIntentResolver({
    decide: async () => {
      throw new Error("internal classifier unavailable");
    },
  });
  const decision = await resolver.resolve({
    cwd: "D:/project",
    prompt: "分析当前内容",
  });

  assert.equal(decision.needsLocalFiles, false);
  assert.equal(decision.strategy, "none");
  assert.equal(decision.source, "resilient_fallback");
  assert.equal(decision.sourcePlan.localFiles.includeCurrentGroup, false);
  assert.equal(decision.error.code, "CONTEXT_INTENT_DECISION_FAILED");
});

test("semantic decision cancellation is terminal instead of falling back and continuing", async () => {
  const controller = new AbortController();
  const resolver = new QuestionAnswerContextIntentResolver({
    decide: async () => {
      controller.abort();
      const error = new Error("cancelled");
      error.name = "AbortError";
      throw error;
    },
  });

  await assert.rejects(
    resolver.resolve({
      cwd: "D:/project",
      prompt: "分析当前内容",
      signal: controller.signal,
    }),
    (error) => error?.name === "AbortError",
  );
});

test("native media does not force local file context when Haolo decides the request is self-contained", () => {
  const decision = normalizeSemanticDecision({
    needsLocalFiles: false,
    intent: "self_contained_video_description",
    scope: [],
    strategy: "none",
  }, {
    uploads: [{
      id: "video-1",
      name: "clip.mp4",
      mime: "video/mp4",
      kind: "video",
      delivery: "native_media",
      path: "D:/uploads/clip.mp4",
    }],
  });

  assert.equal(decision.needsLocalFiles, false);
  assert.deepEqual(decision.scope, []);
  assert.deepEqual(decision.selectedUploadIds, []);
  assert.equal(decision.strategy, "none");
});

test("Haolo can select only a necessary uploaded document without reading the current group", () => {
  const decision = normalizeSemanticDecision({
    needsLocalFiles: true,
    intent: "uploaded_document_summary",
    scope: ["uploads"],
    strategy: "targeted_read",
    selectedUploads: ["brief"],
  }, {
    uploads: [
      {
        id: "brief",
        name: "brief.md",
        kind: "file",
        delivery: "host_read_through",
        path: "D:/uploads/brief.md",
      },
      {
        id: "appendix",
        name: "appendix.md",
        kind: "file",
        delivery: "host_read_through",
        path: "D:/uploads/appendix.md",
      },
    ],
  });

  assert.equal(decision.needsLocalFiles, true);
  assert.deepEqual(decision.scope, ["uploads"]);
  assert.deepEqual(decision.selectedUploadIds, ["brief"]);
  assert.equal(decision.strategy, "targeted_read");
});

test("semantic prompt explicitly optimizes for sufficient evidence", () => {
  const prompt = semanticDecisionPrompt({
    mode: "question_answer",
    userPrompt: "review this project",
    currentGroup: {
      root: "D:/project",
      authorized: true,
    },
  });
  assert.match(prompt, /highest-quality answer/);
  assert.match(prompt, /native_media/);
  assert.match(prompt, /historical attachments/);
  assert.match(prompt, /selectedTurnIds/);
  assert.match(prompt, /threadReferences/);
  assert.match(prompt, /separate reference-context channel/);
  assert.match(prompt, /uncertainty alone is not permission to scan/);
  assert.match(prompt, /selected folder is read recursively/);
  assert.match(prompt, /currentGroup\.authorized=true/);
  assert.doesNotMatch(prompt, /keyword list|regular-expression gate/i);
});

test("resolver tells Haolo whether the selected group is authorized", async () => {
  let plannerPrompt = "";
  const resolver = new QuestionAnswerContextIntentResolver({
    decide: async ({ prompt }) => {
      plannerPrompt = prompt;
      return {
        text: JSON.stringify({
          protocolVersion: 2,
          relation: "new_request",
          sourcePlan: {
            conversation: { mode: "none", selectedTurnIds: [], recentTurnCount: 4 },
            attachments: { currentAttachmentIds: [], historicalAttachmentIds: [] },
            localFiles: {
              includeCurrentGroup: true,
              attachmentIds: [],
              strategy: "broad_context_then_on_demand",
              searchHints: [],
              requiredEvidence: [],
            },
          },
        }),
      };
    },
  });

  const decision = await resolver.resolve({
    cwd: "D:/project",
    prompt: "看看当前文件写了什么",
    currentGroupAuthorized: true,
  });

  assert.match(plannerPrompt, /"authorized":true/);
  assert.equal(decision.sourcePlan.localFiles.includeCurrentGroup, true);
  assert.equal(decision.needsLocalFiles, true);
});

test("Haolo can select a previous video and conversation exchange without local files", () => {
  const conversationTurns = [
    {
      turnId: "turn-video",
      role: "user",
      text: "描述一下这个视频",
      isCurrent: false,
      attachments: [{
        id: "video-1",
        name: "clip.mp4",
        mime: "video/mp4",
        kind: "video",
        delivery: "native_media",
        local_path: "D:/uploads/clip.mp4",
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
  const decision = normalizeSemanticDecision({
    protocolVersion: 2,
    relation: "follow_up_previous_attachment",
    intent: "video_timeline_follow_up",
    sourcePlan: {
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
    confidence: 0.99,
    rationale: "The current request asks for timestamps from the previous video.",
  }, { conversationTurns });

  assert.equal(decision.needsLocalFiles, false);
  assert.equal(decision.sourcePlan.relation, "follow_up_previous_attachment");
  assert.deepEqual(
    decision.sourcePlan.conversation.selectedTurnIds,
    ["turn-video", "turn-answer"],
  );
  assert.deepEqual(
    decision.sourcePlan.attachments.historicalAttachmentIds,
    ["video-1"],
  );
  assert.equal(decision.sourcePlan.localFiles.includeCurrentGroup, false);
});

test("Haolo can request exact Host-side frames from a selected historical video", () => {
  const conversationTurns = [
    {
      turnId: "turn-video",
      role: "user",
      text: "Describe this video",
      isCurrent: false,
      attachments: [{
        id: "video-1",
        name: "clip.mp4",
        mime: "video/mp4",
        kind: "video",
        delivery: "native_media",
        local_path: "D:/uploads/clip.mp4",
      }],
    },
    {
      turnId: "turn-timeline",
      role: "assistant",
      text: "2.5s-6.7s shows the children fishing in the ditch.",
      isCurrent: false,
      attachments: [],
    },
    {
      turnId: "turn-current",
      role: "user",
      text: "Send me the first and last frame images of that segment.",
      isCurrent: true,
      attachments: [],
    },
  ];
  const decision = normalizeSemanticDecision({
    protocolVersion: 2,
    relation: "follow_up_previous_attachment",
    intent: "extract_video_segment_boundary_frames",
    sourcePlan: {
      conversation: {
        mode: "referenced_turns",
        selectedTurnIds: ["turn-timeline"],
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
      },
      derivedMedia: {
        operation: "extract_video_frames",
        attachmentId: "video-1",
        timestampsSeconds: [2.5, 6.7, 6.7, -1, "invalid"],
        labels: ["片段首帧", "片段尾帧"],
      },
    },
  }, { conversationTurns });

  assert.deepEqual(decision.sourcePlan.derivedMedia, {
    operation: "extract_video_frames",
    attachmentId: "video-1",
    timestampsSeconds: [2.5, 6.7],
    labels: ["片段首帧", "片段尾帧"],
  });
  assert.equal(decision.needsLocalFiles, false);
});

test("an invalid referenced turn degrades to recent conversation instead of group files", () => {
  const conversationTurns = [
    {
      turnId: "turn-answer",
      role: "assistant",
      text: "上一轮结论",
      isCurrent: false,
      attachments: [],
    },
    {
      turnId: "turn-current",
      role: "user",
      text: "继续解释刚才的第二点",
      isCurrent: true,
      attachments: [],
    },
  ];
  const decision = normalizeSemanticDecision({
    protocolVersion: 2,
    relation: "follow_up_previous_answer",
    intent: "answer_follow_up",
    sourcePlan: {
      conversation: {
        mode: "referenced_turns",
        selectedTurnIds: ["expired-turn-id"],
        recentTurnCount: 6,
      },
      attachments: {
        currentAttachmentIds: [],
        historicalAttachmentIds: [],
      },
      localFiles: {
        includeCurrentGroup: false,
        attachmentIds: [],
        strategy: "none",
      },
    },
  }, { conversationTurns });

  assert.equal(decision.sourcePlan.conversation.mode, "recent");
  assert.deepEqual(decision.sourcePlan.conversation.selectedTurnIds, []);
  assert.equal(decision.sourcePlan.localFiles.includeCurrentGroup, false);
  assert.equal(decision.needsLocalFiles, false);
});
