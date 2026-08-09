import {
  conversationAttachmentCatalog,
  semanticConversationTurns,
} from "./question-answer-conversation-context.mjs";

const CONTEXT_DECISION_PROTOCOL_VERSION = 2;

const VALID_STRATEGIES = new Set([
  "none",
  "targeted_read",
  "broad_context_then_on_demand",
]);

const VALID_SCOPES = new Set([
  "current_group",
  "uploads",
]);

const VALID_RELATIONS = new Set([
  "new_request",
  "follow_up_previous_answer",
  "follow_up_previous_attachment",
  "mixed",
]);

const VALID_CONVERSATION_MODES = new Set([
  "none",
  "recent",
  "referenced_turns",
  "all_recent",
]);

export class QuestionAnswerContextIntentResolver {
  constructor({ decide } = {}) {
    if (typeof decide !== "function") {
      throw new Error("A Haolo semantic context decision function is required.");
    }
    this.decide = decide;
  }

  async resolve({
    cwd,
    prompt,
    explicitPaths = [],
    uploads = [],
    conversationTurns = [],
    threadReferences = [],
    workspaceSummary = null,
    currentGroupAuthorized = false,
    signal,
  } = {}) {
    const normalizedPaths = uniqueStrings(explicitPaths);
    const normalizedUploads = normalizeIntentUploads(uploads, normalizedPaths);
    const normalizedThreadReferences = normalizeIntentThreadReferences(threadReferences);
    const request = {
      protocolVersion: CONTEXT_DECISION_PROTOCOL_VERSION,
      mode: "question_answer",
      userPrompt: String(prompt || "").trim(),
      currentGroup: {
        root: String(cwd || "").trim(),
        authorized: currentGroupAuthorized === true,
        ...(workspaceSummary && typeof workspaceSummary === "object"
          ? workspaceSummary
          : {}),
      },
      uploads: normalizedUploads,
      conversationTurns: semanticConversationTurns(conversationTurns),
      threadReferences: normalizedThreadReferences,
      qualityPolicy: {
        objective: "maximize_answer_quality",
        contextMustBeSufficient: true,
        preferConversationContinuityForFollowUps: true,
        localFilesRequirePositiveTaskEvidence: true,
        explicitThreadReferencesDeliveredSeparately: true,
        excludeUnrelatedContext: true,
        nativeMediaAlreadyDelivered: true,
      },
    };

    try {
      const response = await this.decide({
        cwd,
        prompt: semanticDecisionPrompt(request),
        signal,
      });
      return normalizeSemanticDecision(response?.text ?? response, {
        uploads: normalizedUploads,
        conversationTurns,
      });
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      return resilientFallbackDecision(error, normalizedUploads, conversationTurns);
    }
  }
}

export function normalizeSemanticDecision(
  value,
  { uploads = [], explicitPaths = [], conversationTurns = [] } = {},
) {
  const normalizedUploads = normalizeIntentUploads(uploads, explicitPaths);
  const parsed = parseDecisionObject(value);
  if (!parsed) {
    return resilientFallbackDecision(
      new Error("Haolo semantic context decision did not return valid JSON."),
      normalizedUploads,
      conversationTurns,
    );
  }
  const sourcePlan = normalizeSourcePlan(parsed, {
    uploads: normalizedUploads,
    conversationTurns,
  });
  const needsLocalFiles = sourcePlan.localFiles.includeCurrentGroup
    || sourcePlan.localFiles.attachmentIds.length > 0;
  const scopes = uniqueStrings(parsed.scope ?? parsed.scopes)
    .filter((scope) => VALID_SCOPES.has(scope));
  if (sourcePlan.localFiles.includeCurrentGroup && !scopes.includes("current_group")) {
    scopes.push("current_group");
  }
  if (sourcePlan.localFiles.attachmentIds.length && !scopes.includes("uploads")) {
    scopes.push("uploads");
  }
  const selectedUploadIds = needsLocalFiles
    ? normalizeSelectedUploadIds(
        sourcePlan.localFiles.attachmentIds,
        normalizedUploads,
        scopes.includes("uploads"),
      )
    : [];
  if (needsLocalFiles && !scopes.length) {
    scopes.push(selectedUploadIds.length ? "uploads" : "current_group");
  }
  const requestedStrategy = String(
    parsed.strategy || parsed.accessStrategy || parsed.access_strategy || "",
  ).trim();
  const strategy = needsLocalFiles
    ? (
        VALID_STRATEGIES.has(requestedStrategy) && requestedStrategy !== "none"
          ? requestedStrategy
          : scopes.length === 1 && scopes[0] === "uploads"
            ? "targeted_read"
            : "broad_context_then_on_demand"
      )
    : "none";
  const confidence = boundedNumber(parsed.confidence, 0.75);
  return {
    protocolVersion: CONTEXT_DECISION_PROTOCOL_VERSION,
    needsLocalFiles,
    intent: String(parsed.intent || "general_question").trim() || "general_question",
    scope: scopes,
    strategy,
    selectedUploadIds,
    searchHints: sourcePlan.localFiles.searchHints,
    requiredEvidence: sourcePlan.localFiles.requiredEvidence,
    confidence,
    rationale: String(parsed.rationale || parsed.reason || "").trim(),
    source: "haolo_semantic",
    sourcePlan,
    error: null,
  };
}

