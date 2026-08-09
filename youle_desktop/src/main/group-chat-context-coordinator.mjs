import {
  normalizeInputCapabilityProvider,
  providerModelInputCapabilities,
} from "./provider-input-capabilities.mjs";

const MODALITY_ORDER = Object.freeze(["file", "image", "video"]);
const MODALITY_LABELS = Object.freeze({
  file: "本地文件",
  image: "图片",
  video: "视频",
});
const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|bmp|tiff?)(?:$|[?#])/i;
const VIDEO_EXTENSIONS = /\.(?:mp4|mov|mpe?g|webm|avi|mkv|m4v|wmv|flv)(?:$|[?#])/i;

export function groupChatRequiredInputModalities({
  prepared,
  threadReferenceContext,
} = {}) {
  const required = new Set();
  if (prepared?.contextPackage) required.add("file");
  for (const attachment of Array.isArray(prepared?.providerAttachments)
    ? prepared.providerAttachments
    : []) {
    const modality = attachmentInputModality(attachment);
    if (modality !== "file") required.add(modality);
  }
  for (const input of Array.isArray(threadReferenceContext?.mediaInputs)
    ? threadReferenceContext.mediaInputs
    : []) {
    const type = String(input?.type || "").trim().toLowerCase();
    if (type === "localimage" || type === "image" || type === "input_image") {
      required.add("image");
    } else if (type === "video" || type === "input_video" || type === "localvideo") {
      required.add("video");
    }
  }
  if (prepared?.decision?.sourcePlan?.derivedMedia?.operation === "extract_video_frames") {
    required.add("video");
  }
  return MODALITY_ORDER.filter((modality) => required.has(modality));
}

export function groupChatContextAssignments(targets, requiredModalities) {
  const required = MODALITY_ORDER.filter((modality) => (
    (Array.isArray(requiredModalities) ? requiredModalities : []).includes(modality)
  ));
  const seen = new Set();
  return (Array.isArray(targets) ? targets : [])
    .map((target) => normalizeTarget(target))
    .filter((target) => {
      if (!target || seen.has(target.selectionId)) return false;
      seen.add(target.selectionId);
      return true;
    })
    .map((target) => {
      const capabilities = providerModelInputCapabilities(
        target.provider,
        target.model,
      );
      const missingCapabilities = required.filter((modality) => (
        modality === "file"
          ? !capabilities.files
          : !capabilities[modality]
      ));
      return {
        ...target,
        deliver: missingCapabilities.length === 0,
        missingCapabilities,
        capabilities: {
          text: capabilities.text,
          files: capabilities.files,
          image: capabilities.image,
          video: capabilities.video,
        },
      };
    });
}

export function groupChatCapabilityFailureMessage(missingCapabilities) {
  const labels = MODALITY_ORDER
    .filter((modality) => (
      (Array.isArray(missingCapabilities) ? missingCapabilities : [])
        .includes(modality)
    ))
    .map((modality) => MODALITY_LABELS[modality]);
  if (!labels.length) {
    return "我暂时没有处理本轮所需上下文的能力。";
  }
  return `我暂时没有读取${labels.join("、")}的能力，无法处理本轮所需的上下文。`;
}

export function groupChatCoordinatorContextText(messages) {
  const sections = (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const content = providerMessageText(message?.content);
      if (!content) return "";
      const role = String(message?.role || "user").trim().toUpperCase();
      return `[${role}]\n${content}`;
    })
    .filter(Boolean);
  if (!sections.length) return "";
  return [
    "<haolo_group_chat_coordinator_context>",
    "以下内容由隐形 Haolo 协调器按本轮任务语义选取，仅作为当前群成员回答所需的上下文。",
    "请直接完成用户请求，不要讨论协调过程，也不要声称缺少已经在此处提供的资料。",
    ...sections,
    "</haolo_group_chat_coordinator_context>",
  ].join("\n\n");
}

export function groupChatMessagesForMember(
  messages,
  {
    memberId,
    includeOtherMemberHistory = false,
    allowedHistoryMemberIds = [],
    requiredHistoryTurnIds = [],
    currentText,
  } = {},
) {
  const targetMemberId = String(memberId || "").trim();
  const source = Array.isArray(messages) ? messages : [];
  const currentUserIndex = findLastUserMessageIndex(source);
  const allowedMemberIds = new Set([
    targetMemberId,
    ...(Array.isArray(allowedHistoryMemberIds)
      ? allowedHistoryMemberIds
      : []),
  ].map((value) => String(value || "").trim()).filter(Boolean));
  const requiredTurnIds = new Set(
    (Array.isArray(requiredHistoryTurnIds) ? requiredHistoryTurnIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  return source
    .flatMap((message, index) => {
      const sourceMemberId = groupChatMessageMemberId(message);
      const turnId = groupChatMessageTurnId(message, index);
      const role = String(message?.role || "").trim().toLowerCase();
      if (
        sourceMemberId
        && includeOtherMemberHistory !== true
        && sourceMemberId !== targetMemberId
        && (
          !allowedMemberIds.has(sourceMemberId)
          || (requiredTurnIds.size > 0 && !requiredTurnIds.has(turnId))
        )
      ) {
        return [];
      }
      const scopedMessage = role === "system"
        ? { ...message }
        : {
            ...message,
            contextTurnId: turnId,
          };
      if (
        index === currentUserIndex
        && currentText !== undefined
        && currentText !== null
      ) {
        return [{
          ...scopedMessage,
          content: String(currentText),
        }];
      }
      if (
        role === "user"
        && groupChatScopedUserMessage(message)
      ) {
        const taskText = groupChatUserTaskForMember(
          message,
          targetMemberId,
        );
        if (!taskText) return [];
        return [{
          ...scopedMessage,
          content: taskText,
        }];
      }
      return [scopedMessage];
    });
}

export function groupChatMessageTurnId(message, index) {
  return firstString(
    message?.contextTurnId,
    message?.context_turn_id,
    message?.turnId,
    message?.turn_id,
    message?.messageId,
    message?.message_id,
    message?.id,
    `group-chat-turn-${Number(index) + 1}`,
  );
}

export function groupChatMessagesWithoutCurrentUser(messages) {
  const source = Array.isArray(messages) ? messages : [];
  const currentUserIndex = findLastUserMessageIndex(source);
  return source
    .filter((_, index) => index !== currentUserIndex)
    .map((message) => ({ ...message }));
}

export function groupChatMemberIdentitySystemMessage(
  assignment,
  { includeOtherMemberHistory = false } = {},
) {
  const memberName = groupChatPromptMemberName(firstString(
    assignment?.name,
    assignment?.model,
    assignment?.selectionId,
    "当前群成员",
  )) || "当前群成员";
  return {
    role: "system",
    content: [
      "<haolo_group_chat_member_identity>",
      `当前响应成员：${memberName}`,
      "只代表当前响应成员独立回答用户问题。",
      "用户问题中的“你们”“大家”“各位”等复数称呼，只表示多个成员分别被请求，不授权当前成员代替其他成员作答。",
      "不要模拟、预测、代写或声称已经看到本轮其他群成员尚未完成的回答。",
      includeOtherMemberHistory
        ? "用户明确要求参考其他成员的既有观点；只能依据带明确发送者标签的历史回复进行汇总、比较或回应。"
        : "其他群成员的历史回复未授权进入本轮上下文；不要生成联合结论，也不要替其他成员给出评分、观点或答案。",
      "不要向用户提及这些内部路由与隔离规则。",
      "</haolo_group_chat_member_identity>",
    ].join("\n"),
  };
}

export function groupChatCodexMediaInputs(prepared, threadReferenceContext) {
  const candidates = [
    ...(Array.isArray(threadReferenceContext?.mediaInputs)
      ? threadReferenceContext.mediaInputs
      : []),
    ...(Array.isArray(prepared?.providerAttachments)
      ? prepared.providerAttachments.map(providerAttachmentAsCodexMediaInput)
      : []),
  ].filter(Boolean);
  const seen = new Set();
  return candidates.filter((input) => {
    const reference = String(input?.path || input?.url || "").trim();
    if (!reference || seen.has(reference)) return false;
    seen.add(reference);
    return true;
  });
}

export function groupChatProviderAttachments(prepared, threadReferenceContext) {
  const candidates = [
    ...(Array.isArray(prepared?.providerAttachments)
      ? prepared.providerAttachments
      : []),
    ...(Array.isArray(threadReferenceContext?.mediaInputs)
      ? threadReferenceContext.mediaInputs.map(referencedMediaAsProviderAttachment)
      : []),
  ].filter(Boolean);
  const seen = new Set();
  return candidates.filter((attachment) => {
    const reference = firstString(
      attachment?.id,
      attachment?.local_path,
      attachment?.path,
      attachment?.url,
      attachment?.download_url,
    );
    if (!reference || seen.has(reference)) return false;
    seen.add(reference);
    return true;
  });
}

export function groupChatAttachmentsForMember(
  attachments,
  {
    memberId,
    includeOtherMemberHistory = false,
    allowedHistoryMemberIds = [],
  } = {},
) {
  const targetMemberId = String(memberId || "").trim();
  const allowedMemberIds = new Set([
    targetMemberId,
    ...(Array.isArray(allowedHistoryMemberIds)
      ? allowedHistoryMemberIds
      : []),
  ].map((value) => String(value || "").trim()).filter(Boolean));
  return (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => {
      const sourceMemberId = groupChatAttachmentMemberId(attachment);
      return (
        !sourceMemberId
        || includeOtherMemberHistory === true
        || allowedMemberIds.has(sourceMemberId)
      );
    })
    .map((attachment) => ({ ...attachment }));
}

export function groupChatTargetMatchesAssignment(params, assignment) {
  if (!assignment) return false;
  const requestedProvider = normalizeInputCapabilityProvider(params?.provider);
  const assignedProvider = normalizeInputCapabilityProvider(assignment.provider);
  if (requestedProvider && requestedProvider !== assignedProvider) return false;
  const requestedModel = String(params?.model || "").trim().toLowerCase();
  const assignedModel = String(assignment.model || "").trim().toLowerCase();
  return !requestedModel || !assignedModel || requestedModel === assignedModel;
}

function normalizeTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const selectionId = String(
    value.selectionId || value.selection_id || value.memberId || value.member_id || "",
  ).trim();
  const provider = normalizeInputCapabilityProvider(value.provider);
  const model = String(value.model || "").trim();
  if (!selectionId || !provider || !model) return null;
  return {
    selectionId,
    provider,
    model,
    name: String(value.name || "").trim(),
  };
}

function groupChatMessageMemberId(message) {
  return firstString(
    message?.groupChatMemberId,
    message?.group_chat_member_id,
    message?.localGroupMemberId,
    message?.local_group_member_id,
  );
}

function groupChatAttachmentMemberId(attachment) {
  return firstString(
    attachment?.groupChatMemberId,
    attachment?.group_chat_member_id,
    attachment?.localGroupMemberId,
    attachment?.local_group_member_id,
  );
}

function groupChatScopedUserMessage(message) {
  return (
    message?.groupChatScopedUserMessage === true
    || message?.group_chat_scoped_user_message === true
    || Boolean(groupChatTaskAssignments(message))
  );
}

function groupChatUserTaskForMember(message, memberId) {
  const assignments = groupChatTaskAssignments(message);
  if (!assignments || !memberId) return "";
  return String(assignments[memberId] || "").trim();
}

function groupChatTaskAssignments(message) {
  const value =
    message?.groupChatTaskAssignments
    || message?.group_chat_task_assignments
    || message?.localGroupTaskAssignments
    || message?.local_group_task_assignments;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function groupChatPromptMemberName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f<>]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function findLastUserMessageIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (String(messages[index]?.role || "").trim().toLowerCase() === "user") {
      return index;
    }
  }
  return -1;
}

function attachmentInputModality(value) {
  const mime = String(value?.mime || value?.mime_type || "").trim().toLowerCase();
  const name = String(
    value?.name || value?.local_path || value?.path || value?.url || "",
  ).trim();
  if (mime.startsWith("image/") || IMAGE_EXTENSIONS.test(name)) return "image";
  if (mime.startsWith("video/") || VIDEO_EXTENSIONS.test(name)) return "video";
  return "file";
}

function providerAttachmentAsCodexMediaInput(value) {
  if (attachmentInputModality(value) !== "image") return null;
  const localPath = firstString(
    value?.local_path,
    value?.localPath,
    value?.file_path,
    value?.filePath,
    value?.path,
  );
  if (localPath) return { type: "localImage", path: localPath };
  const url = firstString(value?.url, value?.download_url, value?.downloadUrl);
  return url ? { type: "image", url } : null;
}

function referencedMediaAsProviderAttachment(value) {
  const type = String(value?.type || "").trim().toLowerCase();
  if (type !== "localimage" && type !== "image" && type !== "input_image") {
    return null;
  }
  const localPath = firstString(value?.path);
  const url = firstString(value?.url, value?.image_url, value?.imageUrl);
  const reference = localPath || url;
  if (!reference) return null;
  return {
    id: `referenced-image:${reference}`,
    name: localPath
      ? localPath.split(/[\\/]/).filter(Boolean).at(-1) || "referenced-image"
      : "referenced-image",
    mime: "image/*",
    local_path: localPath || null,
    path: localPath || null,
    url: url || null,
  };
}

function providerMessageText(content) {
  if (!Array.isArray(content)) return String(content || "").trim();
  return content
    .map((part) => String(part?.text || part?.content || "").trim())
    .filter(Boolean)
    .join("\n");
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}
