const VALID_REASONING_EFFORTS = Object.freeze([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

const REASONING_EFFORT_RANK = new Map(
  VALID_REASONING_EFFORTS.map((effort, index) => [effort, index]),
);

const ROUTINE_TRANSFORM_PATTERN = /(?:^|[\s：:，,。.!！?？])(?:总结|概括|翻译|润色|改写|校对|缩写|扩写|提取|整理|分类|格式化|转换|起标题|写标题|列要点|summari[sz]e\b|translate\b|rewrite\b|proofread\b|polish\b|format\b|extract\b|classify\b|convert\b)/i;
const TRIVIAL_TASK_PATTERN = /^(?:你好|您好|嗨|谢谢|感谢|再见|早上好|下午好|晚上好|晚安|(?:请)?(?:翻译|改写|润色|校对|格式化|起标题|写标题|解释|定义|计算|列出)|hello\b|hi\b|hey\b|thank(?:s| you)\b|bye\b|(?:please\s+)?(?:translate|rewrite|proofread|polish|format|define|calculate|list)\b)/i;
const QUICK_LOOKUP_PATTERN = /(?:天气|气温|温度|降雨|下雨|空气质量|几点|时间|日期|星期|汇率|股价|比分|赛程|热搜|什么是|是谁|哪里|多少|何时|weather\b|temperature\b|forecast\b|air quality\b|what time\b|what date\b|exchange rate\b|stock price\b|score\b|schedule\b|what is\b|who is\b|where is\b|how much\b)/i;
const IMPLEMENTATION_INTENT_PATTERN = /(?:实现|修改|改造|优化|开发|设计|重构|迁移|升级|排查|调试|修复|测试|代码|模块|系统|流程|链路|架构|implement\b|modify\b|build\b|develop\b|design\b|refactor\b|migrate\b|upgrade\b|debug\b|fix\b|test\b|code\b|module\b|system\b|workflow\b|architecture\b)/i;

const BROAD_SCOPE_PATTERNS = Object.freeze([
  /(?:所有|全部|全面|完整|彻底|系统性|全局|全链路|端到端).{0,24}(?:模式|流程|链路|系统|模块|客户端|服务|仓库|功能|测试|改造|实现)/i,
  /(?:跨|多个|多种|多阶段|多步骤|多模型|多仓库|多模块).{0,18}(?:系统|平台|模块|仓库|流程|阶段|步骤|模型|集成)/i,
  /(?:设计|实现|重构|迁移|升级|排查|调试|修复|优化|审计).{0,30}(?:架构|系统|数据库|并发|性能|安全|权限|认证|计费|发布|部署|工作流|协议|基础设施)/i,
  /(?:架构|系统|数据库|并发|性能|安全|权限|认证|计费|发布|部署|工作流|协议|基础设施).{0,30}(?:设计|实现|重构|迁移|升级|排查|调试|修复|优化|审计)/i,
  /(?:根因分析|生产事故|数据迁移|安全审计|性能分析|性能优化|兼容性改造|发布上线|生产部署|故障排查)/i,
  /(?:all|every|entire|comprehensive|end[- ]to[- ]end|system[- ]wide|across).{0,30}(?:mode|flow|path|system|module|client|service|repo|feature|test)/i,
  /(?:design|implement|refactor|migrate|upgrade|debug|diagnose|fix|optimi[sz]e|audit).{0,36}(?:architecture|system|database|concurrency|performance|security|authentication|billing|deployment|workflow|protocol|infrastructure)/i,
  /(?:root cause|production incident|data migration|security audit|performance analysis|production deploy)/i,
]);

const HIGH_STAKES_PATTERN = /(?:医疗|诊断|处方|法律|诉讼|合规|投资|证券|税务|保险理赔|medical|diagnosis|prescription|legal|litigation|compliance|investment|securities|tax|insurance claim)/i;
const INTERNAL_BLOCK_PATTERN = /<haolo_(?:windows_utf8_reminder|media_routing_reminder|thread_group_context|thread_group_memory|internal_turn_group_memory|execution_mode|multi_agent_mode|desktop_instructions|media_routing|identity)>[\s\S]*?<\/haolo_[^>]+>/gi;

export const HAOLO_REASONING_TASK_FIELD = "__haoloReasoningTask";
export const HAOLO_REASONING_SUPPORT_FIELD = "__haoloSupportedReasoningEfforts";
export const HAOLO_REASONING_FIXED_EFFORT_FIELD = "__haoloFixedReasoningEffort";

export function normalizeReasoningEffort(value) {
  const effort = String(value || "").trim().toLowerCase();
  return REASONING_EFFORT_RANK.has(effort) ? effort : undefined;
}

export function isGptSeriesTextModel(model, { assumeGptWhenMissing = false } = {}) {
  const normalized = String(model || "").trim().toLowerCase();
  if (!normalized) return assumeGptWhenMissing;
  const slug = normalized.split("/").at(-1) || normalized;
  return slug.startsWith("gpt-") && !slug.startsWith("gpt-image-");
}

export function isDeepSeekTextModel(model) {
  const normalized = String(model || "").trim().toLowerCase();
  if (!normalized) return false;
  const slug = normalized.split("/").at(-1) || normalized;
  return slug.startsWith("deepseek-") && !slug.includes("image");
}

export function assessTaskDifficulty(value) {
  const task = reasoningTaskText(value);
  if (!task) {
    return Object.freeze({ level: "unknown", effort: undefined, reason: "missing_task" });
  }

  const length = Array.from(task).length;
  const clauses = task.split(/[\n。！？!?；;]/).filter((part) => part.trim()).length;
  const numberedSteps = (task.match(/(?:^|\n)\s*(?:\d+[.)、]|[-*]\s+)/g) || []).length;
  const directive = task.slice(0, 320);
  const routineTransformation = ROUTINE_TRANSFORM_PATTERN.test(directive);
  const complexityText = routineTransformation ? directive : task;
  const broadScopeSignals = BROAD_SCOPE_PATTERNS.filter((pattern) => pattern.test(complexityText)).length;
  const highStakes = HIGH_STAKES_PATTERN.test(complexityText);
  if (
    highStakes
    || broadScopeSignals >= 2
  ) {
    return Object.freeze({ level: "intensive", effort: "max", reason: "intensive_complexity_signal" });
  }

  if (
    length <= 140
    && clauses <= 2
    && TRIVIAL_TASK_PATTERN.test(task)
  ) {
    return Object.freeze({ level: "trivial", effort: "low", reason: "bounded_trivial_task" });
  }

  if (
    length <= 80
    && clauses <= 2
    && QUICK_LOOKUP_PATTERN.test(task)
    && !IMPLEMENTATION_INTENT_PATTERN.test(task)
  ) {
    return Object.freeze({ level: "trivial", effort: "low", reason: "bounded_quick_lookup" });
  }

  // Mechanically bounded work stays routine even when the supplied source is
  // long. The source length should not by itself promote summarisation,
  // translation, extraction, or formatting into deep reasoning.
  if (routineTransformation && length <= 12_000) {
    return Object.freeze({ level: "simple", effort: "medium", reason: "routine_transformation" });
  }

  if (numberedSteps >= 8 || length > 8_000) {
    return Object.freeze({ level: "intensive", effort: "max", reason: "intensive_complexity_signal" });
  }

  if (
    broadScopeSignals >= 1
    || numberedSteps >= 4
    || (length > 900 && clauses >= 7)
    || length > 2_400
  ) {
    return Object.freeze({ level: "complex", effort: "high", reason: "complexity_signal" });
  }

  if (length <= 900 && clauses <= 6 && numberedSteps <= 3) {
    return Object.freeze({ level: "simple", effort: "medium", reason: "bounded_single_task" });
  }

  return Object.freeze({ level: "complex", effort: "high", reason: "unbounded_task" });
}

export const assessGptTaskDifficulty = assessTaskDifficulty;

export function adaptiveReasoningEffortForTask({
  model,
  task,
  requestedEffort,
  supportedReasoningEfforts,
  assumeGptWhenMissing = false,
} = {}) {
  const requested = normalizeReasoningEffort(requestedEffort);
  const adaptiveModel =
    isGptSeriesTextModel(model, { assumeGptWhenMissing })
    || isDeepSeekTextModel(model);
  if (!adaptiveModel) return requested;
  // Adaptive models never inherit a user or historical target. If task text
  // is temporarily unavailable, Haolo chooses the neutral automatic default.
  const adaptive = assessTaskDifficulty(task).effort || "medium";
  const supported = supportedEffortsForModel(model, supportedReasoningEfforts);
  return closestSupportedEffort(adaptive, supported) || adaptive;
}

export function gptReasoningEffortForTask(options = {}) {
  return adaptiveReasoningEffortForTask(options);
}

export function withAdaptiveTurnReasoning(method, params = {}) {
  const next = params && typeof params === "object" && !Array.isArray(params)
    ? { ...params }
    : {};
  const privateTask = next[HAOLO_REASONING_TASK_FIELD];
  const privateSupportedEfforts = next[HAOLO_REASONING_SUPPORT_FIELD];
  const privateFixedEffort = next[HAOLO_REASONING_FIXED_EFFORT_FIELD];
  delete next[HAOLO_REASONING_TASK_FIELD];
  delete next[HAOLO_REASONING_SUPPORT_FIELD];
  delete next[HAOLO_REASONING_FIXED_EFFORT_FIELD];
  if (method !== "turn/start") return next;
  const fixedEffort = normalizeReasoningEffort(privateFixedEffort);
  if (fixedEffort) {
    next.effort = closestSupportedEffort(
      fixedEffort,
      supportedEffortsForModel(next.model, privateSupportedEfforts),
    ) || fixedEffort;
    return next;
  }
  const collaborationEffort = normalizeReasoningEffort(
    next.collaborationMode?.settings?.reasoning_effort
      ?? next.collaboration_mode?.settings?.reasoning_effort,
  );
  if (collaborationEffort) {
    next.effort = collaborationEffort;
    return next;
  }
  const effort = adaptiveReasoningEffortForTask({
    model: next.model,
    task: privateTask || reasoningTaskFromTurnInput(next.input),
    requestedEffort: next.effort ?? next.reasoningEffort ?? next.reasoning_effort,
    supportedReasoningEfforts: privateSupportedEfforts,
    assumeGptWhenMissing: true,
  });
  if (effort) next.effort = effort;
  return next;
}

export function withAdaptiveGptTurnReasoning(method, params = {}) {
  return withAdaptiveTurnReasoning(method, params);
}

function supportedEffortsForModel(model, supplied) {
  const suppliedEfforts = normalizeSupportedReasoningEfforts(supplied);
  if (suppliedEfforts.length) return suppliedEfforts;

  const normalizedModel = String(model || "").trim().toLowerCase().split("/").at(-1) || "";
  if (normalizedModel === "deepseek-v4-flash" || normalizedModel.startsWith("deepseek-")) {
    return ["low", "high", "max"];
  }
  if (normalizedModel === "gpt-5.5") return ["low", "medium", "high", "xhigh"];
  if (normalizedModel === "gpt-5.6-luna") return ["low", "medium", "high", "xhigh", "max"];
  if (normalizedModel === "gpt-5.6-sol" || normalizedModel === "gpt-5.6-terra" || normalizedModel === "gpt-6-sol" || normalizedModel === "gpt-6-astra") {
    return ["low", "medium", "high", "xhigh", "max", "ultra"];
  }
  return ["low", "medium", "high"];
}

function normalizeSupportedReasoningEfforts(values) {
  if (!Array.isArray(values)) return [];
  const efforts = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeReasoningEffort(
      value && typeof value === "object"
        ? value.effort ?? value.value ?? value.reasoningEffort ?? value.reasoning_effort
        : value,
    );
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    efforts.push(normalized);
  }
  return efforts;
}

