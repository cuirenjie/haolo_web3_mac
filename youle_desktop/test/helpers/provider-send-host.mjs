import fs from "node:fs";
import { canonicalExecutionModelProvider } from "../../src/main/execution-model-provider.mjs";
import { migrateDeepSeekModelSelection } from "../../src/main/deepseek-model-policy.mjs";
import { migrateRetiredModelSelection } from "../../src/main/retired-model-policy.mjs";
import { withAnalysisModelRecoveryPolicy } from "../../src/main/analysis-model-policy.mjs";
import { applyThreadProviderSwitch, assertThreadProvider, restartIdleProviderRuntime } from "../../src/main/thread-provider-switch.mjs";
import { isRecoverableAnalysisModelFailure } from "../../src/main/analysis-model-recovery.mjs";

// Execute the real Electron host handlers without starting Electron or loading
// the user's account. Native tests inject the bundled app-server RPC transport.
const source = fs.readFileSync(new URL("../../src/main/main.mjs", import.meta.url), "utf8");
const definition = (name) => {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  if (start < 0) throw new Error(`Missing production function ${name}`);
  const end = source.slice(start).search(/\r?\n}\r?\n/);
  return source.slice(start, start + end).trimEnd() + "\n}";
};
const noop = () => {};

export function createProviderSendHost({ request, client = {}, cwd = "workspace", state = null, now = Date.now(), stop = noop, start = noop } = {}) {
  const pending = new Set(), active = new Map(), clients = new Map();
  client.__youleWorkspaceKey = "test-runtime";
  let handler;
  const deps = {
    firstString: (...values) => values.find((v) => typeof v === "string" && v.trim())?.trim() || "",
    canonicalExecutionModelProvider, migrateDeepSeekModelSelection, migrateRetiredModelSelection,
    DEEPSEEK_EXECUTION_MODEL: "deepseek-flash", DEEPSEEK_EXECUTION_PROVIDER_ID: "deepseek",
    ANALYSIS_PRIMARY_MODEL: "gpt-5.6-sol", applyThreadProviderSwitch, assertThreadProvider, restartIdleProviderRuntime,
    currentSkillsCwd: cwd, desktopWorkspace: () => cwd, currentThreadId: null,
    requestAppServer: (_client, method, params) => request(method, params),
    stopAppServerClient: stop, startAppServerClient: start,
    appShuttingDown: false, appCleanupStarted: false, appServerClientByThreadId: clients,
    activeCodexTurnsByThread: active, pendingCodexTurnThreadIds: pending,
    verifiedDeepSeekTextOnlyThreadIds: new Set(),
    performanceTimingStart: () => null, loadContinuationTransactions: noop,
    bufferedContinuationStartThreadIds: new Set(), initializingContinuationThreadIds: new Set(), discardedContinuationThreadIds: new Set(),
    preparedGroupChatContextForRequest: () => null, persistExplicitMarketAliasMemory: noop,
    withAnalysisModelRecoveryPolicy: (params, value) => withAnalysisModelRecoveryPolicy(params, value, now),
    getAnalysisModelRecoveryStore: () => ({ snapshot: () => state, activate: noop }),
    normalizeConversationMode: () => "execution", IMAGE_GENERATION_CONVERSATION_MODE: "image", VIDEO_GENERATION_CONVERSATION_MODE: "video",
    adaptiveReasoningEffortForTask: () => "high", turnAutoRecoveryCoordinator: { noteUserTurn: noop },
    videoGenerationInstructionOptions: () => ({}),
    beginTurnDiagnostic: () => ({ diagnosticId: "test", requestedAtMs: Date.now() }),
    acquireSerializedThreadSettingsOperation: async () => noop,
    rememberPendingCodexTurnThread: (id) => pending.add(id), forgetPendingCodexTurnThread: (id) => pending.delete(id),
    getClientForCwd: () => client, rememberThreadClient: (id) => clients.set(id, client.__youleWorkspaceKey),
    ensureThreadGroupWorkspaceDirectory: noop, refreshSkillsDeveloperInstructions: async () => "preserved host instructions",
    buildConversationModeTurnOverrides: () => ({}), resolvedThreadReferenceContext: async () => ({}),
    crypto: { randomUUID: () => "synthetic" }, rootRecoveryModelsByThread: new Map(),
    buildTurnInputWithGroupMemory: (text) => text, HAOLO_REASONING_FIXED_EFFORT_FIELD: "__haoloFixedReasoningEffort",
    HAOLO_REASONING_SUPPORT_FIELD: "__haoloSupportedReasoningEfforts", normalizeSandboxPolicy: (value) => value,
    injectLatestSkillsInstructions: noop, isThreadNotFoundError: (error) => /thread not found/i.test(error?.message || ""),
    automationRuntimeApprovalPolicy: (job) => job.approvalPolicy || "never",
    automationRuntimeSandbox: (job) => job.sandboxMode || "read-only",
    bindTurnDiagnostic: noop, recordTurnDiagnostic: noop, rememberActiveCodexTurn: (id, turn) => active.set(id, turn),
    consumptionSourceType: () => "test", rememberConsumptionInteraction: noop, reportConsumptionFact: noop,
    isRecoverableAnalysisModelFailure, failTurnDiagnostic: noop, rejectPendingCodexInterrupt: noop,
    ipcMain: { handle: (_method, callback) => { handler = callback; } },
  };
  const names = ["requestedReasoningEffort", "executionProviderSelection", "requestedThreadModelSettings", "threadConfigurationParams",
    "threadModelProviderFromResumeResult", "isMissingRolloutErrorMessage", "threadHistoryContainsImageContent",
    "ensureDeepSeekThreadHistoryIsTextOnly", "resumeThreadForRequestedProvider", "resumeAutomationThread"];
  const from = source.indexOf('ipcMain.handle("codex:sendMessage"');
  const to = source.indexOf('ipcMain.handle("codex:interruptTurn"', from);
  const helpers = new Function(...Object.keys(deps), `${names.map(definition).join("\n")}\n${source.slice(from, to)}\nreturn { resumeThreadForRequestedProvider, resumeAutomationThread, executionProviderSelection, threadModelProviderFromResumeResult };`)(...Object.values(deps));
  return { send: (params) => handler({}, { cwd, ...params }), ...helpers, client, pending, active, clients };
}
