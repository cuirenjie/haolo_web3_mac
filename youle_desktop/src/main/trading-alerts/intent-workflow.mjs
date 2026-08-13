import crypto from "node:crypto";
import { normalizeAlertDraft, normalizeAlertRule, TRADING_ALERT_SCHEMA_VERSION, stableHash } from "./protocol.mjs";
import { resolveRuleCapabilities, capabilityResolutionGuide } from "./capabilities.mjs";
import { TradingAlertError } from "./errors.mjs";
import { accumulatedAlertIntentContext, sanitizeAlertIntentText } from "./intent-provider.mjs";

const VAGUE_PATTERNS = [
  [/\b(near|roughly|strong|weak|significant)\b/i, "存在主观或未量化的描述"],
  [/(附近|左右|差不多|大概|明显|强势|弱势|暴涨|暴跌|合适|异常|较大|等位置)/, "存在主观或未量化的描述"],
];

function collectNodes(node, result = []) {
  result.push(node);
  if (node.child) collectNodes(node.child, result);
  for (const child of node.children || node.steps || []) collectNodes(child, result);
  return result;
}

function collectExpressions(node, result = []) {
  if (node.type === "condition") result.push(node.condition.left, node.condition.right);
  if (node.child) collectExpressions(node.child, result);
  for (const child of node.children || node.steps || []) collectExpressions(child, result);
  return result.flatMap((expr) => [expr, ...(expr.args || [])]);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const MAX_CLARIFICATION_QUESTIONS = 3;
const CLARIFICATION_INTERNAL_TIMING = /evaluationTiming|evaluationPolicy|confirmation(?:Mode)?|triggerTiming|\.clock\b/i;

function clarificationChoiceSignals(value) {
  const text = String(value || "").trim();
  const mentionsTriggerAction = /(触碰|碰到|碰及|触及|突破|跌破|上穿|下穿|满足|触发)/iu.test(text);
  const mentionsLine = /(趋势线|画线|画布|上升线|下降线|上面的线|下面的线|(?:一|两|2)\s*条(?:趋势)?线|drawing|绑定)/iu.test(text)
    || (mentionsTriggerAction && /(?:一|两|2)\s*条/iu.test(text));
  const asksOne = /(任意|任一|其中|随便|任取|至少一|任何一)/iu.test(text);
  // Accept ordinary grammatical particles between the quantity, scope and
  // action: “两条线都被触碰”, “两条趋势线必须全部触及”, “必须两条都碰到”.
  const asksAll = /(?:两|2)\s*条.{0,10}(?:都|均|全部|同时|共同|一起|必须)|(?:都|均|全部|同时|共同|一起|必须).{0,10}(?:两|2)\s*条/iu.test(text)
    || /(?:全部|全都|每一条|缺一不可)/iu.test(text);
  const presentsAlternative = /(还是|或者|或是|抑或|二选一|or)/iu.test(text);
  return Object.freeze({ text, mentionsLine, mentionsTriggerAction, asksOne, asksAll, presentsAlternative });
}

function isDrawingScopeClarification(value) {
  const { text, mentionsLine, mentionsTriggerAction, asksOne, asksAll, presentsAlternative } = clarificationChoiceSignals(value);
  if (!text) return false;
  return mentionsLine && (
    (asksOne && asksAll)
    || (presentsAlternative && (asksOne || asksAll) && mentionsTriggerAction)
    || /(哪条|选哪|指定哪|上面还是下面|上升还是下降)/u.test(text)
  );
}

function clarificationQuestionCategory(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (CLARIFICATION_INTERNAL_TIMING.test(text) || /(盘中|实时|收盘|收线|何时判断|什么时候判断|确认时机)/.test(text)) return "timing";
  if (isDrawingScopeClarification(text)) return "drawing-scope";
  if (/(趋势线|画线|画布|上升线|下降线|上面的线|下面的线|drawing|绑定)/i.test(text)) return "drawing-scope";
  if (/(交易对|市场|market)/i.test(text)) return "market";
  if (/(K\s*线周期|当前周期|interval)/i.test(text)) return "interval";
  if (/(阈值|误差|附近|明显|threshold|tolerance)/i.test(text)) return "threshold";
  const choice = clarificationChoiceSignals(text);
  if ((choice.asksOne && choice.asksAll) || /(任意一个|全部满足|同时成立|AND|OR|布尔|作用域)/i.test(text)) return "combination";
  if (/(先后|顺序|sequence|先.+再)/i.test(text)) return "sequence";
  if (/(提醒一次|重复提醒|triggerPolicy|rearm)/i.test(text)) return "repeat";
  if (/(请用一句话说明|什么情况.*(?:提醒|预警)|触发条件|完整规则|重述)/i.test(text)) return "rule";
  return `text:${text.toLowerCase().replace(/[\s，。；：、“”'"！？?.]/g, "")}`;
}

function answeredClarificationCategories({ sourceText = "", conversation = [] } = {}) {
  const categories = new Set();
  const turns = Array.isArray(conversation) ? conversation : [];
  const firstAssistantIndex = turns.findIndex((turn) => turn?.role === "assistant");
  if (firstAssistantIndex < 0) return categories;
  const answers = turns
    .slice(firstAssistantIndex + 1)
    .filter((turn) => turn?.role === "user")
    .map((turn) => String(turn?.text || "").trim())
    .filter(Boolean);
  if (!answers.length) return categories;
  const answerText = answers.join("\n");
  if (/(?:任意|任一|其中|随便).{0,6}(?:一条|条)|(?:上面|下面|上升|下降).{0,4}(?:的?线|趋势线)|(?:两条|全部).{0,8}(?:都|监控|触碰|碰到|触及)/u.test(answerText)) {
    categories.add("drawing-scope");
    categories.add("combination");
  }
  if (/(盘中|立即|实时|收盘|收线)/u.test(answerText)) categories.add("timing");
  if (/(只提醒一次|仅提醒一次|重复提醒|继续提醒|每次都提醒)/u.test(answerText)) categories.add("repeat");
  if (/(当前交易对|BTC|ETH|USDT|币安|BINANCE)/iu.test(answerText)) categories.add("market");
  if (/(当前周期|\b\d+\s*(?:m|h|d|w)\b|\d+\s*(?:分钟|小时|日|周))/iu.test(answerText)) categories.add("interval");
  const originalIntent = String(
    turns.find((turn) => turn?.role === "user" && String(turn?.text || "").trim())?.text
      || sourceText,
  ).trim();
  if (originalIntent.length >= 8
    && /(预警|提醒|通知)/u.test(originalIntent)
    && /(当|如果|触碰|碰到|触及|突破|穿过|大于|小于|交叉|上穿|下穿)/u.test(originalIntent)) {
    categories.add("rule");
  }
  return categories;
}

function friendlyClarificationQuestion(value) {
  let question = String(value || "").trim().replace(/^\s*\d+[.、)）]\s*/, "");
  if (!question) return "";
  if (CLARIFICATION_INTERNAL_TIMING.test(question)) {
    return "条件满足后，是盘中立即预警，还是等当前 K 线收盘后再确认？";
  }
  if (isDrawingScopeClarification(question)
    || /(同一根\s*K\s*线.*(?:两条|任意)|(?:两条|任意).*同一根\s*K\s*线)/i.test(question)) {
    return "两条趋势线中，触碰任意一条就预警，还是必须两条都触碰才预警？";
  }
  if (/请确认指的是画布上的哪条线|请点选或说出要监控的那条趋势线/.test(question)) {
    return "请问要监控画布上的哪条线？可以直接说“上面的线”“下面的线”或“两条都监控”。";
  }
  if (/\b(?:candidateRule|drawingBinding|contextId|conditionId|joinMode|unknownPolicy|modelProtocol)\b/i.test(question)) {
    return "还有一项条件不明确，请直接用日常语言说明你希望什么情况发生时提醒。";
  }
  return question.slice(0, 180);
}

