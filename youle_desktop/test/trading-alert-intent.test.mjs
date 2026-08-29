import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ALERT_INTENT_MAX_PROTOCOL_ATTEMPTS,
  accumulatedAlertIntentContext,
  buildAlertIntentClarificationPrompt,
  buildAlertIntentPrompt,
  buildAlertIntentRepairPrompt,
  createAppServerAlertIntentProvider,
  createAlertIntentProviderRegistry,
  normalizeAlertIntentRequest,
  normalizeAlertIntentResponse,
  sanitizeAlertIntentText,
} from "../src/main/trading-alerts/intent-provider.mjs";
import {
  TradingAlertCapabilityRegistry,
  capabilityResolutionGuide,
  createBuiltinCapabilityRegistry,
  requirementsFromRule,
  resolveRuleCapabilities,
} from "../src/main/trading-alerts/capabilities.mjs";
import {
  clarificationQuestions,
  compileAlertDraft,
  createConfirmationBinding,
  summarizeAlertRule,
  verifyConfirmationBinding,
  resumeDraftAfterCapabilities,
} from "../src/main/trading-alerts/intent-workflow.mjs";
import { normalizeAlertRule } from "../src/main/trading-alerts/protocol.mjs";
import { TradingAlertStore } from "../src/main/trading-alerts/store.mjs";

const fixture = normalizeAlertRule(JSON.parse(await readFile(new URL("./fixtures/trading-alerts/ma-macd-rule.v1.json", import.meta.url), "utf8")));

test("clarification questions are plain Chinese, deduplicated by meaning, and capped", () => {
  const questions = clarificationQuestions({
    existingQuestions: [
      "趋势线触碰条件请选择：同一根K线同时触碰两条、触碰任意一条，还是仅监控指定的一条？",
      "当前K线成交量大于前一根K线成交量后，是盘中立即预警，还是等待4小时K线收盘确认？",
      "请确认指的是画布上的哪条线，并保留该画线对象。",
    ],
    missingFields: ["evaluationTiming", "drawingBinding"],
    ambiguities: [
      "触碰两条趋势线不明确是同一根K线同时触碰两条、触碰任意一条，还是只监控其中指定的一条；量能高于前一根K线时不明确盘中立即确认还是等待当前4小时K线收盘确认",
    ],
  });

  assert.deepEqual(questions, [
    "两条趋势线中，触碰任意一条就预警，还是必须两条都触碰才预警？",
    "当前K线成交量大于前一根K线成交量后，是盘中立即预警，还是等待4小时K线收盘确认？",
  ]);
  assert.doesNotMatch(questions.join("\n"), /evaluationTiming|drawingBinding|明确取值/);
});

test("rewritten any-line versus both-lines questions collapse to one clarification", () => {
  const questions = clarificationQuestions({
    existingQuestions: [
      "是两条都碰到才提醒，还是碰到任意一条就提醒？",
      "两条趋势线中，触碰任意一条就预警，还是必须两条都触碰才预警？",
      "任一条趋势线触及 K 线就提醒，还是两条都触及才提醒？",
    ],
  });

  assert.deepEqual(questions, [
    "两条趋势线中，触碰任意一条就预警，还是必须两条都触碰才预警？",
  ]);
});

test("grammatical variants of any-line versus all-lines share one semantic clarification slot", () => {
  const variants = [
    "是任意一条线被触碰就预警，还是两条线都被触碰才预警？",
    "任一条趋势线触及就提醒，还是两条趋势线均被触及后提醒？",
    "碰到其中一条即可，或是必须两条线全部碰到才算？",
    "任何一条画线满足就触发，还是两条画线缺一不可？",
  ];
  const questions = clarificationQuestions({
    existingQuestions: variants,
    ambiguities: ["两条趋势线的触碰关系未明确：任意一条触碰即可，还是必须两条都触碰"],
  });

  assert.deepEqual(questions, [
    "两条趋势线中，触碰任意一条就预警，还是必须两条都触碰才预警？",
  ]);
});

test("a clear clarification answer suppresses both repeated drawing questions and full-rule restatement", () => {
  const conversation = [
    { role: "user", text: "当K线触碰我画的两条趋势线，并且量能比前一根高时预警" },
    { role: "assistant", text: "任意一条还是两条都触碰？" },
    { role: "user", text: "触碰任意一条就预警" },
  ];
  const questions = clarificationQuestions({
    sourceText: conversation[0].text,
    conversation,
    existingQuestions: [
      "要监控下降线、上升线，还是两条都要？",
      "请用一句话说明：什么情况发生时需要提醒你？",
    ],
    missingFields: ["rule"],
  });

  assert.deepEqual(questions, []);
});

function request(sourceText = fixture.sourceText) {
  return {
    schemaVersion: 1,
    requestId: "intent-request-1",
    draftId: "draft-intent-1",
    sourceText,
    conversation: [],
    currentChart: { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "1h" },
    drawings: [],
    availableCapabilities: ["market.ohlcv"],
    locale: "zh-CN",
  };
}

