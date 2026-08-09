function normalizedAttachmentName(value) {
  const rawName = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? value.name || value.fileName || value.filename || ""
      : "";
  return String(rawName).trim().split(/[\\/]/).filter(Boolean).at(-1) || "";
}

export function buildVisibleConsumptionQuestion(text, attachments = []) {
  const visibleText = String(text || "").trim();
  const safeAttachments = Array.isArray(attachments) ? attachments : [];
  const names = [...new Set(safeAttachments.map(normalizedAttachmentName).filter(Boolean))];
  const hasImages = safeAttachments.some((attachment) => {
    if (!attachment || typeof attachment !== "object") return false;
    return String(attachment.mime || attachment.type || "").toLowerCase().startsWith("image/");
  });
  const attachmentSummary = names.length
    ? `${hasImages ? "图片" : "附件"}：${names.join("、")}`
    : safeAttachments.length
      ? (hasImages ? "图片" : "附件")
      : "";
  return [visibleText, attachmentSummary].filter(Boolean).join("\n");
}

export function buildSubagentConsumptionQuestion(parentQuestion, index = 1) {
  const question = String(parentQuestion || "").trim() || "未命名任务";
  const safeIndex = Math.max(1, Math.floor(Number(index) || 1));
  return `[子Agent${safeIndex}]${question.replace(/^\[子Agent(?:\d+)?\]/, "")}`;
}

export function buildSubagentConsumptionRecord(parentRecord = {}, child = {}) {
  const interactionId = String(child.interactionId || child.turnId || child.turn_id || "").trim();
  const childConversationId = String(
    child.childConversationId || child.child_conversation_id || child.threadId || child.thread_id || "",
  ).trim();
  if (!interactionId || !childConversationId) return null;
  return {
    interactionId,
    conversationId: String(parentRecord.conversationId || parentRecord.conversation_id || parentRecord.threadId || "").trim(),
    childConversationId,
    sourceType: String(parentRecord.sourceType || parentRecord.source_type || "haolo").trim() || "haolo",
    question: buildSubagentConsumptionQuestion(parentRecord.question, child.index),
    status: String(child.status || "running"),
    startedAt: child.startedAt || child.started_at,
    endedAt: child.endedAt || child.ended_at,
    answer: child.answer,
  };
}

export function createSerializedConsumptionReporter(send, options = {}) {
  if (typeof send !== "function") throw new TypeError("send is required");
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 5);
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs) || 250);
  const queues = new Map();

  const sendWithRetry = async (params) => {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await send(params);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (2 ** (attempt - 1))));
      }
    }
    throw lastError;
  };

  const report = function report(params = {}) {
    const key = String(
      params.interactionId || params.interaction_id || params.conversationId || params.conversation_id || "unscoped",
    );
    const previous = queues.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(() => sendWithRetry(params));
    queues.set(key, current);
    const cleanup = () => {
      if (queues.get(key) === current) queues.delete(key);
    };
    current.then(cleanup, cleanup);
    return current;
  };
  report.flush = async () => {
    const pending = [...queues.values()];
    if (!pending.length) return [];
    return Promise.allSettled(pending);
  };
  report.pendingCount = () => queues.size;
  return report;
}