function questionForMissingField(field) {
  const mapping = [
    [/\.market$|^market$/, "请确认要监控哪个交易对；若沿用当前图表，直接说“当前交易对”即可。"],
    [/\.interval$|^interval$/, "请确认 K 线周期；若沿用当前图表，直接说“当前周期”即可。"],
    [/drawing/i, "请问要监控画布上的哪条线？可以直接说“上面的线”“下面的线”或“两条都监控”。"],
    [/threshold|value|tolerance/i, "请给出具体数值或允许误差，例如“相差不超过 1%”。"],
    [/evaluationTiming|evaluationPolicy|confirmation|clock/i, "条件满足后，是盘中立即预警，还是等当前 K 线收盘后再确认？"],
    [/combination|scope|operator/i, "多个条件之间，是任意一个满足就预警，还是必须全部满足？"],
    [/triggerPolicy|rearm|repeat/i, "这条预警只提醒一次，还是条件再次满足时继续提醒？"],
    [/^rule$/, "请用一句话说明：什么情况发生时需要提醒你？"],
    [/^modelProtocol\./i, "原指令和画布内容已保留，请换一种日常说法描述触发条件，我会接着处理。"],
  ];
  return mapping.find(([pattern]) => pattern.test(String(field || "")))?.[1]
    || "还有一项条件不明确，请直接用日常语言说明你希望什么情况发生时提醒。";
}