export function semanticDecisionPrompt(request) {
  return [
    "You are Haolo's question-answer ContextSourcePlanner.",
    "Your only job is to select the explicit information sources needed for the highest-quality answer.",
    "This is a semantic decision. Do not use keyword or regular-expression matching.",
    "First decide whether the current message is a new request, a follow-up to a previous answer, a follow-up to a previous attachment, or a mixed request.",
    "Conversation history, current attachments, historical attachments, and local files are independent sources. Never translate a request for 'context', 'the previous item', 'that video', timestamps, or a continuation into current-group file access unless the task actually depends on project files.",
    "User-selected threadReferences are explicit conversation evidence delivered through a separate reference-context channel. Account for their availability, but never translate them into current-group file access.",
    "For a follow-up, select the exact prior turn ids needed. If it asks for visual details or timestamps from a previous image or video, also select that historical attachment id so the media can be submitted again.",
    "If the user explicitly asks Haolo to return still-frame images from a selected video and exact timestamps are available from the request or explicit conversation history, set sourcePlan.derivedMedia to an extract_video_frames operation. This is a Host-side derived-media delivery, not a request for the text model to invent image URLs.",
    "For a requested segment's first and last frames, return both boundary timestamps in timestampsSeconds and matching human-readable labels. If the source video or exact timestamps cannot be identified, leave derivedMedia null so the answer can ask for clarification.",
    "Uploads marked delivery=native_media are delivered directly to the selected model as image or video input. Select only media needed by the current goal.",
    "If uploaded files or folders are needed, list their attachment ids in sourcePlan.localFiles.attachmentIds. A selected folder is read recursively by Haolo using its existing read-only file capabilities. Do not include unrelated uploads.",
    "Set sourcePlan.localFiles.includeCurrentGroup=true only when the answer actually depends on files in the current project/group.",
    "When currentGroup.authorized=true and the user refers to the current files, documents, repository, project, or folder without naming an upload or a historical attachment, treat that as an implicit reference to the current group and set sourcePlan.localFiles.includeCurrentGroup=true.",
    "Prefer sufficient evidence, but uncertainty alone is not permission to scan the current group. Use relevant conversation turns and attachments first; ask for clarification when the referenced source cannot be identified.",
    "Code review, project diagnosis, repository questions, document analysis, comparisons against local material, and requests that refer implicitly to the current project should read files.",
    "Pure greetings, self-contained general-knowledge questions, and requests fully answerable from the message alone may skip files.",
    "Do not execute the user task. You may use Haolo's existing read-only filesystem capabilities only to inspect authorized path metadata when that is necessary to disambiguate the intended source. Return exactly one JSON object and no markdown.",
    'Schema: {"protocolVersion":2,"relation":"new_request"|"follow_up_previous_answer"|"follow_up_previous_attachment"|"mixed","intent":string,"sourcePlan":{"conversation":{"mode":"none"|"recent"|"referenced_turns"|"all_recent","selectedTurnIds":string[],"recentTurnCount":number},"attachments":{"currentAttachmentIds":string[],"historicalAttachmentIds":string[]},"localFiles":{"includeCurrentGroup":boolean,"attachmentIds":string[],"strategy":"none"|"targeted_read"|"broad_context_then_on_demand","searchHints":string[],"requiredEvidence":string[]},"derivedMedia":null|{"operation":"extract_video_frames","attachmentId":string,"timestampsSeconds":number[],"labels":string[]}},"confidence":number,"rationale":string}',
    `Request envelope:\n${JSON.stringify(request)}`,
  ].join("\n");
}

