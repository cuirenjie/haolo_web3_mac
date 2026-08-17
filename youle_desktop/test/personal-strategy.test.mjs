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
  parseStrategyUnderstanding,
  strategyUnderstandingCompilerText,
  strategyUnderstandingDisplayText,
  strategyUnderstandingPrompt,
} from "../src/main/personal-strategy/understanding.mjs";

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
  assert.match(renderer, /strategyUnderstandingPrompt/);
  assert.match(renderer, /stream: false/);
  assert.match(renderer, /clarificationAffirmation/);
  assert.match(renderer, /personalStrategyConversationByThreadId/);
  assert.doesNotMatch(renderer, /await openPersonalStrategyCreation\(text\)/);
  assert.match(styles, /\.personal-strategy-dialog/);
  assert.match(styles, /\.personal-strategy-dialog\s*\{[\s\S]*?position: fixed;[\s\S]*?z-index: 81/);
  assert.match(styles, /html\[data-theme="dark"\] \.personal-strategy-dialog/);
  assert.match(styles, /personal-strategy-dialog-actions button:disabled/);
});