function questionForAmbiguity(ambiguity) {
  const text = String(ambiguity || "").trim();
  if (!text) return "";
  if (/(主观|未量化|附近|明显)/.test(text)) return "请明确具体数值，例如“附近”是指允许相差多少。";
  if (isDrawingScopeClarification(text)) {
    return "两条趋势线中，触碰任意一条就预警，还是必须两条都触碰才预警？";
  }
  if (/(同时成立|AND|任意|OR|布尔)/i.test(text)) return "多个条件之间，是任意一个满足就预警，还是必须全部满足？";
  if (/(先后|顺序|sequence)/i.test(text)) return "这些条件需要按什么先后顺序发生？";
  return friendlyClarificationQuestion(text);
}

export function validateAlertIntent({ sourceText, candidateRule, modelMissingFields = [], modelAmbiguities = [], currentChart = null } = {}) {
  const missingFields = [...modelMissingFields];
  const ambiguities = [...modelAmbiguities];
  let rule = null;
  // A model may already have identified a concrete semantic gap without being
  // able to emit a candidate rule. Preserve that targeted gap instead of
  // adding the generic `rule` field, which otherwise produces unrelated market
  // questions and makes the next turn less precise.
  if (!candidateRule) {
    if (missingFields.length === 0 && ambiguities.length === 0) missingFields.push("rule");
  } else {
    rule = normalizeAlertRule(candidateRule);
    for (const context of rule.contexts) {
      if (context.marketSelector.kind === "current" && !currentChart?.marketId) missingFields.push(`${context.contextId}.market`);
      if (context.marketSelector.kind === "current" && !currentChart?.interval) missingFields.push(`${context.contextId}.interval`);
    }
    const nodes = collectNodes(rule.root);
    if (/(同时|并且|而且|且)/.test(sourceText) && nodes.length > 1 && rule.root.type !== "all" && rule.root.type !== "sequence") {
      ambiguities.push("用户表达了同时成立，但候选规则不是 AND/有序组合");
    }
    if (/(先.+再|随后|之后)/.test(sourceText) && !nodes.some((node) => node.type === "sequence")) {
      ambiguities.push("用户表达了先后顺序，但候选规则没有 sequence");
    }
    const expressions = collectExpressions(rule.root);
    if (expressions.some((expr) => expr.type === "drawing") && !rule.contexts.some((context) => context.drawingBinding)) {
      missingFields.push("drawingBinding");
    }
  }
  for (const [pattern, message] of VAGUE_PATTERNS) if (pattern.test(sourceText)) ambiguities.push(message);
  return Object.freeze({ rule, missingFields: Object.freeze(unique(missingFields)), ambiguities: Object.freeze(unique(ambiguities)) });
}

export function clarificationQuestions({
  missingFields = [],
  ambiguities = [],
  existingQuestions = [],
  sourceText = "",
  conversation = [],
} = {}) {
  const questions = [];
  const categories = new Set();
  const answeredCategories = answeredClarificationCategories({ sourceText, conversation });
  const add = (value) => {
    const question = friendlyClarificationQuestion(value);
    const category = clarificationQuestionCategory(question);
    if (!question || !category || categories.has(category) || answeredCategories.has(category)) return;
    categories.add(category);
    questions.push(question);
  };
  existingQuestions.forEach(add);
  missingFields.forEach((field) => add(questionForMissingField(field)));
  ambiguities.forEach((ambiguity) => add(questionForAmbiguity(ambiguity)));
  return Object.freeze(questions.slice(0, MAX_CLARIFICATION_QUESTIONS));
}

