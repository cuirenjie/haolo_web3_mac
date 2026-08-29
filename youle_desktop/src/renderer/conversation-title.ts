export function stripConversationTitleMentionTokens(
  text: string,
  mentionTokens: readonly string[],
) {
  let source = String(text || "");
  const tokens = [...new Set(
    mentionTokens
      .map((token) => String(token || "").trim())
      .filter(Boolean),
  )].sort((first, second) => second.length - first.length);
  for (const token of tokens) source = source.split(token).join(" ");
  return source.replace(/\s+/g, " ").trim();
}