function closestSupportedEffort(desired, supported) {
  const normalizedDesired = normalizeReasoningEffort(desired);
  if (!normalizedDesired) return undefined;
  const normalizedSupported = normalizeSupportedReasoningEfforts(supported);
  if (!normalizedSupported.length) return normalizedDesired;
  if (normalizedSupported.includes(normalizedDesired)) return normalizedDesired;
  const desiredRank = REASONING_EFFORT_RANK.get(normalizedDesired);
  const ranked = normalizedSupported
    .map((effort) => ({ effort, rank: REASONING_EFFORT_RANK.get(effort) }))
    .filter((entry) => entry.rank != null)
    .sort((left, right) => left.rank - right.rank);
  return ranked.find((entry) => entry.rank >= desiredRank)?.effort || ranked.at(-1)?.effort;
}

export function reasoningTaskText(value) {
  let text = providerContentText(value).trim();
  if (!text) return "";

  const taggedTask = taggedJsonTask(text, "task_json", ["task", "userMessage", "user_message"])
    || taggedJsonTask(text, "haolo_group_chat_assignment_request", ["userMessage", "user_message", "task"]);
  if (taggedTask) return taggedTask;

  const userGoalMarker = "用户目标：";
  const userGoalIndex = text.lastIndexOf(userGoalMarker);
  if (userGoalIndex >= 0) {
    const userGoal = text.slice(userGoalIndex + userGoalMarker.length).trim();
    if (userGoal) return userGoal;
  }

  text = text.replace(INTERNAL_BLOCK_PATTERN, "\n").trim();
  return text;
}

function reasoningTaskFromTurnInput(input) {
  const items = Array.isArray(input) ? input : [];
  const textItems = items
    .filter((item) => item?.type === "text" || typeof item?.text === "string")
    .map((item) => item?.text)
    .filter(Boolean);
  return reasoningTaskText(textItems.at(-1) || "");
}

function taggedJsonTask(text, tag, keys) {
  const expression = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match;
  let candidate = "";
  while ((match = expression.exec(text))) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (typeof parsed === "string" && parsed.trim()) candidate = parsed.trim();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const key of keys) {
          if (typeof parsed[key] === "string" && parsed[key].trim()) {
            candidate = parsed[key].trim();
            break;
          }
        }
      }
    } catch {
      // Ignore malformed internal metadata and classify the visible text instead.
    }
  }
  return candidate;
}

function providerContentText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      return String(part?.text || part?.content || "");
    })
    .filter(Boolean)
    .join("\n");
}
