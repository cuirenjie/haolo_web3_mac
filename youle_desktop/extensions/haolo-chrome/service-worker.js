import {
  CONNECTION_STATES,
  NATIVE_HOST_NAME,
  PROTOCOL_VERSION,
  extensionProfileId,
  randomId,
  safeError,
} from "./shared.js";

let nativePort = null;
let connectionState = CONNECTION_STATES.DISCONNECTED;
let connectionError = null;
let profileId = null;
let sessionId = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
const listeners = new Set();
const temporaryOrigins = new Map();
const activeTasks = new Map();
const completedToolRequests = new Map();
const inFlightToolRequests = new Map();

void initialize();

chrome.runtime.onInstalled.addListener(() => {
  void configureChromeSurface();
  void ensureNativeConnection();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureNativeConnection();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url || !temporaryOrigins.has(tabId)) return;
  const previousOrigin = temporaryOrigins.get(tabId);
  if (httpOrigin(tab.url) !== previousOrigin) void revokeTemporaryAccess(tabId, previousOrigin);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const origin = temporaryOrigins.get(tabId);
  if (origin) void revokeTemporaryAccess(tabId, origin);
  for (const [taskId, task] of activeTasks) {
    if (task.tabId === tabId || task.sourceTabId === tabId) activeTasks.delete(taskId);
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "haolo-sidepanel") return;
  listeners.add(port);
  port.onDisconnect.addListener(() => listeners.delete(port));
  port.onMessage.addListener((message) => void handleSidePanelMessage(port, message));
  port.postMessage({ type: "connection.status", payload: publicConnectionStatus() });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source !== "haolo-page-agent" || message?.type !== "frame.register") return false;
  sendResponse({ frameId: Number(sender.frameId || 0), tabId: sender.tab?.id || null });
  return false;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "ask-haolo" || !tab?.id) return;
  void sendNative({
    protocolVersion: PROTOCOL_VERSION,
    type: "extension.context",
    requestId: randomId("context"),
    sessionId,
    profileId,
    payload: {
      tabId: tab.id,
      url: tab.url || null,
      title: tab.title || null,
      selectionText: String(info.selectionText || "").slice(0, 10_000),
    },
  }).catch((error) => broadcast({ type: "connection.error", payload: safeError(error) }));
});

async function initialize() {
  profileId = await extensionProfileId();
  await configureChromeSurface();
  await ensureNativeConnection();
}

async function configureChromeSurface() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  await chrome.contextMenus.removeAll().catch(() => {});
  chrome.contextMenus.create({
    id: "ask-haolo",
    title: "Ask Haolo about selected text",
    contexts: ["selection"],
  }, () => void chrome.runtime.lastError);
}

async function handleSidePanelMessage(port, message) {
  if (message?.type === "connection.status") {
    port.postMessage({ type: "connection.status", payload: publicConnectionStatus() });
    return;
  }
  if (message?.type === "connection.retry") {
    reconnectAttempt = 0;
    await ensureNativeConnection(true);
    return;
  }
  if (message?.type === "haolo.open") {
    await sendNative({
      protocolVersion: PROTOCOL_VERSION,
      type: "desktop.open",
      requestId: randomId("open"),
      sessionId,
      profileId,
      payload: {},
    }).catch((error) => port.postMessage({ type: "connection.error", payload: safeError(error) }));
    return;
  }
  if (message?.type === "tab.status") {
    port.postMessage({ type: "tab.status", payload: await currentTabStatus() });
    return;
  }
  if (message?.type === "capabilities.status") {
    port.postMessage({ type: "capabilities.status", payload: await capabilityStatus() });
    return;
  }
  if (message?.type === "capability.request") {
    try {
      await requestCapability(message.payload?.capability);
      port.postMessage({ type: "capabilities.status", payload: await capabilityStatus() });
    } catch (error) {
      port.postMessage({ type: "capability.error", payload: safeError(error, "Unable to grant the requested Chrome capability.") });
    }
    return;
  }
  if (message?.type === "permission.request") {
    try {
      const status = await requestCurrentSiteAccess(message.payload?.mode);
      port.postMessage({ type: "tab.status", payload: status });
    } catch (error) {
      port.postMessage({ type: "permission.error", payload: safeError(error, "无法授权当前网站。") });
    }
    return;
  }
  if (message?.type === "permission.decline") {
    const tab = await activeTab();
    if (tab?.id && temporaryOrigins.has(tab.id)) await revokeTemporaryAccess(tab.id, temporaryOrigins.get(tab.id));
    const origin = httpOrigin(tab?.url);
    if (origin) void notifySitePermission({ tabId: tab.id, origin, mode: "none", decision: "prompt" });
    port.postMessage({ type: "tab.status", payload: await currentTabStatus() });
    return;
  }
  if (message?.type === "page.preview") {
    try {
      const tab = await activeTab();
      const snapshot = await readPage(tab?.id, { maxChars: 4_000, includeLinks: false, includeForms: false });
      port.postMessage({ type: "page.preview", payload: snapshot });
    } catch (error) {
      port.postMessage({ type: "page.error", payload: safeError(error, "无法读取当前页面。") });
    }
    return;
  }
  if (message?.type === "task.start") {
    try {
      const result = await startTask(message.payload?.prompt);
      port.postMessage({ type: "task.accepted", payload: result });
    } catch (error) {
      port.postMessage({ type: "task.error", payload: safeError(error, "无法把任务发送到 Haolo。") });
    }
  }
}