function resilientFallbackDecision(error, uploads = [], conversationTurns = []) {
  const normalizedUploads = normalizeIntentUploads(uploads);
  const currentMediaIds = normalizedUploads
    .filter((upload) => upload.delivery === "native_media")
    .map((upload) => upload.id);
  return {
    protocolVersion: CONTEXT_DECISION_PROTOCOL_VERSION,
    needsLocalFiles: false,
    intent: "semantic_decision_unavailable",
    scope: [],
    strategy: "none",
    selectedUploadIds: [],
    searchHints: [],
    requiredEvidence: [],
    confidence: 0,
    rationale: "Semantic source planning failed; preserve recent conversation and current native attachments without scanning the group.",
    source: "resilient_fallback",
    sourcePlan: {
      protocolVersion: CONTEXT_DECISION_PROTOCOL_VERSION,
      relation: "mixed",
      conversation: {
        mode: conversationTurns.length > 1 ? "recent" : "none",
        selectedTurnIds: [],
        recentTurnCount: 8,
      },
      attachments: {
        currentAttachmentIds: currentMediaIds,
        historicalAttachmentIds: [],
      },
      localFiles: {
        includeCurrentGroup: false,
        attachmentIds: [],
        strategy: "none",
        searchHints: [],
        requiredEvidence: [],
      },
      derivedMedia: null,
    },
    error: {
      code: "CONTEXT_INTENT_DECISION_FAILED",
      message: String(error?.message || error || "Unknown semantic decision error"),
    },
  };
}

function normalizeSourcePlan(parsed, { uploads, conversationTurns }) {
  const raw = parsed.sourcePlan ?? parsed.source_plan ?? parsed.sources;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return legacySourcePlan(parsed, uploads, conversationTurns);
  }
  const turnIds = new Set(
    (Array.isArray(conversationTurns) ? conversationTurns : [])
      .map((turn) => String(turn?.turnId || "").trim())
      .filter(Boolean),
  );
  const catalog = conversationAttachmentCatalog(conversationTurns);
  const currentAttachments = catalog.filter((attachment) => attachment.isCurrent);
  const historicalAttachments = catalog.filter((attachment) => !attachment.isCurrent);
  const conversation = raw.conversation && typeof raw.conversation === "object"
    ? raw.conversation
    : {};
  const attachments = raw.attachments && typeof raw.attachments === "object"
    ? raw.attachments
    : {};
  const localFiles = raw.localFiles && typeof raw.localFiles === "object"
    ? raw.localFiles
    : raw.local_files && typeof raw.local_files === "object"
      ? raw.local_files
      : {};
  const requestedMode = String(conversation.mode || "none").trim();
  const mode = VALID_CONVERSATION_MODES.has(requestedMode)
    ? requestedMode
    : "none";
  const relationValue = String(parsed.relation || raw.relation || "new_request").trim();
  const relation = VALID_RELATIONS.has(relationValue) ? relationValue : "new_request";
  const includeCurrentGroup = localFiles.includeCurrentGroup === true
    || localFiles.include_current_group === true;
  const attachmentIds = validatedAttachmentIds(
    localFiles.attachmentIds ?? localFiles.attachment_ids,
    catalog.filter((attachment) => attachment.delivery === "host_read_through"),
  );
  const requestedStrategy = String(localFiles.strategy || "").trim();
  const strategy = includeCurrentGroup || attachmentIds.length
    ? (
        VALID_STRATEGIES.has(requestedStrategy) && requestedStrategy !== "none"
          ? requestedStrategy
          : includeCurrentGroup
            ? "broad_context_then_on_demand"
            : "targeted_read"
      )
    : "none";
  const currentAttachmentIds = validatedAttachmentIds(
    attachments.currentAttachmentIds ?? attachments.current_attachment_ids,
    currentAttachments.filter((attachment) => attachment.delivery === "native_media"),
  );
  const historicalAttachmentIds = validatedAttachmentIds(
    attachments.historicalAttachmentIds ?? attachments.historical_attachment_ids,
    historicalAttachments.filter((attachment) => attachment.delivery === "native_media"),
  );
  const selectedTurnIds = uniqueStrings(
    conversation.selectedTurnIds ?? conversation.selected_turn_ids,
  ).filter((turnId) => turnIds.has(turnId));
  const derivedMedia = normalizeDerivedMedia(
    raw.derivedMedia ?? raw.derived_media,
    catalog,
  );
  const isFollowUp = (
    relation === "follow_up_previous_answer"
    || relation === "follow_up_previous_attachment"
    || historicalAttachmentIds.length > 0
  );
  const conversationMode = (
    (mode === "none" && isFollowUp)
    || (mode === "referenced_turns" && isFollowUp && selectedTurnIds.length === 0)
  )
    ? "recent"
    : mode;
  return {
    protocolVersion: CONTEXT_DECISION_PROTOCOL_VERSION,
    relation,
    conversation: {
      mode: conversationMode,
      selectedTurnIds,
      recentTurnCount: boundedInteger(
        conversation.recentTurnCount ?? conversation.recent_turn_count,
        8,
        1,
        24,
      ),
    },
    attachments: {
      currentAttachmentIds,
      historicalAttachmentIds,
    },
    localFiles: {
      includeCurrentGroup,
      attachmentIds,
      strategy,
      searchHints: uniqueStrings(
        localFiles.searchHints ?? localFiles.search_hints ?? parsed.searchHints ?? parsed.search_hints,
      ).slice(0, 32),
      requiredEvidence: uniqueStrings(
        localFiles.requiredEvidence
          ?? localFiles.required_evidence
          ?? parsed.requiredEvidence
          ?? parsed.required_evidence,
      ).slice(0, 32),
    },
    derivedMedia,
  };
}

