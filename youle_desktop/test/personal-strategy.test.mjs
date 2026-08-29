import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PersonalStrategyService,
  compilePersonalStrategy,
  evaluatePersonalStrategy,
  personalStrategyManifest,
} from "../src/main/personal-strategy/service.mjs";
import {
  personalStrategyUrls,
  readPersonalStrategyUrls,
  safePersonalStrategyUrl,
  strategyDocumentText,
} from "../src/main/personal-strategy/source-ingestion.mjs";
import {
  parseStrategyConfirmationIntent,
  parseStrategyUnderstanding,
  strategyConfirmationIntentPrompt,
  strategyUnderstandingCompilerText,
  strategyUnderstandingDisplayText,
  strategyUnderstandingPrompt,
} from "../src/main/personal-strategy/understanding.mjs";
import {
  PERSONAL_STRATEGY_MAX_RETRIES,
  chunkPersonalStrategyAttachments,
  classifyPersonalStrategyFailure,
  mergePersonalStrategyUnderstandings,
  personalStrategyRetryDelayMs,
} from "../src/main/personal-strategy/pipeline.mjs";

function safeStorageFixture() {
  const transform = (buffer) => Buffer.from([...buffer].map((byte) => byte ^ 0xa5));
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => transform(Buffer.from(value, "utf8")),
    decryptString: (value) => transform(value).toString("utf8"),
  };
}

function candles(count = 80) {
  const result = [];
  let price = 100;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    const close = price + (index < 40 ? 0.12 : index % 2 ? 0.5 : -0.1);
    result.push({ time: index + 1, open, high: Math.max(open, close) + 0.2, low: Math.min(open, close) - 0.2, close, volume: 100 + index * 2 });
    price = close;
  }
  return result;
}

test("personal strategy compiler preserves direction, exception, risk and robust Chinese punctuation", () => {
  const compiled = compilePersonalStrategy("策略名称：回踩 EMA20 只做多；收盘上穿 EMA20 且放量才入场，跌破 EMA20 止损，除非已经盈利 2R。", {});
  assert.equal(compiled.name, "回踩 EMA20");
  assert.equal(compiled.spec.direction, "long");
  assert.equal(compiled.spec.rules.some((rule) => rule.type === "cross_above"), true);
  assert.equal(compiled.spec.rules.some((rule) => rule.type === "cross_below"), false);
  assert.equal(compiled.spec.rules.some((rule) => rule.type === "volume_expansion"), true);
  assert.equal(compiled.spec.exceptions.length > 0, true);
  assert.equal(compiled.spec.warnings.length > 0, true);
});
test("personal strategy compiler does not turn negated or exit-only language into an entry rule", () => {
  const short = compilePersonalStrategy("不要做多，只有收盘跌破 EMA20 才做空，向上穿回 EMA20 只是退出");
  assert.equal(short.spec.direction, "short");
  assert.equal(short.spec.rules.some((rule) => rule.type === "cross_below"), true);
  assert.equal(short.spec.rules.some((rule) => rule.type === "cross_above"), false);
});

test("personal strategy compiler respects an explicit two-way direction", () => {
  const both = compilePersonalStrategy("多空均可：收盘价上穿或下穿 EMA20 时按对应方向入场");
  assert.equal(both.spec.direction, "both");
  assert.equal(both.questions.some((question) => /确认方向/iu.test(question)), false);
});

test("personal strategy compiler lets the latest user correction override an earlier direction and trigger", () => {
  const corrected = compilePersonalStrategy("收盘上穿 EMA20 只做多；用户修订：应该改成收盘跌破 EMA20，只做空");
  assert.equal(corrected.spec.direction, "short");
  assert.equal(corrected.spec.rules.some((rule) => rule.type === "cross_below"), true);
  assert.equal(corrected.spec.rules.some((rule) => rule.type === "cross_above"), false);
});

test("personal strategy confirmation intent parser accepts only the model contract", () => {
  const prompt = strategyConfirmationIntentPrompt({
    userText: "没问题，按这个执行",
    strategyName: "回踩均线",
    lastAssistantMessage: "预演完成，是否创建策略？",
  });
  assert.match(prompt, /confirm\|cancel\|revise\|unclear/);
  assert.deepEqual(parseStrategyConfirmationIntent('{"intent":"confirm","confidence":0.97,"reason":"用户明确接受预演"}'), {
    ok: true,
    intent: "confirm",
    confidence: 0.97,
    reason: "用户明确接受预演",
    rawText: '{"intent":"confirm","confidence":0.97,"reason":"用户明确接受预演"}',
  });
  assert.equal(parseStrategyConfirmationIntent("没问题").ok, false);
  assert.equal(parseStrategyConfirmationIntent('{"intent":"revise","confidence":0.8}').intent, "revise");
});

