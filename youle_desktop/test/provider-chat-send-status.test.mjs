import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("clearing a pending user bubble overwrites merged sending markers", async () => {
  const source = await rendererSource;
  const clearBlock = sourceBlock(source, "function clearPendingComposerSend", "function clearInFlightPendingComposerSendForThread");
  assert.match(clearBlock, /__youleLocalSendStatus: undefined/);
  assert.match(clearBlock, /localSendStatus: undefined/);
  assert.match(clearBlock, /upsertItem\(threadId, nextItem\)/);
});

test("restored provider chat history drops stale in-flight markers", async () => {
  const source = await rendererSource;
  const mergeBlock = sourceBlock(source, "function mergeProviderChatItems", "function latestTimestamp");
  assert.match(mergeBlock, /map\(settleRestoredProviderChatItem\)/);
  assert.match(mergeBlock, /status !== "uploading" && status !== "sending"/);
  assert.match(mergeBlock, /delete settled\.__youleLocalSendStatus/);
});

test("pending user bubbles hide sending copy while delivery failures remain visible", async () => {
  const source = await rendererSource;
  const renderBlock = sourceBlock(source, "function renderLocalSendStatus", "function localSendStatusFromRecord");
  assert.match(renderBlock, /if \(status !== "failed"\) return "";/);
  assert.doesNotMatch(renderBlock, /发送中/);
  assert.match(renderBlock, /__youleLocalSendError[\s\S]*\|\| "发送失败"/);
  assert.match(renderBlock, /class="message-local-send-status failed"/);
});

