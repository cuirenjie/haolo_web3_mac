import assert from "node:assert/strict";
import test from "node:test";

import {
  GroupChatTaskPlanner,
  groupChatTaskPlanningPrompt,
  normalizeGroupChatTaskPlan,
} from "../src/main/group-chat-task-planner.mjs";

const targets = [
  {
    selectionId: "haolo",
    name: "Haolo",
    provider: "codex",
    model: "gpt-5.6",
  },
  {
    selectionId: "gemini",
    name: "Gemini",
    provider: "google",
    model: "gemini-3.5-flash",
  },
  {
    selectionId: "grok",
    name: "Grok",
    provider: "xai",
    model: "grok-4.5",
  },
];

test("Haolo semantically assigns a different standalone prompt to every mentioned model", async () => {
  let plannerPrompt = "";
  const planner = new GroupChatTaskPlanner({
    decide: async ({ prompt }) => {
      plannerPrompt = prompt;
      return {
        text: JSON.stringify({
          protocolVersion: 1,
          assignments: [
            {
              selectionId: "haolo",
              taskPrompt: "写一篇题为《我的父亲》的作文。",
              historyTurnIds: [],
              historyMemberIds: [],
              threadReferenceIds: [],
              rationale: "用户把作文任务交给 Haolo。",
            },
            {
              selectionId: "gemini",
              taskPrompt: "查询深圳当前天气并给出简洁说明。",
              historyTurnIds: [],
              historyMemberIds: [],
              threadReferenceIds: [],
              rationale: "用户把天气任务交给 Gemini。",
            },
            {
              selectionId: "grok",
              taskPrompt: "调研 X 上关于中文 AI 圈的观点趋势。",
              historyTurnIds: [],
              historyMemberIds: [],
              threadReferenceIds: [],
              rationale: "用户把 X 趋势任务交给 Grok。",
            },
          ],
        }),
      };
    },
  });

  const plan = await planner.plan({
    cwd: "D:/workspace",
    text: "@Haolo 帮我写一篇作文，题目是：我的父亲 @Gemini 帮我查询深圳的天气 @Grok 帮我看 X 上关于中文 AI 圈的观点趋势",
    targets,
    participants: targets,
  });

  assert.deepEqual(
    plan.assignments.map(({ selectionId, taskPrompt }) => ({
      selectionId,
      taskPrompt,
    })),
    [
      {
        selectionId: "haolo",
        taskPrompt: "写一篇题为《我的父亲》的作文。",
      },
      {
        selectionId: "gemini",
        taskPrompt: "查询深圳当前天气并给出简洁说明。",
      },
      {
        selectionId: "grok",
        taskPrompt: "调研 X 上关于中文 AI 圈的观点趋势。",
      },
    ],
  );
  assert.match(plannerPrompt, /Mention tokens only identify which members should respond/);
  assert.match(plannerPrompt, /Never split the message by mention position/);
  assert.match(plannerPrompt, /neverUseRegexForTaskBoundaries/);
  assert.match(plannerPrompt, /excludeUnrelatedTargetTasks/);
  assert.match(plannerPrompt, /Selected history turns become mandatory context/);
  assert.match(plannerPrompt, /我的父亲/);
});

test("shared wording is resolved semantically instead of assigning by mention ranges", () => {
  const prompt = groupChatTaskPlanningPrompt({
    protocolVersion: 1,
    userMessage: "基于同一份报告，@Haolo @Gemini 你们分别独立审阅；@Grok 只核验社交媒体趋势。",
    targets,
  });

  assert.match(prompt, /Resolve shared premises, pronouns, coordinated wording/);
  assert.match(prompt, /If several targets genuinely share one task/);
  assert.match(prompt, /independently executable version/);
  assert.doesNotMatch(prompt, /slice from each @/i);
});

