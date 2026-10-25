import { taskMessage, setPanelLanguage, panelLanguage } from "./task-messages.js";
const statusTitle = document.querySelector("#statusTitle");
const statusMessage = document.querySelector("#statusMessage");
const statusDot = document.querySelector("#statusDot");
const retryButton = document.querySelector("#retryButton");
const promptForm = document.querySelector("#promptForm");
const promptInput = document.querySelector("#promptInput");
const sendButton = document.querySelector("#sendButton");
const profileLabel = document.querySelector("#profileLabel");
const siteTitle = document.querySelector("#siteTitle");
const siteOrigin = document.querySelector("#siteOrigin");
const siteBadge = document.querySelector("#siteBadge");
const siteMessage = document.querySelector("#siteMessage");
const permissionActions = document.querySelector("#permissionActions");
const allowOnceButton = document.querySelector("#allowOnceButton");
const allowSiteButton = document.querySelector("#allowSiteButton");
const declineButton = document.querySelector("#declineButton");
const previewButton = document.querySelector("#previewButton");
const previewPanel = document.querySelector("#previewPanel");
const previewMeta = document.querySelector("#previewMeta");
const previewText = document.querySelector("#previewText");
const taskFeedback = document.querySelector("#taskFeedback");
const capabilityFeedback = document.querySelector("#capabilityFeedback");
const capabilityButtons = [...document.querySelectorAll("[data-capability]")];

let connected = false;
let authorized = false;
let permissionBusy = false;
let currentSite = null;
let currentPreview = null;
let taskPending = false;

const staticCopy = [];
const dynamicIds = new Set(['statusTitle','statusMessage','siteTitle','siteOrigin','siteBadge','siteMessage','previewMeta','previewText','profileLabel','taskFeedback','capabilityFeedback']);
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) { const node=walker.currentNode; if (!node.parentElement?.closest('script,style,[data-capability-status]') && !dynamicIds.has(node.parentElement?.id) && node.textContent.trim()) staticCopy.push({node,source:node.textContent}); }
const placeholderSource=promptInput.placeholder;
function localizeStaticCopy(language) {
 setPanelLanguage(language); document.documentElement.lang=panelLanguage();
 for (const {node,source} of staticCopy) node.textContent=source.replace(source.trim(),taskMessage(source.trim()));
 promptInput.placeholder=taskMessage(placeholderSource);
}
localizeStaticCopy();
const port = chrome.runtime.connect({ name: "haolo-sidepanel" });
port.onMessage.addListener(handleMessage);
port.postMessage({ type: "connection.status" });
port.postMessage({ type: "tab.status" });
port.postMessage({ type: "capabilities.status" });

retryButton.addEventListener("click", () => port.postMessage({ type: "connection.retry" }));
allowOnceButton.addEventListener("click", () => requestPermission("once"));
allowSiteButton.addEventListener("click", () => requestPermission("site"));
declineButton.addEventListener("click", () => port.postMessage({ type: "permission.decline" }));
for (const button of capabilityButtons) {
  button.addEventListener("click", async () => {
    const capability = button.dataset.capability;
    button.disabled = true;
    renderCapabilityFeedback("loading", taskMessage("正在请求 Chrome 的一次性权限…"));
    try {
      // Chrome requires permissions.request in the user gesture's UI context.
      const granted = await chrome.permissions.request({ permissions: [capability] });
      if (!granted) throw new Error(taskMessage("你没有授予该 Chrome 权限。"));
      port.postMessage({ type: "capabilities.status" });
    } catch (error) {
      button.disabled = false;
      renderCapabilityFeedback("error", error.message || taskMessage("无法启用该 Chrome 权限。"));
    }
  });
}
addEventListener("focus", () => port.postMessage({ type: "capabilities.status" }));
previewButton.addEventListener("click", () => {
  setPermissionBusy(true);
  port.postMessage({ type: "page.preview" });
});
promptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt || taskPending || !connected || !authorized) return;
  taskPending = true;
  sendButton.disabled = true;
  promptInput.disabled = true;
  renderTaskFeedback("loading", taskMessage("正在把当前页面和任务安全地发送到 Haolo…"));
  port.postMessage({ type: "task.start", payload: { prompt } });
});