async function ensureNativeConnection(force = false) {
  if (nativePort && !force) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (nativePort) {
    try { nativePort.disconnect(); } catch {}
    nativePort = null;
  }
  setConnectionState(CONNECTION_STATES.CONNECTING);
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    nativePort = port;
    port.onMessage.addListener(handleNativeMessage);
    port.onDisconnect.addListener(() => handleNativeDisconnect(port));
    port.postMessage({
      protocolVersion: PROTOCOL_VERSION,
      type: "extension.hello",
      requestId: randomId("hello"),
      profileId,
      extensionVersion: chrome.runtime.getManifest().version,
    });
  } catch (error) {
    nativePort = null;
    setConnectionState(CONNECTION_STATES.ERROR, safeError(error, "Unable to connect to Haolo."));
    scheduleReconnect();
  }
}

function handleNativeMessage(message) {
  if (message?.type === "extension.ready") {
    sessionId = message.sessionId;
    reconnectAttempt = 0;
    if (message.payload?.connected === false) {
      setConnectionState(CONNECTION_STATES.ERROR, {
        code: message.payload?.compatibility?.reason || message.payload?.release?.reason || "CHROME_RELEASE_DISABLED",
        message: "This Haolo Chrome version is not enabled for the current desktop release.",
      });
      return;
    }
    setConnectionState(CONNECTION_STATES.CONNECTED);
    return;
  }
  if (message?.type === "host.error") {
    setConnectionState(CONNECTION_STATES.ERROR, message.payload || safeError(null));
    return;
  }
  if (message?.type === "health.ping") {
    sendToolResult(message, { ok: true, profileId, extensionVersion: chrome.runtime.getManifest().version });
    return;
  }
  if (message?.type === "tool.call") {
    void executeToolCallOnce(message);
    return;
  }
  if (message?.type === "task.tab.create") {
    void createBrokerTaskSurface(message)
      .then((payload) => sendToolResult(message, payload))
      .catch((error) => sendToolError(message, error));
    return;
  }
  broadcast({ type: "native.message", payload: message });
}

function handleNativeDisconnect(port) {
  if (nativePort !== port) return;
  const message = chrome.runtime.lastError?.message || "Haolo Native Host disconnected.";
  nativePort = null;
  sessionId = null;
  setConnectionState(CONNECTION_STATES.DISCONNECTED, { code: "CHROME_NATIVE_HOST_DISCONNECTED", message, category: "transport", retryable: true });
  scheduleReconnect();
}

function sendToolResult(request, payload) {
  if (!nativePort) return;
  nativePort.postMessage({ ...request, type: "tool.result", sessionId, profileId, payload });
}

function sendToolError(request, error) {
  if (!nativePort) return;
  nativePort.postMessage({ ...request, type: "tool.error", sessionId, profileId, payload: safeError(error) });
}