test("intent prompt explicitly merges clarification replies with the original rule", () => {
  const normalizedRequest = normalizeAlertIntentRequest({
    ...request("当K线触碰我画的两条趋势线，并且量能比前一根高时预警"),
    conversation: [
      { role: "user", text: "当K线触碰我画的两条趋势线，并且量能比前一根高时预警" },
      { role: "assistant", text: "任意一条还是两条都触碰？" },
      { role: "user", text: "触碰任意一条就预警" },
    ],
  });
  const accumulated = accumulatedAlertIntentContext(normalizedRequest);
  const prompt = buildAlertIntentPrompt(normalizedRequest);

  assert.equal(accumulated.originalInstruction, "当K线触碰我画的两条趋势线，并且量能比前一根高时预警");
  assert.deepEqual(accumulated.clarificationAnswers, ["触碰任意一条就预警"]);
  assert.match(prompt, /用户后续确认：触碰任意一条就预警/);
  assert.match(prompt, /禁止再问上升线\/下降线\/选哪条/);
});

test("accumulated intent keeps its original source when bounded history no longer contains the original turn", () => {
  const normalizedRequest = normalizeAlertIntentRequest({
    ...request("当MA5死叉MA20并且MACD下穿零轴时预警"),
    conversation: [
      { role: "user", text: "等待当前4小时K线收盘确认" },
      { role: "assistant", text: "只提醒一次还是重复提醒？" },
    ],
  });

  assert.equal(
    accumulatedAlertIntentContext(normalizedRequest).originalInstruction,
    "当MA5死叉MA20并且MACD下穿零轴时预警",
  );
});

function provider(response) {
  return {
    providerId: "scripted",
    modelId: "fixture-model",
    async compile(input) {
      assert.match(input.prompt, /只把用户意图编译成候选规则/);
      return { json: { schemaVersion: 1, requestId: input.requestId, ...response } };
    },
  };
}

test("provider retries once when a model repeats an already answered clarification", async () => {
  let attempts = 0;
  const prompts = [];
  const registry = createAlertIntentProviderRegistry([{
    providerId: "continuation-repair",
    modelId: "fixture-model",
    async compile(input) {
      attempts += 1;
      prompts.push(input.prompt);
      if (attempts === 1) {
        return { json: {
          schemaVersion: 1,
          requestId: input.requestId,
          candidateRule: null,
          missingFields: ["rule"],
          ambiguities: [],
          questions: ["要监控下降线、上升线，还是两条都要？", "请用一句话说明完整规则。"],
          dataRequirements: [],
          explanation: "需要继续澄清",
        } };
      }
      return { json: {
        schemaVersion: 1,
        requestId: input.requestId,
        candidateRule: fixture,
        missingFields: [],
        ambiguities: [],
        questions: [],
        dataRequirements: [],
        explanation: "已合并原始条件和补充回答",
      } };
    },
  }]);
  const continuationRequest = {
    ...request("当K线触碰我画的两条趋势线，并且量能比前一根高时预警"),
    conversation: [
      { role: "user", text: "当K线触碰我画的两条趋势线，并且量能比前一根高时预警" },
      { role: "assistant", text: "任意一条还是两条都触碰？" },
      { role: "user", text: "触碰任意一条就预警" },
    ],
  };

  const result = await registry.compile("continuation-repair", continuationRequest);

  assert.equal(attempts, 2);
  assert.equal(result.semanticRecovery, "clarification_context_merged");
  assert.ok(result.candidateRule);
  assert.match(prompts[1], /CONTINUATION_REPAIR/);
  assert.match(prompts[1], /不得重复询问已回答内容/);
});

test("backend restores the original instruction when a transient source was overwritten by a short answer", async () => {
  let providerSourceText = "";
  const registry = createAlertIntentProviderRegistry([{
    providerId: "restored-source",
    modelId: "fixture-model",
    async compile(input) {
      providerSourceText = input.sourceText;
      return { json: {
        schemaVersion: 1,
        requestId: input.requestId,
        candidateRule: fixture,
        missingFields: [],
        ambiguities: [],
        questions: [],
        dataRequirements: [],
        explanation: "完整",
      } };
    },
  }]);
  const original = "当K线触碰我画的两条趋势线，并且量能比前一根高时预警";
  const result = await compileAlertDraft({
    registry,
    providerId: "restored-source",
    capabilityRegistry: createBuiltinCapabilityRegistry(),
    input: {
      ...request("触碰任意一条就预警"),
      conversation: [
        { role: "user", text: original },
        { role: "assistant", text: "任意一条还是两条都触碰？" },
        { role: "user", text: "触碰任意一条就预警" },
      ],
    },
  });

  assert.equal(providerSourceText, original);
  assert.equal(result.draft.sourceText, original);
  assert.equal(result.draft.status, "ready_to_simulate");
});