function legacySourcePlan(parsed, uploads, conversationTurns) {
  const needsLocalFiles = parsed.needsLocalFiles === true
    || parsed.needs_local_files === true;
  const scopes = uniqueStrings(parsed.scope ?? parsed.scopes)
    .filter((scope) => VALID_SCOPES.has(scope));
  const selectedUploadIds = needsLocalFiles
    ? normalizeSelectedUploadIds(
        parsed.selectedUploads ?? parsed.selected_uploads,
        uploads,
        scopes.includes("uploads"),
      )
    : [];
  const currentNativeIds = uploads
    .filter((upload) => upload.delivery === "native_media")
    .map((upload) => upload.id);
  const requestedStrategy = String(
    parsed.strategy || parsed.accessStrategy || parsed.access_strategy || "",
  ).trim();
  return {
    protocolVersion: CONTEXT_DECISION_PROTOCOL_VERSION,
    relation: "new_request",
    conversation: {
      mode: conversationTurns.length > 1 ? "recent" : "none",
      selectedTurnIds: [],
      recentTurnCount: 8,
    },
    attachments: {
      currentAttachmentIds: currentNativeIds,
      historicalAttachmentIds: [],
    },
    localFiles: {
      includeCurrentGroup: needsLocalFiles && scopes.includes("current_group"),
      attachmentIds: selectedUploadIds,
      strategy: needsLocalFiles
        ? (
            VALID_STRATEGIES.has(requestedStrategy) && requestedStrategy !== "none"
              ? requestedStrategy
              : scopes.length === 1 && scopes[0] === "uploads"
                ? "targeted_read"
                : "broad_context_then_on_demand"
          )
        : "none",
      searchHints: uniqueStrings(parsed.searchHints ?? parsed.search_hints).slice(0, 32),
      requiredEvidence: uniqueStrings(
        parsed.requiredEvidence ?? parsed.required_evidence,
      ).slice(0, 32),
    },
    derivedMedia: null,
  };
}

