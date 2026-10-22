const CHANNELS = new Set(["wechat", "feishu", "telegram"]);
export const CHANNEL_CODEX_INSTRUCTIONS = "This external-channel request intentionally contains only the current message and its attachments. Do not search transcripts or session files to reconstruct chat history. When the user refers to a pending draft or previous plan, use haolo_market context to read the owned business state (drafts/latestAnalysis), then continue the relevant Skill. Ask for missing facts rather than guessing past conversation.";

// Explicit allowlist: no transcript, summaries, quoted history or prior media
// enter the fresh runtime from the visible conversation.
export function channelCodexInput(params = {}) {
  if (!CHANNELS.has(params.channel)) throw new Error("Unsupported external channel.");
  if (!params.threadId || !params.interactionId || !params.businessContextId) throw new Error("Missing channel request identity.");
  const attachments = Array.isArray(params.attachments) ? params.attachments : [];
  const mediaInputs = attachments.flatMap(attachment => {
    if (!attachment || typeof attachment !== "object") return [];
    const mime = String(attachment.mime || attachment.mimeType || "").toLowerCase();
    const localPath = attachment.path || attachment.localPath || attachment.filePath;
    const image = mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(String(attachment.name || localPath || attachment.url || ""));
    if (!image) return [];
    if (typeof localPath === "string" && localPath) return [{ type: "localImage", path: localPath }];
    if (typeof attachment.url === "string" && /^https?:\/\//i.test(attachment.url)) return [{ type: "image", url: attachment.url }];
    return [];
  });
  return {
    params: {
      provider: "channel-codex", sourceType: params.channel,
      threadId: String(params.threadId), interactionId: String(params.interactionId),
      text: String(params.text || ""), visibleQuestion: String(params.visibleQuestion || params.text || ""),
      businessContextId: String(params.businessContextId), cwd: params.cwd,
      model: params.model, modelProvider: params.modelProvider, reasoningEffort: params.reasoningEffort,
    },
    mediaInputs,
  };
}
