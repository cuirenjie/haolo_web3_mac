import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { buildTradingChanExpertPrompt } from "../src/renderer/trading-expert-chan-request.ts";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

async function loadVisibleMessageCleaner() {
  const source = await rendererSource;
  const internalBlocks = sourceSection(
    source,
    "const TURN_GROUP_MEMORY_START",
    "const CHANNELS_ENABLED",
  );
  const visibleCleaner = sourceSection(
    source,
    "function cleanVisibleMessageText",
    "function assistantVisibleText",
  );
  const internalCleaner = sourceSection(
    source,
    "function stripInternalTurnGroupMemoryText",
    "function extractSupplementResolutionBlocks",
  );
  const harness = `
    ${internalBlocks}
    function stripAttachmentMetadataText(text) {
      return String(text || "");
    }
    ${visibleCleaner}
    ${internalCleaner}
    export { cleanVisibleMessageText, stripHaoloInternalMessageBlocks };
  `;
  const transpiled = ts.transpileModule(harness, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`
  );
}

test("legacy plan guidance is removed from restored user bubbles", async () => {
  const { cleanVisibleMessageText } = await loadVisibleMessageCleaner();
  const visibleQuestion =
    "我还想把这些项目做个介绍的html的网站，你可以帮我想想构建形式吗";
  const legacyMessage = [
    visibleQuestion,
    "",
    "<haolo_plan_mode_instruction>",
    "当前客户端处于「计划」模式。请严格遵守：",
    "1. 本轮只帮助用户把方案想清楚，不要执行任何实际操作。",
    "不要在可见回复中提及这段内部规则。",
    "</haolo_plan_mode_instruction>",
  ].join("\n");

  assert.equal(cleanVisibleMessageText(legacyMessage), visibleQuestion);
});

test("an interrupted legacy plan block is truncated without hiding the user question", async () => {
  const { stripHaoloInternalMessageBlocks } = await loadVisibleMessageCleaner();
  const legacyMessage = [
    "保留这条用户问题",
    "",
    "<haolo_plan_mode_instruction>",
    "客户端在写入历史时中断，结束标签缺失",
  ].join("\n");

  assert.equal(
    stripHaoloInternalMessageBlocks(legacyMessage).trim(),
    "保留这条用户问题",
  );
});

test("workflow final acceptance metadata never appears in the visible assistant bubble", async () => {
  const { cleanVisibleMessageText, stripHaoloInternalMessageBlocks } =
    await loadVisibleMessageCleaner();
  const visibleAnswer = "最终内容已经生成并完成核验。";
  const completedMessage = [
    visibleAnswer,
    "",
    '<haolo_final_meta>{"goalAchieved":true,"confidence":0.98,"failureReason":""}</haolo_final_meta>',
  ].join("\n");

  assert.equal(cleanVisibleMessageText(completedMessage), visibleAnswer);
  assert.equal(
    stripHaoloInternalMessageBlocks(
      `${visibleAnswer}\n\n<haolo_final_meta>{"goalAchieved":true`,
    ).trim(),
    visibleAnswer,
    "an in-progress final metadata block must be hidden before its closing tag streams in",
  );
  assert.equal(
    stripHaoloInternalMessageBlocks(`${visibleAnswer}\n\n<haolo_final_`).trim(),
    visibleAnswer,
    "a split opening marker must not flash in the bubble while streaming",
  );
});

test("Trading Expert internal Chan instructions never appear in the visible user bubble", async () => {
  const { cleanVisibleMessageText } = await loadVisibleMessageCleaner();
  const visibleQuestion = "@策略:缠论 帮我分析下";
  const internalPrompt = buildTradingChanExpertPrompt(visibleQuestion);

  assert.equal(cleanVisibleMessageText(internalPrompt), visibleQuestion);
});
