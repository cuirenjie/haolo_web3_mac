export const DEV_SOURCE_UPDATED_MESSAGE = "haolo:dev-source-updated";
export const DEV_RESTART_REQUEST_MESSAGE = "haolo:dev-restart-request";
export const DEV_RESTART_ACK_MESSAGE = "haolo:dev-restart-ack";
export const DEV_UPDATE_PROMPT_READY_MESSAGE = "haolo:dev-update-prompt-ready";
export const DEV_MANUAL_RESTART_ENV = "HAOLO_DESKTOP_MANUAL_RESTART";

let restartRequestSequence = 0;

export function isManualDevelopmentRestartEnabled({
  env = process.env,
  isPackaged = false,
  isDefaultApp = Boolean(process.defaultApp),
} = {}) {
  // A branded copy of Electron has a non-standard executable name, which
  // makes app.isPackaged true even when it is still loading the project as
  // the default Electron app (for example, `haolo_desktop_dev-*.exe .`).
  if (isPackaged && !isDefaultApp) return false;
  if (env?.[DEV_MANUAL_RESTART_ENV] !== "1") return false;
  return Boolean(
    env?.HAOLO_DESKTOP_DEV_SERVER_URL ||
      env?.CODEX_DESKTOP_DEV_SERVER_URL ||
      env?.YOULE_DESKTOP_DEV_SERVER_URL,
  );
}

export function installDevelopmentSourceUpdatePrompt({
  app,
  env = process.env,
  messageTarget = process,
  requestRestart = () => requestDevelopmentRestart(messageTarget),
  requestConfirmation = async () => false,
  showNotice = async () => {},
} = {}) {
  const enabled = isManualDevelopmentRestartEnabled({
    env,
    isPackaged: Boolean(app?.isPackaged),
    isDefaultApp: Boolean(messageTarget?.defaultApp),
  });
  if (!enabled) {
    return { enabled: false, dispose() {} };
  }

  let disposed = false;
  let promptActive = false;
  const pendingFiles = new Set();

  const handleMessage = (message) => {
    if (message?.type !== DEV_SOURCE_UPDATED_MESSAGE) return;
    for (const filePath of message.changedFiles || []) {
      if (filePath) pendingFiles.add(String(filePath));
    }
    if (promptActive || disposed) return;
    promptActive = true;
    void showRestartPrompt().finally(() => {
      pendingFiles.clear();
      promptActive = false;
    });
  };

  messageTarget.on?.("message", handleMessage);
  try {
    messageTarget.send?.({ type: DEV_UPDATE_PROMPT_READY_MESSAGE }, () => {});
  } catch {
    // The launcher may already be gone; restart requests will show a warning.
  }

  async function showRestartPrompt() {
    const changedFiles = [...pendingFiles];
    const detailLines = changedFiles
      .slice(0, 6)
      .map((filePath) => `• ${filePath}`);
    if (changedFiles.length > detailLines.length) {
      detailLines.push(
        `• 另有 ${changedFiles.length - detailLines.length} 个文件`,
      );
    }
    const approved = await requestConfirmation({
      title: "开发代码已更新",
      message: "检测到代码更新，是否重启开发客户端？",
      detail: [
        "当前客户端不会自动刷新，选择“稍后”可继续保留现有测试状态。",
        detailLines.length ? `\n本次变化：\n${detailLines.join("\n")}` : "",
      ].join(""),
      confirmLabel: "立即重启",
      cancelLabel: "稍后",
    });
    if (!approved || disposed) return;

    const accepted = await requestRestart();
    if (accepted) {
      app.quit();
      return;
    }
    await showNotice({
      title: "无法自动重启",
      message: "开发启动器连接已断开",
      detail: "请回到开发终端手动停止并重新运行 pnpm dev。",
      confirmLabel: "知道了",
    });
  }

  return {
    enabled: true,
    dispose() {
      if (disposed) return;
      disposed = true;
      messageTarget.off?.("message", handleMessage);
    },
  };
}

export function requestDevelopmentRestart(
  messageTarget = process,
  options = {},
) {
  const timeoutMs = Math.max(250, Number(options.timeoutMs) || 3000);
  if (
    typeof messageTarget?.send !== "function" ||
    messageTarget.connected === false
  ) {
    return Promise.resolve(false);
  }
  const requestId = `${process.pid}-${Date.now()}-${++restartRequestSequence}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      messageTarget.off?.("message", handleAck);
      resolve(Boolean(accepted));
    };
    const handleAck = (message) => {
      if (
        message?.type !== DEV_RESTART_ACK_MESSAGE ||
        message.requestId !== requestId
      )
        return;
      finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    messageTarget.on?.("message", handleAck);
    try {
      messageTarget.send(
        {
          type: DEV_RESTART_REQUEST_MESSAGE,
          requestId,
        },
        (error) => {
          if (error) finish(false);
        },
      );
    } catch {
      finish(false);
    }
  });
}