function drawingCandidate({ drawingId = "trend-line-1", revision = 3, marketId = "BINANCE:FUTURES:BTCUSDT", interval = "15m", geometryMode = "extended" } = {}) {
  const drawingValue = { type: "drawing", drawingId, output: "price_at_time" };
  const condition = (conditionId, operator, field) => ({
    type: "condition",
    condition: {
      conditionId,
      contextId: "primary",
      operator,
      left: { type: "field", field },
      right: drawingValue,
      confirmation: "intrabar",
    },
  });
  return {
    title: "趋势线触碰或突破预警",
    root: {
      type: "any",
      children: [
        { type: "all", children: [condition("touch_high", "gte", "high"), condition("touch_low", "lte", "low")] },
        condition("break_above", "break_above", "close"),
        condition("break_below", "break_below", "close"),
      ],
    },
    contexts: [{
      contextId: "primary",
      marketSelector: { kind: "fixed", marketIds: [marketId] },
      intervals: [interval],
      drawingBinding: { drawingId, drawingRevision: revision, marketId, interval, geometryMode },
    }],
    evaluationPolicy: { clock: "bar_update", anchorContextId: "primary", joinMode: "latest_closed", maxDataAgeMs: 5000, unknownPolicy: "do_not_trigger" },
    triggerPolicy: { mode: "once", edge: "false_to_true", rearm: "must_become_false", maxTriggersTotal: 1, resumePolicy: "baseline_only_no_catch_up" },
    dataRequirements: [],
    normalizedSummary: `${marketId} ${interval} 盘中触碰或向任一方向突破绑定趋势线时提醒一次`,
  };
}

test("intent request redacts credentials before reaching a model or transient rule object", () => {
  const sourceText = "监控BTC api_key=secret-value-1234567890，sk-abcdefghijklmnopqrstuvwxyz";
  const normalized = normalizeAlertIntentRequest(request(sourceText));
  assert.doesNotMatch(normalized.sourceText, /secret-value|sk-/);
  assert.equal(sanitizeAlertIntentText(sourceText).includes("[REDACTED_CREDENTIAL]"), true);
});

test("model-neutral registry fails closed into transient retry state after repeated unknown output fields", async () => {
  let attempts = 0;
  const scripted = provider({ candidateRule: fixture, missingFields: [], ambiguities: [], questions: [], dataRequirements: [], unexpected: true });
  const registry = createAlertIntentProviderRegistry([{
    ...scripted,
    async compile(input) {
      attempts += 1;
      return scripted.compile(input);
    },
  }]);
  assert.equal(registry.list()[0].capabilities.createAlert, false);
  const result = await registry.compile("scripted", request());
  assert.equal(attempts, ALERT_INTENT_MAX_PROTOCOL_ATTEMPTS + 1);
  assert.equal(result.candidateRule, null);
  assert.equal(result.protocolRecovery, "local_resumable_clarification");
  assert.equal(result.protocolDiagnostics.length, ALERT_INTENT_MAX_PROTOCOL_ATTEMPTS + 1);
  assert.ok(result.protocolDiagnostics.every((entry) => entry.path === "response"));
  assert.throws(() => normalizeAlertIntentResponse({
    schemaVersion: 1,
    requestId: "intent-request-1",
    candidateRule: null,
    missingFields: ["rule"],
    ambiguities: [],
    questions: ["请补充规则。"],
    dataRequirements: [],
    unexpected: true,
  }, normalizeAlertIntentRequest(request())), /unsupported fields/);
});

test("intent response accepts only the known clarificationQuestions alias and the prompt names the canonical contract", () => {
  const normalizedRequest = normalizeAlertIntentRequest(request());
  const response = normalizeAlertIntentResponse({
    schemaVersion: 1,
    requestId: normalizedRequest.requestId,
    candidateRule: null,
    missingFields: ["drawingBinding"],
    ambiguities: [],
    clarificationQuestions: ["请确认要绑定哪一条趋势线。"],
    dataRequirements: [],
    explanation: "需要确认画线对象",
  }, normalizedRequest);

  assert.deepEqual(response.questions, ["请确认要绑定哪一条趋势线。"]);
  assert.match(buildAlertIntentPrompt(normalizedRequest), /字段名 questions 不得改写为 clarificationQuestions/);
  assert.match(buildAlertIntentPrompt(normalizedRequest), /questions 最多 3 个/);
  assert.match(buildAlertIntentPrompt(normalizedRequest), /禁止出现 evaluationTiming/);
  assert.match(buildAlertIntentPrompt(normalizedRequest), /INPUT_JSON=.*"requestId":"intent-request-1"/);
  assert.throws(() => normalizeAlertIntentResponse({
    schemaVersion: 1,
    requestId: normalizedRequest.requestId,
    candidateRule: null,
    missingFields: [],
    ambiguities: [],
    questions: [],
    clarificationQuestions: [],
    dataRequirements: [],
  }, normalizedRequest), /unsupported fields: clarificationQuestions/);
});

test("intent prompt contains the complete drawing DSL contract instead of asking the model to invent a schema", () => {
  const normalizedRequest = normalizeAlertIntentRequest({
    ...request("当K线触碰或者突破我画的趋势线时预警"),
    currentChart: { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "15m" },
    drawings: [{
      drawingId: "trend-line-1",
      revision: 3,
      geometryMode: "extended",
      points: [{ time: 1_786_460_000_000, price: 65_300 }, { time: 1_786_464_000_000, price: 63_700 }],
    }],
  });
  const prompt = buildAlertIntentPrompt(normalizedRequest);
  assert.match(prompt, /CandidateRule=\{title,root,contexts,evaluationPolicy,triggerPolicy,dataRequirements,normalizedSummary\}/);
  assert.match(prompt, /high>=/);
  assert.match(prompt, /low<=/);
  assert.match(prompt, /break_above/);
  assert.match(prompt, /break_below/);
  assert.match(prompt, /"drawingId":"trend-line-1"/);
  assert.match(prompt, /"drawingRevision":3/);
  assert.match(prompt, /死叉\/向下穿越\/下穿=operator cross_under/);
  assert.match(prompt, /MA5\/MA20 死叉预警/);
  assert.match(prompt, /MACD DIF 下穿零轴/);
  assert.match(prompt, /标准术语已经明确时禁止制造歧义/);
  assert.match(prompt, /lag\{expr,bars\}/);
  assert.match(prompt, /rolling\{op:min\/max\/avg\/sum,expr,period,offset\?\}/);
  assert.match(prompt, /volume > M \* rolling\(max, volume, period=N, offset=1\)/);
});

