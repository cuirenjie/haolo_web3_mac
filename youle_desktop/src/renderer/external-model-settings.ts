import { renderHaoloSelect } from "./haolo-select";

export type ExternalModelBaseUrlOption = {
  id: string;
  label: string;
  baseUrl: string;
  keyConsoleUrl?: string;
  documentationUrl?: string;
};

export type ExternalModelProviderStatus = {
  id: string;
  displayName: string;
  vendor: string;
  protocol: string;
  defaultModel: string;
  model: string;
  baseUrlOptions: ExternalModelBaseUrlOption[];
  baseUrlProfile: string;
  configured: boolean;
  enabled: boolean;
  updatedAt?: string | null;
  secureStorageAvailable: boolean;
  keyConsoleUrl: string;
  documentationUrl: string;
  apiKeyEnvironmentVariable: string;
  connectionTest?: { billable?: boolean };
  capabilities?: {
    roles?: string[];
    toolsEnabled?: boolean;
    localFileAccess?: boolean;
    shellAccess?: boolean;
    writeAccess?: boolean;
  };
};

export type ExternalModelSettingsMessage = {
  tone: "success" | "error" | "info";
  text: string;
};

export type ExternalModelsSettingsState = {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  busyProviderId: string | null;
  providers: ExternalModelProviderStatus[];
  messages: Record<string, ExternalModelSettingsMessage>;
};

export function createExternalModelsSettingsState(): ExternalModelsSettingsState {
  return {
    loading: false,
    loaded: false,
    error: null,
    busyProviderId: null,
    providers: [],
    messages: {},
  };
}

export function renderExternalModelSettingsPanel(state: ExternalModelsSettingsState) {
  if (state.loading && !state.loaded) {
    return `<div class="external-model-settings-loading">正在读取本机安全配置…</div>`;
  }
  if (state.error && !state.providers.length) {
    return `
      <div class="external-model-settings-error">
        <strong>模型配置暂时无法读取</strong>
        <span>${escapeHtml(state.error)}</span>
        <button type="button" data-external-model-refresh>重试</button>
      </div>
    `;
  }
  return `
    <div class="external-model-settings-panel">
      <section class="external-model-security-note">
        <strong>第一阶段：只读接入</strong>
        <span>API Key 仅发送到 Electron 主进程，并通过系统安全存储加密；不会写入聊天记录、localStorage、Haolo 配置或用户数据导出。外部模型当前没有终端、文件读写或工具权限。</span>
      </section>
      ${state.error ? `<div class="external-model-inline-error">${escapeHtml(state.error)}</div>` : ""}
      <div class="external-model-provider-list">
        ${state.providers.map((provider) => renderProviderCard(provider, state)).join("")}
      </div>
    </div>
  `;
}

function renderProviderCard(provider: ExternalModelProviderStatus, state: ExternalModelsSettingsState) {
  const busy = state.busyProviderId === provider.id;
  const anotherBusy = Boolean(state.busyProviderId && !busy);
  const disabled = busy || anotherBusy;
  const message = state.messages[provider.id];
  const statusLabel = provider.configured ? "已加密保存" : "未配置";
  const baseUrlSelect = provider.baseUrlOptions.length > 1
    ? `
      <div class="external-model-field">
        <span>API 站点</span>
        ${renderHaoloSelect({
          id: `external-model-base-url-${provider.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
          value: provider.baseUrlProfile,
          ariaLabel: `${provider.displayName} API 站点`,
          className: "external-model-base-url-select",
          disabled,
          inputAttributes: { "data-external-model-base-url": provider.id },
          options: provider.baseUrlOptions.map((option) => ({
            value: option.id,
            label: `${option.label} · ${option.baseUrl}`,
          })),
        })}
      </div>
    `
    : `<div class="external-model-endpoint">${escapeHtml(provider.baseUrlOptions[0]?.baseUrl || "")}</div>`;
  return `
    <article class="external-model-provider-card" data-external-model-card="${escapeAttr(provider.id)}">
      <header>
        <div>
          <strong>${escapeHtml(provider.displayName)}</strong>
          <span>${escapeHtml(provider.vendor)}</span>
        </div>
        <span class="external-model-status ${provider.configured ? "configured" : ""}">${statusLabel}</span>
      </header>
      ${baseUrlSelect}
      <label class="external-model-field">
        <span>模型名称</span>
        <input
          type="text"
          value="${escapeAttr(provider.model || provider.defaultModel)}"
          data-external-model-model="${escapeAttr(provider.id)}"
          autocomplete="off"
          spellcheck="false"
          ${disabled ? "disabled" : ""}
        />
      </label>
      <label class="external-model-field">
        <span>API Key</span>
        <input
          type="password"
          value=""
          placeholder="${provider.configured ? "已保存；留空可只更新模型" : `粘贴 ${provider.apiKeyEnvironmentVariable}`}"
          data-external-model-key="${escapeAttr(provider.id)}"
          autocomplete="new-password"
          autocapitalize="off"
          spellcheck="false"
          ${disabled || !provider.secureStorageAvailable ? "disabled" : ""}
        />
      </label>
      ${provider.connectionTest?.billable ? `<small class="external-model-billing-note">连接测试会发出一次极小请求，可能产生少量费用。</small>` : ""}
      ${!provider.secureStorageAvailable ? `<small class="external-model-storage-warning">系统安全存储不可用，Haolo 不会降级为明文保存。</small>` : ""}
      ${message ? `<div class="external-model-card-message ${escapeAttr(message.tone)}">${escapeHtml(message.text)}</div>` : ""}
      <footer>
        <button type="button" class="external-model-secondary-button" data-external-model-key-console="${escapeAttr(provider.id)}">获取 Key</button>
        <button type="button" class="external-model-secondary-button" data-external-model-docs="${escapeAttr(provider.id)}">官方文档</button>
        <span></span>
        ${provider.configured ? `<button type="button" class="external-model-danger-button" data-external-model-remove="${escapeAttr(provider.id)}" ${disabled ? "disabled" : ""}>删除 Key</button>` : ""}
        <button type="button" class="external-model-secondary-button" data-external-model-test="${escapeAttr(provider.id)}" ${disabled || !provider.configured ? "disabled" : ""}>${busy ? "测试中…" : "测试连接"}</button>
        <button type="button" class="external-model-primary-button" data-external-model-save="${escapeAttr(provider.id)}" ${disabled || !provider.secureStorageAvailable ? "disabled" : ""}>${busy ? "处理中…" : "保存"}</button>
      </footer>
    </article>
  `;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: unknown) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
