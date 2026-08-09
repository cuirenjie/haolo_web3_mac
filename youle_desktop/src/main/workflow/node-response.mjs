const CHAT_SUMMARY_TAG = "haolo_chat_summary";
const NODE_RESULT_TAG = "haolo_node_result";
const NODE_META_TAG = "haolo_node_meta";
const FINAL_META_TAG = "haolo_final_meta";
const CHAT_SUMMARY_MAX_LENGTH = 110;

export function workflowNodeResponseFormatInstructions() {
  return [
    "请严格按下面两个 XML 标签返回，标签外不要输出任何内容：",
    `<${CHAT_SUMMARY_TAG}>`,
    "用第一人称写 1–2 句、不超过 100 个汉字的群聊发言，概括你真正完成了什么和最关键的结论。语气要像同事聊天，可以用“我这边”“我刚看完”“先说结论”等自然表达，但不要写标题、Markdown、列表、引号、表情或复制正文原句。",
    `</${CHAT_SUMMARY_TAG}>`,
    `<${NODE_RESULT_TAG}>`,
    "在这里给出完整、严谨的节点结果，供下游节点和 Haolo 最终验收使用。",
    `</${NODE_RESULT_TAG}>`,
    `<${NODE_META_TAG}>`,
    '{"status":"succeeded","confidence":0.9,"requirementsSatisfied":true,"failureReason":""}',
    `</${NODE_META_TAG}>`,
    "meta 必须是合法 JSON。只有确实满足节点提示词（包括其中声明的输出要求）时才能填写 succeeded；confidence 使用 0 到 1。",
  ].join("\n");
}

export function parseWorkflowNodeResponse(value, context = {}) {
  const rawText = String(value || "").trim();
  const taggedSummary = taggedText(rawText, CHAT_SUMMARY_TAG);
  const taggedResult = taggedText(rawText, NODE_RESULT_TAG);
  const taggedMeta = parseNodeMeta(taggedText(rawText, NODE_META_TAG), {
    required: context?.requireMeta === true,
  });
  const outputText = taggedResult || responseWithoutSummaryEnvelope(rawText) || rawText;
  return {
    text: outputText,
    chatSummary: normalizeChatSummary(taggedSummary) || fallbackChatSummary(context),
    status: taggedMeta.status,
    confidence: taggedMeta.confidence,
    requirementsSatisfied: taggedMeta.requirementsSatisfied,
    failureReason: taggedMeta.failureReason,
  };
}

export function workflowFinalResponseFormatInstructions() {
  return [
    "End the final user-facing answer with exactly one machine-readable acceptance envelope:",
    `<${FINAL_META_TAG}>{"goalAchieved":true,"confidence":0.95,"failureReason":""}</${FINAL_META_TAG}>`,
    "goalAchieved must be true only when the original goal and frozen success criteria are actually satisfied.",
    "When the goal was not achieved, set goalAchieved to false, state the real failure and an executable compensation plan in the normal answer, and do not replan, rerun, or roll back.",
    "The envelope is mandatory JSON and is not part of the user-facing answer.",
  ].join("\n");
}

export function parseWorkflowFinalResponse(value) {
  const rawText = String(value || "").trim();
  const taggedMeta = taggedText(rawText, FINAL_META_TAG);
  const text = rawText
    .replace(new RegExp(`<${FINAL_META_TAG}>[\\s\\S]*?</${FINAL_META_TAG}>`, "gi"), "")
    .trim();
  if (!taggedMeta) {
    return {
      text,
      metaPresent: false,
      goalAchieved: false,
      confidence: 0,
      failureReason: "Final acceptance envelope is missing.",
    };
  }
  try {
    const parsed = JSON.parse(taggedMeta);
    const confidence = Number(parsed?.confidence);
    if (typeof parsed?.goalAchieved !== "boolean") throw new Error("goalAchieved must be boolean");
    return {
      text,
      metaPresent: true,
      goalAchieved: parsed.goalAchieved,
      confidence: Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : null,
      failureReason: String(parsed?.failureReason || "").trim(),
    };
  } catch {
    return {
      text,
      metaPresent: false,
      goalAchieved: false,
      confidence: 0,
      failureReason: "Final acceptance envelope is invalid.",
    };
  }
}

function taggedText(value, tag) {
  const match = String(value || "").match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
  return match?.[1]?.trim() || "";
}

function responseWithoutSummaryEnvelope(value) {
  return String(value || "")
    .replace(new RegExp(`<${CHAT_SUMMARY_TAG}>[\\s\\S]*?</${CHAT_SUMMARY_TAG}>`, "gi"), "")
    .replace(new RegExp(`</?${NODE_RESULT_TAG}>`, "gi"), "")
    .replace(new RegExp(`<${NODE_META_TAG}>[\\s\\S]*?</${NODE_META_TAG}>`, "gi"), "")
    .trim();
}

function parseNodeMeta(value, options = {}) {
  const fallback = {
    status: options.required === true ? "failed" : "succeeded",
    confidence: null,
    requirementsSatisfied: null,
    failureReason: options.required === true
      ? "Node result metadata is missing or invalid."
      : "",
  };
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (
      options.required === true
      && (
        (parsed?.status !== "succeeded" && parsed?.status !== "failed")
        || typeof parsed?.requirementsSatisfied !== "boolean"
      )
    ) {
      return fallback;
    }
    const confidence = Number(parsed?.confidence);
    const requirementsSatisfied = typeof parsed?.requirementsSatisfied === "boolean"
      ? parsed.requirementsSatisfied
      : null;
    const failed = parsed?.status === "failed" || requirementsSatisfied === false;
    return {
      status: failed ? "failed" : "succeeded",
      confidence: Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : null,
      requirementsSatisfied,
      failureReason: String(parsed?.failureReason || "").trim(),
    };
  } catch {
    return fallback;
  }
}

function normalizeChatSummary(value) {
  let summary = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^[\s>*#`~_-]+/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^(?:群聊|聊天)?(?:摘要|总结|发言)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim();
  if (!summary) return "";
  summary = compactAtSentenceBoundary(summary, CHAT_SUMMARY_MAX_LENGTH);
  if (!/(?:^|[，。！？；])(?:我|我这边|我刚|先说|简单说|目前|这部分)/u.test(summary)) {
    summary = `我这边的结论是：${summary}`;
  }
  return ensureSentenceEnding(summary);
}

function fallbackChatSummary(context) {
  const title = compactPlainText(context?.title, 28);
  const purpose = compactPlainText(context?.purpose, 48);
  if (purpose) {
    return `我这边已经把“${purpose}”梳理好了，关键判断和建议都交回 Haolo 了。`;
  }
  if (title) {
    return `我这边已经把“${title}”这部分梳理好了，关键判断和建议都交回 Haolo 了。`;
  }
  return "我这边已经梳理好了，关键判断和建议都交回 Haolo 了。";
}

function compactPlainText(value, limit) {
  const text = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`#>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function compactAtSentenceBoundary(value, limit) {
  if (value.length <= limit) return value;
  const candidate = value.slice(0, limit);
  const boundary = Math.max(
    candidate.lastIndexOf("。"),
    candidate.lastIndexOf("！"),
    candidate.lastIndexOf("？"),
    candidate.lastIndexOf("；"),
  );
  if (boundary >= Math.floor(limit * 0.55)) return candidate.slice(0, boundary + 1);
  return `${candidate.trimEnd()}…`;
}

function ensureSentenceEnding(value) {
  return /[。！？…]$/u.test(value) ? value : `${value}。`;
}