test("personal strategy engine returns a safe read-only plan and drawing patch", () => {
  const compiled = compilePersonalStrategy("收盘价上穿 EMA20，只做多，止损按最近低点，止盈 2R");
  const result = evaluatePersonalStrategy({ ...compiled.spec, strategyId: "personal-test" }, candles(), { marketId: "BTCUSDT", interval: "1H" });
  assert.equal(result.ok, true);
  assert.equal(result.analysisPlan.drawingPatch.operations.length >= 4, true);
  assert.match(result.analysisPlan.report, /不会自动下单/);
  assert.equal(result.strategyResult, undefined);
});

test("personal strategy lifecycle requires simulation confirmation, encrypts records, and versions feedback", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-personal-strategy-"));
  try {
    const service = new PersonalStrategyService({
      storagePath: path.join(tempRoot, "personal-strategies.json"),
      vaultPath: path.join(tempRoot, "vault"),
      safeStorage: safeStorageFixture(),
      now: () => new Date("2026-08-17T08:00:00.000Z"),
    });
    const draftResult = await service.createDraft("owner-a", { text: "收盘价上穿 EMA20 只做多，止损 95，止盈 110", name: "我的回踩策略", understanding: { summary: "模型从资料中理解为 EMA20 上穿只做多", direction: "long", evidence: [{ source: "规则.pdf", locator: "第 2 页", meaning: "收盘确认" }], confidence: 0.88 } });
    assert.equal(draftResult.draft.status, "draft");
    assert.equal((await service.list("owner-b")).length, 0);
    const simulationResult = await service.simulate("owner-a", { draftId: draftResult.draft.id, candles: candles() });
    assert.equal(simulationResult.simulation.status, "completed");
    assert.equal(Array.isArray(simulationResult.simulation.generated.primary), true);
    assert.equal(simulationResult.simulation.visualization.marketId, "SIMULATION");
    assert.equal(simulationResult.simulation.triggerBarIndex >= 0, true);
    const active = await service.confirm("owner-a", { draftId: draftResult.draft.id, simulationId: simulationResult.simulation.simulationId });
    assert.equal(active.status, "active");
    assert.equal(active.version, "1.0.0");
    assert.equal(personalStrategyManifest(active).personalContext.direction, "long");
    assert.match(personalStrategyManifest(active).personalContext.understanding.summary, /模型从资料中理解/);
    assert.equal(fs.existsSync(path.join(tempRoot, "vault", "Strategies")), true);
    const markdown = fs.readFileSync(path.join(tempRoot, "vault", "Strategies", fs.readdirSync(path.join(tempRoot, "vault", "Strategies"))[0]), "utf8");
    assert.match(markdown, /模型从资料中理解/);
    assert.match(markdown, /规则\.pdf/);
    const persisted = fs.readFileSync(path.join(tempRoot, "personal-strategies.json"), "utf8");
    assert.doesNotMatch(persisted, /收盘价上穿|我的回踩策略/);
    const optimized = await service.feedback("owner-a", { strategyId: active.id, text: "再加一条：必须放量，且只在 1 小时周期使用。" });
    assert.equal(optimized.strategy.status, "draft");
    assert.equal(optimized.strategy.version, "1.1.0");
    const optimizedSimulation = await service.simulate("owner-a", { draftId: optimized.strategy.id, candles: candles() });
    const optimizedActive = await service.confirm("owner-a", { draftId: optimized.strategy.id, simulationId: optimizedSimulation.simulation.simulationId });
    assert.equal(optimizedActive.version, "1.1.0");
    await assert.rejects(service.confirm("owner-a", { draftId: active.id, simulationId: "stale" }), (error) => error.code === "STRATEGY_CONFIRMATION_STALE");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("personal strategy source ingestion reads public text safely and strips active HTML", async () => {
  assert.equal(safePersonalStrategyUrl("http://localhost:3000/rules"), "");
  assert.equal(safePersonalStrategyUrl("https://127.0.0.1/rules"), "");
  assert.equal(safePersonalStrategyUrl("https://example.com/rules?api_key=secret"), "");
  assert.deepEqual(personalStrategyUrls("参考 https://example.com/rules。再看 https://example.org/a"), [
    "https://example.com/rules",
    "https://example.org/a",
  ]);
  assert.equal(strategyDocumentText("<script>alert(1)</script><h1>只做多</h1><p>收盘上穿 EMA20</p>", "text/html"), "只做多\n收盘上穿 EMA20");
  const result = await readPersonalStrategyUrls("https://example.com/rules", {
    fetchImpl: async () => new Response("<article><h1>只做多</h1><p>放量上穿 EMA20</p></article>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  });
  assert.equal(result.warnings.length, 0);
  assert.match(result.documents[0].content, /放量上穿 EMA20/);
});

test("personal strategy understanding accepts fenced JSON and produces compiler-safe text", () => {
  const parsed = parseStrategyUnderstanding(`模型说明：\n\`\`\`json\n${JSON.stringify({
    schemaVersion: 1,
    name: "图片 EMA 策略",
    summary: "收盘上穿 EMA20 且放量后只做多",
    direction: "long",
    entryRules: [{ type: "cross_above", text: "收盘价上穿 EMA20" }, { type: "volume_expansion", text: "放量确认" }],
    exitRules: [{ type: "cross_below", text: "跌破 EMA20 止损" }],
    risk: { riskReward: 2 },
    evidence: [{ source: "截图.png", locator: "第 1 页", meaning: "图中标注 EMA20 上穿" }],
    questions: [],
    uncertainties: [],
    confidence: 0.91,
    compilerText: "收盘价上穿 EMA20 且放量，只做多，跌破 EMA20 止损，盈亏比 2R",
  })}\n\`\`\``);
  assert.equal(parsed.ok, true);
  const compilerText = strategyUnderstandingCompilerText(parsed.understanding, "用户原文");
  assert.match(compilerText, /EMA20/);
  assert.match(strategyUnderstandingDisplayText(parsed.understanding), /截图\.png/);
  assert.match(strategyUnderstandingPrompt({ sourceText: "读取截图中的策略", attachmentSummary: "- 截图.png（image/png）" }), /只输出一个 JSON 对象/);
});

test("personal strategy pipeline splits attachments and classifies stage failures", () => {
  const attachments = [{ name: "a.png" }, { name: "b.pdf" }, { name: "c.docx" }, { name: "d.png" }];
  assert.deepEqual(chunkPersonalStrategyAttachments(attachments), [attachments.slice(0, 3), attachments.slice(3)]);
  assert.equal(PERSONAL_STRATEGY_MAX_RETRIES, 2);
  assert.equal(personalStrategyRetryDelayMs(1) < personalStrategyRetryDelayMs(2), true);
  assert.equal(classifyPersonalStrategyFailure({ code: "PERSONAL_STRATEGY_ATTACHMENT_READ_TIMEOUT", message: "60s" }).kind, "attachment_read_timeout");
  assert.equal(classifyPersonalStrategyFailure({ code: "PERSONAL_STRATEGY_MODEL_TIMEOUT", message: "120s" }).kind, "model_timeout");
  assert.match(classifyPersonalStrategyFailure({ code: "PROVIDER_FIRST_BYTE_TIMEOUT", message: "timeout" }, "model").userMessage, /首响应/);
  assert.match(classifyPersonalStrategyFailure({ code: "PROVIDER_STREAM_INACTIVITY_TIMEOUT", message: "timeout" }, "model").userMessage, /生成中断/);
  assert.equal(classifyPersonalStrategyFailure(new Error("websocket closed by server"), "model").kind, "network_disconnected");
  assert.equal(classifyPersonalStrategyFailure({ code: "STREAM_DISCONNECTED", message: "模型流式响应在完成前断开" }, "model").kind, "network_disconnected");
  assert.equal(classifyPersonalStrategyFailure(new Error("流式响应在完成前断开"), "model").kind, "network_disconnected");
  assert.match(classifyPersonalStrategyFailure({ code: "STRATEGY_NAME_CONFLICT", message: "已有同名策略" }, "compiler").userMessage, /同名策略/);
  assert.match(classifyPersonalStrategyFailure({ code: "STRATEGY_NOT_FOUND", message: "找不到个人策略" }, "compiler").userMessage, /找不到正在编辑/);
});

test("personal strategy pipeline merges understanding from attachment batches without inventing rules", () => {
  const merged = mergePersonalStrategyUnderstandings([
    { name: "EMA策略", summary: "上穿 EMA20", direction: "long", entryRules: [{ type: "cross_above", text: "收盘上穿 EMA20" }], confidence: 0.8 },
    { name: "", summary: "放量确认", direction: "long", entryRules: [{ type: "volume_expansion", text: "成交量高于均值" }], exitRules: [{ type: "cross_below", text: "跌破 EMA20" }], confidence: 0.6 },
  ], { rawText: "批次资料" });
  assert.equal(merged.direction, "long");
  assert.equal(merged.entryRules.length, 2);
  assert.equal(merged.exitRules.length, 1);
  assert.equal(merged.confidence, 0.7);
  assert.match(merged.rawText, /批次资料/);
});

test("personal strategy UI and IPC keep the minimal flow and both themes wired", () => {
  const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const preload = fs.readFileSync(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
  const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  assert.match(main, /ipcMain\.handle\("personalStrategy:createDraft"/);
  assert.match(main, /ipcMain\.handle\("personalStrategy:simulate"/);
  assert.match(main, /ipcMain\.handle\("personalStrategy:confirm"/);
  assert.match(main, /ipcMain\.handle\("personalStrategy:feedback"/);
  assert.match(main, /personal-strategy-understanding/);
  assert.match(main, /strategyMediaAttachments/);
  assert.match(main, /PERSONAL_STRATEGY_ATTACHMENT_BATCH_SIZE/);
  assert.match(main, /PERSONAL_STRATEGY_ATTACHMENT_READ_TIMEOUT_MS/);
  assert.match(main, /preparedPersonalStrategySourceContexts/);
  assert.match(main, /modelPreparationIds/);
  assert.match(main, /personalStrategyRetryDelayMs/);
  assert.match(main, /personalContext:/);
  assert.match(preload, /createPersonalStrategyDraft/);
  assert.match(preload, /preparePersonalStrategySource/);
  assert.match(renderer, /@创建策略/);
  assert.match(renderer, /@策略:/);
  assert.match(renderer, /模拟预演/);
  assert.match(renderer, /重新理解/);
  assert.match(renderer, /GitHub 版本管理/);
  assert.match(renderer, /runPersonalStrategyConversation/);
  assert.match(renderer, /runPersonalStrategyUnderstanding/);
  assert.match(renderer, /PERSONAL_STRATEGY_MAX_RETRIES/);
  assert.match(renderer, /maxTransportAttempts: 1/);
  assert.match(renderer, /personalStrategySourcePreparationId/);
  assert.match(renderer, /label: "智能体正在理解策略资料", detail: ""/);
  assert.doesNotMatch(renderer, /智能体正在理解策略资料（尝试/);
  assert.doesNotMatch(renderer, /PERSONAL_STRATEGY_MODEL_TIMEOUT_MS/);
  assert.match(renderer, /附件读取超时/);
  assert.match(renderer, /网络连接中断/);
  assert.match(renderer, /chunkPersonalStrategyAttachments/);
  assert.match(renderer, /strategyUnderstandingPrompt/);
  assert.match(renderer, /strategyConfirmationIntentPrompt/);
  assert.match(renderer, /parseStrategyConfirmationIntent/);
  assert.match(renderer, /personal-strategy-understanding-confirmation-intent/);
  assert.match(renderer, /stream: false/);
  assert.match(renderer, /不会重复发送“确认”/);
  assert.match(renderer, /confirmationSimulationId/);
  assert.match(renderer, /personalStrategyConversationByThreadId/);
  assert.match(main, /detail: `\$\{batchLabel\}：正在提取 \$\{batch\.length\} 个附件`/);
  assert.doesNotMatch(main, /正在提取 \$\{batch\.length\} 个附件（尝试/);
  assert.doesNotMatch(main, /次重试）/);
  assert.doesNotMatch(renderer, /await openPersonalStrategyCreation\(text\)/);
  assert.match(styles, /\.personal-strategy-dialog/);
  assert.match(styles, /\.personal-strategy-dialog\s*\{[\s\S]*?position: fixed;[\s\S]*?z-index: 81/);
  assert.match(styles, /html\[data-theme="dark"\] \.personal-strategy-dialog/);
  assert.match(styles, /personal-strategy-dialog-actions button:disabled/);
});