test("semantic candidate rules are hydrated with compiler-managed identity fields", () => {
  const normalizedRequest = normalizeAlertIntentRequest(request());
  const {
    schemaVersion: _schemaVersion,
    ruleId: _ruleId,
    revision: _revision,
    sourceText: _sourceText,
    createdAt: _createdAt,
    ruleHash: _ruleHash,
    ...semanticCandidate
  } = fixture;
  const response = normalizeAlertIntentResponse({
    schemaVersion: 1,
    requestId: normalizedRequest.requestId,
    candidateRule: semanticCandidate,
    missingFields: [],
    ambiguities: [],
    questions: [],
    dataRequirements: [],
  }, normalizedRequest);
  assert.match(response.candidateRule.ruleId, /^rule-/);
  assert.equal(response.candidateRule.revision, 1);
  assert.equal(response.candidateRule.sourceText, normalizedRequest.sourceText);
  assert.ok(Number.isSafeInteger(response.candidateRule.createdAt));
  assert.equal(typeof response.candidateRule.ruleHash, "string");
});

test("one exact drawing request always compiles through the model before local validation", async () => {
  let attempts = 0;
  const registry = createAlertIntentProviderRegistry([{
    providerId: "model-drawing",
    modelId: "fixture-model",
    async compile(input) {
      attempts += 1;
      return { json: {
        schemaVersion: 1,
        requestId: input.requestId,
        candidateRule: drawingCandidate(),
        missingFields: [],
        ambiguities: [],
        questions: [],
        dataRequirements: [],
      } };
    },
  }]);
  const input = {
    ...request("当K线触碰或者突破我画的趋势线时预警"),
    currentChart: { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "15m" },
    drawings: [{
      drawingId: "trend-line-1",
      revision: 3,
      geometryMode: "extended",
      points: [{ time: 1_786_460_000_000, price: 65_300 }, { time: 1_786_464_000_000, price: 63_700 }],
    }],
  };
  const result = await registry.compile("model-drawing", input);
  assert.equal(attempts, 1);
  assert.equal(result.modelId, "fixture-model");
  assert.equal(result.protocolRecovery, undefined);
  assert.equal(result.candidateRule.root.type, "any");
  assert.equal(result.candidateRule.root.children[0].type, "all");
  assert.deepEqual(result.candidateRule.root.children[0].children.map((node) => node.condition.operator), ["gte", "lte"]);
  assert.deepEqual(result.candidateRule.root.children.slice(1).map((node) => node.condition.operator), ["break_above", "break_below"]);
  assert.deepEqual(result.candidateRule.contexts[0].drawingBinding, {
    drawingId: "trend-line-1",
    drawingRevision: 3,
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "15m",
    geometryMode: "extended",
  });
});

test("multiple drawings are resolved by the model as clarification and never guessed locally", async () => {
  let attempts = 0;
  const registry = createAlertIntentProviderRegistry([{
    providerId: "malformed-multiple-drawings",
    async compile(input) {
      attempts += 1;
      return { json: {
        schemaVersion: 1,
        requestId: input.requestId,
        candidateRule: null,
        missingFields: ["drawingBinding"],
        ambiguities: ["当前画布存在多条可绑定画线"],
        questions: ["请点选或说出要监控的那条趋势线。"],
        dataRequirements: [],
      } };
    },
  }]);
  const drawing = (drawingId) => ({
    drawingId,
    revision: 1,
    geometryMode: "extended",
    points: [{ time: 1_786_460_000_000, price: 65_300 }, { time: 1_786_464_000_000, price: 63_700 }],
  });
  const result = await registry.compile("malformed-multiple-drawings", {
    ...request("当K线触碰或者突破我画的趋势线时预警"),
    currentChart: { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "15m" },
    drawings: [drawing("line-a"), drawing("line-b")],
  });
  assert.equal(attempts, 1);
  assert.equal(result.candidateRule, null);
  assert.deepEqual(result.missingFields, ["drawingBinding"]);
  assert.match(result.questions[0], /点选|说出/);
});

