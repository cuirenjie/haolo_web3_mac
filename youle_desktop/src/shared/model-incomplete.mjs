// Error-boundary metadata only. Never inspect assistant text or tool outputs.
export const MODEL_RESPONSE_INCOMPLETE = "MODEL_RESPONSE_INCOMPLETE";
const token = value => typeof value === "string" && /^[\w-]{1,160}$/.test(value) ? value : "";
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function modelIncompleteFacts(value) {
  const seen = new Set();
  const visit = (entry, depth = 0) => {
    if (entry == null || depth > 8) return null;
    if (typeof entry === "string") {
      if (entry.length < 32000 && entry.trim().startsWith("{")) {
        try { return visit(JSON.parse(entry), depth + 1); } catch { /* Wrapped runtime message. */ }
      }
      if (!/MODEL_RESPONSE_INCOMPLETE|response[._]incomplete|Upstream response incomplete/.test(entry)) return null;
      const field = name => entry.match(new RegExp(`\\b${name}=([\\w-]+)`))?.[1];
      return { reason: token(field("reason")) || "unknown", responseId: token(field("response_id")),
        inputTokens: count(Number(field("input_tokens"))), outputTokens: count(Number(field("output_tokens"))), outputItems: count(Number(field("output_items"))) };
    }
    if (typeof entry !== "object" || seen.has(entry)) return null;
    seen.add(entry);
    const response = entry.response || entry;
    if (entry.code === MODEL_RESPONSE_INCOMPLETE && !entry.incomplete_reason && entry.message) {
      const wrapped = visit(entry.message, depth + 1);
      if (wrapped) return wrapped;
    }
    if (entry.type === "response.incomplete" || response.status === "incomplete" || entry.code === MODEL_RESPONSE_INCOMPLETE) {
      return {
        reason: token(response.incomplete_details?.reason || entry.incomplete_reason) || "unknown",
        responseId: token(response.id || entry.response_id),
        inputTokens: count(response.usage?.input_tokens), outputTokens: count(response.usage?.output_tokens),
        outputItems: Array.isArray(response.output) ? response.output.length : count(entry.output_items),
      };
    }
    for (const key of ["params", "turn", "error", "response", "cause", "codexErrorInfo", "codex_error_info", "responseStreamDisconnected", "response_stream_disconnected", "additionalDetails", "additional_details", "message", "reason", "detail"]) {
      const found = visit(entry[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return visit(value);
}

export function incompleteErrorMessage(facts) {
  return `${MODEL_RESPONSE_INCOMPLETE} reason=${token(facts.reason) || "unknown"}`
    + (token(facts.responseId) ? ` response_id=${facts.responseId}` : "")
    + [ ["input_tokens", facts.inputTokens], ["output_tokens", facts.outputTokens], ["output_items", facts.outputItems] ]
      .filter(([, value]) => count(value) !== null).map(([key, value]) => ` ${key}=${value}`).join("");
}

const copy = {
  "zh-CN": ["模型达到本次输出上限，回答尚未完成。", "模型因内容限制未能完成回答。", "模型提前结束了回答，本轮尚未完成。", "已收到的内容会保留。请在当前会话检查已有结果后继续补全。", "继续补全", "请接着上一轮未完成的回答继续，只补充尚未完成的部分。先核对会话中已有的工具结果和操作记录，不要重新执行已经完成的操作；状态不明的操作先核实，不要假定成功或重复提交。"],
  "zh-TW": ["模型達到本次輸出上限，回答尚未完成。", "模型因內容限制未能完成回答。", "模型提前結束回答，本輪尚未完成。", "已收到的內容會保留。請在目前會話檢查已有結果後繼續補全。", "繼續補全", "請接續上一輪未完成的回答，只補充尚未完成的部分。先核對會話中已有的工具結果及操作紀錄，不要再次執行已完成的操作；狀態不明的操作先核實，不要假定成功或重複提交。"],
  en: ["The model reached its output limit before finishing.", "The model could not finish because of a content restriction.", "The model stopped before finishing this answer.", "Received content is kept. Review the existing results before continuing in this conversation.", "Continue answer", "Continue the unfinished answer from the last turn, adding only what remains. Check the existing tool results and action records first. Do not repeat completed operations. Verify operations with an unknown outcome before proceeding; do not assume success or submit them again."],
  ja: ["モデルが出力上限に達し、回答が未完了です。", "内容の制限により回答を完了できませんでした。", "モデルが回答を途中で終了したため、この回答は未完了です。", "受信済みの内容は保持されます。既存の結果を確認し、この会話で続きを依頼してください。", "回答を続ける", "前の未完了の回答について、残っている部分だけ続けてください。既存のツール結果と操作記録を先に確認し、完了した操作を繰り返さないでください。結果が不明な操作は確認し、成功と決めつけたり再送信したりしないでください。"],
  ko: ["모델이 출력 한도에 도달해 답변을 완료하지 못했습니다.", "콘텐츠 제한으로 답변을 완료하지 못했습니다.", "모델이 답변을 중단해 아직 완료되지 않았습니다.", "받은 내용은 유지됩니다. 기존 결과를 확인한 후 이 대화에서 계속하세요.", "답변 이어가기", "이전 답변에서 완료하지 못한 부분만 이어서 작성하세요. 기존 도구 결과와 작업 기록을 먼저 확인하고 완료된 작업을 반복하지 마세요. 결과가 불명확한 작업은 확인한 후 진행하고, 성공했다고 가정하거나 다시 제출하지 마세요."],
  vi: ["Mô hình đạt giới hạn đầu ra trước khi hoàn tất câu trả lời.", "Mô hình không thể hoàn tất do giới hạn nội dung.", "Mô hình dừng trước khi hoàn tất câu trả lời.", "Nội dung đã nhận được giữ lại. Hãy kiểm tra kết quả hiện có trước khi tiếp tục trong cuộc trò chuyện này.", "Tiếp tục câu trả lời", "Tiếp tục câu trả lời chưa hoàn tất ở lượt trước, chỉ bổ sung phần còn thiếu. Trước tiên hãy kiểm tra kết quả công cụ và lịch sử thao tác. Không lặp lại thao tác đã hoàn tất. Xác minh thao tác chưa rõ kết quả trước khi tiếp tục; không giả định thành công hoặc gửi lại."],
};
export function incompleteResponseCopy(reason = "unknown", language = "en") {
  const c = copy[language === "zh-Hant" ? "zh-TW" : language] || copy.en;
  return { message: reason === "content_filter" ? c[1] : `${c[reason === "max_output_tokens" ? 0 : 2]} ${c[3]}`, label: c[4], prompt: c[5], canContinue: reason !== "content_filter" };
}

export function incompleteNoticeItem(threadId, turnId, reason, language, diagnosticSuffix = "") {
  const c = incompleteResponseCopy(reason, language);
  return {
    id: `agent-notice-incomplete-${turnId || "latest"}`, type: "agentMessage", turnId,
    text: c.message + diagnosticSuffix, __youleLocalStatus: true, __youleIncompleteNotice: true,
    actions: c.canContinue ? [{ id: "continue-incomplete", kind: "continue-incomplete", label: c.label, text: c.prompt, conversation_id: threadId }] : [],
  };
}

export function preserveIncompletePartial(existing, incoming) {
  if (existing?.__youleIncompletePartial !== true || existing.type !== "agentMessage" || existing.id !== incoming?.id) return incoming;
  if (typeof existing.text !== "string" || (incoming.text != null && typeof incoming.text !== "string")) return incoming;
  const text = incoming.text || "";
  // A late sparse snapshot cannot erase a received prefix. A different,
  // authoritative answer is never overwritten with the local partial answer.
  return existing.text.length > text.length && existing.text.startsWith(text)
    ? { ...incoming, text: existing.text, __youleIncompletePartial: true } : incoming;
}