async function dispatchToolCall(request) {
  const tool = String(request.payload?.tool || "");
  const args = request.payload?.arguments || {};
  if (tool === "list_tabs") return listTabs(args);
  if (tool === "read_page") return readPage(args.tab_id, {
    includeLinks: args.include_links,
    includeForms: args.include_forms,
    maxChars: args.max_chars,
  });
  if (tool === "read_selection") return pageRequest(args.tab_id, { type: "read.selection" });
  if (tool === "capture_view") return captureView(args.tab_id);
  if (tool === "wait_for") return pageRequest(args.tab_id, { type: "wait.for", condition: args.condition, timeoutMs: args.timeout_ms });
  if (tool === "cancel_task") return cancelTask(args.task_id);
  if (tool === "navigate") return navigateTab(args.tab_id, args.url);
  if (tool === "click") return actionRequest(args.tab_id, { type: "action.click", target: args.target });
  if (tool === "type_text") return actionRequest(args.tab_id, { type: "action.type", target: args.target, text: args.text, replace: args.replace });
  if (tool === "select_option") return actionRequest(args.tab_id, { type: "action.select", target: args.target, value: args.value });
  if (tool === "scroll") return actionRequest(args.tab_id, { type: "action.scroll", target: args.target, deltaX: args.delta_x, deltaY: args.delta_y });
  if (tool === "press_key") return actionRequest(args.tab_id, { type: "action.key", key: args.key });
  if (tool === "prepare_external_action") return actionRequest(args.tab_id, { type: "action.external.prepare", action: args.action, target: args.target });
  if (tool === "upload_file") return actionRequest(args.tab_id, { type: "action.upload.prepare", target: args.target });
  if (tool === "download") return prepareDownload(args.tab_id, args.url, args.filename);
  if (tool === "commit_external_action") return commitPreparedAction(request);
  if (tool === "read_history") return readHistoryOnce(args);
  throw extensionError("CHROME_TOOL_NOT_IMPLEMENTED", `Chrome tool ${tool} is not available in this extension version.`, "protocol", false);
}

async function executeToolCallOnce(request) {
  const requestId = String(request.requestId || "");
  if (!requestId) {
    sendToolError(request, extensionError("CHROME_REQUEST_ID_REQUIRED", "Chrome tool calls require a request id.", "protocol", false));
    return;
  }
  const completed = completedToolRequests.get(requestId);
  if (completed) {
    if (completed.ok) sendToolResult(request, completed.payload);
    else sendToolError(request, completed.error);
    return;
  }
  if (inFlightToolRequests.has(requestId)) return;
  const operation = dispatchToolCall(request)
    .then((payload) => {
      rememberToolResult(requestId, { ok: true, payload });
      sendToolResult(request, payload);
    })
    .catch((error) => {
      const safe = safeError(error);
      rememberToolResult(requestId, { ok: false, error: safe });
      sendToolError(request, safe);
    })
    .finally(() => inFlightToolRequests.delete(requestId));
  inFlightToolRequests.set(requestId, operation);
  await operation;
}

function rememberToolResult(requestId, value) {
  completedToolRequests.set(requestId, value);
  while (completedToolRequests.size > 200) completedToolRequests.delete(completedToolRequests.keys().next().value);
}

async function listTabs(args = {}) {
  const query = {};
  if (Number.isInteger(args.window_id)) query.windowId = args.window_id;
  const tabs = await chrome.tabs.query(query);
  const results = await Promise.all(tabs.map(async (tab) => ({
    tab_id: tab.id,
    window_id: tab.windowId,
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    title: String(tab.title || "").slice(0, 1_000),
    url: safeHttpUrl(tab.url),
    origin: httpOrigin(tab.url),
    authorized: tab.id ? await hasTabAccess(tab) : false,
  })));
  return { profile_id: profileId, tabs: results.filter((tab) => tab.url) };
}

async function readPage(tabId, options = {}) {
  return pageRequest(tabId, { type: "read.page", options });
}

async function navigateTab(tabId, urlValue) {
  const tab = await requireAuthorizedTab(tabId);
  const url = safeHttpUrl(urlValue);
  if (!url) throw extensionError("CHROME_URL_UNSUPPORTED", "Chrome navigation only accepts HTTP or HTTPS URLs.", "policy", false);
  const before = { tab_id: tab.id, url: safeHttpUrl(tab.url), title: tab.title || null };
  await chrome.tabs.update(tab.id, { url });
  const after = await waitForTabReady(tab.id, 30_000);
  return { action: "navigate", before, after: { tab_id: after.id, url: safeHttpUrl(after.url), title: after.title || null }, changed: before.url !== safeHttpUrl(after.url), verified_at: new Date().toISOString() };
}

async function actionRequest(tabId, message) {
  const tab = await requireAuthorizedTab(tabId);
  const beforeTabs = new Set((await chrome.tabs.query({ windowId: tab.windowId })).map((entry) => entry.id));
  const result = await pageRequest(tab.id, message);
  const afterTabs = await chrome.tabs.query({ windowId: tab.windowId });
  return {
    ...result,
    created_tabs: afterTabs.filter((entry) => !beforeTabs.has(entry.id)).map((entry) => ({ tab_id: entry.id, url: safeHttpUrl(entry.url), title: entry.title || null })),
  };
}