test("drawing requests combined with indicators still use the model compiler", async () => {
  let attempts = 0;
  const registry = createAlertIntentProviderRegistry([{
    providerId: "drawing-with-indicator",
    modelId: "fixture-model",
    async compile(input) {
      attempts += 1;
      return { json: {
        schemaVersion: 1,
        requestId: input.requestId,
        candidateRule: fixture,
        missingFields: [], ambiguities: [], questions: [], dataRequirements: [],
      } };
    },
  }]);
  const result = await registry.compile("drawing-with-indicator", {
    ...request("当K线突破趋势线并且 MACD 下穿0轴时预警"),
    drawings: [{
      drawingId: "line-composite",
      revision: 1,
      geometryMode: "extended",
      points: [{ time: 1_786_460_000_000, price: 65_300 }, { time: 1_786_464_000_000, price: 63_700 }],
    }],
  });
  assert.equal(attempts, 1);
  assert.equal(result.modelId, "fixture-model");
  assert.equal(result.deterministicRecovery, undefined);
});

test("standard MA death-cross wording becomes an executable cross_under draft without clarification", async () => {
  const simpleRule = {
    ...fixture,
    title: "MA5/MA20 死叉预警",
    root: fixture.root.children[0],
    contexts: [{
      ...fixture.contexts[0],
      intervals: ["4h"],
    }],
    normalizedSummary: "BTCUSDT 永续 4小时收盘时，MA5下穿MA20，只提醒一次",
    ruleHash: undefined,
  };
  const registry = createAlertIntentProviderRegistry([{
    providerId: "ma-death-cross",
    modelId: "fixture-model",
    async compile(input) {
      assert.match(input.prompt, /死叉\/向下穿越\/下穿=operator cross_under/);
      assert.match(input.prompt, /不得把“死叉”追问成上穿还是下穿/);
      return {
        json: {
          schemaVersion: 1,
          requestId: input.requestId,
          candidateRule: simpleRule,
          missingFields: [],
          ambiguities: [],
          questions: [],
          dataRequirements: [],
        },
      };
    },
  }]);
  const result = await compileAlertDraft({
    registry,
    providerId: "ma-death-cross",
    capabilityRegistry: createBuiltinCapabilityRegistry(),
    input: {
      ...request("当MA5和MA20死叉的时候预警"),
      currentChart: { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "4h" },
    },
  });
  assert.equal(result.draft.status, "ready_to_simulate");
  assert.equal(result.draft.questions.length, 0);
  assert.equal(result.draft.rule.root.condition.operator, "cross_under");
  assert.deepEqual(result.draft.rule.root.condition.left.params, { period: 5 });
  assert.deepEqual(result.draft.rule.root.condition.right.params, { period: 20 });
});

test("intent registry repairs one mismatched requestId without accepting the stale response", async () => {
  let attempts = 0;
  const registry = createAlertIntentProviderRegistry([{
    providerId: "repair-request-id",
    modelId: "fixture-model",
    async compile(input) {
      attempts += 1;
      if (attempts === 1) {
        return { json: { schemaVersion: 1, requestId: "stale-request", candidateRule: null, missingFields: ["rule"], ambiguities: [], questions: [], dataRequirements: [] } };
      }
      assert.match(input.prompt, /REPAIR_INSTRUCTION=上一轮响应没有精确复制 requestId/);
      assert.match(input.prompt, /VALIDATION_ERROR_JSON=.*TRADING_ALERT_INTENT_REQUEST_ID_MISMATCH.*response.requestId/);
      assert.match(input.prompt, /PREVIOUS_RESPONSE_TEXT=.*stale-request/);
      assert.match(input.prompt, /EXPECTED_REQUEST_ID="intent-request-1"/);
      return { json: { schemaVersion: 1, requestId: input.requestId, candidateRule: null, missingFields: ["rule"], ambiguities: [], questions: ["请确认规则。"], dataRequirements: [] } };
    },
  }]);
  const result = await registry.compile("repair-request-id", request());
  assert.equal(attempts, 2);
  assert.equal(result.requestId, "intent-request-1");
  assert.deepEqual(result.questions, ["请确认规则。"]);
});

test("invented indicators and parameters are rejected with an exact repair path", async () => {
  let attempts = 0;
  const invented = structuredClone(fixture);
  invented.root.children[0].condition.left = {
    type: "indicator",
    name: "supertrend",
    params: { period: 5 },
  };
  const invalidParams = structuredClone(fixture);
  invalidParams.root.children[0].condition.left = { type: "indicator", name: "sma", params: { period: "five" } };
  const registry = createAlertIntentProviderRegistry([{
    providerId: "indicator-contract-repair",
    modelId: "fixture-model",
    async compile(input) {
      attempts += 1;
      if (attempts === 1) {
        return { json: { schemaVersion: 1, requestId: input.requestId, candidateRule: invented, missingFields: [], ambiguities: [], questions: [], dataRequirements: [] } };
      }
      if (attempts === 2) {
        assert.match(input.prompt, /TRADING_ALERT_INTENT_UNSUPPORTED_INDICATOR/);
        assert.match(input.prompt, /candidateRule.root.children\[0\].condition.left.name/);
        return { json: { schemaVersion: 1, requestId: input.requestId, candidateRule: invalidParams, missingFields: [], ambiguities: [], questions: [], dataRequirements: [] } };
      }
      assert.match(input.prompt, /TRADING_ALERT_INTENT_INVALID_INDICATOR_PARAM/);
      assert.match(input.prompt, /candidateRule.root.children\[0\].condition.left.params.period/);
      return { json: { schemaVersion: 1, requestId: input.requestId, candidateRule: fixture, missingFields: [], ambiguities: [], questions: [], dataRequirements: [] } };
    },
  }]);
  const result = await registry.compile("indicator-contract-repair", request());
  assert.equal(attempts, 3);
  assert.equal(result.candidateRule.root.children[0].condition.left.name, "sma");
  assert.equal(result.protocolDiagnostics[0].code, "TRADING_ALERT_INTENT_UNSUPPORTED_INDICATOR");
  assert.equal(result.protocolDiagnostics[1].code, "TRADING_ALERT_INTENT_INVALID_INDICATOR_PARAM");
});

