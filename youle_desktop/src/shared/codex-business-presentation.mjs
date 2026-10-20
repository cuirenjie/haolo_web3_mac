// Native tool output is persisted by Codex. Rehydrate the same native cards on
// replay; never inject synthetic assistant/user turns while Codex is executing.
export function businessPresentationItems(item) {
  return businessPresentationResult(item)?.presentationItems?.filter(candidate =>
    candidate?.type === "agentMessage" && typeof candidate.id === "string" &&
    typeof candidate.text === "string").map(candidate => {
      // Replayed tool results belong to the enclosing turn, including a
      // display-only follow-up that reuses an older analysis reference.
      const turnId = item.turnId || item.turn_id;
      return turnId ? { ...candidate, turnId } : candidate;
    }) || [];
}

export function businessPresentationResult(item) {
  if (!["dynamicToolCall", "mcpToolCall"].includes(item?.type) ||
      !/haolo_(trading|analysis|chart_draw|plan_present|alerts|simulation|personal_strategy|plans)$/.test(String(item.tool || ""))) return null;
  const content = item.contentItems || item.content_items || item.result?.content || [];
  for (const entry of content) {
    if (!["inputText", "text"].includes(entry.type) || typeof entry.text !== "string") continue;
    try {
      const value = JSON.parse(entry.text);
      if (!Array.isArray(value?.presentationItems)) continue;
      return value;
    } catch { /* Other tool content is not a native presentation. */ }
  }
  return null;
}
