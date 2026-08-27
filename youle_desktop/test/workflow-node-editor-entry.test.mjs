import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const workflowSource = readFile(
  new URL("../src/renderer/workflow-canvas.ts", import.meta.url),
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

test("workflow history keeps the remote three-column layout and aligned canvas toolbar", async () => {
  const renderer = await rendererSource;
  const workflow = await workflowSource;
  const styles = await stylesSource;
  const renderBlock = sourceBlock(
    renderer,
    "function render()",
    "function renderLoginScreen",
  );
  const agentPanel = sourceBlock(
    renderer,
    "function renderAgentPanel",
    "function renderComposerThreadMentionSearch",
  );
  const toolbar = sourceBlock(
    workflow,
    "export function renderWorkflowToolbar",
    "export function workflowCanvasPreferredPanelWidth",
  );

  assert.match(
    renderBlock,
    /renderChatList\(\)[\s\S]*renderChatPanel\(thread\)[\s\S]*renderAgentPanel\(thread\)/,
  );
  assert.match(agentPanel, /renderWorkflowToolbar\(workflowRun,\s*\{[\s\S]*showExit:/);
  assert.match(toolbar, /<div class="cluster-workflow-toolbar">/);
  assert.match(toolbar, /class="cluster-workflow-toolbar-title" role="heading" aria-level="2">画布<\/span>/);
  assert.doesNotMatch(toolbar, /<h2|<header/);
  assert.doesNotMatch(toolbar, /cluster-workflow-progress|cluster-workflow-run-state|runStatusLabel/);
  assert.doesNotMatch(renderer, /workflowCanvasEditThreadId|renderWorkflowCanvasEditLayout|modify-workflow-canvas|exit-workflow-canvas-edit/);
  assert.doesNotMatch(workflow, /WorkflowToolbarAction|cluster-workflow-toolbar-action|修改画布|退出修改/);
  assert.doesNotMatch(styles, /workflow-canvas-edit-|cluster-workflow-toolbar-action/);
});

test("group-chat workflow node clicks open the editable revision draft directly", async () => {
  const renderer = await rendererSource;
  const bindings = sourceBlock(
    renderer,
    "function bindWorkflowCanvasSurfaceEvents",
    "function workflowCanvasDialogSkills",
  );
  const activeDialog = sourceBlock(
    renderer,
    "function renderActiveWorkflowNodeDialog",
    "function isWorkflowNodeDialogSurfaceActive",
  );
  const draftUpdate = sourceBlock(
    renderer,
    "function updateWorkflowNodeRevisionDraft",
    "function renderMessageScrollBottomButton",
  );

  assert.match(
    bindings,
    /const run = ensureWorkflowCanvasRevisionDraft\(threadId\);[\s\S]*state\.workflowNodeDialog = \{ threadId, nodeId, sourceNodeId \}/,
  );
  assert.match(activeDialog, /ensureWorkflowCanvasRevisionDraft\(selection\.threadId\)/);
  assert.match(activeDialog, /editable:\s*true/);
  assert.match(
    activeDialog,
    /availableExecutors:\s*workflowCanvasExecutorOptionsForNode\([\s\S]*dialogNode,[\s\S]*newNode,[\s\S]*selection\.threadId,[\s\S]*\)/,
  );
  assert.match(activeDialog, /availableSkills:\s*workflowCanvasDialogSkills\(\)/);
  assert.match(renderer, /const workflowCanvasDraftsByThreadId = new Map<string, WorkflowCanvasRun>\(\)/);
  assert.match(renderer, /function createWorkflowCanvasRevisionDraft\([\s\S]*?run: WorkflowCanvasRun/);
  assert.match(renderer, /function workflowCanvasRunWithDraft\(threadId:/);
  assert.match(draftUpdate, /node\.joinPolicy = \{ mode: "all_required" \}/);
  assert.match(draftUpdate, /node\.outputContract = null/);
  assert.match(draftUpdate, /node\.acceptance = \[\]/);
  assert.doesNotMatch(draftUpdate, /outputRequirements|请至少填写一条输出要求|structuredDataFormat|outputSchema|outputFormat/);
  assert.match(draftUpdate, /const skillBindings = workflowNodePromptSkillBindings/);
  assert.match(draftUpdate, /node\.skillBindings = skillBindings/);
  assert.match(draftUpdate, /skillBindings\.length && selectedExecutorType !== "codex_subagent"/);
  assert.doesNotMatch(draftUpdate, /workflowRunsByThreadId\.set/);
  assert.match(draftUpdate, /const prompt = composeWorkflowControlledPrompt\([\s\S]*inputDefinition[\s\S]*taskDefinition[\s\S]*outputDefinition/);
  assert.match(draftUpdate, /api\.compileWorkflowRevisionNode\([\s\S]*definition:[\s\S]*layout:/);
});

test("a terminal canvas persists its revision before compiling a node", async () => {
  const renderer = await rendererSource;
  const persistence = sourceBlock(
    renderer,
    "async function ensurePersistedWorkflowRevisionDraft",
    "async function synchronizeWorkflowRevisionDraft",
  );
  const draftUpdate = sourceBlock(
    renderer,
    "async function updateWorkflowNodeRevisionDraft",
    "function renderMessageScrollBottomButton",
  );

  assert.doesNotMatch(
    persistence,
    /isLocalBlankThreadId\(threadId\)[\s\S]*return null/,
  );
  assert.match(persistence, /runId: currentRun\.id/);
  assert.match(persistence, /entryBindings: workflowRevisionEntryBindings\(localDraft, layout\)/);
  assert.doesNotMatch(persistence, /seedRun|BlankWorkflowCanvas/);
  assert.match(
    draftUpdate,
    /await ensurePersistedWorkflowRevisionDraft\(threadId\)[\s\S]*api\.compileWorkflowRevisionNode/,
  );
});

test("successful node analysis survives rerenders and closes only its own dialog", async () => {
  const renderer = await rendererSource;
  const activeDialog = sourceBlock(
    renderer,
    "function renderActiveWorkflowNodeDialog",
    "function renderWorkflowCanvasContextMenu",
  );
  const bindings = sourceBlock(
    renderer,
    "function bindEvents",
    "function openChannelDialog",
  );
  const draftUpdate = sourceBlock(
    renderer,
    "async function updateWorkflowNodeRevisionDraft",
    "function renderMessageScrollBottomButton",
  );

  assert.match(activeDialog, /saving:\s*activeWorkflowNodeDialogIsSaving\(\)/);
  assert.match(
    bindings,
    /workflowNodeDialogSaveRequest = saveRequest;[\s\S]*const savePromise = updateWorkflowNodeRevisionDraft\(form\);[\s\S]*render\(\);[\s\S]*const successMessage = await savePromise/,
  );
  assert.match(
    bindings,
    /workflowNodeDialogMatchesSaveRequest\(state\.workflowNodeDialog, saveRequest\)[\s\S]*state\.workflowNodeDialog = null;[\s\S]*showToast\(successMessage, 1800\)/,
  );
  assert.match(bindings, /if \(activeWorkflowNodeDialogIsSaving\(\)\) return;/);
  assert.match(draftUpdate, /return `\$\{pendingInsertion\.zoneLabel\}[^`]+节点`/);
  assert.match(draftUpdate, /return "节点契约已由 Haolo 编译并保存"/);
});

test("saving an unchanged existing workflow node closes without compiling", async () => {
  const renderer = await rendererSource;
  const bindings = sourceBlock(
    renderer,
    "function bindEvents",
    "function openChannelDialog",
  );

  assert.match(
    bindings,
    /!pendingInsertion[\s\S]*workflowNodeFormMatchesInitialValues\(form\)[\s\S]*!attachmentDraft\?\.attachments\.length[\s\S]*state\.workflowNodeDialog = null;[\s\S]*render\(\);[\s\S]*return;/,
  );
  const unchangedCloseIndex = bindings.indexOf(
    "workflowNodeFormMatchesInitialValues(form)",
  );
  const savingIndex = bindings.indexOf(
    "workflowNodeDialogSaveRequest = saveRequest",
  );
  const compileIndex = bindings.indexOf(
    "updateWorkflowNodeRevisionDraft(form)",
  );
  assert.ok(unchangedCloseIndex >= 0);
  assert.ok(savingIndex > unchangedCloseIndex);
  assert.ok(compileIndex > savingIndex);
});

test("workflow model nodes reuse the authenticated provider catalog", async () => {
  const renderer = await rendererSource;
  const catalogOptions = sourceBlock(
    renderer,
    "function workflowCanvasExternalModelExecutorOptions",
    "function renderQuestionAnswerModelMenu",
  );
  const openPendingNode = sourceBlock(
    renderer,
    "async function openWorkflowCanvasPendingNodeEditor",
    "function insertWorkflowCanvasNestedSpec",
  );
  const bindings = sourceBlock(
    renderer,
    "function bindWorkflowCanvasContextMenu",
    "function bindWeComSupportEvents",
  );

  assert.match(catalogOptions, /availableQuestionAnswerModelGroups\(\)/);
  assert.match(catalogOptions, /executorType:\s*"external_model"/);
  assert.match(catalogOptions, /provider:\s*group\.provider/);
  assert.match(catalogOptions, /model:\s*option\.value/);
  assert.match(catalogOptions, /label:\s*option\.label \|\| option\.value/);
  assert.match(
    openPendingNode,
    /kind === "model"[\s\S]*await refreshProviderModelCatalog\(\{ renderAfter: false \}\)/,
  );
  assert.match(bindings, /button\.disabled = true/);
  assert.match(bindings, /openWorkflowCanvasPendingNodeEditor\(menuState, kind\)\.finally/);
});

test("new workflow agents reuse every concrete model from the unified execution picker", async () => {
  const renderer = await rendererSource;
  const agentOptions = sourceBlock(
    renderer,
    "function workflowCanvasExecutionAgentExecutorOptions",
    "function workflowCanvasExecutorOptionsForNode",
  );
  const optionRouting = sourceBlock(
    renderer,
    "function workflowCanvasExecutorOptionsForNode",
    "function renderQuestionAnswerModelMenu",
  );
  const openPendingNode = sourceBlock(
    renderer,
    "async function openWorkflowCanvasPendingNodeEditor",
    "function insertWorkflowCanvasNestedSpec",
  );
  const workflow = await workflowSource;
  const dialogRendering = sourceBlock(
    workflow,
    "export function renderWorkflowNodeDialog",
    "function renderWorkflowNodeMentionMenu",
  );
  const executorOptions = sourceBlock(
    workflow,
    "function workflowExecutorOptions",
    "function workflowExecutorOptionValue",
  );

  assert.match(agentOptions, /unifiedExecutionAvailableModelGroups\(threadId\)/);
  assert.match(agentOptions, /executorType:\s*"codex_subagent"/);
  assert.match(agentOptions, /:\s*"haolo-codex-agent"/);
  assert.match(agentOptions, /"haolo-image-agent"/);
  assert.match(agentOptions, /"haolo-video-agent"/);
  assert.match(agentOptions, /groupLabel:\s*group\.label/);
  assert.match(agentOptions, /priceLabel:\s*option\.priceLabel/);
  assert.match(agentOptions, /filter\(\(option\) => Boolean\(String\(option\.value/);
  assert.match(optionRouting, /newNode[\s\S]*agentOptions[\s\S]*externalModelOptions/);
  assert.match(
    openPendingNode,
    /kind === "model"[\s\S]*refreshProviderModelCatalog[\s\S]*refreshBusinessModelPools[\s\S]*preloadMediaCreationModelCatalogs/,
  );
  assert.match(dialogRendering, /newAgentNode[\s\S]*availableOnly:\s*true/);
  assert.match(dialogRendering, /executorType:\s*"codex_subagent"/);
  assert.match(dialogRendering, /requireModel:\s*true/);
  assert.match(dialogRendering, /暂无可用执行模型/);
  assert.match(executorOptions, /constraints\.availableOnly/);
  assert.match(executorOptions, /constraints\.requireModel && !normalized\.model/);
});

test("new workflow models and agents start with immutable input, task, and output fields", async () => {
  const renderer = await rendererSource;
  const draftNode = sourceBlock(
    renderer,
    "function workflowCanvasDraftNode",
    "async function openWorkflowCanvasPendingNodeEditor",
  );
  const workflow = await workflowSource;
  const dialogRendering = sourceBlock(
    workflow,
    "export function renderWorkflowNodeDialog",
    "function renderWorkflowNodeMentionMenu",
  );

  assert.match(draftNode, /prompt:\s*""/);
  assert.match(draftNode, /requirements:\s*\[\]/);
  assert.match(draftNode, /acceptance:\s*\[\]/);
  assert.doesNotMatch(draftNode, /独立完成该节点承担的任务|完成该节点承担的任务|结果清晰完整/);
  assert.match(dialogRendering, /name="inputDefinition"/);
  assert.match(dialogRendering, /name="taskDefinition"/);
  assert.match(dialogRendering, /name="outputDefinition"/);
  assert.match(dialogRendering, />输入：<\/span>[\s\S]*>任务：<\/span>[\s\S]*>输出：<\/span>/);
  assert.match(
    dialogRendering,
    /inputBindings\.length \? `[\s\S]*textarea name="inputDefinition" hidden aria-hidden="true" tabindex="-1"[\s\S]*workflow-node-derived-input-note[\s\S]*由连接线和上游节点输出自动生成，不可直接修改/,
  );
  assert.doesNotMatch(dialogRendering, /<small>由连接线和上游节点输出自动生成/);
  assert.doesNotMatch(dialogRendering, /allowEmptyRequirements|outputRequirements|输出要求提示词/);
});

test("every existing workflow canvas freezes and executes the current graph without replanning", async () => {
  const renderer = await rendererSource;
  const persistence = sourceBlock(
    renderer,
    "async function persistWorkflowRevisionDraftForExecution",
    "function queueWorkflowRevisionPersistence",
  );
  const sendFlow = sourceBlock(
    renderer,
    "const workflowStartParams = {",
    "if (hasThreadCodexWork(threadId))",
  );

  assert.match(persistence, /while \(true\)/);
  assert.match(persistence, /await queueWorkflowRevisionPersistence\(threadId, desiredRun, desiredLayout\)/);
  assert.match(persistence, /desiredSignature === latestSignature/);
  assert.match(renderer, /const executeCurrentCanvas = Boolean\(workflowContractAtSend\)/);
  assert.match(renderer, /executeCurrentCanvas && !canExecuteCurrentCanvas/);
  assert.match(sendFlow, /if \(workflowContractAtSend\) \{/);
  assert.match(sendFlow, /await persistWorkflowRevisionDraftForExecution\(threadId\)/);
  assert.match(sendFlow, /await api\.freezeWorkflowRevisionDraft!\(\{ draftId: envelope\.draft\.id \}\)/);
  assert.match(sendFlow, /await api\.startWorkflowSpecRun!\(\{/);
  assert.match(sendFlow, /entryNodeIds: \[\.\.\.workflowContractAtSend\.entryNodeIds\]/);
  assert.match(sendFlow, /\} else \{\s*run = await api\.startWorkflowRun!\(workflowStartParams\)/);
  assert.doesNotMatch(sendFlow, /const revisionDraft = workflowCanvasDraftsByThreadId\.get/);
});

test("workflow composer removes the redundant input summary and preserves its contract placeholder", async () => {
  const renderer = await rendererSource;
  const styles = await stylesSource;
  const placeholder = sourceBlock(
    renderer,
    "function composerPlaceholderForThread",
    "function normalizeThreadModelSettings",
  );
  const inputSlots = sourceBlock(
    renderer,
    "function renderWorkflowComposerInputSlots",
    "function renderComposer",
  );
  const composer = sourceBlock(
    renderer,
    "function renderComposer",
    "function renderVideoExpertComposer",
  );
  const dynamicPatch = sourceBlock(
    renderer,
    "function patchComposerDynamicState",
    "function renderComposerSkillMentionPopover",
  );

  assert.match(
    placeholder,
    /const workflowInputContract = workflowComposerInvocationContract\(thread\.id\);[\s\S]*return workflowInvocationRequirementMessage\(workflowInputContract\.slots\);/,
  );
  assert.match(
    placeholder,
    /if \(isMultiModelClusterThread\(thread\.id\)\) \{\s*return "说出需求点击发送自动创建画布，也可以在画布面板手动创建画布";/,
  );
  assert.doesNotMatch(inputSlots, /workflow-composer-inputs-head/);
  assert.doesNotMatch(inputSlots, />运行输入</);
  assert.doesNotMatch(inputSlots, /workflowInvocationRequirementMessage\(contract\.slots\)/);
  assert.match(
    composer,
    /placeholder="\$\{escapeAttr\(composerPlaceholderForThread\(thread\)\)\}"/,
  );
  assert.match(
    composer,
    /const workflowUsesMainText = workflowInvocationUsesMainText\(workflowInputContract\)/,
  );
  assert.match(
    composer,
    /workflowInputContract && !workflowUsesMainText \? ' readonly tabindex="-1" aria-hidden="true"' : ""/,
  );
  assert.match(
    dynamicPatch,
    /const placeholder = composerPlaceholderForThread\(thread\);[\s\S]*input\.placeholder = placeholder/,
  );
  assert.match(
    renderer,
    /const persistedContract = workflowInvocationContractFromMetadata\(currentRun\?\.metadata\);[\s\S]*if \(persistedContract\) return persistedContract;/,
  );
  assert.doesNotMatch(styles, /\.workflow-composer-inputs-head/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-composer-inputs\s*\{/);
});

test("workflow file inputs reuse compact typed upload guides and uploaded attachment cards", async () => {
  const renderer = await rendererSource;
  const styles = await stylesSource;
  const labels = sourceBlock(
    renderer,
    "function workflowComposerUploadSlotLabel",
    "function workflowComposerAttachmentLabels",
  );
  const attachmentLabels = sourceBlock(
    renderer,
    "function workflowComposerAttachmentLabels",
    "function renderWorkflowComposerUploadGuideSlots",
  );
  const guides = sourceBlock(
    renderer,
    "function renderWorkflowComposerUploadGuideSlots",
    "function workflowComposerFileInputPolicy",
  );
  const pendingRail = sourceBlock(
    renderer,
    "function renderPendingAttachmentsRail",
    "function workflowComposerInvocationContract",
  );
  const composer = sourceBlock(
    renderer,
    "function renderComposer",
    "function renderVideoExpertComposer",
  );

  assert.match(labels, /slot\.type === "image"\) return "图片"/);
  assert.match(labels, /slot\.type === "video"\) return "视频"/);
  assert.match(labels, /return "word"/);
  assert.match(labels, /return "txt"/);
  assert.match(guides, /Math\.max\(0, slot\.maxCount - assignedCount\)/);
  assert.match(guides, /class="media-upload-guide-slot workflow-upload-guide-slot/);
  assert.match(guides, /data-workflow-input-remaining=/);
  assert.match(attachmentLabels, /labels\.set\(attachmentId, workflowComposerUploadSlotLabel\(slot\)\)/);
  assert.match(pendingRail, /workflowComposerAttachmentLabels\([\s\S]*mediaLabels\.set\(attachmentId, label\)/);
  assert.match(pendingRail, /data-attachment-scroll="left"[^>]*hidden/);
  assert.match(pendingRail, /data-attachment-scroll="right"[^>]*hidden/);
  assert.match(composer, /const workflowCanvasMode = isMultiModelClusterThread\(thread\.id\)/);
  assert.match(composer, /const workflowHasEntryNodes = Boolean\(workflowInputContract\?\.entryNodeIds\.length\)/);
  assert.match(composer, /workflowCanvasMode && workflowHasEntryNodes \? "" : `[\s\S]*composer-upload-button/);
  assert.match(composer, /renderWorkflowComposerUploadGuideSlots\(thread\.id, workflowInputContract\)/);
  assert.match(renderer, /wrap\.querySelector\("\[data-media-input-kind\], \[data-workflow-input-slot\]"\)/);
  assert.match(renderer, /window\.requestAnimationFrame\(updateAttachmentScrollControls\)/);
  assert.doesNotMatch(renderer, /workflow-composer-slot upload-slot/);
  assert.doesNotMatch(styles, /workflow-composer-slot\.upload-slot|workflow-composer-slot-state|workflow-composer-slot-copy/);
  assert.doesNotMatch(styles, /\.pending-attachments-wrap:has\(\.workflow-upload-guide-slot\)\s*\{[^}]*translateY\(-7px\)/s);
  assert.match(styles, /\.pending-attachments:has\(\.workflow-upload-guide-slot\)\s*\{[^}]*height:\s*62px;[^}]*align-items:\s*center;[^}]*padding-left:\s*2px;/s);
});

test("an empty canvas keeps generic uploads and automatic cluster planning available", async () => {
  const renderer = await rendererSource;
  const topology = sourceBlock(
    renderer,
    "function workflowComposerTopologyValidation",
    "function workflowComposerNamedTextValues",
  );
  const sendFlow = sourceBlock(
    renderer,
    "const workflowStartParams = {",
    "if (hasThreadCodexWork(threadId))",
  );

  assert.match(
    topology,
    /const definitionNodes = workflowRevisionDefinitionNodes\(activeDraft\);\s*if \(!definitionNodes\.length\) return null;/,
  );
  assert.match(
    topology,
    /const definitionNodes = workflowRevisionDefinitionNodes\(draft\);\s*if \(!definitionNodes\.length\) return null;/,
  );
  assert.match(sendFlow, /\} else \{\s*run = await api\.startWorkflowRun!\(workflowStartParams\)/);
  assert.match(sendFlow, /explicitPaths: readyAttachments/);
  assert.match(sendFlow, /attachments: userAttachments/);
});

test("an empty historical workflow canvas keeps its send button disabled", async () => {
  const renderer = await rendererSource;
  const styles = await stylesSource;
  const canSend = sourceBlock(
    renderer,
    "function canSendComposer",
    "function canSendConversationSupplement",
  );
  const visibleText = sourceBlock(
    renderer,
    "function workflowComposerVisibleText",
    "function workflowComposerInputPreparation",
  );
  const hasContent = sourceBlock(
    renderer,
    "function workflowComposerInputPreparationHasContent",
    "function workflowComposerFileInputPolicy",
  );

  assert.match(
    canSend,
    /const preparation = workflowComposerInputPreparation\([\s\S]*preparation\.valid[\s\S]*workflowComposerInputPreparationHasContent\(/,
  );
  assert.match(visibleText, /if \(textSlots\.length <= 1\) return mainText\.trim\(\);/);
  assert.match(
    hasContent,
    /workflowComposerVisibleText\(threadId, contract, mainText\)\.trim\(\)[\s\S]*preparation\.usedAttachmentIds\.length/,
  );
  assert.match(
    renderer,
    /if \(!workflowComposerInputPreparationHasContent\([\s\S]*earlyPreparation,[\s\S]*\)\) \{[\s\S]*return;/,
  );
  assert.match(styles, /\.send-button:disabled\s*\{[^}]*background:\s*var\(--surface-disabled\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.send-button:disabled\s*\{[^}]*background:\s*#242830;/s);
});

test("node editor covers light and dark interaction states after the layout rollback", async () => {
  const styles = await stylesSource;

  assert.doesNotMatch(
    styles,
    /workflow-node-editor-(?:intro|capabilities|checklist|switch|inline-options|row|empty)/,
  );
  assert.match(
    styles,
    /\.workflow-node-editor-field input:focus-visible,[\s\S]*?box-shadow:/,
  );
  assert.match(styles, /\.workflow-node-edit-button:hover:not\(:disabled\)\s*\{/);
  assert.match(styles, /\.workflow-node-edit-button:active:not\(:disabled\)\s*\{/);
  assert.match(styles, /\.workflow-node-edit-button:focus-visible\s*\{/);
  assert.match(styles, /\.workflow-node-edit-button:disabled\s*\{/);
  assert.match(styles, /\.workflow-node-dialog-close:disabled\s*\{/);
  assert.match(styles, /\.workflow-node-mention-root-item:hover:not\(:disabled\),[\s\S]*?\.workflow-node-mention-options > button\.active\s*\{/);
  assert.match(styles, /\.workflow-node-mention-root-item:active:not\(:disabled\),[\s\S]*?\.workflow-node-mention-options > button:active:not\(:disabled\)\s*\{/);
  assert.match(styles, /\.workflow-node-mention-root-item:focus-visible,[\s\S]*?\.workflow-node-mention-search:focus-within\s*\{/);
  assert.match(styles, /\.workflow-node-mention-root-item:disabled,[\s\S]*?\.workflow-node-mention-options > button:disabled\s*\{/);
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.workflow-node-edit-dialog\s*\{[^}]*background:/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.workflow-node-editor-setting-label,[\s\S]*?html\[data-theme="dark"\] \.workflow-node-editor-field > \.workflow-node-editor-setting-label\s*\{[^}]*color:\s*#b5bece;/s,
  );
  assert.doesNotMatch(styles, /workflow-node-structured|workflow-node-output-(?:picker|trigger|menu|option)/);
  assert.match(
    styles,
    /\.workflow-node-executor-picker \.workflow-node-executor-menu\.composer-model-menu\.grouped\s*\{[^}]*max-height:\s*min\([\s\S]*260px,[\s\S]*calc\(100vh - 420px\),[\s\S]*var\(--workflow-node-menu-available-height, 260px\)[\s\S]*\);[^}]*overscroll-behavior:\s*contain;/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.composer-model-menu\.grouped \.composer-model-option-name\s*\{[^}]*color:\s*var\(--text-primary\);/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.workflow-node-editor-field input\[type="number"\],[\s\S]*?color-scheme:\s*dark;/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.workflow-node-mention-popover,[\s\S]*?\.workflow-node-mention-submenu\s*\{[^}]*border-color:[^}]*background:/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.workflow-node-mention-root-item:hover:not\(:disabled\),[\s\S]*?\.workflow-node-mention-options > button\.active\s*\{/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.workflow-node-mention-root-item:focus-visible,[\s\S]*?\.workflow-node-mention-search:focus-within\s*\{/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.workflow-node-edit-button:focus-visible\s*\{/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.workflow-node-dialog-close:disabled\s*\{/,
  );
  assert.doesNotMatch(styles, /workflow-node-join-/);
  assert.match(styles, /\.workflow-composer-slot\.text-slot > input:hover:not\(:disabled\)\s*\{/);
  assert.match(styles, /\.workflow-composer-slot\.text-slot > input:focus-visible\s*\{/);
  assert.match(styles, /\.workflow-composer-slot\.text-slot > input:disabled\s*\{/);
  assert.match(styles, /\.media-upload-guide-slot:hover:not\(:disabled\),[\s\S]*\.media-upload-guide-slot:focus-visible:not\(:disabled\)\s*\{/);
  assert.match(styles, /\.media-upload-guide-slot:active:not\(:disabled\)\s*\{/);
  assert.match(styles, /\.media-upload-guide-slot:disabled\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-composer-slot\.text-slot > input:hover:not\(:disabled\)\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-composer-slot\.text-slot > input:focus-visible\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-composer-slot\.text-slot > input:disabled\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.media-upload-guide-slot:hover:not\(:disabled\),[\s\S]*html\[data-theme="dark"\] \.media-upload-guide-slot:focus-visible:not\(:disabled\)\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.media-upload-guide-slot:active:not\(:disabled\)\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.media-upload-guide-slot:disabled\s*\{/);
});

test("workflow node mention submenus stay on the right and shift the root menu into view", async () => {
  const renderer = await rendererSource;
  const styles = await stylesSource;
  const placement = sourceBlock(
    renderer,
    "function placeWorkflowNodeMentionSubmenu",
    "function renderWorkflowNodeMentionHighlights",
  );

  assert.match(
    styles,
    /\.workflow-node-mention-submenu\s*\{[^}]*left:\s*calc\(100% \+ 3px\);/s,
  );
  assert.doesNotMatch(styles, /\.workflow-node-mention-submenu\.open-left/);
  assert.doesNotMatch(placement, /classList\.(?:add|toggle)\(\s*["']open-left/);
  assert.match(
    placement,
    /rightOverflow[\s\S]*popoverRect\.right[\s\S]*submenuWidth[\s\S]*dialogRect\.right/,
  );
  assert.match(
    placement,
    /nextViewportLeft[\s\S]*popoverRect\.left - rightOverflow[\s\S]*popover\.style\.left/,
  );
  assert.match(placement, /submenu\.style\.maxWidth =/);
});
