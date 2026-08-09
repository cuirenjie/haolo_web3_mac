const DEFAULT_MAX_CONVERSATION_TURNS = 24;
const DEFAULT_RECENT_TURN_COUNT = 8;
const MAX_CONVERSATION_ATTACHMENTS = 64;
const MAX_SEMANTIC_TURN_CHARS = 12_000;

export function normalizeQuestionAnswerConversationTurns(
  messages,
  {
    maxTurns = DEFAULT_MAX_CONVERSATION_TURNS,
    currentAttachments = [],
  } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  const normalized = source
    .map((message, index) => normalizeConversationTurn(message, index))
    .filter(Boolean)
    .slice(-positiveInteger(maxTurns, DEFAULT_MAX_CONVERSATION_TURNS));
  const currentIndex = findCurrentUserTurnIndex(normalized);
  return normalized.map((turn, index) => ({
    ...turn,
    isCurrent: index === currentIndex,
    attachments: (
      index === currentIndex
        ? dedupeAttachments([
            ...turn.attachments,
            ...normalizeConversationAttachments(currentAttachments, turn.turnId),
          ])
        : turn.attachments
    ).map((attachment) => ({
        ...attachment,
        source: index === currentIndex ? "current_turn" : "conversation_history",
      })),
  }));
}

export function semanticConversationTurns(turns) {
  return (Array.isArray(turns) ? turns : []).map((turn) => ({
    turnId: turn.turnId,
    role: turn.role,
    text: semanticPlanningText(turn.text),
    isCurrent: turn.isCurrent === true,
    attachments: (Array.isArray(turn.attachments) ? turn.attachments : []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mime: attachment.mime,
      kind: attachment.kind,
      delivery: attachment.delivery,
      source: attachment.source,
      hasLocalPath: Boolean(attachment.local_path || attachment.path),
      hasRemoteUrl: Boolean(attachment.url || attachment.download_url),
    })),
  }));
}

export function conversationAttachmentCatalog(turns) {
  return (Array.isArray(turns) ? turns : [])
    .flatMap((turn) => (
      (Array.isArray(turn.attachments) ? turn.attachments : []).map((attachment) => ({
        ...attachment,
        turnId: turn.turnId,
        role: turn.role,
        isCurrent: turn.isCurrent === true,
      }))
    ))
    .slice(-MAX_CONVERSATION_ATTACHMENTS);
}

export function providerAttachmentsForQuestionAnswerPlan(turns, sourcePlan) {
  const catalog = conversationAttachmentCatalog(turns);
  const attachmentPlan = sourcePlan?.attachments || {};
  const selected = new Set([
    ...stringList(attachmentPlan.currentAttachmentIds),
    ...stringList(attachmentPlan.historicalAttachmentIds),
  ].map((value) => value.toLowerCase()));
  if (!selected.size) return [];
  return dedupeAttachments(
    catalog
      .filter((attachment) => (
        selected.has(String(attachment.id || "").toLowerCase())
        && attachment.delivery === "native_media"
      ))
      .map(publicProviderAttachment),
  );
}

export function selectedHostAttachmentPathsForPlan(turns, sourcePlan) {
  const requested = new Set(
    stringList(sourcePlan?.localFiles?.attachmentIds)
      .map((value) => value.toLowerCase()),
  );
  if (!requested.size) return [];
  return uniqueStrings(
    conversationAttachmentCatalog(turns)
      .filter((attachment) => (
        requested.has(String(attachment.id || "").toLowerCase())
        && attachment.delivery === "host_read_through"
      ))
      .map((attachment) => firstString(
        attachment.local_path,
        attachment.path,
        attachment.file_path,
      )),
  );
}

export function providerMessagesWithQuestionAnswerConversationPlan(
  messages,
  prepared,
  { requiredTurnIds = [] } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  const plan = prepared?.decision?.sourcePlan;
  const requiredConversationTurnIds = selectedConversationExchangeIds(
    source,
    stringList(requiredTurnIds),
  );
  if (!plan?.conversation && !requiredConversationTurnIds.size) return source;
  const mode = String(plan?.conversation?.mode || "none").trim();
  const lastUserIndex = findLastUserMessageIndex(source);
  if (lastUserIndex < 0) return source;
  const selectedTurnIds = selectedConversationExchangeIds(
    source,
    stringList(plan?.conversation?.selectedTurnIds),
  );
  const recentTurnCount = positiveInteger(
    plan?.conversation?.recentTurnCount,
    DEFAULT_RECENT_TURN_COUNT,
  );
  const recentStart = Math.max(0, lastUserIndex - recentTurnCount);
  return source.filter((message, index) => {
    if (message?.role === "system") return true;
    if (index === lastUserIndex) return true;
    const turnId = messageTurnId(message, index);
    if (requiredConversationTurnIds.has(turnId)) return true;
    if (selectedTurnIds.has(turnId)) return true;
    if (mode === "recent" || mode === "all_recent") {
      return index >= recentStart && index < lastUserIndex;
    }
    return false;
  });
}