async function prepareDownload(tabId, urlValue, filenameValue) {
  const tab = await requireAuthorizedTab(tabId);
  const url = safeHttpUrl(urlValue);
  if (!url) throw extensionError("CHROME_URL_UNSUPPORTED", "Chrome downloads only accept HTTP or HTTPS URLs.", "policy", false);
  return {
    prepared: true,
    action: "download",
    tab_id: tab.id,
    url,
    filename: safeDownloadFilename(filenameValue),
    page_url: safeHttpUrl(tab.url),
    prepared_at: new Date().toISOString(),
  };
}

async function commitPreparedAction(request) {
  const preparedTool = String(request.payload?.prepared_tool || "");
  const args = request.payload?.original_arguments || {};
  const preview = request.payload?.prepared_preview || {};
  if (preparedTool === "prepare_external_action") {
    return actionRequest(args.tab_id, {
      type: "action.external.commit",
      action: args.action,
      target: args.target,
      expectedSignature: preview.target_signature,
    });
  }
  if (preparedTool === "upload_file") return commitUpload(args, preview, request.payload?.authorized_artifact);
  if (preparedTool === "download") return commitDownload(args, preview);
  throw extensionError("CHROME_PREPARED_TOOL_INVALID", "The prepared Chrome operation is not supported.", "protocol", false);
}

async function commitDownload(args, preview) {
  await requireAuthorizedTab(args.tab_id);
  const url = safeHttpUrl(args.url);
  if (!url || url !== preview.url) throw extensionError("CHROME_DOWNLOAD_CHANGED", "The download URL changed after approval.", "policy", false);
  if (!await chrome.permissions.contains({ permissions: ["downloads"] })) {
    throw extensionError("CHROME_DOWNLOAD_PERMISSION_REQUIRED", "Enable one-time Downloads access in the Haolo Chrome side panel, then retry.", "policy", true);
  }
  try {
    const downloadId = await chrome.downloads.download({ url, filename: safeDownloadFilename(args.filename) || undefined, saveAs: false });
    return { action: "download", committed: true, download_id: downloadId, url, filename: safeDownloadFilename(args.filename), committed_at: new Date().toISOString() };
  } finally {
    await chrome.permissions.remove({ permissions: ["downloads"] }).catch(() => false);
  }
}

async function commitUpload(args, preview, authorizedArtifact) {
  const tab = await requireAuthorizedTab(args.tab_id);
  const marker = String(preview?.marker || "");
  const artifactId = String(args.artifact_id || "");
  const artifactPath = String(authorizedArtifact?.path || "");
  if (!marker || String(authorizedArtifact?.artifact_id || "") !== artifactId || !isAbsoluteWindowsFilePath(artifactPath)) {
    throw extensionError("CHROME_ARTIFACT_NOT_GRANTED", "The approved local artifact is missing or does not match this operation.", "policy", false);
  }
  if (!await chrome.permissions.contains({ permissions: ["debugger"] })) {
    throw extensionError("CHROME_DEBUGGER_PERMISSION_REQUIRED", "Enable one-time File upload access in the Haolo Chrome side panel, then retry.", "policy", true);
  }
  const debuggee = { tabId: tab.id };
  let attached = false;
  try {
    await chrome.debugger.attach(debuggee, "1.3");
    attached = true;
    await chrome.debugger.sendCommand(debuggee, "DOM.enable");
    const documentNode = await chrome.debugger.sendCommand(debuggee, "DOM.getDocument", { depth: -1, pierce: true });
    const match = await chrome.debugger.sendCommand(debuggee, "DOM.querySelector", {
      nodeId: documentNode.root.nodeId,
      selector: `[data-haolo-upload-token="${marker}"]`,
    });
    if (!match?.nodeId) throw extensionError("CHROME_UPLOAD_TARGET_CHANGED", "The approved file input is no longer available.", "execution", false);
    await chrome.debugger.sendCommand(debuggee, "DOM.setFileInputFiles", { files: [artifactPath], nodeId: match.nodeId });
  } finally {
    if (attached) await chrome.debugger.detach(debuggee).catch(() => {});
    await chrome.permissions.remove({ permissions: ["debugger"] }).catch(() => false);
  }
  const result = await pageRequest(tab.id, { type: "action.upload.complete", marker });
  return { ...result, artifact_id: artifactId, committed: true };
}

