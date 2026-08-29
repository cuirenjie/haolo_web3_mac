import assert from "node:assert/strict";
import test from "node:test";

import {
  groupChatMessagesForMember,
} from "../src/main/group-chat-context-coordinator.mjs";
import {
  normalizeGroupChatTaskPlan,
} from "../src/main/group-chat-task-planner.mjs";
import {
  providerMessagesWithQuestionAnswerConversationPlan,
} from "../src/main/workflow/question-answer-conversation-context.mjs";

test("a targeted reviewer receives every semantically required candidate even when the second planner selects none", () => {
  const participants = [
    { selectionId: "gpt", name: "GPT" },
    { selectionId: "deepseek", name: "DeepSeek" },
    { selectionId: "gemini", name: "Gemini" },
  ];
  const history = [
    {
      role: "assistant",
      content: "DeepSeek 更早且与本轮无关的回复",
      contextTurnId: "deepseek-unrelated",
      groupChatMemberId: "deepseek",
    },
    {
      role: "user",
      content: "请分别写一篇短文。",
      contextTurnId: "writing-request",
      groupChatScopedUserMessage: true,
      groupChatTaskAssignments: {
        gpt: "独立写一篇短文。",
        deepseek: "独立写一篇短文。",
        gemini: "独立写一篇短文。",
      },
    },
    {
      role: "assistant",
      content: "GPT 的候选短文",
      contextTurnId: "gpt-candidate",
      groupChatMemberId: "gpt",
    },
    {
      role: "assistant",
      content: "DeepSeek 的候选短文",
      contextTurnId: "deepseek-candidate",
      groupChatMemberId: "deepseek",
    },
    {
      role: "assistant",
      content: "Gemini 的候选短文",
      contextTurnId: "gemini-candidate",
      groupChatMemberId: "gemini",
    },
  ];
  const current = {
    role: "user",
    content: "@DeepSeek 你帮我看下谁写得最好",
    contextTurnId: "current-question",
    groupChatScopedUserMessage: true,
  };
  const plan = normalizeGroupChatTaskPlan({
    assignments: [{
      selectionId: "deepseek",
      taskPrompt: "比较 GPT、DeepSeek 和 Gemini 上一轮的三篇候选短文，选出写得最好的一篇并说明依据。",
      historyTurnIds: [
        "gpt-candidate",
        "deepseek-candidate",
        "gemini-candidate",
      ],
      historyMemberIds: ["gpt", "gemini"],
      threadReferenceIds: [],
      rationale: "用户要求 DeepSeek 比较上一轮全部候选回复。",
    }],
  }, {
    targets: [participants[1]],
    participants,
    conversationTurns: history.map((message) => ({
      turnId: message.contextTurnId,
      role: message.role,
      memberId: message.groupChatMemberId || null,
    })),
  });
  const assignment = plan.assignments[0];
  const scoped = groupChatMessagesForMember([...history, current], {
    memberId: assignment.selectionId,
    allowedHistoryMemberIds: assignment.historyMemberIds,
    requiredHistoryTurnIds: assignment.historyTurnIds,
    currentText: assignment.taskPrompt,
  });
  const finalProviderMessages =
    providerMessagesWithQuestionAnswerConversationPlan(
      scoped,
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
      { requiredTurnIds: assignment.historyTurnIds },
    );

  assert.deepEqual(
    finalProviderMessages.map((message) => message.contextTurnId),
    [
      "writing-request",
      "gpt-candidate",
      "deepseek-candidate",
      "gemini-candidate",
      "current-question",
    ],
  );
  assert.equal(finalProviderMessages.at(-1).content, assignment.taskPrompt);
  assert.equal(
    finalProviderMessages.some(
      (message) => message.contextTurnId === "deepseek-unrelated",
    ),
    false,
  );
});
