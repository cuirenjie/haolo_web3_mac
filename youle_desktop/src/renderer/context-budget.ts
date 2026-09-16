// Haolo's managed GPT route is backed by ChatGPT/Codex OAuth subscriptions.
// Keep these limits separate from the 1.05M direct OpenAI API model window.
export const NATIVE_MODEL_CONTEXT_WINDOW_TOKENS = 400_000;
// Codex reserves 5% of the configured native window. The app-server therefore
// reports 380K as the effective denominator used by the renderer.
export const CURRENT_MODEL_CONTEXT_WINDOW_TOKENS = 380_000;
// Start before the observed 370K rejection boundary so compaction has room to
// upload the existing history and return its continuation handoff.
export const CURRENT_AUTO_COMPACT_THRESHOLD_TOKENS = 300_000;
export const GPT_5_5_DOWNGRADE_SWITCH_THRESHOLD_TOKENS = CURRENT_AUTO_COMPACT_THRESHOLD_TOKENS;
export const GPT_5_6_MODEL_CONTEXT_WINDOW_TOKENS = CURRENT_MODEL_CONTEXT_WINDOW_TOKENS;
export const GPT_5_6_AUTO_COMPACT_THRESHOLD_TOKENS = CURRENT_AUTO_COMPACT_THRESHOLD_TOKENS;
export const DEEPSEEK_V4_FLASH_NATIVE_CONTEXT_WINDOW_TOKENS = 1_048_576;
export const DEEPSEEK_V4_FLASH_MODEL_CONTEXT_WINDOW_TOKENS = Math.floor(
  DEEPSEEK_V4_FLASH_NATIVE_CONTEXT_WINDOW_TOKENS * 0.95,
);
export const CONTEXT_INPUT_SAFETY_TOKENS = 2_000;
export const SINGLE_INPUT_HARD_LIMIT_TOKENS = 350_000;
export const COMPOSER_QUOTE_CONTEXT_MAX_TOKENS = 12_000;

const AUTO_COMPACT_TO_EFFECTIVE_WINDOW_RATIO = 90 / 95;
const CJK_LIKE_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;

export type AutoCompactThreshold = {
  tokens: number;
  estimated: boolean;
};

export type ContextBudgetDecision = {
  action: "allow" | "compact" | "block";
  estimatedInputTokens: number;
  estimatedRequestTokens: number;
  modelContextWindow: number;
  autoCompactThreshold: number;
  thresholdEstimated: boolean;
};

export type ModelSwitchContextDecision = {
  action: "allow" | "block";
  downgrade: boolean;
  reason: "not-downgrade" | "within-target-budget" | "usage-unavailable" | "target-budget-exceeded";
  currentModelContextWindow: number | null;
  targetModelContextWindow: number | null;
  targetSwitchThreshold: number | null;
};

const MODEL_EFFECTIVE_CONTEXT_WINDOWS: Readonly<Record<string, number>> = Object.freeze({
  "gpt-5.6-sol": GPT_5_6_MODEL_CONTEXT_WINDOW_TOKENS,
  "gpt-5.6-terra": GPT_5_6_MODEL_CONTEXT_WINDOW_TOKENS,
  "gpt-5.6-luna": GPT_5_6_MODEL_CONTEXT_WINDOW_TOKENS,
  "gpt-5.5": CURRENT_MODEL_CONTEXT_WINDOW_TOKENS,
  "deepseek-flash": DEEPSEEK_V4_FLASH_MODEL_CONTEXT_WINDOW_TOKENS,
  "deepseek-v4-flash": DEEPSEEK_V4_FLASH_MODEL_CONTEXT_WINDOW_TOKENS, // Historical task metadata.
});

const MODEL_DOWNGRADE_SWITCH_THRESHOLDS: Readonly<Record<string, number>> = Object.freeze({
  "gpt-5.5": GPT_5_5_DOWNGRADE_SWITCH_THRESHOLD_TOKENS,
});