test("semantic planner can authorize only the exact historical member and reference needed", () => {
  const plan = normalizeGroupChatTaskPlan({
    assignments: [
      {
        selectionId: "haolo",
        taskPrompt: "根据 Gemini 之前的天气答复写出出行建议。",
        historyTurnIds: ["gemini-answer"],
        historyMemberIds: ["gemini", "gemini", "unknown"],
        threadReferenceIds: ["weather-thread", "unknown-reference"],
      },
      {
        selectionId: "gemini",
        taskPrompt: "重新核验深圳天气。",
        historyMemberIds: [],
        threadReferenceIds: ["weather-thread"],
      },
      {
        selectionId: "grok",
        taskPrompt: "仅核验 X 上的中文 AI 趋势。",
        historyMemberIds: [],
        threadReferenceIds: [],
      },
    ],
  }, {
    targets,
    participants: targets,
    conversationTurns: [
      {
        turnId: "gemini-answer",
        role: "assistant",
        memberId: "gemini",
        content: "深圳天气答复",
      },
    ],
    threadReferences: [
      { threadId: "weather-thread", name: "天气资料" },
    ],
  });

  assert.deepEqual(plan.assignments[0].historyTurnIds, ["gemini-answer"]);
  assert.deepEqual(plan.assignments[0].historyMemberIds, ["gemini"]);
  assert.deepEqual(plan.assignments[0].threadReferenceIds, ["weather-thread"]);
  assert.deepEqual(plan.assignments[1].threadReferenceIds, ["weather-thread"]);
});

test("semantic planner keeps exact prior replies, including the target's own candidate", () => {
  const plan = normalizeGroupChatTaskPlan({
    assignments: [
      {
        selectionId: "haolo",
        taskPrompt: "比较上一轮三个成员的回答并选出最佳答案。",
        historyTurnIds: ["haolo-answer", "gemini-answer", "grok-answer"],
        historyMemberIds: ["gemini", "grok"],
        threadReferenceIds: [],
      },
      {
        selectionId: "gemini",
        taskPrompt: "独立继续当前任务。",
        historyTurnIds: [],
        historyMemberIds: [],
        threadReferenceIds: [],
      },
      {
        selectionId: "grok",
        taskPrompt: "独立继续当前任务。",
        historyTurnIds: [],
        historyMemberIds: [],
        threadReferenceIds: [],
      },
    ],
  }, {
    targets,
    participants: targets,
    conversationTurns: [
      { turnId: "haolo-answer", role: "assistant", memberId: "haolo" },
      { turnId: "gemini-answer", role: "assistant", memberId: "gemini" },
      { turnId: "grok-answer", role: "assistant", memberId: "grok" },
    ],
  });

  assert.deepEqual(plan.assignments[0].historyTurnIds, [
    "haolo-answer",
    "gemini-answer",
    "grok-answer",
  ]);
  assert.deepEqual(plan.assignments[0].historyMemberIds, ["gemini", "grok"]);
});

test("invalid or incomplete GPT output fails closed instead of broadcasting the original request", () => {
  assert.throws(
    () => normalizeGroupChatTaskPlan({
      assignments: [
        {
          selectionId: "haolo",
          taskPrompt: "只完成作文。",
        },
      ],
    }, { targets }),
    (error) => (
      error?.code === "GROUP_CHAT_TASK_PLAN_INVALID"
      && /did not assign every selected target/i.test(error.message)
    ),
  );

  assert.throws(
    () => normalizeGroupChatTaskPlan("not-json", { targets }),
    (error) => error?.code === "GROUP_CHAT_TASK_PLAN_INVALID",
  );

  assert.throws(
    () => normalizeGroupChatTaskPlan({
      assignments: targets.map((target) => ({
        selectionId: target.selectionId,
        taskPrompt: `完成 ${target.name} 的独立任务。`,
        historyTurnIds: target.selectionId === "haolo"
          ? ["missing-history-turn"]
          : [],
        historyMemberIds: [],
        threadReferenceIds: [],
      })),
    }, {
      targets,
      participants: targets,
      conversationTurns: [
        {
          turnId: "known-history-turn",
          role: "assistant",
          memberId: "gemini",
        },
      ],
    }),
    (error) => (
      error?.code === "GROUP_CHAT_TASK_PLAN_INVALID"
      && /outside the supplied conversation/i.test(error.message)
    ),
  );
});

test("an unavailable Haolo planner stops the round instead of using a deterministic text split", async () => {
  const planner = new GroupChatTaskPlanner({
    decide: async () => {
      throw new Error("planner unavailable");
    },
  });

  await assert.rejects(
    planner.plan({
      cwd: "D:/workspace",
      text: "@Haolo 写作文 @Gemini 查天气 @Grok 看趋势",
      targets,
    }),
    /planner unavailable/,
  );
});