function handleMessage(message) {
  if (message?.type === "connection.status") renderConnection(message.payload || {});
  if (message?.type === "connection.error") renderConnection({ state: "error", error: message.payload });
  if (message?.type === "tab.status") renderTabStatus(message.payload || {});
  if (message?.type === "capabilities.status") renderCapabilities(message.payload || {});
  if (message?.type === "capability.error") {
    for (const button of capabilityButtons) button.disabled = false;
    renderCapabilityFeedback("error", message.payload?.message || taskMessage("无法启用该 Chrome 权限。"));
  }
  if (message?.type === "permission.error") {
    setPermissionBusy(false);
    renderTaskFeedback("error", message.payload?.message || taskMessage("无法授权当前网站。"));
  }
  if (message?.type === "page.preview") renderPreview(message.payload || {});
  if (message?.type === "page.error") {
    setPermissionBusy(false);
    renderTaskFeedback("error", message.payload?.message || taskMessage("无法读取当前页面。"));
  }
  if (message?.type === "task.accepted") {
    taskPending = false;
    promptInput.value = "";
    renderTaskFeedback("success", taskMessage("任务已发送到 Haolo · {0}", undefined, [shortId(message.payload?.taskId)]));
    updateComposerState();
  }
  if (message?.type === "task.status") {
    taskPending = false;
    const accepted = message.payload?.state === "accepted";
    renderTaskFeedback(accepted ? "success" : "error", accepted
      ? taskMessage("Haolo 已开始处理，可在桌面端查看进度。")
      : message.payload?.error || taskMessage("Haolo 未能启动任务，请重试。"));
    updateComposerState();
  }
  if (message?.type === "task.error") {
    taskPending = false;
    renderTaskFeedback("error", message.payload?.message || taskMessage("无法把任务发送到 Haolo。"));
    updateComposerState();
  }
}

function renderCapabilities(status) {
  for (const button of capabilityButtons) {
    const capability = button.dataset.capability;
    const granted = Boolean(status[capability]);
    const row = document.querySelector(`[data-capability-row="${capability}"]`);
    const label = document.querySelector(`[data-capability-status="${capability}"]`);
    row.dataset.state = granted ? "ready" : "idle";
    label.textContent = granted ? taskMessage("已就绪 · 使用后自动撤销") : taskMessage("未启用");
    button.textContent = granted ? taskMessage("已启用") : taskMessage("启用一次");
    button.disabled = granted;
  }
  if (Object.values(status).some(Boolean)) renderCapabilityFeedback("success", taskMessage("高级权限已就绪，只会用于下一次已批准的对应动作。"));
  else capabilityFeedback.hidden = true;
}

function renderCapabilityFeedback(state, text) {
  capabilityFeedback.hidden = false;
  capabilityFeedback.dataset.state = state;
  capabilityFeedback.textContent = taskMessage(text);
}

function renderConnection(status) {
  localizeStaticCopy(status.language);
  if (currentSite) renderTabStatus(currentSite);
  if (currentPreview && !previewPanel.hidden) renderPreview(currentPreview);
  if (status.language) port.postMessage({ type: "capabilities.status" });
  const state = status.state || "disconnected";
  statusDot.dataset.state = state;
  connected = state === "connected";
  updateComposerState();
  retryButton.hidden = connected || state === "connecting";
  profileLabel.textContent = connected ? shortProfile(status.profileId) : taskMessage("等待连接");
  if (connected) {
    statusTitle.textContent = taskMessage("Chrome 已连接");
    statusMessage.textContent = taskMessage("可以读取当前页面；使用站点前仍会请求你的授权。");
  } else if (state === "connecting") {
    statusTitle.textContent = taskMessage("正在连接 Haolo");
    statusMessage.textContent = taskMessage("正在检查桌面端和安全连接。");
  } else {
    statusTitle.textContent = taskMessage("无法连接 Haolo");
    statusMessage.textContent = taskMessage(status.error?.message || "") || taskMessage("请确认 Haolo 桌面端已经安装并正在运行。");
  }
}