export function isDuplicateContextCompactionEvent(params: {
  keys: string[];
  seenKeys: readonly string[];
  status: string;
  lastCompactedAt: number | null | undefined;
  now?: number;
}) {
  const now = params.now ?? Date.now();
  const recentlyCompleted =
    params.status === "completed" && params.lastCompactedAt != null && now - params.lastCompactedAt < 5_000;
  if (params.keys.length) {
    const seen = new Set(params.seenKeys);
    return params.keys.some((key) => seen.has(key)) || recentlyCompleted;
  }
  return recentlyCompleted;
}

function finiteNonNegativeInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/**
 * Conservative prompt estimate for the mixed Chinese/English text sent to the
 * local agent. CJK-like code points count as roughly one token each; all other
 * UTF-16 characters count as roughly one token per four characters.
 */
export function estimateAgentTextTokens(text: string) {
  let cjkCharacters = 0;
  let otherCharacters = 0;
  for (const character of String(text || "")) {
    if (CJK_LIKE_CHARACTER.test(character)) cjkCharacters += 1;
    else otherCharacters += character.length;
  }
  return Math.ceil(cjkCharacters + otherCharacters / 4);
}

/**
 * Keeps an explicitly quoted message useful without copying an arbitrarily
 * large historical item into the new user turn. The original message remains
 * in thread history; this is only the bounded model-facing excerpt.
 */
export function boundedComposerQuoteText(
  value: string,
  maxTokens = COMPOSER_QUOTE_CONTEXT_MAX_TOKENS,
) {
  const text = String(value || "").trim();
  const budgetTokens = Math.max(1, Math.floor(Number(maxTokens) || 0));
  if (!text || estimateAgentTextTokens(text) <= budgetTokens) return text;

  const marker = "\n[...引用内容过长，已保留首尾并省略中间部分...]\n";
  let low = 0;
  let high = text.length;
  let best = marker.trim();
  while (low <= high) {
    const keptCharacters = Math.floor((low + high) / 2);
    const headCharacters = Math.ceil(keptCharacters * 0.65);
    const tailCharacters = Math.max(0, keptCharacters - headCharacters);
    const candidate = `${text.slice(0, headCharacters)}${marker}${tailCharacters ? text.slice(-tailCharacters) : ""}`;
    if (estimateAgentTextTokens(candidate) <= budgetTokens) {
      best = candidate;
      low = keptCharacters + 1;
    } else {
      high = keptCharacters - 1;
    }
  }
  return best;
}

export function effectiveContextWindowForModel(model: string | null | undefined) {
  return MODEL_EFFECTIVE_CONTEXT_WINDOWS[String(model || "").trim().toLowerCase()] ?? null;
}

/**
 * Bounds stale runtime metadata from threads created before a managed-route
 * limit correction, while still respecting a smaller window reported by the
 * server or by an unmanaged/custom model.
 */
export function contextWindowForModel(
  model: string | null | undefined,
  reportedWindow: number | null | undefined,
) {
  const managedWindow = effectiveContextWindowForModel(model);
  const reported = finiteNonNegativeInteger(reportedWindow);
  if (managedWindow == null) return reported;
  if (reported == null) return managedWindow;
  return Math.min(managedWindow, reported);
}