async function readHistoryOnce(args) {
  if (!await chrome.permissions.contains({ permissions: ["history"] })) {
    throw extensionError("CHROME_HISTORY_PERMISSION_REQUIRED", "Enable one-time History access in the Haolo Chrome side panel, then retry.", "policy", true);
  }
  try {
    const maxResults = Math.max(1, Math.min(50, Number(args.max_results || 20)));
    const results = await chrome.history.search({ text: String(args.query || "").slice(0, 500), maxResults, startTime: 0 });
    return {
      query: String(args.query || "").slice(0, 500),
      results: results.slice(0, maxResults).map((entry) => ({
        title: String(entry.title || "").slice(0, 1_000),
        url: safeHttpUrl(entry.url),
        last_visit_time: Number(entry.lastVisitTime || 0),
        visit_count: Math.max(0, Number(entry.visitCount || 0)),
        typed_count: Math.max(0, Number(entry.typedCount || 0)),
      })).filter((entry) => entry.url),
      permission_revoked: true,
    };
  } finally {
    await chrome.permissions.remove({ permissions: ["history"] }).catch(() => false);
  }
}

function waitForTabReady(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(extensionError("CHROME_NAVIGATION_TIMEOUT", "Chrome navigation did not finish before the timeout.", "timeout", true)), timeoutMs);
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish(null, tab);
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish(null, tab);
    }).catch(() => {});
    function finish(error, tab) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve(tab);
    }
  });
}

async function pageRequest(tabId, message) {
  const tab = await requireAuthorizedTab(tabId);
  await ensurePageAgent(tab.id);
  if (message.type === "read.page") return readAllFrames(tab, message);
  if (message.type === "read.selection") return readSelectionFromFrames(tab, message);
  const frameId = frameIdFromMessage(message);
  const response = await chrome.tabs.sendMessage(tab.id, { source: "haolo-extension", ...message }, frameId === null ? undefined : { frameId });
  if (!response?.ok) throw extensionError(
    response?.error?.code || "CHROME_PAGE_AGENT_ERROR",
    response?.error?.message || "The page agent could not complete the request.",
    response?.error?.category || "execution",
    Boolean(response?.error?.retryable),
  );
  return response.payload;
}

async function readAllFrames(tab, message) {
  const frames = await authorizedFrames(tab);
  const snapshots = [];
  for (const frame of frames) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { source: "haolo-extension", ...message }, { frameId: frame.frameId });
      if (response?.ok) snapshots.push(response.payload);
    } catch {}
  }
  if (!snapshots.length) throw extensionError("CHROME_PAGE_AGENT_UNAVAILABLE", "No authorized page frame responded.", "execution", true);
  const top = snapshots.find((snapshot) => snapshot.frameId === 0) || snapshots[0];
  const remainingChars = Math.max(0, Number(message.options?.maxChars || 24_000) - String(top.text || "").length);
  const frameText = snapshots.filter((snapshot) => snapshot !== top).map((snapshot) => `[Frame ${snapshot.frameId}]\n${snapshot.text || ""}`).join("\n").slice(0, remainingChars);
  return {
    ...top,
    text: [top.text, frameText].filter(Boolean).join("\n"),
    truncated: Boolean(top.truncated || snapshots.some((snapshot) => snapshot.truncated) || frameText.length >= remainingChars),
    headings: snapshots.flatMap((snapshot) => snapshot.headings || []).slice(0, 100),
    elements: snapshots.flatMap((snapshot) => snapshot.elements || []).slice(0, 500),
    links: snapshots.flatMap((snapshot) => snapshot.links || []).slice(0, 250),
    forms: snapshots.flatMap((snapshot) => snapshot.forms || []).slice(0, 100),
    frames: snapshots.map((snapshot) => ({ frame_id: snapshot.frameId, top: snapshot.topFrame, url: snapshot.url, title: snapshot.title })),
  };
}

async function readSelectionFromFrames(tab, message) {
  const frames = await authorizedFrames(tab);
  for (const frame of frames) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { source: "haolo-extension", ...message }, { frameId: frame.frameId });
      if (response?.ok && response.payload?.text) return { ...response.payload, frame_id: frame.frameId };
    } catch {}
  }
  return { trust: "untrusted_web_content", instructionAuthority: "none", url: safeHttpUrl(tab.url), text: "", collapsed: true, frame_id: 0 };
}

async function authorizedFrames(tab) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
  const allowed = [];
  for (const frame of frames) {
    const origin = httpOrigin(frame.url);
    if (!origin) {
      if (frame.frameId === 0) allowed.push(frame);
      continue;
    }
    if (temporaryOrigins.get(tab.id) === origin || await chrome.permissions.contains({ origins: [`${origin}/*`] })) allowed.push(frame);
  }
  if (!allowed.some((frame) => frame.frameId === 0)) allowed.unshift({ frameId: 0, url: tab.url });
  return allowed;
}