test("intent registry keeps a resumable clarification draft after every model response mismatches", async () => {
  let attempts = 0;
  const registry = createAlertIntentProviderRegistry([{
    providerId: "always-mismatch",
    async compile() {
      attempts += 1;
      return { json: { schemaVersion: 1, requestId: `wrong-${attempts}`, candidateRule: null, missingFields: [], ambiguities: [], questions: [], dataRequirements: [] } };
    },
  }]);
  const result = await registry.compile("always-mismatch", request());
  assert.equal(attempts, ALERT_INTENT_MAX_PROTOCOL_ATTEMPTS + 1);
  assert.equal(result.candidateRule, null);
  assert.equal(result.protocolRecovery, "local_resumable_clarification");
  assert.match(result.questions[0], /保留/);
  assert.ok(result.protocolDiagnostics.every((entry) => entry.code === "TRADING_ALERT_INTENT_REQUEST_ID_MISMATCH"));
});

test("protocol exhaustion asks the model for a targeted clarification before using local fallback", async () => {
  let attempts = 0;
  const registry = createAlertIntentProviderRegistry([{
    providerId: "clarification-recovery",
    modelId: "fixture-model",
    async compile(input) {
      attempts += 1;
      if (attempts <= ALERT_INTENT_MAX_PROTOCOL_ATTEMPTS) {
        return {
          json: {
            schemaVersion: 1,
            requestId: input.requestId,
            candidateRule: { marketId: "BINANCE:FUTURES:BTCUSDT", condition: {} },
            missingFields: [],
            ambiguities: [],
            questions: [],
            dataRequirements: [],
          },
        };
      }
      assert.match(input.prompt, /CLARIFICATION_RECOVERY=/);
      assert.match(input.prompt, /VALIDATION_ISSUES_JSON=.*candidateRule/);
      return {
        json: {
          schemaVersion: 1,
          requestId: input.requestId,
          candidateRule: null,
          missingFields: ["drawingBinding"],
          ambiguities: ["当前有多条趋势线"],
          questions: ["请点选要监控的趋势线。"],
          dataRequirements: [],
          explanation: "需要确认画线对象",
        },
      };
    },
  }]);
  const result = await registry.compile("clarification-recovery", request("触碰我画的趋势线时预警"));
  assert.equal(attempts, ALERT_INTENT_MAX_PROTOCOL_ATTEMPTS + 1);
  assert.equal(result.protocolRecovery, "model_clarification");
  assert.equal(result.candidateRule, null);
  assert.deepEqual(result.questions, ["请点选要监控的趋势线。"]);
  assert.equal(result.protocolDiagnostics.length, ALERT_INTENT_MAX_PROTOCOL_ATTEMPTS);
});