function defaultStatus(validation, capabilityResult) {
  if (validation.missingFields.length || validation.ambiguities.length) return "awaiting_clarification";
  return capabilityResult.status;
}

function intentProviderRecoveryQuestion(error) {
  if (error?.code === "TRADING_ALERT_INTENT_PROVIDER_UNAVAILABLE") {
    return "当前没有可用的预警意图模型。请先在模型设置中恢复可用模型，然后在当前会话回复“继续”，我会重新解析本次条件。";
  }
  return "预警意图模型本次连接或执行失败。请在当前会话回复“继续”或重新发送补充条件，我会重试解析。";
}

export async function compileAlertDraft({ registry, providerId, capabilityRegistry, input, now = () => Date.now(), signal, onReasoningSummaryDelta } = {}) {
  // These fields belong to Haolo's transient confirmation flow, not the
  // model-neutral provider contract. They must not cross the strict provider
  // boundary or be persisted before the user confirms the alert.
  const { originThreadId, createdAt, ...rawProviderInput } = input || {};
  const restoredSourceText = accumulatedAlertIntentContext(rawProviderInput).originalInstruction;
  const providerInput = {
    ...rawProviderInput,
    sourceText: restoredSourceText || rawProviderInput.sourceText,
  };
  let compiled;
  try {
    compiled = await registry.compile(providerId, providerInput, { signal, onReasoningSummaryDelta });
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    const time = now();
    const draft = normalizeAlertDraft({
      schemaVersion: TRADING_ALERT_SCHEMA_VERSION,
      draftId: providerInput.draftId,
      sourceText: sanitizeAlertIntentText(providerInput.sourceText),
      status: "awaiting_clarification",
      rule: null,
      missingFields: ["modelProvider.validatedResponse"],
      ambiguities: [],
      questions: [intentProviderRecoveryQuestion(error)],
      conversation: providerInput.conversation || [],
      dataRequirements: [],
      createdAt: createdAt || time,
      updatedAt: time,
      ...(originThreadId ? { originThreadId } : {}),
    });
    return Object.freeze({
      draft,
      capabilityResult: Object.freeze({ requirements: [], resolutions: [], ready: false, status: "awaiting_clarification" }),
      onboarding: Object.freeze([]),
      provider: Object.freeze({ providerId, modelId: "", usage: null }),
      providerFailure: Object.freeze({
        code: String(error?.code || "TRADING_ALERT_INTENT_PROVIDER_FAILED").slice(0, 160),
        category: String(error?.category || "provider").slice(0, 80),
        retryable: error?.retryable === true,
      }),
    });
  }
  const validation = validateAlertIntent({
    sourceText: providerInput.sourceText,
    candidateRule: compiled.candidateRule,
    modelMissingFields: compiled.missingFields,
    modelAmbiguities: compiled.ambiguities,
    currentChart: providerInput.currentChart,
  });
  const capabilityResult = validation.rule
    ? resolveRuleCapabilities(validation.rule, capabilityRegistry)
    : { requirements: compiled.dataRequirements, resolutions: [], ready: false, status: "awaiting_clarification" };
  const questions = clarificationQuestions({
    missingFields: validation.missingFields,
    ambiguities: validation.ambiguities,
    existingQuestions: compiled.questions,
    sourceText: providerInput.sourceText,
    conversation: providerInput.conversation,
  });
  const resumableQuestions = !validation.rule && questions.length === 0
    && answeredClarificationCategories({
      sourceText: providerInput.sourceText,
      conversation: providerInput.conversation,
    }).size > 0
    ? Object.freeze(["你的原始条件和补充回答在当前运行内仍然可用，本轮规则解析没有完成。请回复“继续”，我会直接重试，不需要重述条件；未确认前不会写入预警存储。"])
    : questions;
  const time = now();
  const resolvedRule = validation.rule ? normalizeAlertRule({
    ...validation.rule,
    dataRequirements: capabilityResult.requirements,
    ruleHash: undefined,
  }) : null;
  const draft = normalizeAlertDraft({
    schemaVersion: TRADING_ALERT_SCHEMA_VERSION,
    draftId: providerInput.draftId,
    sourceText: sanitizeAlertIntentText(providerInput.sourceText),
    status: defaultStatus(validation, capabilityResult),
    rule: resolvedRule,
    missingFields: validation.missingFields,
    ambiguities: validation.ambiguities,
    questions: resumableQuestions,
    conversation: providerInput.conversation || [],
    dataRequirements: capabilityResult.requirements,
    createdAt: createdAt || time,
    updatedAt: time,
    ...(originThreadId ? { originThreadId } : {}),
  });
  return Object.freeze({
    draft,
    capabilityResult,
    onboarding: Object.freeze((capabilityResult.resolutions || []).filter((entry) => entry.action !== "continue").map(capabilityResolutionGuide)),
    provider: Object.freeze({ providerId: compiled.providerId, modelId: compiled.modelId, usage: compiled.usage }),
  });
}

