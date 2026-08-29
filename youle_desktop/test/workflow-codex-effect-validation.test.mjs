import assert from "node:assert/strict";
import test from "node:test";

import {
  unresolvedWorkflowEffectFailures,
  workflowEffectFailureEnvelope,
} from "../src/main/workflow/codex-effect-validation.mjs";

test("reports a trailing failed command as an unrecovered subAgent failure", () => {
  const effects = [
    { id: "read", type: "commandExecution", status: "succeeded", summary: "读取文件" },
    { id: "write", type: "commandExecution", status: "failed", summary: "写入文件" },
  ];
  assert.deepEqual(unresolvedWorkflowEffectFailures(effects), [effects[1]]);
  assert.deepEqual(workflowEffectFailureEnvelope(effects), {
    code: "CODEX_SUBAGENT_EFFECT_FAILED",
    category: "execution",
    retryable: false,
    message: "Haolo 子 Agent 存在未恢复的失败操作：写入文件",
    failedEffects: [effects[1]],
  });
});

test("allows an intermediate command failure when a later command succeeds", () => {
  const effects = [
    { id: "test-before", type: "commandExecution", status: "failed", summary: "初始测试失败" },
    { id: "test-after", type: "commandExecution", status: "succeeded", summary: "修复后测试通过" },
  ];
  assert.deepEqual(unresolvedWorkflowEffectFailures(effects), []);
  assert.equal(workflowEffectFailureEnvelope(effects), null);
});

test("keeps a failed file change unresolved until the same paths are changed successfully", () => {
  const failed = {
    id: "write-1",
    type: "fileChange",
    status: "failed",
    paths: ["D:/workspace/output.md"],
  };
  const unrelatedSuccess = {
    id: "write-2",
    type: "fileChange",
    status: "succeeded",
    paths: ["D:/workspace/other.md"],
  };
  assert.deepEqual(unresolvedWorkflowEffectFailures([failed, unrelatedSuccess]), [failed]);

  const recovered = {
    id: "write-3",
    type: "fileChange",
    status: "succeeded",
    paths: ["D:/workspace/output.md"],
  };
  assert.deepEqual(unresolvedWorkflowEffectFailures([failed, recovered]), []);
});
