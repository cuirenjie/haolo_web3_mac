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
  button.addEventListener("click", () => {
    const capability = button.dataset.capability;
    button.disabled = true;
    renderCapabilityFeedback("loading", "正在请求 Chrome 的一次性权限…");
    port.postMessage({ type: "capability.request", payload: { capability } });
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
  if (!prompt) return;
  sendButton.disabled = true;
  promptInput.disabled = true;
  renderTaskFeedback("loading", "正在把当前页面和任务安全地发送到 Haolo…");
  port.postMessage({ type: "task.start", payload: { prompt } });
});

function handleMessage(message) {
  if (message?.type === "connection.status") renderConnection(message.payload || {});
  if (message?.type === "connection.error") renderConnection({ state: "error", error: message.payload });
  if (message?.type === "tab.status") renderTabStatus(message.payload || {});
  if (message?.type === "capabilities.status") renderCapabilities(message.payload || {});
  if (message?.type === "capability.error") {
    for (const button of capabilityButtons) button.disabled = false;
    renderCapabilityFeedback("error", message.payload?.message || "无法启用该 Chrome 权限。");
  }
  if (message?.type === "permission.error") {
    setPermissionBusy(false);
    renderTaskFeedback("error", message.payload?.message || "无法授权当前网站。");
  }
  if (message?.type === "page.preview") renderPreview(message.payload || {});
  if (message?.type === "page.error") {
    setPermissionBusy(false);
    renderTaskFeedback("error", message.payload?.message || "无法读取当前页面。");
  }
  if (message?.type === "task.accepted") {
    promptInput.value = "";
    renderTaskFeedback("success", `任务已发送到 Haolo · ${shortId(message.payload?.taskId)}`);
    updateComposerState();
  }
  if (message?.type === "task.error") {
    renderTaskFeedback("error", message.payload?.message || "无法把任务发送到 Haolo。");
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
    label.textContent = granted ? "已就绪 · 使用后自动撤销" : "未启用";
    button.textContent = granted ? "已启用" : "启用一次";
    button.disabled = granted;
  }
  if (Object.values(status).some(Boolean)) renderCapabilityFeedback("success", "高级权限已就绪，只会用于下一次已批准的对应动作。");
  else capabilityFeedback.hidden = true;
}

function renderCapabilityFeedback(state, text) {
  capabilityFeedback.hidden = false;
  capabilityFeedback.dataset.state = state;
  capabilityFeedback.textContent = text;
}

function renderConnection(status) {
  const state = status.state || "disconnected";
  statusDot.dataset.state = state;
  connected = state === "connected";
  updateComposerState();
  retryButton.hidden = connected || state === "connecting";
  profileLabel.textContent = connected ? shortProfile(status.profileId) : "等待连接";
  if (connected) {
    statusTitle.textContent = "Chrome 已连接";
    statusMessage.textContent = "可以读取当前页面；使用站点前仍会请求你的授权。";
  } else if (state === "connecting") {
    statusTitle.textContent = "正在连接 Haolo";
    statusMessage.textContent = "正在检查桌面端和安全连接。";
  } else {
    statusTitle.textContent = "无法连接 Haolo";
    statusMessage.textContent = status.error?.message || "请确认 Haolo 桌面端已经安装并正在运行。";
  }
}

function renderTabStatus(status) {
  setPermissionBusy(false);
  authorized = Boolean(status.authorized);
  siteTitle.textContent = status.title || (status.supported ? "当前网站" : "此页面不可访问");
  siteOrigin.textContent = status.origin || "Chrome 内部页面不会开放给 Haolo";
  siteBadge.dataset.state = status.authorized ? "allowed" : status.supported ? "blocked" : "unsupported";
  siteBadge.textContent = status.authorized ? (status.mode === "once" ? "本次已允许" : "已允许") : status.supported ? "未授权" : "不支持";
  siteMessage.textContent = status.authorized
    ? (status.mode === "once" ? "仅在当前任务期间读取此标签页，任务结束后授权会失效。" : "Haolo 可在你发起任务时读取此网站；敏感输入值仍会被排除。")
    : status.supported ? "选择授权范围后，Haolo 才能读取页面并开始任务。" : "出于安全原因，chrome://、扩展页、文件和开发者工具页面始终拒绝访问。";
  permissionActions.hidden = !status.supported || status.authorized;
  previewButton.hidden = !status.authorized;
  if (!status.authorized) previewPanel.hidden = true;
  updateComposerState();
}

function renderPreview(snapshot) {
  setPermissionBusy(false);
  previewPanel.hidden = false;
  previewMeta.textContent = `${snapshot.elements?.length || 0} 个可交互元素${snapshot.truncated ? " · 已截断" : ""}`;
  previewText.textContent = String(snapshot.text || "此页面没有可读取的可见文本。").slice(0, 1_200);
}

function requestPermission(mode) {
  setPermissionBusy(true);
  renderTaskFeedback("loading", mode === "once" ? "正在申请本次访问权限…" : "正在申请此网站的持续访问权限…");
  port.postMessage({ type: "permission.request", payload: { mode } });
}

function setPermissionBusy(value) {
  permissionBusy = value;
  allowOnceButton.disabled = value;
  allowSiteButton.disabled = value;
  declineButton.disabled = value;
  previewButton.disabled = value;
}

function updateComposerState() {
  const enabled = connected && authorized;
  promptInput.disabled = !enabled;
  sendButton.disabled = !enabled;
  if (!authorized) profileLabel.textContent = "先授权当前网站";
}

function renderTaskFeedback(state, text) {
  taskFeedback.hidden = false;
  taskFeedback.dataset.state = state;
  taskFeedback.textContent = text;
}

function shortProfile(value) {
  const text = String(value || "");
  return text ? `Profile ${text.slice(-8)}` : "Chrome Profile";
}

function shortId(value) {
  const text = String(value || "");
  return text ? text.slice(-8) : "已接收";
}