function renderTabStatus(status) {
  currentSite = status;
  setPermissionBusy(false);
  authorized = Boolean(status.authorized);
  siteTitle.textContent = status.title || (status.supported ? taskMessage("当前网站") : taskMessage("此页面不可访问"));
  siteOrigin.textContent = status.origin || taskMessage("Chrome 内部页面不会开放给 Haolo");
  siteBadge.dataset.state = status.authorized ? "allowed" : status.supported ? "blocked" : "unsupported";
  siteBadge.textContent = status.authorized ? (status.mode === "once" ? taskMessage("本次已允许") : taskMessage("已允许")) : status.supported ? taskMessage("未授权") : taskMessage("不支持");
  siteMessage.textContent = status.authorized
    ? (status.mode === "once" ? taskMessage("仅在当前任务期间读取此标签页，任务结束后授权会失效。") : taskMessage("Haolo 可在你发起任务时读取此网站；敏感输入值仍会被排除。"))
    : status.supported ? taskMessage("选择授权范围后，Haolo 才能读取页面并开始任务。") : taskMessage("出于安全原因，chrome://、扩展页、文件和开发者工具页面始终拒绝访问。");
  permissionActions.hidden = !status.supported || status.authorized;
  previewButton.hidden = !status.authorized;
  if (!status.authorized) previewPanel.hidden = true;
  updateComposerState();
}

function renderPreview(snapshot) {
  currentPreview = snapshot;
  setPermissionBusy(false);
  previewPanel.hidden = false;
  previewMeta.textContent = taskMessage("{0} 个可交互元素{1}", undefined, [snapshot.elements?.length || 0, snapshot.truncated ? taskMessage(" · 已截断") : ""]);
  previewText.textContent = String(snapshot.text || taskMessage("此页面没有可读取的可见文本。")).slice(0, 1_200);
}

async function requestPermission(mode) {
  const site = currentSite;
  if (!site?.supported || !site.origin || permissionBusy) return;
  setPermissionBusy(true);
  renderTaskFeedback("loading", mode === "once" ? taskMessage("正在申请本次访问权限…") : taskMessage("正在申请此网站的持续访问权限…"));
  try {
    const granted = await chrome.permissions.request({ origins: [`${site.origin}/*`] });
    if (!granted) throw new Error(taskMessage("你没有授予当前网站的访问权限。"));
    port.postMessage({ type: "permission.request", payload: {
      mode, tabId: site.tabId, origin: site.origin, previousMode: site.mode,
    } });
  } catch (error) {
    setPermissionBusy(false);
    renderTaskFeedback("error", error.message || taskMessage("无法授权当前网站。"));
  }
}

function setPermissionBusy(value) {
  permissionBusy = value;
  allowOnceButton.disabled = value;
  allowSiteButton.disabled = value;
  declineButton.disabled = value;
  previewButton.disabled = value;
}

function updateComposerState() {
  const enabled = connected && authorized && !taskPending;
  promptInput.disabled = !enabled;
  sendButton.disabled = !enabled;
  if (!authorized) profileLabel.textContent = taskMessage("先授权当前网站");
}

function renderTaskFeedback(state, text) {
  taskFeedback.hidden = false;
  taskFeedback.dataset.state = state;
  taskFeedback.textContent = taskMessage(text);
}

function shortProfile(value) {
  const text = String(value || "");
  return text ? `Profile ${text.slice(-8)}` : "Chrome Profile";
}

function shortId(value) {
  const text = String(value || "");
  return text ? text.slice(-8) : taskMessage("已接收");
}
