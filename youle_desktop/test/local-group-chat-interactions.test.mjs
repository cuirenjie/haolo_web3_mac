import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("multi-@ group rounds pass every target through Haolo capability gating before concurrent replies", async () => {
  const source = await rendererSource;
  const send = sourceBlock(
    source,
    "async function sendCurrentLocalGroupChatMessage",
    "async function sendCurrentMessage",
  );
  const memberRequest = sourceBlock(
    source,
    "async function requestLocalGroupChatMemberReply",
    "async function sendCurrentLocalGroupChatMessage",
  );

  assert.match(send, /localGroupMessageRoute\(/);
  assert.match(send, /const targetEntries = route\.targets\.map/);
  assert.match(
    send,
    /const run = beginLocalGroupChatRun\(record\.id,\s*route\.targets\)/,
  );
  assert.match(send, /await api\.prepareGroupChatContext\(/);
  assert.match(send, /targets:\s*coordinationTargets/);
  assert.match(
    send,
    /currentGroupContext:\s*questionAnswerCurrentGroupContext\([\s\S]*?groupIdForThreadContext\(record\.id\),[\s\S]*?userMessageId/,
  );
  assert.match(send, /contextPreparation\?\.assignments/);
  assert.match(send, /coordinationText\s*=\s*composerAgentText\(\s*text,/);
  assert.match(send, /participants:\s*routingMembers\.map/);
  assert.match(send, /assignment\?\.taskPrompt/);
  assert.match(send, /__youleLocalGroupTaskAssignments/);
  assert.doesNotMatch(send, /stripLocalGroupMemberMentions/);
  assert.doesNotMatch(send, /localGroupSharedHistoryRequested/);
  assert.match(send, /await Promise\.all\(/);
  assert.match(
    send,
    /targetEntries\.map\(async \(\{ member, target \}\) =>/,
  );
  assert.match(send, /finally \{[\s\S]*localGroupChatBusyThreadIds\.delete\(record\.id\)/);
  assert.match(memberRequest, /await api\.sendProviderChat!?\(/);
  assert.match(memberRequest, /stream:\s*true/);
  assert.match(memberRequest, /groupChatContextPreparationId:/);
  assert.match(memberRequest, /groupChatMemberId:\s*member\.selectionId/);
  assert.match(memberRequest, /assignment\.deliver/);
  assert.match(memberRequest, /assignment\.capabilityMessage/);
  assert.match(memberRequest, /appendLocalGroupChatAgentMessage\(/);
  assert.match(memberRequest, /LOCAL_GROUP_CHAT_MUTED_REPLY/);
  assert.match(source, /if \(localGroupChatBusyThreadIds\.has\(threadId\)\) return false/);
  assert.doesNotMatch(source, /群聊消息与多智能体协作将在后续版本接入/);
});

test("Haolo group members use persistent full Agent threads with tool access", async () => {
  const source = await rendererSource;
  const haoloRuntime = sourceBlock(
    source,
    "function localGroupChatHaoloThreadKey",
    "async function requestLocalGroupChatMemberReply",
  );
  const memberRequest = sourceBlock(
    source,
    "async function requestLocalGroupChatMemberReply",
    "async function sendCurrentLocalGroupChatMessage",
  );

  assert.match(haoloRuntime, /desktopAgentThreadStore\[key\]\?\.threadId/);
  assert.match(haoloRuntime, /await api\.startThread\(/);
  assert.match(haoloRuntime, /codexToolExecutionModelRequestOptions\(null\)/);
  assert.match(haoloRuntime, /conversationMode:\s*"execution"/);
  assert.match(haoloRuntime, /activate:\s*false/);
  assert.match(
    haoloRuntime,
    /captureAgentThreadReply\(internalThreadId,\s*\{\s*timeoutMs:\s*null/,
  );
  assert.match(haoloRuntime, /await api\.sendMessage\(/);
  assert.match(
    haoloRuntime,
    /codexToolExecutionModelRequestOptions\([\s\S]*params\.coordination\.assignment\.model/,
  );
  assert.doesNotMatch(
    haoloRuntime,
    /\.\.\.selectedChatModelRequestOptions\(internalThreadId\)/,
  );
  assert.match(haoloRuntime, /sourceType:\s*"local-group-chat"/);
  assert.match(haoloRuntime, /groupChatContextPreparationId:/);
  assert.match(haoloRuntime, /groupChatThreadId:\s*params\.record\.id/);
  assert.match(haoloRuntime, /groupChatMemberId:/);
  assert.match(haoloRuntime, /approvalPolicy:\s*DESKTOP_APPROVAL_POLICY/);
  assert.match(haoloRuntime, /sandboxPolicy:\s*DESKTOP_SANDBOX_POLICY/);
  assert.match(haoloRuntime, /rememberDesktopAgentThread\(key, internalThreadId\)/);
  assert.match(haoloRuntime, /hideDesktopAgentInternalThread\(internalThreadId\)/);
  assert.match(haoloRuntime, /replacementThread\?\.id/);
  assert.match(memberRequest, /const haoloMember = isHaoloContact\(/);
  assert.match(
    memberRequest,
    /haoloMember[\s\S]*requestLocalGroupChatHaoloAgentReply\(/,
  );
  assert.match(memberRequest, /modelPool:\s*"question_answer"/);
  assert.match(memberRequest, /groupChatThreadId:\s*record\.id/);
});

test("routing an existing group's Haolo member cannot inherit DeepSeek", async () => {
  const source = await rendererSource;
  const target = sourceBlock(
    source,
    "function localGroupChatContextTarget",
    "function localGroupChatRoutingMembers",
  );
  const toolOptions = sourceBlock(
    source,
    "function codexToolExecutionModelRequestOptions",
    "function hydrateSelectedChatModel",
  );

  assert.match(target, /provider === "codex"[\s\S]*codexToolExecutionModelOption/);
  assert.doesNotMatch(target, /selectedChatModelValue\(null\)/);
  assert.match(toolOptions, /supportsCodexToolExecutionModel\(option\)/);
  assert.match(toolOptions, /modelProvider:\s*executionModelProviderId\(selected\.providerId\)/);
});

test("active group rounds expose one stop-all action and cancel every active member", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const run = sourceBlock(
    source,
    "function beginLocalGroupChatRun",
    "async function sendCurrentLocalGroupChatMessage",
  );
  const interrupt = sourceBlock(
    source,
    "async function interruptCurrentTurn",
    "function finishInterruptedTurnLocally",
  );
  const submit = sourceBlock(
    source,
    "function renderComposerSubmitButton",
    "function renderVoiceInputButton",
  );

  assert.match(source, /const localGroupChatRunsByThreadId = new Map<string, LocalGroupChatRun>/);
  assert.match(source, /function isComposerThreadBusy\([\s\S]*localGroupChatBusyThreadIds\.has\(threadId\)/);
  assert.match(run, /pendingMembers:\s*new Map\(/);
  assert.match(run, /providerInteractionIds:\s*new Set<string>\(\)/);
  assert.match(run, /haoloThreadIds:\s*new Set<string>\(\)/);
  assert.match(run, /run\.stopRequested = true/);
  assert.match(run, /api\.interruptProviderChat\(\{ threadId, interactionId \}\)/);
  assert.match(run, /api\.interruptTurn\(\{[\s\S]*threadId:\s*internalThreadId[\s\S]*source:\s*"group-chat-stop"/);
  assert.match(run, /Promise\.allSettled\(interruptions\)/);
  assert.match(run, /迟到的模型结果不会再写入会话/);
  assert.match(
    sourceBlock(
      source,
      "async function requestLocalGroupChatMemberReply",
      "async function sendCurrentLocalGroupChatMessage",
    ),
    /await api\.sendProviderChat!?[\s\S]*if \(params\.run\.stopRequested\) return;[\s\S]*appendLocalGroupChatAgentMessage/,
  );
  assert.match(interrupt, /localGroupChatBusyThreadIds\.has\(threadId\)[\s\S]*stopLocalGroupChatRun\(threadId\)/);
  assert.match(submit, /isComposerThreadBusy\(thread\.id\)/);
  assert.match(submit, /停止全部回应/);
  assert.match(styles, /\.stop-button:active:not\(:disabled\)/);
  assert.match(styles, /\.stop-button:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.stop-button:active:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.stop-button:focus-visible/);
});

test("every routed group member shows its own thinking row until answer output starts", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const send = sourceBlock(
    source,
    "async function sendCurrentLocalGroupChatMessage",
    "async function sendCurrentMessage",
  );
  const memberReply = sourceBlock(
    source,
    "async function requestLocalGroupChatMemberReply",
    "function beginLocalGroupChatRun",
  );
  const thinking = sourceBlock(
    source,
    "function withThinkingMessage",
    "function hasActiveVideoGenerationState",
  );
  const appendReply = sourceBlock(
    source,
    "function appendLocalGroupChatAgentMessage",
    "function appendLocalGroupChatMemberEvent",
  );

  assert.match(send, /localGroupMessageRoute\([\s\S]*beginLocalGroupChatRun\(record\.id,\s*route\.targets\)/);
  assert.match(
    memberReply,
    /associateLocalGroupChatMemberInteraction\([\s\S]*member\.selectionId,[\s\S]*interactionId/,
  );
  assert.match(
    thinking,
    /localGroupChatRecord\(threadId\)[\s\S]*withLocalGroupChatThinkingMessages\(threadId,\s*visible\)/,
  );
  assert.match(thinking, /Array\.from\(run\.pendingMembers\.values\(\)\)/);
  assert.match(
    thinking,
    /questionAnswerStreamItemId\(pending\.interactionId\)[\s\S]*!itemText\(streamItem\)\.trim\(\)/,
  );
  assert.match(thinking, /sender_label:\s*presentation\.name/);
  assert.match(thinking, /avatar_url:\s*presentation\.avatarUrl/);
  assert.match(thinking, /localGroupThinkingMemberId:\s*member\.selectionId/);
  assert.match(thinking, /text:\s*"正在思考"/);
  assert.match(
    appendReply,
    /settleLocalGroupChatMemberThinking\([\s\S]*record\.id,[\s\S]*member\.selectionId,[\s\S]*run/,
  );
  assert.match(
    appendReply,
    /if \(!run \|\| run !== expectedRun\) return false/,
  );
  assert.match(styles, /\.local-group-thinking-row \.message-meta\s*\{[^}]*display:\s*block/);
  assert.match(
    styles,
    /\.local-group-thinking-row \.thinking-text\s*\{[^}]*background:\s*var\(--bubble-agent\)/,
  );
  assert.match(styles, /--bubble-agent:\s*#f2f4f8/);
  assert.match(styles, /--bubble-agent:\s*#20242b/);
});

test("group context planning carries references once and keeps the coordinator invisible", async () => {
  const source = await rendererSource;
  const send = sourceBlock(
    source,
    "async function sendCurrentLocalGroupChatMessage",
    "async function sendCurrentMessage",
  );

  assert.match(send, /cloneComposerThreadReferences\(\s*state\.composerThreadReferences/);
  assert.match(send, /__youleThreadReferences:/);
  assert.match(send, /composerAgentText\([\s\S]*composerThreadReferences/);
  assert.match(send, /threadReferences:\s*referenceParams\.references/);
  assert.match(send, /messages:\s*\[[\s\S]*\.\.\.historyMessages[\s\S]*role:\s*"user"/);
  assert.match(send, /contextPreparation\?\.assignments/);
  assert.match(send, /groupChatScopedUserMessage:\s*true/);
  assert.match(send, /本轮上下文协调失败/);
});

test("Haolo group capture returns the final answer instead of commentary", async () => {
  const source = await rendererSource;
  const capture = sourceBlock(
    source,
    "function captureAgentThreadReply",
    "async function sendLocalAgentChannelReply",
  );
  const notifications = sourceBlock(
    source,
    "function handleChannelAgentNotification",
    "async function searchChannelUsers",
  );

  assert.match(capture, /item\.phase === "final_answer"/);
  assert.match(capture, /item\.phase !== "commentary"/);
  assert.match(capture, /const finalAnswer = items[\s\S]*\.at\(-1\)/);
  assert.match(capture, /const conclusive = items[\s\S]*\.at\(-1\)/);
  assert.match(capture, /resolve\(capturedReply\(\)\)/);
  assert.match(capture, /options\.timeoutMs === undefined \? 120_000 : options\.timeoutMs/);
  assert.match(capture, /if \(timeout !== null\) window\.clearTimeout\(timeout\)/);
  assert.match(notifications, /capture\.startItem\?\.\(message\.params\.item\)/);
  assert.match(
    notifications,
    /capture\.append\?\.\([\s\S]*message\.params\?\.itemId/,
  );
  assert.match(
    notifications,
    /capture\.completeItem\?\.\(message\.params\.item\)/,
  );
  assert.doesNotMatch(notifications, /!capture\.hasOutput/);
});

test("group @ cascade exposes favorites, session references, and members", async () => {
  const source = await rendererSource;
  const candidates = sourceBlock(
    source,
    "function composerSkillMentionCandidates",
    "function composerPromptFavoriteMentionCandidates",
  );
  const composer = sourceBlock(
    source,
    "function renderComposer(thread",
    "function renderComposerSubmitButton",
  );
  const rootItems = sourceBlock(
    source,
    "function composerMentionRootItems",
    "function dismissComposerSkillMentionPopover",
  );
  const popover = sourceBlock(
    source,
    "function renderComposerSkillMentionPopover",
    "function renderVideoExpertModelPicker",
  );

  assert.match(candidates, /localGroupChatUniqueMembers\(localGroupChat\)/);
  assert.match(candidates, /member\.muted \? " · 已禁言"/);
  assert.match(rootItems, /localGroupChatRecord\(threadId\)/);
  assert.match(rootItems, /\{ id: "favorites", label: "已收藏提示词" \}/);
  assert.match(rootItems, /\{ id: "threads", label: "引用会话" \}/);
  assert.match(rootItems, /\{ id: "group-members", label: "群成员" \}/);
  assert.match(popover, /renderComposerMentionRootMenu\(\)/);
  assert.match(popover, /renderComposerPromptFavoritesSubmenu\(\)/);
  assert.match(popover, /renderComposerThreadReferenceList/);
  assert.match(popover, /local-group-mention-submenu/);
  assert.match(source, /submenu === "group-members"/);
  assert.match(source, /localGroupChatMentionTokens\(/);
  assert.match(source, /localGroupChatQuotedMemberId\(record, quote\)/);
  assert.match(composer, /Boolean\(localGroupChatRecord\(thread\.id\)\)/);
  assert.match(composer, /const composerTrailingPicker = multiAgentMode/);
  assert.doesNotMatch(composer, /multiAgentMode \|\| isTradingExpertThreadId\(thread\.id\)/);
  assert.match(source, /发送消息，输入 @ 可指定一个或多个群成员回复/);
});

test("member menu exposes all approved actions and persistent state changes", async () => {
  const source = await rendererSource;
  const menu = sourceBlock(
    source,
    "function renderLocalGroupChatMemberMenu",
    "function renderLocalGroupChatMemberDialog",
  );

  for (const label of [
    "发送消息",
    "@ TA",
    "查看资料",
    "修改群昵称",
    "设置群内禁言",
    "取消群内禁言",
    "移出本群",
  ]) {
    assert.match(menu, new RegExp(label));
  }
  assert.match(source, /button\.addEventListener\("click", openMenu\)/);
  assert.match(source, /button\.addEventListener\("contextmenu", openMenu\)/);
  assert.match(source, /defaultProviderChatModelOption\(provider\)/);
  assert.match(source, /candidate\.selectionId === selectionId[\s\S]*muted/);
  assert.match(source, /member\.selectionId !== dialog\.selectionId/);
});

test("local group message avatars open the same member menu with either mouse button", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const avatar = sourceBlock(
    source,
    "function localGroupChatMessageMember",
    "function renderRoleAvatar",
  );
  const itemMessage = sourceBlock(
    source,
    "function itemToMessage",
    "function withLocalSendStatus",
  );

  assert.match(itemMessage, /__youleLocalGroupMemberId/);
  assert.match(itemMessage, /localGroupMemberId:/);
  assert.match(avatar, /localGroupChatMember\(record, memberId\)/);
  assert.match(avatar, /class="message-avatar[^"]*local-group-chat-message-member-avatar/);
  assert.match(avatar, /data-local-group-chat-member=/);
  assert.match(avatar, /aria-haspopup="menu"/);
  assert.match(avatar, /aria-expanded=/);
  assert.match(source, /button\.addEventListener\("click", openMenu\)/);
  assert.match(source, /button\.addEventListener\("contextmenu", openMenu\)/);
  assert.match(styles, /\.local-group-chat-message-member-avatar:hover\s*\{/);
  assert.match(styles, /\.local-group-chat-message-member-avatar:active\s*\{/);
  assert.match(styles, /\.local-group-chat-message-member-avatar:focus-visible,[\s\S]*\.local-group-chat-message-member-avatar\.is-menu-open\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-message-member-avatar:hover\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-message-member-avatar:focus-visible,[\s\S]*html\[data-theme="dark"\] \.local-group-chat-message-member-avatar\.is-menu-open\s*\{/);
});

test("member moderation uses avatar notices without a mute text badge", async () => {
  const source = await rendererSource;
  const memberCell = sourceBlock(
    source,
    "function renderLocalGroupChatMemberCell",
    "function renderLocalGroupChatMembersPanel",
  );
  const eventRenderer = sourceBlock(
    source,
    "function renderLocalGroupChatMemberEvent",
    "function renderLocalGroupChatPanel",
  );
  const muteMember = sourceBlock(
    source,
    "function toggleLocalGroupChatMemberMuted",
    "function openLocalGroupChatMemberDialog",
  );
  const removeMember = sourceBlock(
    source,
    "function confirmRemoveLocalGroupChatMember",
    "function handleLocalGroupChatMemberAction",
  );
  const providerHistory = sourceBlock(
    source,
    "function providerMessagesForThread",
    "async function sendCurrentChannelMessage",
  );

  assert.match(memberCell, /member\.muted \? "muted" : ""/);
  assert.doesNotMatch(memberCell, /local-group-chat-muted-badge/);
  assert.match(eventRenderer, /renderLocalGroupChatAvatarContent/);
  for (const copy of [
    "被你添加到群聊",
    "被你禁言",
    "被你取消禁言",
    "被你移出群聊",
  ]) {
    assert.match(source, new RegExp(copy));
  }
  assert.match(
    muteMember,
    /appendLocalGroupChatMemberEvent\([\s\S]*muted \? "muted" : "unmuted"/,
  );
  assert.match(
    removeMember,
    /const member = localGroupChatMember\([\s\S]*record\.members = record\.members\.filter\([\s\S]*appendLocalGroupChatMemberEvent\(record, member, "removed"\)/,
  );
  assert.match(providerHistory, /localGroupChatMemberEventFromItem\(item\)/);
  assert.match(providerHistory, /groupChatMemberId\?: string/);
  assert.match(providerHistory, /localGroupProviderHistoryMessage\(threadId,\s*item,\s*trimmed\)/);
  assert.match(providerHistory, /groupChatMemberName:/);
});

test("group member controls cover light and dark interaction states", async () => {
  const styles = await stylesSource;
  for (const selector of [
    ".local-group-chat-member-cell:hover",
    ".local-group-chat-member-cell:active",
    ".local-group-chat-member-cell:focus-visible",
    ".local-group-chat-member-cell:disabled",
    ".local-group-chat-member-menu button:hover",
    ".local-group-chat-member-menu button:active",
    ".local-group-chat-member-menu button:focus-visible",
    ".local-group-chat-member-menu button:disabled",
    ".local-group-chat-member-dialog input:focus",
    ".local-group-chat-member-dialog input:disabled",
  ]) {
    assert.match(styles, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-member-menu/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-member-menu button:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-member-menu button:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-member-dialog input:focus/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-member-dialog footer button:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-mention-title/);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-mention-submenu button:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-mention-submenu button:focus-visible/);
  assert.doesNotMatch(styles, /\.local-group-mention-popover\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(styles, /\.local-group-chat-member-event-copy[\s\S]*color: var\(--text-muted\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-member-event-copy/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-member-event-name/);
  assert.doesNotMatch(styles, /\.local-group-chat-muted-badge/);
});

test("local groups bypass handled-time decoration and result collapsing after workflow decoration", async () => {
  const source = await rendererSource;
  const messages = sourceBlock(
    source,
    "function messagesForThread",
    "function isFinalAgentTurnResultMessage",
  );

  assert.match(
    messages,
    /const messagesWithWorkflowRelay = withWorkflowRelayMessages\(threadId, orderedMessages\)[\s\S]*const collapsedMessages = localGroupChatRecord\(threadId\)[\s\S]*\? messagesWithWorkflowRelay[\s\S]*: withCollapsedTurnResults\(threadId, messagesWithWorkflowRelay\)/,
  );
});