test("provider transport failure returns transient recovery state without persisting an unconfirmed alert", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-intent-provider-failure-"));
  try {
    const store = new TradingAlertStore({ dataDir });
    const registry = createAlertIntentProviderRegistry([{
      providerId: "offline-provider",
      modelId: "fixture-model",
      async compile() {
        const error = new Error("sensitive upstream transport detail");
        error.code = "TRADING_ALERT_INTENT_PROVIDER_FAILED";
        error.category = "transport";
        error.retryable = true;
        throw error;
      },
    }]);
    const recovered = await compileAlertDraft({
      registry,
      providerId: "offline-provider",
      capabilityRegistry: createBuiltinCapabilityRegistry(),
      store,
      input: { ...request(), originThreadId: "thread-offline-provider" },
      now: () => 1_786_464_003_000,
    });
    assert.equal(recovered.draft.status, "awaiting_clarification");
    assert.deepEqual(recovered.draft.missingFields, ["modelProvider.validatedResponse"]);
    assert.match(recovered.draft.questions[0], /当前会话/);
    assert.doesNotMatch(recovered.draft.questions[0], /sensitive upstream/);
    assert.equal(recovered.providerFailure.retryable, true);
    assert.equal(recovered.draft.originThreadId, "thread-offline-provider");
    assert.equal("drafts" in await store.load(), false);

    const controller = new AbortController();
    controller.abort(new Error("newer alert instruction"));
    await assert.rejects(() => compileAlertDraft({
      registry,
      providerId: "offline-provider",
      capabilityRegistry: createBuiltinCapabilityRegistry(),
      store,
      signal: controller.signal,
      input: { ...request(), requestId: "cancelled-request", draftId: "cancelled-draft" },
    }), /newer alert instruction/);
    assert.equal("drafts" in await store.load(), false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("concurrent intent prompts retain their own exact request correlation ids", async () => {
  const seen = [];
  const registry = createAlertIntentProviderRegistry([{
    providerId: "concurrent",
    async compile(input) {
      seen.push(input.prompt);
      await new Promise((resolve) => setTimeout(resolve, input.requestId.endsWith("a") ? 10 : 1));
      return { json: { schemaVersion: 1, requestId: input.requestId, candidateRule: null, missingFields: ["rule"], ambiguities: [], questions: [], dataRequirements: [] } };
    },
  }]);
  const [left, right] = await Promise.all([
    registry.compile("concurrent", { ...request(), requestId: "intent-concurrent-a", draftId: "draft-a" }),
    registry.compile("concurrent", { ...request(), requestId: "intent-concurrent-b", draftId: "draft-b" }),
  ]);
  assert.deepEqual([left.requestId, right.requestId], ["intent-concurrent-a", "intent-concurrent-b"]);
  assert.ok(seen.some((prompt) => prompt.includes('"requestId":"intent-concurrent-a"')));
  assert.ok(seen.some((prompt) => prompt.includes('"requestId":"intent-concurrent-b"')));
});

test("repair prompt always carries the exact request correlation value", () => {
  const normalizedRequest = normalizeAlertIntentRequest(request());
  const mismatch = new TypeError("Alert intent response requestId mismatch");
  mismatch.code = "TRADING_ALERT_INTENT_REQUEST_ID_MISMATCH";
  mismatch.path = "response.requestId";
  const prompt = buildAlertIntentRepairPrompt(normalizedRequest, mismatch, {
    previousResponse: { text: '{"requestId":"wrong"}' },
  });
  assert.match(prompt, /EXPECTED_REQUEST_ID="intent-request-1"/);
  assert.match(prompt, /VALIDATION_ERROR_JSON=.*response.requestId/);
  assert.match(prompt, /PREVIOUS_RESPONSE_TEXT=.*wrong/);
  assert.match(prompt, /不可信数据/);
  assert.match(buildAlertIntentClarificationPrompt(normalizedRequest, [{ path: "response.requestId" }]), /candidateRule 必须为 null/);
});

test("local thread metadata stays on the transient result without crossing the intent-provider boundary", async () => {
  let providerRequest;
  const streamedSummaries = [];
  const onReasoningSummaryDelta = (delta) => streamedSummaries.push(delta);
  const registry = createAlertIntentProviderRegistry([{
    providerId: "metadata-boundary",
    modelId: "fixture-model",
    async compile(input, options) {
      providerRequest = input;
      assert.equal(options.onReasoningSummaryDelta, onReasoningSummaryDelta);
      options.onReasoningSummaryDelta("正在识别画线条件");
      return {
        json: {
          schemaVersion: 1,
          requestId: input.requestId,
          candidateRule: fixture,
          missingFields: [],
          ambiguities: [],
          questions: [],
          dataRequirements: [],
        },
      };
    },
  }]);
  const result = await compileAlertDraft({
    registry,
    providerId: "metadata-boundary",
    capabilityRegistry: createBuiltinCapabilityRegistry(),
    input: {
      ...request(),
      conversation: [
        { role: "user", text: "当价格触碰趋势线时提醒" },
        { role: "assistant", text: "触碰还是突破？" },
      ],
      originThreadId: "thread-trading-alert-1",
      createdAt: 1_786_464_000_000,
    },
    now: () => 1_786_464_001_000,
    onReasoningSummaryDelta,
  });

  assert.equal(Object.hasOwn(providerRequest, "originThreadId"), false);
  assert.equal(Object.hasOwn(providerRequest, "createdAt"), false);
  assert.equal(result.draft.originThreadId, "thread-trading-alert-1");
  assert.equal(result.draft.createdAt, 1_786_464_000_000);
  assert.deepEqual(result.draft.conversation.map((turn) => turn.role), ["user", "assistant"]);
  assert.deepEqual(streamedSummaries, ["正在识别画线条件"]);
});

test("app-server alert provider forwards reasoning summaries outside the strict request payload", async () => {
  const summaries = [];
  const onReasoningSummaryDelta = (delta) => summaries.push(delta);
  let invocation;
  const provider = createAppServerAlertIntentProvider({
    invoke: async (params) => {
      invocation = params;
      params.onReasoningSummaryDelta("正在核对市场与周期");
      return {
        status: "success",
        text: JSON.stringify({
          schemaVersion: 1,
          requestId: params.request.requestId,
          candidateRule: null,
          missingFields: ["rule"],
          ambiguities: [],
          questions: ["请补充规则。"],
          dataRequirements: [],
        }),
      };
    },
  });
  const normalizedRequest = normalizeAlertIntentRequest(request());
  await provider.compile(
    { ...normalizedRequest, prompt: buildAlertIntentPrompt(normalizedRequest) },
    { onReasoningSummaryDelta },
  );

  assert.equal(invocation.onReasoningSummaryDelta, onReasoningSummaryDelta);
  assert.equal(Object.hasOwn(invocation.request, "onReasoningSummaryDelta"), false);
  assert.deepEqual(summaries, ["正在核对市场与周期"]);
});

test("complex AND intent compiles to a transient executable request", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-intent-"));
  try {
    const store = new TradingAlertStore({ dataDir });
    const registry = createAlertIntentProviderRegistry([provider({
      candidateRule: fixture,
      missingFields: [],
      ambiguities: [],
      questions: [],
      dataRequirements: [],
      explanation: "两个条件必须在同一根收盘K线上同时成立",
    })]);
    const result = await compileAlertDraft({
      registry,
      providerId: "scripted",
      capabilityRegistry: createBuiltinCapabilityRegistry(),
      store,
      input: request(),
      now: () => 1_786_464_001_000,
    });
    assert.equal(result.draft.status, "ready_to_simulate");
    assert.equal(result.draft.rule.root.type, "all");
    assert.equal(result.draft.rule.dataRequirements[0].status, "available");
    assert.equal("drafts" in await store.load(), false);
    assert.match(summarizeAlertRule(result.draft.rule), /客户端停机期间不补触发/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("vague intent is held for clarification and never advances to simulation", async () => {
  const registry = createAlertIntentProviderRegistry([provider({ candidateRule: fixture, missingFields: [], ambiguities: [], questions: [], dataRequirements: [] })]);
  const result = await compileAlertDraft({
    registry,
    providerId: "scripted",
    capabilityRegistry: createBuiltinCapabilityRegistry(),
    input: request("MA5大概下穿MA20附近，同时MACD明显走弱时提醒"),
  });
  assert.equal(result.draft.status, "awaiting_clarification");
  assert.ok(result.draft.ambiguities.length > 0);
  assert.match(result.draft.questions[0], /歧义|明确/);
});

test("capability resolver asks for connection or an adapter instead of rejecting", () => {
  const externalRule = normalizeAlertRule({
    ...fixture,
    root: {
      type: "condition",
      condition: {
        conditionId: "whale-flow",
        contextId: "primary",
        operator: "gt",
        left: { type: "external", capability: "chain.whale_flow", field: "net_inflow", params: {} },
        right: { type: "constant", value: 1000000 },
        confirmation: "intrabar",
      },
    },
    evaluationPolicy: { ...fixture.evaluationPolicy, clock: "mixed" },
    ruleHash: undefined,
  });
  const requirements = requirementsFromRule(externalRule);
  assert.ok(requirements.some((entry) => entry.capability === "chain.whale_flow"));
  const absent = resolveRuleCapabilities(externalRule, createBuiltinCapabilityRegistry());
  assert.equal(absent.ready, false);
  assert.match(capabilityResolutionGuide(absent.resolutions.find((entry) => entry.requirement.capability === "chain.whale_flow")), /接口、插件、MCP/);

  const hyperliquid = new TradingAlertCapabilityRegistry([{
    capabilityId: "chain.whale_flow",
    providerId: "hyperliquid",
    displayName: "Hyperliquid",
    fields: ["net_inflow"],
    markets: ["*"],
    permission: "public",
    connectionState: "disconnected",
    maxHistoryWindow: 10_000,
  }]);
  const resolution = hyperliquid.resolve(requirements.find((entry) => entry.capability === "chain.whale_flow"));
  assert.equal(resolution.action, "connect_provider");
  assert.match(capabilityResolutionGuide(resolution), /不要在聊天中发送 API Key/);
});

test("rolling volume rules request the exact field and enough history", () => {
  const volumeRule = normalizeAlertRule({
    ...fixture,
    ruleId: "rolling-volume-capability",
    root: { type: "condition", condition: {
      conditionId: "volume-window",
      contextId: "primary",
      operator: "gt",
      left: { type: "field", field: "volume" },
      right: { type: "rolling", op: "avg", expr: { type: "field", field: "volume" }, period: 20, offset: 1 },
      confirmation: "bar_close",
    } },
    dataRequirements: [],
    ruleHash: undefined,
  });
  const market = requirementsFromRule(volumeRule).find((entry) => entry.capability === "market.ohlcv");
  assert.deepEqual(market.fields, ["volume"]);
  assert.ok(market.historyWindow >= 22);
});

test("capability completion resumes the original transient request", async () => {
  const draft = {
    schemaVersion: 1,
    draftId: "resume-draft",
    sourceText: fixture.sourceText,
    status: "awaiting_authorization",
    rule: fixture,
    missingFields: [],
    ambiguities: [],
    questions: [],
    dataRequirements: [],
    createdAt: 1_786_464_000_000,
    updatedAt: 1_786_464_000_000,
  };
  const resumed = await resumeDraftAfterCapabilities({ draft, capabilityRegistry: createBuiltinCapabilityRegistry(), now: () => 1_786_464_002_000 });
  assert.equal(resumed.ready, true);
  assert.equal(resumed.draft.draftId, draft.draftId);
  assert.equal(resumed.draft.status, "ready_to_simulate");
});

test("confirmation binds draft, rule hash and simulation, and invalidates changes", () => {
  const draft = { draftId: "draft-1", rule: fixture };
  const binding = createConfirmationBinding({ draftId: draft.draftId, ruleHash: fixture.ruleHash, simulationId: "simulation-1", now: 1000 });
  assert.equal(verifyConfirmationBinding(binding, { draft, simulationId: "simulation-1", now: 2000 }), true);
  assert.throws(() => verifyConfirmationBinding(binding, { draft, simulationId: "simulation-2", now: 2000 }), /重新确认/);
  assert.throws(() => verifyConfirmationBinding(binding, { draft, simulationId: "simulation-1", now: binding.expiresAt + 1 }), /过期/);
});