test("provider history excludes the optimistic item that is dispatched separately", async () => {
  const source = await rendererSource;
  const historyBlock = sourceBlock(source, "function providerMessagesForThread", "async function sendCurrentChannelMessage");
  assert.match(historyBlock, /excludeItemId\?: string \| null/);
  assert.match(historyBlock, /if \(id === excludeItemId\) continue/);

  const sendBlock = sourceBlock(source, "async function sendCurrentProviderMessage", "function applyVideoGenerationBillingSession");
  assert.match(sendBlock, /providerMessagesForThread\(params\.threadId, params\.pendingLocalItemId\)/);
  assert.match(
    sendBlock,
    /messages:\s*\[\.\.\.historyMessages,\s*\{[\s\S]*?role:\s*"user"[\s\S]*?content:\s*agentText[\s\S]*?contextTurnId:\s*interactionId[\s\S]*?attachments:\s*params\.attachments/,
  );
  assert.match(
    sendBlock,
    /modelPool:\s*"question_answer"[\s\S]*?modelCapability:\s*"question_answer"[\s\S]*?stream:\s*true/,
  );
});

test("local group plan replies also use the question-answer streaming transport", async () => {
  const source = await rendererSource;
  const sendBlock = sourceBlock(
    source,
    "async function requestLocalGroupChatMemberReply",
    "async function sendCurrentLocalGroupChatMessage",
  );
  assert.match(
    sendBlock,
    /modelPool:\s*"question_answer"[\s\S]*?modelCapability:\s*"question_answer"[\s\S]*?stream:\s*true/,
  );
});

test("provider answers attach Host-derived media artifacts to the actual agent reply", async () => {
  const source = await rendererSource;
  const sendBlock = sourceBlock(
    source,
    "async function sendCurrentProviderMessage",
    "function applyVideoGenerationBillingSession",
  );
  assert.match(sendBlock, /result\?\.derived_media_artifacts/);
  assert.match(sendBlock, /derivedMediaArtifacts\.forEach\(mergeUploadedArtifact\)/);
  assert.match(
    sendBlock,
    /finalizeQuestionAnswerStreamAgentMessage\(\{[\s\S]*?interactionId,[\s\S]*?text:\s*providerReply,[\s\S]*?attachments:\s*derivedMediaAttachments/,
  );

  const appendBlock = sourceBlock(
    source,
    "function appendProviderAgentMessage",
    "function questionAnswerProgressItemId",
  );
  assert.match(appendBlock, /turnId: string \| null = null/);
  assert.match(appendBlock, /turn_id: firstString\(turnId\) \|\| undefined/);

  const artifactBindingBlock = sourceBlock(
    source,
    "function attachPersistedResultArtifactsToThread",
    "function attachmentFromArtifact",
  );
  assert.match(artifactBindingBlock, /const resolvedDeliveries = deliveries/);
  assert.match(artifactBindingBlock, /if \(!resolvedDeliveries\.length\) return false/);
  assert.match(artifactBindingBlock, /resultArtifactTargetAgentItemId\(order, items, delivery\.turnId\)/);
  assert.match(artifactBindingBlock, /for \(const delivery of resolvedDeliveries\)/);
  assert.match(artifactBindingBlock, /function resultArtifactTargetAgentItemId/);
  assert.match(artifactBindingBlock, /itemTurnId\(item\) === turnId/);
  assert.match(artifactBindingBlock, /questionAnswerProgressFromItem\(items\[itemId\]\)\?\.interactionId === turnId/);
});

test("question and GPT plan modes expose stop and reject every late result", async () => {
  const source = await rendererSource;
  const submit = sourceBlock(
    source,
    "function renderComposerSubmitButton",
    "function renderVoiceInputButton",
  );
  const send = sourceBlock(
    source,
    "async function sendCurrentProviderMessage",
    "function applyVideoGenerationBillingSession",
  );
  const stream = sourceBlock(
    source,
    "function applyQuestionAnswerStreamEvent",
    "function finalizeQuestionAnswerStreamAgentMessage",
  );
  const progress = sourceBlock(
    source,
    "function applyQuestionAnswerProgressEvent",
    "function settleQuestionAnswerProgress",
  );

  assert.match(submit, /const threadBusy = isComposerThreadBusy\(thread\.id\)/);
  assert.doesNotMatch(submit, /!providerFromThreadId/);
  assert.match(submit, /data-action="interrupt-turn"/);
  assert.match(
    send,
    /if \(interruptedProviderInteractionIds\.has\(interactionId\)\)[\s\S]*DOMException[\s\S]*await api\.sendProviderChat/,
  );
  assert.match(
    send,
    /const insufficientBalance = await confirmInsufficientAvailableBalanceBeforeSend[\s\S]*if \(interruptedProviderInteractionIds\.has\(interactionId\)\)[\s\S]*if \(insufficientBalance\)/,
  );
  assert.doesNotMatch(
    sourceBlock(
      source,
      "async function sendCurrentProviderMessage",
      "function applyVideoGenerationBillingSession",
    ),
    /finally \{[\s\S]*interruptedProviderInteractionIds\.delete\(interactionId\)/,
  );
  assert.match(stream, /interruptedProviderInteractionIds\.has\(interactionId\)\) return/);
  assert.match(progress, /interruptedProviderInteractionIds\.has\(interactionId\)\) return/);
});

test("contact message opens a hidden question-mode draft while preserving the Haolo new task", async () => {
  const source = await rendererSource;
  const openBlock = sourceBlock(source, "function openProviderContactChat", "function openVideoExpertThread");
  assert.match(openBlock, /openProviderQuestionDraft\(mapped\.provider, contact\.id\)/);
  assert.match(openBlock, /newProviderThreadId\(provider\)/);
  assert.match(openBlock, /providerDraftThreadIds\.add\(threadId\)/);
  assert.match(openBlock, /ensureTopLevelBlankThreadForList\(\)/);
  assert.match(openBlock, /defaultProviderChatModelOption\(provider\)/);
  assert.doesNotMatch(openBlock, /state\.blankThreadId = threadId/);
  assert.doesNotMatch(openBlock, /state\.providerTouchedAt/);
  assert.doesNotMatch(openBlock, /saveProviderChatThreads/);

  const visibleListBlock = sourceBlock(
    source,
    "function visibleConversationThreadsForChatList",
    "function renderThreadGroupSetDialog",
  );
  assert.match(visibleListBlock, /!providerDraftThreadIds\.has\(thread\.id\)/);

  const activeRowBlock = sourceBlock(source, "function isActiveThreadRow", "function renderContactRequestList");
  assert.match(activeRowBlock, /threadId === state\.blankThreadId/);
  assert.match(activeRowBlock, /providerDraftThreadIds\.has\(state\.currentThreadId\)/);
  assert.match(activeRowBlock, /isBlankNewThread\(state\.currentThreadId\)/);

  const modeBlock = sourceBlock(source, "function newThreadModeForThread", "function activeComposerDraftSnapshot");
  assert.match(modeBlock, /providerDraftThreadIds\.has\(threadId\)/);
  assert.match(modeBlock, /isVideoExpertProviderThreadId\(threadId\) \? "video-generation" : "question-answer"/);

  const pickerBlock = sourceBlock(source, "function renderComposerModePicker", "function activeComposerDraftSnapshot");
  assert.match(pickerBlock, /class="composer-mode-trigger serial-only"/);
  assert.match(pickerBlock, /<span>执行模式<\/span>/);
  assert.doesNotMatch(pickerBlock, /question-answer|data-new-thread-mode|data-composer-cluster-mode/);
});

test("video expert uses a hidden question-mode draft and its dedicated composer", async () => {
  const source = await rendererSource;
  const openVideoBlock = sourceBlock(source, "function openVideoExpertThread", "function upsertContactRequest");
  assert.match(openVideoBlock, /findContactProfile\(VIDEO_EXPERT_CONTACT_ID\)/);
  assert.match(openVideoBlock, /openProviderContactChat\(contact\)/);
  assert.doesNotMatch(openVideoBlock, /providerThreadId\(VIDEO_EXPERT_PROVIDER\)/);
  assert.doesNotMatch(openVideoBlock, /saveProviderChatThreads/);

  const composerBlock = sourceBlock(source, "function renderComposer(thread: ConversationSummary)", "function renderVideoExpertComposer");
  assert.match(composerBlock, /isVideoExpertThread\(thread\)/);
  assert.match(composerBlock, /return renderVideoExpertComposer\(thread\)/);

  const videoComposerBlock = sourceBlock(source, "function renderVideoExpertComposer", "function renderVideoExpertAspectRatioPicker");
  assert.match(
    videoComposerBlock,
    /class="composer video-expert-composer media-creation-composer"/,
  );
  assert.match(videoComposerBlock, /renderPendingAttachmentsRail\(thread\.id,\s*renderMediaInputGuideSlots\(thread\.id\)\)/);
  assert.doesNotMatch(videoComposerBlock, /data-video-expert-frame|video-expert-first-frame/);
  assert.match(videoComposerBlock, /renderVideoExpertAspectRatioPicker\(\)/);
  assert.match(videoComposerBlock, /renderVideoExpertDurationPicker\(\)/);

  const sendBlock = sourceBlock(
    source,
    "async function sendCurrentVideoExpertMessage",
    "function appendVideoExpertAgentMessage",
  );
  assert.match(sendBlock, /upsertProviderThread\(VIDEO_EXPERT_PROVIDER, params\.threadId\)/);
});

test("clicking the fixed Haolo new task discards a provider draft and returns to execution mode", async () => {
  const source = await rendererSource;
  const startBlock = sourceBlock(source, "async function startNewThread", "async function createBlankThreadForList");
  assert.match(
    startBlock,
    /providerDraftThreadIds\.has\(currentThreadId\)[\s\S]*hideUnavailableThread\(currentThreadId\)/,
  );
  assert.match(startBlock, /activateBlankThread\(blankThread\.id\)/);

  const selectBlock = sourceBlock(source, "async function selectThread", "async function resumeThreadWithModelLock");
  assert.match(selectBlock, /if \(isBlankNewThread\(threadId\)\)[\s\S]*activateBlankThread\(threadId\)/);

  const unlinkBlock = sourceBlock(
    source,
    "function unlinkProviderDraftFromBlankThread",
    "function unlinkBlankThreadFromProviderDraft",
  );
  assert.match(
    unlinkBlock,
    /newThreadModeByThreadId\.get\(blankThreadId\) === "question-answer"[\s\S]*newThreadModeByThreadId\.delete\(blankThreadId\)/,
  );

  const activateBlock = sourceBlock(source, "function activateBlankThread", "function isBlankNewThread");
  assert.match(activateBlock, /providerDraftThreadIds\.has\(previousThreadId\)/);
  assert.match(activateBlock, /hideUnavailableThread\(previousThreadId\)/);
  assert.match(activateBlock, /state\.blankThreadId = threadId/);

  const heroBlock = sourceBlock(source, "function renderBlankThreadHero", "function renderMessage");
  const pickerBlock = sourceBlock(source, "function renderComposerModePicker", "function activeComposerDraftSnapshot");
  assert.doesNotMatch(heroBlock, /data-new-thread-mode/);
  assert.match(pickerBlock, /class="composer-mode-trigger serial-only"/);
  assert.match(pickerBlock, /role="status"/);
  assert.match(pickerBlock, /<span>执行模式<\/span>/);
  assert.doesNotMatch(pickerBlock, /data-new-thread-mode|data-composer-cluster-mode|计划模式|集群模式/);
});

test("the execution model picker preserves the underlying image and video workflows", async () => {
  const source = await rendererSource;
  const switchBlock = sourceBlock(source, "async function switchNewThreadMode", "function renderBlankThreadHero");
  assert.match(switchBlock, /providerDraftThreadIds\.has\(sourceThreadId\)[\s\S]*providerFromThreadId\(sourceThreadId\)/);
  assert.match(switchBlock, /const nextUsesProviderDraft = mode === "question-answer"/);
  assert.match(switchBlock, /!currentUsesProviderDraft && !nextUsesProviderDraft/);
  assert.match(switchBlock, /newThreadModeByThreadId\.set\(sourceThreadId, mode\)/);
  assert.match(switchBlock, /mode === "video-generation"[\s\S]*videoExpertInputAttachments/);
  assert.match(switchBlock, /const sourceGroupId = groupIdForThreadContext\(sourceThreadId\)/);
  assert.match(switchBlock, /state\.activeNewThreadGroupId = sourceGroupId/);
  assert.match(switchBlock, /state\.newThreadGroupPickerOpen = false/);
  assert.match(switchBlock, /defaultProviderModelSelection\(state\.providerModelCatalog\)/);
  assert.match(
    switchBlock,
    /questionAnswerDefault\?\.provider \|\| "codex"/,
  );
  assert.match(switchBlock, /questionAnswerDefault\?\.option \|\| null/);
  assert.match(switchBlock, /const targetThreadId = await startNewThread\(\)/);
  assert.match(switchBlock, /newThreadModeByThreadId\.set\(targetThreadId, mode\)/);
  assert.match(switchBlock, /setComposerDraft\(targetThreadId, providerDraft\)/);

  const openBlock = sourceBlock(source, "function openProviderQuestionDraft", "function openVideoExpertThread");
  assert.match(openBlock, /initialGroupId: string \| null = null/);
  assert.match(openBlock, /initialModel: ChatModelOption \| null = null/);
  assert.match(openBlock, /const groupId = selectableThreadGroupId\(initialGroupId\)/);
  assert.match(openBlock, /threadGroupByThreadId\[threadId\] = groupId/);
  assert.match(openBlock, /rememberThreadWorkspace\(threadId, workspaceForGroupId\(groupId\)\)/);
  assert.match(openBlock, /initialModel \|\| defaultProviderChatModelOption\(provider\)/);

  const bindingBlock = sourceBlock(source, '.querySelectorAll<HTMLButtonElement>("[data-new-thread-mode]")', 'data-action="toggle-composer-model-menu"');
  assert.doesNotMatch(bindingBlock, /requestedMode === "media-creation"/);
  assert.doesNotMatch(bindingBlock, /\[data-media-creation-mode\]/);
  assert.match(bindingBlock, /switchNewThreadMode\(mode\)/);
  assert.match(bindingBlock, /\[data-composer-cluster-mode\]/);
  assert.match(bindingBlock, /switchComposerClusterMode/);

  const modelBindingBlock = sourceBlock(
    source,
    '.querySelectorAll<HTMLButtonElement>("[data-composer-model]")',
    "bindComposerSkillMentionSearchEvents",
  );
  assert.match(modelBindingBlock, /button\.dataset\.composerModelKind/);
  assert.match(modelBindingBlock, /selectComposerModelForThread\(threadId, selected, kind\)/);
});

test("provider thinking placeholder follows the selected model instead of the draft thread id", async () => {
  const source = await rendererSource;
  const providerBlock = sourceBlock(source, "function providerFromThreadId", "function providerFromValue");
  assert.match(providerBlock, /function effectiveProviderForThread/);
  assert.match(providerBlock, /threadModelSelection\(threadId\)\?\.model \|\| threadModelSettings\(threadId\)\?\.model/);
  assert.match(providerBlock, /questionAnswerProviderForModel\(selectedModel\) \|\| originalProvider/);

  const thinkingBlock = sourceBlock(source, "function withThinkingMessage", "function hasActiveContextCompaction");
  assert.match(thinkingBlock, /provider: effectiveProviderForThread\(threadId\) \|\| undefined/);

  const signatureBlock = sourceBlock(source, "function messageRenderSignature", "function messageSignatureText");
  assert.match(signatureBlock, /\(message as ProviderChatMessage\)\.provider \|\| ""/);
});

test("each provider question is persisted by conversation id and grouped on its first send", async () => {
  const source = await rendererSource;
  const recordsBlock = sourceBlock(source, "function providerChatRecordsFromState", "function saveProviderChatThreads");
  assert.match(recordsBlock, /for \(const thread of state\.threads\)/);
  assert.match(recordsBlock, /providerDraftThreadIds\.has\(threadId\)/);
  assert.match(recordsBlock, /records\[threadId\] = \{ items, touchedAt \}/);

  const commitBlock = sourceBlock(source, "function canCommitNewThreadGroupForSend", "function selectComposerThreadGroup");
  assert.match(commitBlock, /providerDraftThreadIds\.has\(threadId\)/);
  assert.match(commitBlock, /return commitActiveNewThreadGroupForSend\(threadId, selectedGroupId\)/);
  assert.match(commitBlock, /threadGroupByThreadId\[threadId\] = group\.id/);
  assert.match(commitBlock, /selectableThreadGroupId\(selectedGroupId\)/);
  assert.doesNotMatch(commitBlock, /pendingNewThreadGroup/);
  assert.doesNotMatch(commitBlock, /selectableThreadGroupId\(state\.activeNewThreadGroupId\)/);

  const composerSendBlock = sourceBlock(source, "async function sendCurrentMessage", "async function sendCurrentProviderMessage");
  const groupCaptureIndex = composerSendBlock.indexOf("const composerGroupIdForSend =");
  const pendingBubbleIndex = composerSendBlock.indexOf("beginPendingComposerSend");
  assert.ok(groupCaptureIndex >= 0 && groupCaptureIndex < pendingBubbleIndex);
  assert.match(
    composerSendBlock,
    /const composerGroupIdForSend = groupIdForThreadContext\(threadId\);/,
  );
  assert.match(composerSendBlock, /commitSelectedNewThreadGroupForSend\(threadId, composerGroupIdForSend\)/);

  const sendBlock = sourceBlock(source, "async function sendCurrentProviderMessage", "function applyVideoGenerationBillingSession");
  assert.match(sendBlock, /upsertProviderThread\(selectedProvider, params\.threadId\)/);
});

test("legacy provider history keys migrate while new per-question ids remain distinct", async () => {
  const source = await rendererSource;
  const keyBlock = sourceBlock(source, "function providerThreadIdFromRecordKey", "function messageProvider");
  assert.match(keyBlock, /providerFromThreadId\(recordKey\)/);
  assert.match(keyBlock, /providerFromValue\(recordKey\)/);
  assert.match(keyBlock, /providerThreadId\(legacyProvider\)/);

  const mergeBlock = sourceBlock(source, "function mergeProviderChatThreadRecords", "function mergeProviderChatItems");
  assert.match(mergeBlock, /providerThreadIdFromRecordKey\(recordKey\)/);
  assert.match(mergeBlock, /records\[threadId\]/);
});

test("restored provider rows prefer the last replying provider over the thread id prefix", async () => {
  const source = await rendererSource;
  const summaryBlock = sourceBlock(
    source,
    "function providerThreadSummary",
    "function upsertProviderThread",
  );
  assert.match(summaryBlock, /lastAssistantProviderFromItems\(threadId, threadItems\)/);
  assert.match(
    summaryBlock,
    /lastAssistantProvider \|\| effectiveProviderForThread\(threadId\) \|\| provider/,
  );
  assert.match(
    summaryBlock,
    /avatar_image: draft \? conversationAvatarUrl\(\) : meta\.avatarUrl \|\| existing\?\.avatar_image/,
  );
  assert.ok(
    summaryBlock.indexOf("lastAssistantProviderFromItems(threadId, threadItems)") <
      summaryBlock.indexOf("effectiveProviderForThread(threadId)"),
  );
});

test("conversation rows restore the last replying agent avatar before the thread is opened", async () => {
  const source = await rendererSource;
  const providerBlock = sourceBlock(
    source,
    "function providerFromAssistantIdentity",
    "function providerThreadIdFromRecordKey",
  );
  assert.match(providerBlock, /record\.provider/);
  assert.match(providerBlock, /record\.sender_label/);
  assert.match(providerBlock, /questionAnswerProviderForModel/);
  assert.match(providerBlock, /lastAssistantProviderFromThreadData/);
  assert.match(providerBlock, /threadLastAssistantProviderByThreadId\.set/);
  assert.match(providerBlock, /return item\.type === "channelMessage" \? null : "codex"/);

  const hydrationBlock = sourceBlock(
    source,
    "function shouldHydrateAssistantPreview",
    "function shouldHydrateAttachmentOnlyTitle",
  );
  assert.match(hydrationBlock, /shouldHydrateThreadLastAssistantProvider\(thread\)/);

  const applyHydrationBlock = sourceBlock(
    source,
    "function applyAssistantPreviewHydration",
    "function threadFromLoaded",
  );
  assert.match(applyHydrationBlock, /lastAssistantProviderFromThreadData\(threadId, thread\)/);
  assert.match(applyHydrationBlock, /avatar_image: assistantAvatarUrl \|\| summary\.avatar_image/);
  assert.match(applyHydrationBlock, /patchConversationRow\(threadId\)/);

  const avatarBlock = sourceBlock(source, "function renderThreadAvatar", "function renderThreadRowAvatar");
  assert.match(avatarBlock, /threadLastAssistantAvatarUrl\(thread\?\.id\)/);
  assert.match(avatarBlock, /PROVIDER_CHAT_META\[summarizedProvider\]\?\.avatarUrl/);
  assert.ok(
    avatarBlock.indexOf("threadLastAssistantAvatarUrl(thread?.id)") <
      avatarBlock.indexOf("firstString(thread?.avatar_image)"),
  );

  const preferenceLoadBlock = sourceBlock(source, "function loadThreadPreferences", "function emptyThreadPreferences");
  const preferenceSaveBlock = sourceBlock(source, "function saveThreadPreferences", "function saveContactPreferences");
  assert.match(preferenceLoadBlock, /threadLastAssistantProviders:\s*normalizePersistedThreadLastAssistantProviders/);
  assert.match(preferenceSaveBlock, /threadLastAssistantProviders:\s*Object\.fromEntries/);
});
