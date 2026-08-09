import type { MessageAttachment } from "./domain";

type Listener<T> = (payload: T) => void;

type MockMessage = {
  id?: string;
  type?: string;
  text?: string;
  attachments?: MessageAttachment[];
  content?: Array<{ text?: string; attachments?: MessageAttachment[] }>;
};

type DesktopApiLike = Window["codexDesktop"];

export function ensureBrowserDesktopApi() {
  if (typeof window.codexDesktop !== "undefined") return;
  document.documentElement.dataset.mockDesktop = "true";

  let notificationListeners: Array<Listener<any>> = [];
  let statusListeners: Array<Listener<any>> = [];
  let serverRequestListeners: Array<Listener<any>> = [];
  let errorListeners: Array<Listener<any>> = [];
  let windowsUpdateDownloadProgressListeners: Array<Listener<any>> = [];

  const session = {
    authenticated: true,
    baseUrl: "https://haolo.com",
    profile: {
      id: "mock-user-001",
      nickname: "浏览器预览用户",
      email: "mock@example.com",
      avatar_url: "",
      avatar_style: "nft-rose",
      level: {
        level: 1,
        icons: [{ type: "egg", count: 1 }],
        current_progress: 0,
        required_progress: 300,
      },
    },
  };

  function mockLevelIcons(level: number) {
    const cappedLevel = Math.max(1, Math.floor(level));
    const weights = [
      { type: "cat_king", value: 8 },
      { type: "cat", value: 4 },
      { type: "egg_cat", value: 2 },
      { type: "egg", value: 1 },
    ];
    const icons: Array<{ type: string; count: number }> = [];
    let remaining = cappedLevel;
    for (const { type, value } of weights) {
      const count = Math.floor(remaining / value);
      if (count > 0) icons.push({ type, count });
      remaining %= value;
    }
    return icons.length ? icons : [{ type: "egg", count: 1 }];
  }

  function advanceMockLevel(delta = 1) {
    const current = typeof session.profile.level?.level === "number" ? session.profile.level.level : 1;
    const next = Math.max(1, current + delta);
    session.profile.level = {
      ...session.profile.level,
      level: next,
      icons: mockLevelIcons(next),
      current_progress: next,
    };
  }

  const threadId = "mock-thread-1";
  let activeThreadModel = "gpt-5.5";
  let activeThreadReasoningEffort = "high";
  const mockConsumptionTurn = {
    id: "mock-turn-1",
    status: "completed",
    items: [
      {
        id: "mock-user-1",
        type: "userMessage",
        createdAt: new Date().toISOString(),
        text: "帮我梳理产品需求",
        content: [{ text: "帮我梳理产品需求" }],
      },
      {
        id: "mock-agent-1",
        type: "agentMessage",
        createdAt: new Date().toISOString(),
        text: "已经完成需求梳理。",
      },
    ],
  };
  let appTheme: "light" | "dark" = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const systemIntegration = {
    taskbar: false,
    startMenu: false,
    startup: false,
    available: {
      taskbar: true,
      startMenu: true,
      startup: true,
    },
  };
  let taskCompletionPopupEnabled = true;
  let promptFavorites: Array<{ id: string; content: string; created_at: string; updated_at: string }> = [];

  const api: DesktopApiLike = {
    async start() {
      queueMicrotask(() => {
        statusListeners.forEach((listener) => listener({ state: "ready", command: "mock-browser", pid: 1, port: 5177 }));
      });
      return { command: "mock-browser", port: 5177, init: {} };
    },
    async getStatus() {
      return { state: "ready" };
    },
    async getDefaults() {
      return {
        cwd: "/mock/workspace",
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        youleApiBaseUrl: "https://haolo.com",
        theme: appTheme,
        taskCompletionPopupEnabled,
      };
    },
    async resolveThreadGroupWorkspace(params: any) {
      const cwd = params?.externalPath || params?.cwd || `/mock/workspace/${params?.workspaceSlug || params?.groupId || "default"}`;
      return { ...params, cwd, path: cwd };
    },
    async listThreadGroupWorkspaces(params: any) {
      const groups = Array.isArray(params?.groups) ? params.groups : [];
      const data = groups.map((group: any) => {
        const cwd = group?.externalPath || group?.cwd || `/mock/workspace/${group?.workspaceSlug || group?.groupId || "default"}`;
        return { ...group, cwd, path: cwd };
      });
      return { data, items: data };
    },
    async openThreadGroupFolder(params: any) {
      return { ok: true, path: params?.externalPath || params?.cwd || "/mock/workspace/default" };
    },
    async pickThreadGroupFolder() {
      return { canceled: false, path: "/mock/imported-folder", name: "imported-folder" };
    },
    async createThreadGroupFolder(params: any) {
      const name = String(params?.name || "new-folder").trim() || "new-folder";
      return { ok: true, path: `/mock/workspace/default/${name}`, name };
    },
    async exportUserData() {
      return { ok: true, operation: "export", exportPath: "/mock/Haolo-user-data.zip" };
    },
    async importUserData() {
      return { ok: true, operation: "import", backupPath: "/mock/backup-before-import" };
    },
    async getUserDataTransferStatus() {
      return null;
    },
    async getSystemIntegrationState() {
      return { ...systemIntegration, available: { ...systemIntegration.available } };
    },
    async setSystemIntegration(params: any) {
      const key = params?.key as "taskbar" | "startMenu" | "startup" | undefined;
      if (key === "taskbar" || key === "startMenu" || key === "startup") {
        systemIntegration[key] = Boolean(params?.enabled);
      }
      return { ...systemIntegration, available: { ...systemIntegration.available } };
    },
    async setTaskCompletionPopupEnabled(params: any) {
      taskCompletionPopupEnabled = params?.enabled !== false;
      return { taskCompletionPopupEnabled };
    },
    async confirmTaskCompletionRendered() {
      return { ok: true, shown: taskCompletionPopupEnabled };
    },
    async setAppTheme(params: any) {
      appTheme = params?.theme === "dark" ? "dark" : "light";
      return { theme: appTheme };
    },
    async checkWindowsUpdate() {
      return {
        current_version: "0.1.103",
        update_available: true,
        force_update: false,
        latest: { version: "0.1.105", release_notes: "暂无更新说明。" },
        download: {
          url: "https://haolo.com/mock-update.exe",
          file_name: "haolo_desktop-0.1.105-Setup.exe",
          size_bytes: 167_600_000,
          sha256: "",
        },
      };
    },
    async downloadWindowsUpdate(params: any) {
      const totalBytes = Number(params?.download?.size_bytes) || 167_600_000;
      for (const percent of [0, 7, 18, 31, 48, 63, 79, 92, 100]) {
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        windowsUpdateDownloadProgressListeners.forEach((listener) =>
          listener({
            fileName: params?.download?.file_name || "haolo_desktop-0.1.105-Setup.exe",
            downloadedBytes: Math.round((totalBytes * percent) / 100),
            totalBytes,
            percent,
          }),
        );
      }
      return { ok: true };
    },
    async getYouleSession() {
      return session;
    },
    async refreshProfile() {
      return session;
    },
    async refreshMemberLevel() {
      return { level: session.profile.level, session };
    },
    async sendActivityHeartbeat(params: any) {
      const delta = Number(params?.onlineSecondsDelta ?? params?.online_seconds_delta ?? 60);
      if (Number.isFinite(delta) && delta > 0) {
        advanceMockLevel(1);
      }
      return { level: session.profile.level, session };
    },
    async reportTaskCompleted() {
      advanceMockLevel(1);
      return { level: session.profile.level, session };
    },
    async reportConsumptionAppEntry() {
      return { ok: true };
    },
    async reportConsumptionEvent() {
      return { ok: true };
    },
    async getConsumptionOverview() {
      return {
        profile: session.profile,
        level: session.profile.level,
        cumulative_tokens: 85_000_000_000,
        cumulative_points: 128.64,
        peak_daily_tokens: 1_040_000_000,
        peak_daily_points: 18.42,
        longest_task_ms: 27_540_000,
        login_days: 15,
      };
    },
    async getConsumptionCalendar(params: any) {
      const month = String(params?.month || new Date().toISOString().slice(0, 7));
      const days = Array.from({ length: 31 }, (_, index) => ({
        date: `${month}-${String(index + 1).padStart(2, "0")}`,
        tokens: (index * 9_100_000) % 130_000_000,
        points: ((index * 91) % 1300) / 100,
        color_level: index % 6,
      }));
      return { month, days };
    },
    async getConsumptionRecords(params: any) {
      const page = Number(params?.page || 1);
      return {
        page,
        page_size: Number(params?.pageSize || 6),
        pages: 2,
        total: 24,
        items: [
          {
            interaction_id: "mock-turn-1",
            conversation_id: threadId,
            started_at: new Date().toISOString(),
            duration_ms: 126000,
            duration_display: "2分6秒",
            duration_label: "任务用时",
            duration_note: "来自客户端上报的任务开始与完成时间",
            usage_event_count: 3,
            tokens: 733000000,
            points: 2.31,
            display_unit: params?.unit || "token",
            models: ["gpt-5.6-sol", "gpt-5.6-terra"],
            type: "Haolo会话",
            task_kind: "task",
            task_kind_label: "主任务",
            status: "complete",
            question: "帮我梳理产品需求",
            answer_excerpt: "已经完成需求梳理。...",
            billing_explanation: "本行汇总 3 次实际模型调用，按输入、输出及缓存 Token 计费。",
          },
        ],
      };
    },
    async exportConsumptionReport(params: any) {
      const unit = params?.unit === "points" ? "积分" : "Token";
      return { ok: true, path: `/mock/好咯使用数据_${unit}.xlsx`, unit: params?.unit || "token" };
    },
    async login() {
      return session;
    },
    async lookupIdentity() {
      return { mode: "login", exists: true };
    },
    async sendOtp() {
      return { challenge_id: "mock-challenge", resend_after: 60, mode: "login" };
    },
    async verifyOtp() {
      return session;
    },
    async completeRegistration() {
      return session;
    },
    async getWechatAuthConfig() {
      return { enabled: false, flow_expires_in: 300, poll_interval_ms: 1500 };
    },
    async startWechatAuthFlow() {
      throw new Error("微信登录在浏览器预览中不可用");
    },
    async getWechatAuthFlowStatus() {
      return { status: "waiting_scan" };
    },
    async exchangeWechatAuthFlow() {
      return { mode: "needs_email", status: "needs_email" };
    },
    async listBusinessModelPools() {
      return {
        configured: false,
        catalogVersion: 0,
        updatedAt: null,
        pools: [],
        source: "browser-mock",
      };
    },
    async listVideoExpertModels() {
      return {
        object: "list",
        catalog_version: 1,
        default_model: "grok-imagine-video-1.5",
        models: [
          {
            id: "grok-imagine-video-1.5",
            display_name: "Grok Imagine Video 1.5",
            input_mode: "text-or-image-to-video",
            required_image_count: 0,
            max_image_count: 1,
            required_video_count: 0,
            max_video_count: 0,
            screen_sizes: [
              { value: "16:9", label: "横屏 16:9", resolution: "720p" },
              { value: "9:16", label: "竖屏 9:16", resolution: "720p" },
              { value: "1:1", label: "方形 1:1", resolution: "720p" },
              { value: "4:3", label: "横向 4:3", resolution: "720p" },
              { value: "3:4", label: "竖向 3:4", resolution: "720p" },
              { value: "2:3", label: "竖向 2:3", resolution: "720p" },
              { value: "3:2", label: "横向 3:2", resolution: "720p" },
            ],
            durations: Array.from({ length: 15 }, (_, index) => ({
              value: String(index + 1),
              label: `${index + 1}秒`,
            })),
            default_screen_size: "16:9",
            default_duration: "6",
            default_resolution: "720p",
          },
        ],
      };
    },
    async logout() {
      return { authenticated: false, baseUrl: "https://haolo.com", profile: null };
    },
    async patchProfile(params: any) {
      if (params?.nickname) {
        session.profile.nickname = params.nickname;
      }
      return session;
    },
    async listPromptFavorites(params: any = {}) {
      const offset = Math.max(0, Number(params?.offset) || 0);
      const limit = Math.max(1, Number(params?.limit) || 100);
      return { items: promptFavorites.slice(offset, offset + limit), total: promptFavorites.length, limit, offset };
    },
    async createPromptFavorite(params: any) {
      const content = String(params?.content || "").trim();
      if (promptFavorites.some((item) => item.content === content)) throw new Error("该提示词已收藏");
      const now = new Date().toISOString();
      const item = { id: `favorite-${Date.now()}`, content, created_at: now, updated_at: now };
      promptFavorites = [item, ...promptFavorites];
      return item;
    },
    async updatePromptFavorite(params: any) {
      const id = String(params?.promptFavoriteId || "");
      const content = String(params?.content || "").trim();
      if (promptFavorites.some((item) => item.id !== id && item.content === content)) throw new Error("该提示词已收藏");
      const current = promptFavorites.find((item) => item.id === id);
      if (!current) throw new Error("收藏的提示词不存在");
      const item = { ...current, content, updated_at: new Date().toISOString() };
      promptFavorites = [item, ...promptFavorites.filter((candidate) => candidate.id !== id)];
      return item;
    },
    async deletePromptFavorite(params: any) {
      const id = String(params?.promptFavoriteId || "");
      promptFavorites = promptFavorites.filter((item) => item.id !== id);
      return null;
    },
    async listMaterials() {
      return { data: [] };
    },
    async listArtifacts() {
      return { data: [] };
    },
    async uploadMaterialFile(params: any) {
      return {
        attachment: {
          name: params?.name || "mock-file",
          mime: params?.mime || "application/octet-stream",
          size: params?.size || 0,
          object_key: `mock-${Date.now()}`,
          url: params?.mime?.startsWith("image/") ? URL.createObjectURL(new Blob([params.bytes], { type: params.mime })) : "",
          material_id: `material-${Date.now()}`,
        },
        material: {
          id: `material-${Date.now()}`,
          name: params?.name || "mock-file",
          mime: params?.mime || "application/octet-stream",
          url: "",
          size_bytes: params?.size || 0,
        },
      };
    },
    async listAutoTasks() {
      return [];
    },
    async saveAutoTasks(params: any) {
      return params?.tasks || [];
    },
    async previewFile() {
      return null;
    },
    async previewImageFile() {
      return { cancelled: true };
    },
    async localFileInfo() {
      return { path: "", name: "", mime: "application/octet-stream", size: 0 };
    },
    async readLocalFile() {
      return { path: "", name: "", mime: "image/png", size: 0, base64: "" };
    },
    async listThreads() {
      return {
        data: [
          {
            id: threadId,
            name: "浏览器预览会话",
            kind: "main_session",
            preview: "可以直接在这里测试主界面",
            last_message_at: new Date().toISOString(),
          },
        ],
      };
    },
    async modelList() {
      return { data: [{ id: "mock-model" }] };
    },
    async configRead() {
      return { model: "mock-model", cwd: "/mock/workspace" };
    },
    async skillsList() {
      return { cwd: "/mock/workspace", skills: [] };
    },
    async pluginsList() {
      return {
        directory: "/mock/haolo-ai-home/plugins",
        data: [
          {
            id: "mock-documents",
            name: "documents",
            title: "Documents",
            description: "Create and edit document artifacts",
            enabled: true,
            installed: true,
          },
        ],
      };
    },
    async setPluginEnabled(params: any) {
      return { ok: true, ...params };
    },
    async deletePlugin(params: any) {
      return { ok: true, ...params };
    },
    async startThread(params: any = {}) {
      activeThreadModel = String(params.model || activeThreadModel);
      activeThreadReasoningEffort = String(params.reasoningEffort || params.effort || activeThreadReasoningEffort);
      return {
        thread: {
          id: threadId,
          model: activeThreadModel,
          reasoningEffort: activeThreadReasoningEffort,
          serviceTier: null,
        },
        model: activeThreadModel,
        reasoningEffort: activeThreadReasoningEffort,
        serviceTier: null,
      };
    },
    async stageContinuationPrompt(params: any = {}) {
      return { ok: true, transaction: { ...params, status: "ready", targetThreadId: null } };
    },
    async discardSupersededContinuations() {
      return { ok: true, removedCount: 0 };
    },
    async createContinuationThread(params: any = {}) {
      const result = await this.startThread({ ...params, activate: false });
      if (result?.thread && params.name) result.thread.name = params.name;
      return result;
    },
    async listContinuationTransactions() {
      return { data: [] };
    },
    async readThreadForBackgroundHydration() {
      return {
        thread: {
          id: threadId,
          model: activeThreadModel,
          reasoningEffort: activeThreadReasoningEffort,
          serviceTier: null,
          turns: [mockConsumptionTurn],
        },
      };
    },
    async resumeThread() {
      return {
        thread: {
          id: threadId,
          model: activeThreadModel,
          reasoningEffort: activeThreadReasoningEffort,
          serviceTier: null,
          turns: [mockConsumptionTurn],
        },
        model: activeThreadModel,
        reasoningEffort: activeThreadReasoningEffort,
        serviceTier: null,
      };
    },
    async updateThreadSettings(params: any = {}) {
      activeThreadModel = String(params.model || activeThreadModel);
      activeThreadReasoningEffort = String(params.reasoningEffort || params.effort || activeThreadReasoningEffort);
      const threadSettings = {
        model: activeThreadModel,
        effort: activeThreadReasoningEffort,
        serviceTier: null,
      };
      queueMicrotask(() => emitNotification("thread/settings/updated", { threadId, threadSettings }));
      return { changed: true, threadSettings };
    },
    async compactThread() {
      const turnId = `compact-${Date.now()}`;
      queueMicrotask(() => {
        emitNotification("turn/started", { threadId, turn: { id: turnId } });
        emitNotification("item/completed", {
          threadId,
          turnId,
          item: { id: `${turnId}-item`, type: "contextCompaction" },
        });
        emitNotification("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
      });
      return { ok: true };
    },
    async sendMessage(params: any) {
      const text = String(params?.text || "");
      emitNotification("turn/started", { threadId, turn: { id: `turn-${Date.now()}` } });
      if (text.includes("附件")) {
        emitNotification("item/started", { threadId, item: mockItem("userMessage", text) });
      }
      window.setTimeout(() => {
        emitNotification("item/reasoning/textDelta", { threadId, itemId: "reasoning-1", delta: "正在整理思路..." });
      }, 150);
      window.setTimeout(() => {
        emitNotification("item/commandExecution/outputDelta", { threadId, itemId: "tool-1", delta: btoa("tool invoked") });
      }, 300);
      window.setTimeout(() => {
        emitNotification("item/agentMessage/delta", { threadId, itemId: "agent-1", delta: `已收到：${text.slice(0, 20) || "你好"}` });
      }, 450);
      window.setTimeout(() => {
        emitNotification("turn/completed", { threadId, turn: { id: `turn-${Date.now()}` } });
      }, 900);
      return { ok: true };
    },
    async steerTurn() {
      return { ok: true, turnId: `turn-${Date.now()}` };
    },
    async interruptTurn() {
      emitNotification("turn/completed", { threadId, turn: { id: `turn-${Date.now()}` } });
      return { ok: true };
    },
    async respondServerRequest() {
      return { ok: true };
    },
    async openExternal(url: string) {
      window.open(url, "_blank", "noopener,noreferrer");
      return { ok: true };
    },
    async windowControl() {
      return { ok: true, maximized: false, pinned: false };
    },
    async windowResize() {
      return { ok: true };
    },
    onStatus(callback) {
      statusListeners.push(callback);
      return () => {
        statusListeners = statusListeners.filter((listener) => listener !== callback);
      };
    },
    onLog() {
      return () => {};
    },
    onNotification(callback) {
      notificationListeners.push(callback);
      return () => {
        notificationListeners = notificationListeners.filter((listener) => listener !== callback);
      };
    },
    onSkills() {
      return () => {};
    },
    onAutoTasksChanged() {
      return () => {};
    },
    onServerRequest(callback) {
      serverRequestListeners.push(callback);
      return () => {
        serverRequestListeners = serverRequestListeners.filter((listener) => listener !== callback);
      };
    },
    onError(callback) {
      errorListeners.push(callback);
      return () => {
        errorListeners = errorListeners.filter((listener) => listener !== callback);
      };
    },
    onWindowsUpdateDownloadProgress(callback) {
      windowsUpdateDownloadProgressListeners.push(callback);
      return () => {
        windowsUpdateDownloadProgressListeners = windowsUpdateDownloadProgressListeners.filter((listener) => listener !== callback);
      };
    },
    onWindowState() {
      return () => {};
    },
    onOpenSettings() {
      return () => {};
    },
  };

  window.codexDesktop = api;

  function emitNotification(method: string, params: any) {
    notificationListeners.forEach((listener) => listener({ method, params }));
  }
}

function mockItem(type: string, text: string): MockMessage {
  return {
    id: `${type}-${Date.now()}`,
    type,
    text,
    content: [{ text }],
  };
}