export function questionAnswerSourcePlanSummary(decision) {
  const plan = decision?.sourcePlan;
  if (!plan) {
    if (
      decision?.authorization?.currentGroup?.plannerRequested === true
      && decision.authorization.currentGroup.granted !== true
    ) {
      return "将只使用当前消息和附件；未选择分组，不读取当前目录";
    }
    return decision?.needsLocalFiles
      ? "将携带语义选中的本地资料"
      : "将直接使用当前消息和附件";
  }
  const parts = [];
  const conversationMode = String(plan.conversation?.mode || "none");
  const historicalCount = stringList(
    plan.attachments?.historicalAttachmentIds,
  ).length;
  const currentCount = stringList(plan.attachments?.currentAttachmentIds).length;
  if (conversationMode !== "none") parts.push("相关历史对话");
  if (historicalCount) parts.push(`${historicalCount} 个历史附件`);
  if (currentCount) parts.push(`${currentCount} 个本轮附件`);
  if (plan.localFiles?.includeCurrentGroup) parts.push("当前分组文件");
  const fileAttachmentCount = stringList(plan.localFiles?.attachmentIds).length;
  if (fileAttachmentCount) parts.push(`${fileAttachmentCount} 个文档附件`);
  if (plan.derivedMedia?.operation === "extract_video_frames") {
    const frameCount = Array.isArray(plan.derivedMedia.timestampsSeconds)
      ? plan.derivedMedia.timestampsSeconds.length
      : 0;
    parts.push(`${frameCount || 1} 个视频帧`);
  }
  const summary = parts.length ? `将使用${parts.join("、")}` : "将只使用当前问题";
  if (
    decision?.authorization?.currentGroup?.plannerRequested === true
    && decision.authorization.currentGroup.granted !== true
  ) {
    return `${summary}；未选择分组，不读取当前目录`;
  }
  return summary;
}

function normalizeConversationTurn(message, index) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const role = ["system", "assistant", "user"].includes(String(message.role || ""))
    ? String(message.role)
    : "user";
  const text = providerContentText(message.content ?? message.text);
  const turnId = messageTurnId(message, index);
  const attachments = normalizeConversationAttachments(
    message.attachments ?? contentAttachments(message.content),
    turnId,
  );
  if (!text && !attachments.length) return null;
  return {
    turnId,
    role,
    text,
    attachments,
  };
}

function normalizeConversationAttachments(values, turnId) {
  const source = Array.isArray(values) ? values : [];
  return source
    .map((value, index) => normalizeConversationAttachment(value, turnId, index))
    .filter(Boolean)
    .slice(0, MAX_CONVERSATION_ATTACHMENTS);
}

function normalizeConversationAttachment(value, turnId, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = firstString(value.name, value.file_name, `attachment-${index + 1}`);
  const mime = String(value.mime || value.mime_type || "").trim().toLowerCase()
    || attachmentMimeFromName(name);
  const kind = attachmentKind(mime, name);
  const id = firstString(
    value.id,
    value.attachmentId,
    value.attachment_id,
    value.material_id,
    value.materialId,
    value.object_key,
    `${turnId}:attachment:${index + 1}`,
  );
  const localPath = firstString(
    value.local_path,
    value.localPath,
    value.file_path,
    value.filePath,
    value.path,
  );
  const url = firstString(
    value.url,
    value.download_url,
    value.downloadUrl,
    value.preview_url,
    value.previewUrl,
  );
  return {
    id,
    name,
    mime,
    kind,
    delivery: kind === "image" || kind === "video"
      ? "native_media"
      : "host_read_through",
    size: finiteNumber(value.size),
    object_key: firstString(value.object_key),
    material_id: firstString(value.material_id, value.materialId),
    groupChatMemberId: firstString(
      value.groupChatMemberId,
      value.group_chat_member_id,
      value.localGroupMemberId,
      value.local_group_member_id,
    ) || null,
    groupChatMemberName: firstString(
      value.groupChatMemberName,
      value.group_chat_member_name,
      value.localGroupMemberName,
      value.local_group_member_name,
    ) || null,
    local_path: localPath || null,
    path: localPath || null,
    url: url || null,
    download_url: firstString(value.download_url, value.downloadUrl) || null,
  };
}