// HAOLO-CONTEXT-RECOVERY-PATCH-BEGIN
export function isContextWindowExhaustedError(value: unknown) {
  const message = String(value || "").trim();
  if (!message) return false;
  return (
    /ran out of room in (?:the )?model(?:'s|’s)? context window/i.test(message) ||
    /context[_\s-]*(?:window|length)[_\s-]*(?:exceeded|full|exhausted)/i.test(message) ||
    /context window (?:has been )?exceeded/i.test(message) ||
    /maximum context length/i.test(message) ||
    /context length (?:has been )?exceeded/i.test(message) ||
    /(?:input|prompt)(?:\s+\w+){0,4}\s+(?:too long for|exceeds?) (?:the )?(?:model(?:'s|’s)? )?context/i.test(message) ||
    /too many input tokens/i.test(message)
  );
}
// HAOLO-CONTEXT-RECOVERY-PATCH-END

export function autoCompactThresholdForWindow(modelContextWindow: number | null | undefined): AutoCompactThreshold {
  const window = finiteNonNegativeInteger(modelContextWindow);
  if (window == null || window === CURRENT_MODEL_CONTEXT_WINDOW_TOKENS) {
    return { tokens: CURRENT_AUTO_COMPACT_THRESHOLD_TOKENS, estimated: false };
  }
  return {
    // App-server reports the effective input window after Codex's 95% reserve.
    // Convert that back to the model catalog's 90% automatic-compaction point.
    tokens: Math.max(1, Math.min(window, Math.round(window * AUTO_COMPACT_TO_EFFECTIVE_WINDOW_RATIO))),
    estimated: true,
  };
}

export function decideModelSwitchContext(params: {
  currentModel: string | null | undefined;
  targetModel: string | null | undefined;
  currentContextTokens: number | null | undefined;
  currentModelContextWindow?: number | null | undefined;
  usageStale?: boolean;
}): ModelSwitchContextDecision {
  const reportedCurrentWindow = finiteNonNegativeInteger(params.currentModelContextWindow);
  const currentModelContextWindow = effectiveContextWindowForModel(params.currentModel) ?? reportedCurrentWindow;
  const targetModelContextWindow = effectiveContextWindowForModel(params.targetModel);
  const normalizedTargetModel = String(params.targetModel || "").trim().toLowerCase();
  const targetThreshold = MODEL_DOWNGRADE_SWITCH_THRESHOLDS[normalizedTargetModel] ?? (
    targetModelContextWindow == null ? null : autoCompactThresholdForWindow(targetModelContextWindow).tokens
  );
  const downgrade =
    currentModelContextWindow != null &&
    targetModelContextWindow != null &&
    targetModelContextWindow < currentModelContextWindow;
  const base = {
    downgrade,
    currentModelContextWindow,
    targetModelContextWindow,
    targetSwitchThreshold: targetThreshold,
  };

  if (!downgrade) return { ...base, action: "allow", reason: "not-downgrade" };
  const usedTokens = finiteNonNegativeInteger(params.currentContextTokens);
  if (params.usageStale || usedTokens == null || targetThreshold == null) {
    return { ...base, action: "block", reason: "usage-unavailable" };
  }
  if (usedTokens >= targetThreshold) {
    return { ...base, action: "block", reason: "target-budget-exceeded" };
  }
  return { ...base, action: "allow", reason: "within-target-budget" };
}

/**
 * Decides whether a normal local-agent send fits the current context budget.
 * Missing/stale usage deliberately allows the send: the client must not reject
 * input based on a guessed current context size.
 */
export function decideContextBudget(params: {
  currentContextTokens: number | null | undefined;
  modelContextWindow: number | null | undefined;
  agentText: string;
}): ContextBudgetDecision {
  const currentContextTokens = finiteNonNegativeInteger(params.currentContextTokens);
  const configuredWindow = finiteNonNegativeInteger(params.modelContextWindow);
  const modelContextWindow = configuredWindow ?? CURRENT_MODEL_CONTEXT_WINDOW_TOKENS;
  const threshold = autoCompactThresholdForWindow(configuredWindow);
  const estimatedInputTokens = estimateAgentTextTokens(params.agentText);
  const estimatedRequestTokens = estimatedInputTokens + CONTEXT_INPUT_SAFETY_TOKENS;
  const base = {
    estimatedInputTokens,
    estimatedRequestTokens,
    modelContextWindow,
    autoCompactThreshold: threshold.tokens,
    thresholdEstimated: threshold.estimated,
  };

  if (estimatedRequestTokens >= Math.min(modelContextWindow, SINGLE_INPUT_HARD_LIMIT_TOKENS)) {
    return { ...base, action: "block" };
  }
  if (currentContextTokens == null) return { ...base, action: "allow" };
  if (currentContextTokens + estimatedRequestTokens >= threshold.tokens) {
    return { ...base, action: "compact" };
  }
  return { ...base, action: "allow" };
}