function frameIdFromMessage(message) {
  const elementId = String(message?.target?.element_id || message?.condition?.target?.element_id || "");
  const match = /^hf_(\d+)_/.exec(elementId);
  return match ? Number(match[1]) : null;
}

async function captureView(tabId) {
  const tab = await requireAuthorizedTab(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  if (!dataUrl || dataUrl.length > 12 * 1024 * 1024) {
    throw extensionError("CHROME_SCREENSHOT_TOO_LARGE", "The visible page capture exceeds the 12 MiB limit.", "execution", false);
  }
  return { tab_id: tab.id, url: safeHttpUrl(tab.url), mime_type: "image/png", data_url: dataUrl };
}

async function startTask(promptValue) {
  const prompt = String(promptValue || "").trim();
  if (!prompt || prompt.length > 20_000) throw extensionError("CHROME_TASK_PROMPT_INVALID", "请输入 1 到 20000 个字符的任务。", "validation", false);
  const sourceTab = await activeTab();
  if (!sourceTab?.id) throw extensionError("CHROME_TAB_MISSING", "没有可用的当前标签页。", "routing", true);
  await requireAuthorizedTab(sourceTab.id);
  const taskSurface = await createTaskTab(sourceTab);
  const tab = taskSurface.tab;
  const snapshot = await readPage(tab.id, { maxChars: 12_000, includeLinks: true, includeForms: true });
  const taskId = randomId("chrome_task");
  const tabStatus = await currentTabStatus();
  activeTasks.set(taskId, {
    tabId: tab.id,
    sourceTabId: sourceTab.id,
    groupId: taskSurface.groupId,
    isolated: taskSurface.isolated,
    origin: httpOrigin(tab.url),
    temporary: temporaryOrigins.has(tab.id),
    startedAt: Date.now(),
  });
  await sendNative({
    protocolVersion: PROTOCOL_VERSION,
    type: "extension.task.start",
    requestId: randomId("task"),
    sessionId,
    profileId,
    taskId,
    payload: {
      taskId,
      prompt,
      permissionMode: tabStatus.mode,
      tab: { tabId: tab.id, sourceTabId: sourceTab.id, groupId: taskSurface.groupId, isolated: taskSurface.isolated, windowId: tab.windowId, title: tab.title || null, url: safeHttpUrl(tab.url), origin: httpOrigin(tab.url) },
      snapshot,
    },
  });
  return { taskId, tabId: tab.id, title: tab.title || null };
}

async function cancelTask(taskIdValue) {
  const taskId = String(taskIdValue || "");
  const task = activeTasks.get(taskId);
  activeTasks.delete(taskId);
  if (task?.temporary && temporaryOrigins.get(task.tabId) === task.origin) await revokeTemporaryAccess(task.tabId, task.origin);
  if (task?.isolated && task.tabId) await chrome.tabs.remove(task.tabId).catch(() => {});
  return { task_id: taskId, cancelled: Boolean(task) };
}

async function createTaskTab(sourceTab) {
  let duplicate = null;
  let movedTemporaryOrigin = null;
  try {
    duplicate = await chrome.tabs.duplicate(sourceTab.id);
    if (!duplicate?.id) throw new Error("Chrome did not return a duplicated tab.");
    const origin = httpOrigin(sourceTab.url);
    if (origin && temporaryOrigins.get(sourceTab.id) === origin) {
      temporaryOrigins.delete(sourceTab.id);
      temporaryOrigins.set(duplicate.id, origin);
      movedTemporaryOrigin = origin;
    }
    await chrome.tabs.update(duplicate.id, { active: true });
    const ready = await waitForTabReady(duplicate.id, 30_000);
    const groupId = await chrome.tabs.group({ tabIds: [duplicate.id] });
    await chrome.tabGroups.update(groupId, { title: "Haolo", color: "purple", collapsed: false });
    return { tab: ready, groupId, isolated: true };
  } catch (error) {
    if (duplicate?.id) {
      temporaryOrigins.delete(duplicate.id);
      await chrome.tabs.remove(duplicate.id).catch(() => {});
    }
    if (movedTemporaryOrigin) temporaryOrigins.set(sourceTab.id, movedTemporaryOrigin);
    throw extensionError("CHROME_TASK_TAB_CREATE_FAILED", `无法创建独立的 Haolo 任务标签页：${error?.message || error}`, "execution", true);
  }
}

async function createBrokerTaskSurface(request) {
  const sourceTabId = Number(request.payload?.tabId);
  const taskId = String(request.taskId || request.payload?.taskId || randomId("chrome_task"));
  const sourceTab = await requireAuthorizedTab(sourceTabId);
  const existing = activeTasks.get(taskId);
  if (existing?.tabId) {
    const existingTab = await chrome.tabs.get(existing.tabId).catch(() => null);
    if (existingTab) return { task_id: taskId, reused: true, tab: taskTabPayload(existingTab, existing) };
  }
  const surface = await createTaskTab(sourceTab);
  const task = {
    tabId: surface.tab.id,
    sourceTabId: sourceTab.id,
    groupId: surface.groupId,
    isolated: surface.isolated,
    origin: httpOrigin(surface.tab.url),
    temporary: temporaryOrigins.has(surface.tab.id),
    startedAt: Date.now(),
  };
  activeTasks.set(taskId, task);
  return { task_id: taskId, reused: false, tab: taskTabPayload(surface.tab, task) };
}

function taskTabPayload(tab, task) {
  return {
    tab_id: tab.id,
    source_tab_id: task.sourceTabId,
    window_id: tab.windowId,
    group_id: task.groupId,
    isolated: Boolean(task.isolated),
    title: tab.title || null,
    url: safeHttpUrl(tab.url),
    origin: httpOrigin(tab.url),
  };
}

async function currentTabStatus() {
  const tab = await activeTab();
  const origin = httpOrigin(tab?.url);
  if (!tab?.id || !origin) {
    return { supported: false, authorized: false, tabId: tab?.id || null, title: tab?.title || null, url: null, origin: null, mode: "none" };
  }
  const persistent = await chrome.permissions.contains({ origins: [`${origin}/*`] });
  const temporary = temporaryOrigins.get(tab.id) === origin;
  return {
    supported: true,
    authorized: persistent || temporary,
    tabId: tab.id,
    windowId: tab.windowId,
    title: String(tab.title || "").slice(0, 1_000),
    url: safeHttpUrl(tab.url),
    origin,
    mode: temporary ? "once" : persistent ? "site" : "none",
  };
}

async function capabilityStatus() {
  const entries = await Promise.all(["downloads", "history", "debugger"].map(async (capability) => [
    capability,
    await chrome.permissions.contains({ permissions: [capability] }),
  ]));
  return Object.fromEntries(entries);
}

async function requestCapability(capabilityValue) {
  const capability = String(capabilityValue || "");
  if (!["downloads", "history", "debugger"].includes(capability)) {
    throw extensionError("CHROME_CAPABILITY_INVALID", "Unknown optional Chrome capability.", "validation", false);
  }
  const granted = await chrome.permissions.request({ permissions: [capability] });
  if (!granted) throw extensionError("CHROME_CAPABILITY_DENIED", "The requested Chrome capability was not granted.", "policy", false);
  return true;
}

async function requestCurrentSiteAccess(modeValue) {
  const mode = modeValue === "once" ? "once" : modeValue === "site" ? "site" : null;
  if (!mode) throw extensionError("CHROME_PERMISSION_MODE_INVALID", "Unknown site permission mode.", "validation", false);
  const tab = await activeTab();
  const origin = httpOrigin(tab?.url);
  if (!tab?.id || !origin) throw extensionError("CHROME_URL_UNSUPPORTED", "Haolo 只能访问 HTTP 或 HTTPS 页面。", "policy", false);
  const pattern = `${origin}/*`;
  const alreadyGranted = await chrome.permissions.contains({ origins: [pattern] });
  if (!alreadyGranted) {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) throw extensionError("CHROME_SITE_PERMISSION_DENIED", "你没有授予当前网站的访问权限。", "policy", false);
  }
  if (mode === "once" && (!alreadyGranted || hasTemporaryOrigin(origin))) temporaryOrigins.set(tab.id, origin);
  if (mode === "site") clearTemporaryOrigin(origin);
  await ensurePageAgent(tab.id);
  void notifySitePermission({ tabId: tab.id, origin, mode, decision: "allow" });
  return currentTabStatus();
}