function publicProviderAttachment(attachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
    object_key: attachment.object_key,
    material_id: attachment.material_id,
    groupChatMemberId: attachment.groupChatMemberId,
    groupChatMemberName: attachment.groupChatMemberName,
    local_path: attachment.local_path,
    path: attachment.path,
    url: attachment.url,
    download_url: attachment.download_url,
  };
}

function selectedConversationExchangeIds(messages, requestedIds) {
  const requested = new Set(requestedIds);
  if (!requested.size) return requested;
  const ids = messages.map(messageTurnId);
  for (let index = 0; index < messages.length; index += 1) {
    if (!requested.has(ids[index])) continue;
    if (messages[index]?.role === "user" && messages[index + 1]?.role === "assistant") {
      requested.add(ids[index + 1]);
    }
    if (messages[index]?.role === "assistant" && messages[index - 1]?.role === "user") {
      requested.add(ids[index - 1]);
    }
  }
  return requested;
}

function findCurrentUserTurnIndex(turns) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.role === "user") return index;
  }
  return -1;
}

function findLastUserMessageIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function messageTurnId(message, index) {
  return firstString(
    message?.contextTurnId,
    message?.context_turn_id,
    message?.turnId,
    message?.turn_id,
    message?.messageId,
    message?.message_id,
    message?.id,
    `qa-turn-${Number(index) + 1}`,
  );
}

function contentAttachments(content) {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => (
    Array.isArray(part?.attachments) ? part.attachments : []
  ));
}

function providerContentText(content) {
  if (!Array.isArray(content)) return String(content || "").trim();
  return content
    .map((part) => String(part?.text || "").trim())
    .filter(Boolean)
    .join("\n");
}

function semanticPlanningText(value) {
  const text = String(value || "");
  if (text.length <= MAX_SEMANTIC_TURN_CHARS) return text;
  const half = Math.floor((MAX_SEMANTIC_TURN_CHARS - 80) / 2);
  return [
    text.slice(0, half),
    "\n...[为上下文来源规划省略中间内容；实际选中后仍提交完整轮次]...\n",
    text.slice(-half),
  ].join("");
}

function attachmentKind(mime, name) {
  const normalizedMime = String(mime || "").toLowerCase();
  if (normalizedMime === "inode/directory") return "folder";
  if (normalizedMime.startsWith("image/")) return "image";
  if (normalizedMime.startsWith("video/")) return "video";
  const lowerName = String(name || "").toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)(?:$|[?#])/.test(lowerName)) return "image";
  if (/\.(mp4|mov|mpe?g|webm|avi|mkv|m4v|wmv|flv)(?:$|[?#])/.test(lowerName)) return "video";
  return "file";
}

function attachmentMimeFromName(name) {
  const lower = String(name || "").toLowerCase();
  if (/\.(png)(?:$|[?#])/.test(lower)) return "image/png";
  if (/\.(jpe?g)(?:$|[?#])/.test(lower)) return "image/jpeg";
  if (/\.(webp)(?:$|[?#])/.test(lower)) return "image/webp";
  if (/\.(gif)(?:$|[?#])/.test(lower)) return "image/gif";
  if (/\.(mp4|m4v)(?:$|[?#])/.test(lower)) return "video/mp4";
  if (/\.(mov)(?:$|[?#])/.test(lower)) return "video/quicktime";
  if (/\.(webm)(?:$|[?#])/.test(lower)) return "video/webm";
  return "";
}

function dedupeAttachments(attachments) {
  const seen = new Set();
  return attachments.filter((attachment) => {
    const key = firstString(
      attachment.id,
      attachment.object_key,
      attachment.url,
      attachment.local_path,
      attachment.name,
    ).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
}

function stringList(values) {
  return uniqueStrings(Array.isArray(values) ? values : []);
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : fallback;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