function normalizeDerivedMedia(value, attachments) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const operation = String(value.operation || value.type || "").trim();
  if (operation !== "extract_video_frames") return null;
  const requestedAttachmentId = String(
    value.attachmentId ?? value.attachment_id ?? "",
  ).trim().toLowerCase();
  const video = (Array.isArray(attachments) ? attachments : []).find((attachment) => (
    attachment.kind === "video"
    && (
      String(attachment.id || "").trim().toLowerCase() === requestedAttachmentId
      || String(attachment.name || "").trim().toLowerCase() === requestedAttachmentId
    )
  ));
  if (!video) return null;
  const rawTimestamps = value.timestampsSeconds ?? value.timestamps_seconds ?? value.timestamps;
  const timestampsSeconds = [
    ...new Set(
      (Array.isArray(rawTimestamps) ? rawTimestamps : [])
        .map((timestamp) => Number(timestamp))
        .filter((timestamp) => Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= 86_400)
        .map((timestamp) => Math.round(timestamp * 1_000) / 1_000),
    ),
  ].slice(0, 8);
  if (!timestampsSeconds.length) return null;
  const requestedLabels = uniqueStrings(value.labels).slice(0, timestampsSeconds.length);
  return {
    operation,
    attachmentId: video.id,
    timestampsSeconds,
    labels: timestampsSeconds.map((timestamp, index) => (
      requestedLabels[index] || `视频帧 ${formatTimestampSeconds(timestamp)}`
    )),
  };
}

function formatTimestampSeconds(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  const normalizedSeconds = remainder
    .toFixed(3)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  const [wholeSeconds, fraction] = normalizedSeconds.split(".");
  const secondsText = `${wholeSeconds.padStart(2, "0")}${fraction ? `.${fraction}` : ""}`;
  return `${minutes}:${secondsText}`;
}

function validatedAttachmentIds(values, attachments) {
  const requested = new Set(uniqueStrings(values).map((value) => value.toLowerCase()));
  return attachments
    .filter((attachment) => (
      requested.has(String(attachment.id || "").toLowerCase())
      || requested.has(String(attachment.name || "").toLowerCase())
    ))
    .map((attachment) => attachment.id);
}

function normalizeIntentUploads(values, explicitPaths = []) {
  const source = Array.isArray(values) ? values : [];
  const output = [];
  const seenPaths = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const filePath = String(value.path || value.localPath || value.local_path || "").trim();
    const id = String(value.id || `upload-${index + 1}`).trim() || `upload-${index + 1}`;
    const name = String(value.name || filePath || id).trim() || id;
    const mime = String(value.mime || "").trim().toLowerCase();
    const kind = String(value.kind || "").trim().toLowerCase()
      || (mime === "inode/directory" ? "folder" : "file");
    const delivery = String(value.delivery || "").trim().toLowerCase()
      || (kind === "image" || kind === "video" ? "native_media" : "host_read_through");
    if (filePath) seenPaths.add(filePath.toLowerCase());
    output.push({
      id,
      name,
      mime,
      kind,
      delivery,
      ...(filePath ? { path: filePath } : {}),
    });
  }
  for (const filePath of uniqueStrings(explicitPaths)) {
    if (seenPaths.has(filePath.toLowerCase())) continue;
    output.push({
      id: `upload-${output.length + 1}`,
      name: filePath,
      mime: "",
      kind: "file",
      delivery: "host_read_through",
      path: filePath,
    });
  }
  return output;
}

function normalizeIntentThreadReferences(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const id = firstString(
        value.threadId,
        value.thread_id,
        value.id,
      );
      if (!id) return null;
      const selectedTurnIds = uniqueStrings(
        value.selectedTurnIds ?? value.selected_turn_ids,
      );
      return {
        id,
        title: firstString(value.title, value.name) || null,
        selectionMode: firstString(
          value.selectionMode,
          value.selection_mode,
          value.mode,
        ) || "all",
        selectedTurnCount: selectedTurnIds.length,
      };
    })
    .filter(Boolean)
    .slice(0, 16);
}

function normalizeSelectedUploadIds(values, uploads, defaultToReadableUploads) {
  const requested = new Set(uniqueStrings(values).map((value) => value.toLowerCase()));
  const selected = uploads
    .filter((upload) => (
      requested.has(upload.id.toLowerCase())
      || requested.has(upload.name.toLowerCase())
      || (upload.path && requested.has(upload.path.toLowerCase()))
    ))
    .map((upload) => upload.id);
  if (selected.length || !defaultToReadableUploads) return selected;
  return uploads
    .filter((upload) => upload.delivery === "host_read_through")
    .map((upload) => upload.id);
}

function parseDecisionObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }
}

function uniqueStrings(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(
    source
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
}

function boundedNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}