async function hasTabAccess(tab) {
  const origin = httpOrigin(tab?.url);
  if (!tab?.id || !origin) return false;
  if (temporaryOrigins.get(tab.id) === origin) return true;
  if (hasTemporaryOrigin(origin)) return false;
  return chrome.permissions.contains({ origins: [`${origin}/*`] });
}

async function revokeTemporaryAccess(tabId, origin) {
  if (temporaryOrigins.get(tabId) !== origin) return false;
  temporaryOrigins.delete(tabId);
  if (!hasTemporaryOrigin(origin)) await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => false);
  void notifySitePermission({ tabId, origin, mode: "none", decision: "prompt" });
  return true;
}

function hasTemporaryOrigin(origin) {
  return [...temporaryOrigins.values()].includes(origin);
}

function clearTemporaryOrigin(origin) {
  for (const [tabId, temporaryOrigin] of temporaryOrigins) {
    if (temporaryOrigin === origin) temporaryOrigins.delete(tabId);
  }
}

async function notifySitePermission({ tabId, origin, mode, decision }) {
  await sendNative({
    protocolVersion: PROTOCOL_VERSION,
    type: "extension.site.permission",
    requestId: randomId("site"),
    sessionId,
    profileId,
    payload: { tabId, origin, mode, decision },
  }).catch(() => {});
}