export function summarizeAlertRule(ruleValue) {
  const rule = normalizeAlertRule(ruleValue);
  const contexts = rule.contexts.map((context) => {
    const market = context.marketSelector.kind === "fixed" ? context.marketSelector.marketIds.join("、") : context.marketSelector.kind === "current" ? "当前交易对" : `${context.marketSelector.venue} ${context.marketSelector.marketType} 市场集合`;
    return `${market} / ${context.intervals.join("、")}`;
  }).join("；");
  const clock = rule.evaluationPolicy.clock === "bar_close" ? "K线收盘确认" : rule.evaluationPolicy.clock === "mixed" ? "按各条件的盘中/收盘口径" : "盘中实时确认";
  const trigger = rule.triggerPolicy.mode === "once" ? "仅提醒一次" : "重复监控（满足重置条件后可再次提醒）";
  return `${rule.title}｜${contexts}｜${clock}｜${trigger}｜客户端停机期间不补触发`;
}

export function createConfirmationBinding({ draftId, ruleHash, simulationId, now = Date.now(), ttlMs = 30 * 60_000 } = {}) {
  const payload = {
    draftId: String(draftId || ""),
    ruleHash: String(ruleHash || ""),
    simulationId: String(simulationId || ""),
    issuedAt: Math.floor(Number(now)),
    expiresAt: Math.floor(Number(now) + Math.max(60_000, Number(ttlMs) || 0)),
    nonce: crypto.randomUUID(),
  };
  if (!payload.draftId || !payload.ruleHash || !payload.simulationId) throw new TypeError("Confirmation binding fields are required");
  return Object.freeze({ ...payload, confirmationId: `confirm-${stableHash(payload).slice(0, 32)}` });
}

export function verifyConfirmationBinding(binding, { draft, simulationId, now = Date.now() } = {}) {
  if (!binding || typeof binding !== "object") throw new TradingAlertError("缺少确认绑定", { code: "TRADING_ALERT_CONFIRMATION_MISSING", category: "validation" });
  const expectedId = `confirm-${stableHash({
    draftId: binding.draftId,
    ruleHash: binding.ruleHash,
    simulationId: binding.simulationId,
    issuedAt: binding.issuedAt,
    expiresAt: binding.expiresAt,
    nonce: binding.nonce,
  }).slice(0, 32)}`;
  if (binding.confirmationId !== expectedId || binding.draftId !== draft?.draftId || binding.ruleHash !== draft?.rule?.ruleHash || binding.simulationId !== simulationId) {
    throw new TradingAlertError("规则或模拟已经变化，请重新确认", { code: "TRADING_ALERT_CONFIRMATION_STALE", category: "validation" });
  }
  if (Number(now) > Number(binding.expiresAt)) throw new TradingAlertError("确认已过期，请重新模拟", { code: "TRADING_ALERT_CONFIRMATION_EXPIRED", category: "validation" });
  return true;
}

export async function resumeDraftAfterCapabilities({ draft, capabilityRegistry, now = () => Date.now() } = {}) {
  if (!draft?.rule) return { draft, ready: false, onboarding: [] };
  const capabilityResult = resolveRuleCapabilities(draft.rule, capabilityRegistry);
  const next = normalizeAlertDraft({
    ...draft,
    status: capabilityResult.status,
    dataRequirements: capabilityResult.requirements,
    updatedAt: now(),
  });
  return Object.freeze({
    draft: next,
    ready: capabilityResult.ready,
    onboarding: Object.freeze(capabilityResult.resolutions.filter((entry) => entry.action !== "continue").map(capabilityResolutionGuide)),
  });
}
