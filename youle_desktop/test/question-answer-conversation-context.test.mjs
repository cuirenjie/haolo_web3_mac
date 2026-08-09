import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeQuestionAnswerConversationTurns,
  providerAttachmentsForQuestionAnswerPlan,
  providerMessagesWithQuestionAnswerConversationPlan,
  semanticConversationTurns,
  selectedHostAttachmentPathsForPlan,
} from "../src/main/workflow/question-answer-conversation-context.mjs";

test("conversation turns preserve roles, stable ids, and historical attachment references", () => {
  const turns = normalizeQuestionAnswerConversationTurns([
    {
      role: "user",
      content: "描述视频",
      contextTurnId: "turn-video",
      attachments: [{
        id: "video-1",
        name: "clip.mp4",
        mime: "video/mp4",
        local_path: "D:/uploads/clip.mp4",
      }],
    },
    {
      role: "assistant",
      content: "视频里有几个孩子。",
      contextTurnId: "turn-answer",
    },
    {
      role: "user",
      content: "标记每个时间片段",
      contextTurnId: "turn-current",
    },
  ]);

  assert.deepEqual(turns.map((turn) => turn.turnId), [
    "turn-video",
    "turn-answer",
    "turn-current",
  ]);
  assert.equal(turns[0].attachments[0].source, "conversation_history");
  assert.equal(turns[0].attachments[0].delivery, "native_media");
  assert.equal(turns[2].isCurrent, true);
});

test("source plan keeps only referenced conversation exchanges and reuses selected video", () => {
  const messages = [
    { role: "user", content: "无关旧问题", contextTurnId: "old-user" },
    { role: "assistant", content: "无关旧回答", contextTurnId: "old-answer" },
    {
      role: "user",
      content: "描述视频",
      contextTurnId: "turn-video",
      attachments: [{
        id: "video-1",
        name: "clip.mp4",
        mime: "video/mp4",
        local_path: "D:/uploads/clip.mp4",
      }],
    },
    { role: "assistant", content: "视频描述", contextTurnId: "turn-answer" },
    { role: "user", content: "标记时间片段", contextTurnId: "turn-current" },
  ];
  const turns = normalizeQuestionAnswerConversationTurns(messages);
  const sourcePlan = {
    conversation: {
      mode: "referenced_turns",
      selectedTurnIds: ["turn-video"],
    },
    attachments: {
      currentAttachmentIds: [],
      historicalAttachmentIds: ["video-1"],
    },
    localFiles: {
      includeCurrentGroup: false,
      attachmentIds: [],
    },
  };
  const selectedMessages = providerMessagesWithQuestionAnswerConversationPlan(
    messages,
    { decision: { sourcePlan } },
  );
  const selectedAttachments = providerAttachmentsForQuestionAnswerPlan(
    turns,
    sourcePlan,
  );

  assert.deepEqual(
    selectedMessages.map((message) => message.contextTurnId),
    ["turn-video", "turn-answer", "turn-current"],
  );
  assert.deepEqual(
    selectedAttachments.map((attachment) => attachment.id),
    ["video-1"],
  );
});

test("mandatory group history survives a second semantic plan that selects no conversation", () => {
  const messages = [
    {
      role: "assistant",
      content: "DeepSeek 的候选回答",
      contextTurnId: "deepseek-answer",
    },
    {
      role: "assistant",
      content: "Gemini 的候选回答",
      contextTurnId: "gemini-answer",
    },
    {
      role: "assistant",
      content: "与本轮无关的旧回答",
      contextTurnId: "unrelated-answer",
    },
    {
      role: "user",
      content: "谁写得最好？",
      contextTurnId: "current-question",
    },
  ];

  const selected = providerMessagesWithQuestionAnswerConversationPlan(
    messages,
    {
      decision: {
        sourcePlan: {
          conversation: {
            mode: "none",
            selectedTurnIds: [],
          },
        },
      },
    },
    {
      requiredTurnIds: ["deepseek-answer", "gemini-answer"],
    },
  );

  assert.deepEqual(
    selected.map((message) => message.contextTurnId),
    ["deepseek-answer", "gemini-answer", "current-question"],
  );
});

test("historical documents are selected explicitly without enabling the current group", () => {
  const turns = normalizeQuestionAnswerConversationTurns([
    {
      role: "user",
      content: "分析这个文档",
      contextTurnId: "turn-doc",
      attachments: [{
        id: "doc-1",
        name: "brief.md",
        mime: "text/markdown",
        local_path: "D:/uploads/brief.md",
      }],
    },
    {
      role: "user",
      content: "继续核对第二部分",
      contextTurnId: "turn-current",
    },
  ]);
  const paths = selectedHostAttachmentPathsForPlan(turns, {
    localFiles: {
      includeCurrentGroup: false,
      attachmentIds: ["doc-1"],
    },
  });

  assert.deepEqual(paths, ["D:/uploads/brief.md"]);
});

test("semantic planning bounds oversized history without changing the selected full turn", () => {
  const longText = `开头-${"中".repeat(20_000)}-结尾`;
  const turns = normalizeQuestionAnswerConversationTurns([
    {
      role: "assistant",
      content: longText,
      contextTurnId: "turn-long",
    },
    {
      role: "user",
      content: "继续",
      contextTurnId: "turn-current",
    },
  ]);
  const semanticTurns = semanticConversationTurns(turns);

  assert.equal(turns[0].text, longText);
  assert.ok(semanticTurns[0].text.length <= 12_100);
  assert.match(semanticTurns[0].text, /^开头-/);
  assert.match(semanticTurns[0].text, /-结尾$/);
});

test("historical group media keeps its member attribution through provider selection", () => {
  const turns = normalizeQuestionAnswerConversationTurns([
    {
      role: "assistant",
      content: "生成的参考图",
      contextTurnId: "mimo-answer",
      attachments: [{
        id: "mimo-image",
        name: "mimo.png",
        mime: "image/png",
        local_path: "D:/uploads/mimo.png",
        groupChatMemberId: "mimo",
        groupChatMemberName: "MiMo",
      }],
    },
    {
      role: "user",
      content: "继续",
      contextTurnId: "current",
    },
  ]);
  const selected = providerAttachmentsForQuestionAnswerPlan(turns, {
    attachments: {
      currentAttachmentIds: [],
      historicalAttachmentIds: ["mimo-image"],
    },
  });
  assert.equal(selected[0].groupChatMemberId, "mimo");
  assert.equal(selected[0].groupChatMemberName, "MiMo");
});