async function requireAuthorizedTab(tabIdValue) {
  const tabId = Number(tabIdValue);
  if (!Number.isInteger(tabId) || tabId < 0) throw extensionError("CHROME_TAB_INVALID", "A valid tab id is required.", "validation", false);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw extensionError("CHROME_TAB_MISSING", "The requested Chrome tab no longer exists.", "routing", true);
  if (!httpOrigin(tab.url)) throw extensionError("CHROME_URL_UNSUPPORTED", "Haolo can only access HTTP or HTTPS pages.", "policy", false);
  if (!await hasTabAccess(tab)) throw extensionError("CHROME_SITE_PERMISSION_REQUIRED", "This site has not been authorized in the Haolo Chrome panel.", "policy", false);
  return tab;
}

async function ensurePageAgent(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { source: "haolo-extension", type: "read.selection" });
    if (response?.ok) return;
  } catch {}
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["page-agent.js"] });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function httpOrigin(value) {
  try {
    const parsed = new URL(String(value || ""));
    return /^https?:$/.test(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!/^https?:$/.test(parsed.protocol)) return null;
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeDownloadFilename(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const normalized = text.replace(/\\/g, "/").split("/").filter((part) => part && part !== "." && part !== "..").join("/");
  return normalized.slice(0, 240) || null;
}

function isAbsoluteWindowsFilePath(value) {
  const text = String(value || "");
  return !text.includes("\0") && (/^[a-zA-Z]:\\/.test(text) || /^\\\\[^\\]+\\[^\\]+/.test(text));
}

function extensionError(code, message, category, retryable) {
  const error = new Error(message);
  error.code = code;
  error.category = category;
  error.retryable = retryable;
  return error;
}

Object.defineProperty(globalThis, "__haoloReadOnlyDiagnostics", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: Object.freeze({
    readPage,
    invoke(tool, args = {}) {
      return dispatchToolCall({ payload: { tool: String(tool || ""), arguments: args } });
    },
    invokePrepared(preparedTool, originalArguments, preparedPreview, authorizedArtifact = null) {
      return dispatchToolCall({
        payload: {
          tool: "commit_external_action",
          arguments: { operation_id: "diagnostic", approval_token: "diagnostic" },
          prepared_tool: preparedTool,
          original_arguments: originalArguments,
          prepared_preview: preparedPreview,
          authorized_artifact: authorizedArtifact,
        },
      });
    },
    authorizeTemporaryTab(tabId, origin) {
      temporaryOrigins.set(Number(tabId), String(origin));
    },
  }),
});

function sendNative(message) {
  if (!nativePort || connectionState !== CONNECTION_STATES.CONNECTED) {
    const error = new Error("Haolo Native Host is not connected.");
    error.code = "CHROME_NATIVE_HOST_DISCONNECTED";
    error.category = "transport";
    error.retryable = true;
    return Promise.reject(error);
  }
  nativePort.postMessage({ ...message, sessionId, profileId });
  return Promise.resolve();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(30_000, 500 * (2 ** reconnectAttempt));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureNativeConnection(true);
  }, delay);
}

function setConnectionState(state, error = null) {
  connectionState = state;
  connectionError = error;
  broadcast({ type: "connection.status", payload: publicConnectionStatus() });
}

function publicConnectionStatus() {
  return {
    state: connectionState,
    profileId,
    sessionId,
    extensionVersion: chrome.runtime.getManifest().version,
    error: connectionError,
  };
}

function broadcast(message) {
  for (const port of listeners) {
    try { port.postMessage(message); } catch { listeners.delete(port); }
  }
}
