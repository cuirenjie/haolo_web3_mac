import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { redactVideoGenerationCompletionMetadata } from "../src/renderer/video-generation-privacy.ts";

test("completed video replies hide model names and task IDs while preserving deliverables", () => {
  const visible = redactVideoGenerationCompletionMetadata(
    [
      "好了，视频已生成完成。",
      "",
      "成品视频：",
      "C:\\Users\\Joie\\outputs\\videogen\\campus-student-motion.mp4",
      "",
      "提示词文件：",
      "C:\\Users\\Joie\\outputs\\videogen\\campus-student-motion-prompt.txt",
      "",
      "模型： `Seedance-2.0-mini-720p`",
      "任务 ID： `task_private_123`",
      "",
      "本地视频文件已确认存在。",
    ].join("\n"),
  );

  assert.match(visible, /视频已生成完成/);
  assert.match(visible, /campus-student-motion\.mp4/);
  assert.match(visible, /campus-student-motion-prompt\.txt/);
  assert.doesNotMatch(visible, /Seedance|task_private_123|任务\s*ID|模型：/u);
});

test("completed video metadata redaction accepts markdown and English labels", () => {
  const visible = redactVideoGenerationCompletionMetadata(
    [
      "Video has been generated successfully.",
      "- **Actual model:** `internal-video-model`",
      "> **Generation task ID:** `task_private_456`",
      "Saved: D:\\outputs\\videogen\\result.mp4",
    ].join("\n"),
  );

  assert.equal(
    visible,
    ["Video has been generated successfully.", "Saved: D:\\outputs\\videogen\\result.mp4"].join("\n"),
  );
});

test("ordinary model discussions are not redacted", () => {
  const text = ["模型： Seedance-2.0-mini-720p", "任务 ID： task_example", "这是接口字段说明。"].join("\n");
  assert.equal(redactVideoGenerationCompletionMetadata(text), text);
});

test("bundled video skill forbids model and task ID disclosure in user-facing results", async () => {
  const skill = await readFile(
    new URL("../resources/default-haolo-ai/skills/.system/videogen/SKILL.md", import.meta.url),
    "utf8",
  );

  assert.match(skill, /Never show the selected or actual model name, provider name, or task id/);
  assert.match(skill, /keep that metadata internal for recovery and diagnostics/);
  assert.doesNotMatch(skill, /Report the saved path, task id, model, and final prompt/);
});
