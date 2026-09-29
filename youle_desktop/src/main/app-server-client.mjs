import { modelToolNetworkEnv, modelToolNetworkConfigArgs } from "./model-tool-network.mjs";
import { HAOLO_GATEWAY_BASE_URL, migrateHaoloGatewayAuth, migrateHaoloGatewayConfig, normalizeHaoloGatewayBaseUrl } from "./haolo-gateway.mjs";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createConnection, createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { ModelRequestRelay, modelRequestRelayEnabled } from "./model-request-relay.mjs";
import { haoloRoute } from "./haolo-network-policy.mjs";
import { requestWithThreadHistoryRecovery } from "./thread-history-recovery.mjs";
import { DEEPSEEK_FLASH_MODEL, LEGACY_DEEPSEEK_FLASH_MODEL, isDeepSeekFlashModel, migrateDeepSeekModelSelection } from "./deepseek-model-policy.mjs";
import { DEFAULT_EXECUTION_MODEL, assertAllowedModelRequest, isRetiredExecutionModel } from "./retired-model-policy.mjs";
import { HAOLO_BUILTIN_PLUGIN_IDS, syncBuiltinPluginRegistration } from "./plugin-manager.mjs";
import {
  isolateHaoloRuntimeEnvironment,
  verifyHaoloRuntimeInstallation,
} from "./runtime-binaries.mjs";

const START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;
const TIMED_OUT_REQUEST_RETENTION_MS = 5 * 60_000;
const TIMED_OUT_REQUEST_MAX_ENTRIES = 256;
const READY_CHECK_REQUEST_TIMEOUT_MS = 1_000;
const LOCAL_PROXY_PROBE_TIMEOUT_MS = 500;
const PROXY_ENV_NAME_PATTERN = /^(?:http|https|all)_proxy$/i;
const DEFAULT_CODEX_RESOURCE_DIR = "default-haolo-ai";
const DEFAULT_CODEX_CONFIG_FILE = "config.toml";
const DEFAULT_CODEX_AUTH_FILE = "auth.json";
const DEFAULT_CODEX_SKILLS_DIR = "skills";
const DEFAULT_CODEX_PLUGINS_DIR = "plugins";
const MANAGED_MODEL_CATALOG_FILE = "haolo-model-catalog.json";
const DEEPSEEK_CODEX_MODEL_CATALOG_FILE = path.join(
  "model-catalog-supplements",
  "deepseek-v4-flash.json",
);
const DEEPSEEK_CODEX_MODEL_CATALOG_CANONICAL_SHA256 =
  "49c525cceef02b3e5dfa26e56cae970e7cc052cde2365a9d076577a3d34cdcfa";
const MANAGED_PLUGIN_INDEX_FILE = ".haolo-desktop-managed-plugins.json";
const MANAGED_PLUGIN_INDEX_VERSION = 1;
const CODEX_RUNTIME_HOME_DIR = "runtime-home";
const CODEX_DOT_DIR = ".codex";
const LEGACY_DEFAULT_CODEX_PLUGIN_DIRS = [
  path.join("cache", "openai-bundled", "latex", "0.2.2"),
  path.join("cache", "openai-primary-runtime", "documents", "26.601.10930"),
  path.join("cache", "openai-primary-runtime", "presentations", "26.601.10930"),
  path.join("cache", "openai-primary-runtime", "spreadsheets", "26.601.10930"),
];
const COPY_ONCE_SYSTEM_SKILLS = new Set();
const COPY_ONCE_SYSTEM_SKILL_MARKER = ".haolo-desktop-managed";
const DEEPSEEK_MCP_SERVER_FILE = path.join("mcp", "deepseek-server", "index.mjs");
const GITHUB_MCP_SERVER_FILE = path.join("mcp", "github-server", "index.mjs");
const CHROME_MCP_SERVER_FILE = path.join("mcp", "chrome-server", "index.mjs");
const PERSONAL_CONTEXT_MCP_SERVER_FILE = path.join("mcp", "personal-context-server", "index.mjs");
const MANAGED_DEEPSEEK_MCP_CONFIG_START = "# >>> haolo_desktop managed DeepSeek MCP";
const MANAGED_DEEPSEEK_MCP_CONFIG_END = "# <<< haolo_desktop managed DeepSeek MCP";
const MANAGED_GITHUB_MCP_CONFIG_START = "# >>> haolo_desktop managed GitHub MCP";
const MANAGED_GITHUB_MCP_CONFIG_END = "# <<< haolo_desktop managed GitHub MCP";
const MANAGED_CHROME_MCP_CONFIG_START = "# >>> haolo_desktop managed Chrome MCP";
const MANAGED_CHROME_MCP_CONFIG_END = "# <<< haolo_desktop managed Chrome MCP";
const MANAGED_PERSONAL_CONTEXT_MCP_CONFIG_START = "# >>> haolo_desktop managed Personal Context MCP";
const MANAGED_PERSONAL_CONTEXT_MCP_CONFIG_END = "# <<< haolo_desktop managed Personal Context MCP";
const PACKAGED_CODEX_BIN = process.platform === "win32" ? "haolo_ai.exe" : "haolo_ai";
const PACKAGED_CODEX_PLATFORM_BIN_DIR = process.platform === "darwin" ? `darwin-${process.arch}` : null;
const DEFAULT_PROVIDER_ID = "haolo_ai";
export const DEEPSEEK_EXECUTION_PROVIDER_ID = "deepseek";
export const DEEPSEEK_EXECUTION_MODEL = DEEPSEEK_FLASH_MODEL;
export const DEEPSEEK_EXECUTION_ENV_KEY = "HAOLO_DEEPSEEK_EXECUTION_TOKEN";
const DEFAULT_MODEL = DEFAULT_EXECUTION_MODEL;
const DEFAULT_MODEL_REASONING_EFFORT = "high";
const DEFAULT_WINDOWS_SANDBOX_MODE = "unelevated";
// The root thread occupies the only session slot. This is a runtime backstop
// for Haolo's ordinary serial-execution policy, even if a stale prompt tries
// to create a child thread.
const DEFAULT_AGENT_MAX_THREADS_PER_SESSION = 1;
// The managed haolo_ai provider uses the ChatGPT/Codex OAuth subscription
// route. Production currently enforces a 400K native window on that route,
// independently of the 1.05M window advertised for direct OpenAI API access.
// Compact at 300K so the compact request itself still has enough headroom.
const MANAGED_MODEL_CONTEXT_WINDOW = 400_000;
const MANAGED_MODEL_AUTO_COMPACT_TOKEN_LIMIT = 300_000;
const MANAGED_MODEL_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95;
const MANAGED_LONG_CONTEXT_MODEL_SLUGS = new Set([
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
]);
const MANAGED_COMPACTION_PROMPT = "Create a self-contained continuation handoff for another model. Preserve the user's current goal, completed work, key decisions, constraints, preferences, critical identifiers and paths, observed failures, and exact remaining steps. Omit routine narration, duplicate history, and obsolete details. Keep the entire summary under 6,000 tokens; if space is tight, prioritize unresolved work and facts needed to continue safely.";
const LEGACY_MANAGED_CONTEXT_CONFIG_VALUES = [
  ["model_context_window", "272000"],
  ["model_auto_compact_token_limit", "244800"],
  // Desktop releases before the OAuth-route correction pinned the direct API
  // limits at top level. Remove only those exact managed values; a user's own
  // 400K/300K override remains untouched.
  ["model_context_window", "1050000"],
  ["model_auto_compact_token_limit", "800000"],
  ["model_auto_compact_token_limit_scope", '"total"'],
  ["compact_prompt", JSON.stringify(MANAGED_COMPACTION_PROMPT)],
];
const LEGACY_MANAGED_SECTION_CONFIG_VALUES = [
  { section: "features", key: "responses_websockets_v2", value: "true" },
  { section: "features", key: "network_proxy", value: "true" },
  { section: "features", key: "network_proxy", value: "false" },
  { section: "model_providers.haolo_ai", key: "request_max_retries", value: "0" },
  { section: "model_providers.haolo_ai", key: "stream_max_retries", value: "0" },
  { section: "model_providers.haolo_ai", key: "stream_max_retries", value: "1" },
  // Existing installs carry an older Codex header in their managed config.
  // Keep each host aligned with its shipped runtime while migrating headers
  // written by the other platform's release as well.
  { section: "model_providers.haolo_ai", key: "http_headers", value: process.platform === "darwin" ? /version\s*=\s*"(?:0\.153\.4|0\.157\.1)"/ : /version\s*=\s*"(?:0\.144\.1|0\.153\.4)"/ },
  { section: "model_providers.deepseek", key: "http_headers", value: process.platform === "darwin" ? /version\s*=\s*"(?:0\.153\.4|0\.157\.1)"/ : /version\s*=\s*"(?:0\.144\.1|0\.153\.4)"/ },
];
const FORCED_MANAGED_SECTION_CONFIG_VALUES = [
  { section: "model_providers.haolo_ai", key: "supports_websockets", value: "true" },
  { section: "features.network_proxy", key: "enabled", value: "false" },
  { section: "windows", key: "sandbox", value: `"${DEFAULT_WINDOWS_SANDBOX_MODE}"` },
];
const MANAGED_SECTION_CONFIG_KEYS = [
  { section: "features", key: "remote_plugin" },
  { section: "model_providers.haolo_ai", key: "request_max_retries" },
  { section: "model_providers.haolo_ai", key: "stream_max_retries" },
  { section: "model_providers.haolo_ai", key: "http_headers" },
  { section: "model_providers.deepseek", key: "http_headers" },
];
const DEFAULT_PROVIDER_BASE_URL = HAOLO_GATEWAY_BASE_URL;
const DEFAULT_PROVIDER_WIRE_API = "responses";
// Keep in sync with codex-runtime-macos.json and codex-runtime.json respectively.
const DEFAULT_PROVIDER_CODEX_VERSION = process.platform === "darwin" ? "0.144.1" : "0.157.1";
const DEFAULT_PROVIDER_MODEL_POOL = "execution";
const DEFAULT_PROVIDER_MODEL_CAPABILITY = "root_execution";
const DEEPSEEK_EXECUTION_DEFAULT_BASE_URL = DEFAULT_PROVIDER_BASE_URL;
const HAOLO_CODEX_ORIGINATOR_OVERRIDE_ENV = "HAOLO_DESKTOP_CODEX_ORIGINATOR_OVERRIDE";
const CODEX_ORIGINATOR_OVERRIDE_ENV = "CODEX_INTERNAL_ORIGINATOR_OVERRIDE";
const WORKSPACE_DEPENDENCIES_NODE_MODULES_ENV = "CODEX_WORKSPACE_DEPENDENCIES_NODE_MODULES";
const RIPGREP_CONFIG_FILE = "haolo-ripgrep.config";
const RIPGREP_EXCLUDED_GLOBS = [
  ".git/**",
  "node_modules/**",
  "dist/**",
  "build/**",
  "target/**",
  "out/**",
  ".next/**",
  ".nuxt/**",
  ".vite/**",
  ".turbo/**",
  ".cache/**",
  "coverage/**",
  "tmp/**",
  "temp/**",
];
const APP_SERVER_LOG_MAX_LINES_PER_CHUNK = 200;
const APP_SERVER_LOG_LINE_MAX_CHARS = 16_000;
const APP_SERVER_LOG_LINE_TAIL_CHARS = 4_000;

const managedPluginSourceDigestCache = new Map();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class AppServerClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.cwd = options.cwd || process.cwd();
    this.clientInfo = options.clientInfo || {
      name: "haolo_desktop",
      title: "haolo_desktop",
      version: "0.1.0",
    };
    this.codexCommand = options.codexCommand || null;
    this.codexHome = options.codexHome || process.env.HAOLO_DESKTOP_CODEX_HOME || process.env.CODEX_DESKTOP_CODEX_HOME || null;
    this.authPath = options.authPath || null;
    this.providerRuntimeResolver =
      typeof options.providerRuntimeResolver === "function"
        ? options.providerRuntimeResolver
        : null;
    this.modelRelayFetch = typeof options.modelRelayFetch === "function"
      ? options.modelRelayFetch
      : null;
    this.modelRelayWebSocketImpl = options.modelRelayWebSocketImpl || null;
    this.modelRequestRelays = [];
    this.modelTransport = { enabled: false, routes: [] };
    this.providerRuntime = null;
    this.child = null;
    this.port = null;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.activeRuntimeTurns = new Map();
    this.timedOutRequests = new Map();
    this.status = "stopped";
  }

  async start() {
    if (this.status === "ready") {
      return this.getStatus();
    }
    if (this.status === "starting") {
      await this.onceReady();
      return this.getStatus();
    }

    this.status = "starting";
    this.emit("status", this.getStatus());

    this.defaultConfig = loadDefaultCodexConfig();
    if (this.defaultConfig.action === "loaded") {
      this.emitLog("system", `loaded default runtime config from ${this.defaultConfig.configPath}`);
    }
    const defaultAuth = loadDefaultCodexAuthEnv({ authPath: this.authPath });
    this.defaultAuth = defaultAuth.status;
    const providerRuntime = await resolveExecutionProviderRuntime(
      this.providerRuntimeResolver,
    );
    this.providerRuntime = providerRuntime.status;
    const requestedProviderBaseUrl = normalizeProviderBaseUrl(
      defaultAuth.modelBaseUrl || DEFAULT_PROVIDER_BASE_URL,
    );
    const requestedDeepSeekBaseUrl = normalizeProviderBaseUrl(
      providerRuntime.deepSeek?.baseUrl
      || requestedProviderBaseUrl
      || DEEPSEEK_EXECUTION_DEFAULT_BASE_URL,
    );
    const command = this.codexCommand || resolveCodexCommand(this.cwd);
    verifyHaoloRuntimeInstallation(command);
    this.defaultResources = syncDefaultCodexResources(this.codexHome, {
      authEnv: defaultAuth.env,
      codexCommand: command,
    });
    if (this.defaultResources.action === "synced") {
      this.emitLog("system", `synced default Haolo resources into ${this.defaultResources.codexHome}`);
      this.emitDefaultResourceSyncErrors(this.defaultResources);
    }
    if (this.defaultAuth.envKeys?.includes("OPENAI_API_KEY")) {
      this.emitLog("system", `loaded Haolo API key from ${this.defaultAuth.authPath}`);
    }
    if (this.defaultAuth.envKeys?.includes("DEEPSEEK_API_KEY")) {
      this.emitLog("system", `loaded DeepSeek API key from ${this.defaultAuth.authPath}`);
    }

    const port = await getFreePort();
    this.port = port;
    this.command = command;

    const shell = needsShell(command);
    if (this.codexHome) {
      fs.mkdirSync(this.codexHome, { recursive: true });
    }
    const proxyEnvironment = await sanitizeAppServerProxyEnv(process.env);
    for (const key of proxyEnvironment.removed) {
      delete process.env[key];
    }
    if (proxyEnvironment.removed.length) {
      this.emitLog(
        "system",
        `removed unavailable local proxy variables from Haolo runtime: ${proxyEnvironment.removed.join(", ")}`,
      );
    }
    let childEnv = buildAppServerEnv({
      baseEnv: proxyEnvironment.env,
      codexHome: this.codexHome,
      authEnv: defaultAuth.env,
      providerEnv: providerRuntime.env,
      authPath: this.authPath,
      modelBaseUrl: defaultAuth.modelBaseUrl,
    });
    ensureAppServerEnvDirs(childEnv);
    const processCwd = resolveAppServerProcessCwd({
      workspaceCwd: this.cwd,
      runtimeHome: childEnv.HOME,
      command,
    });
    const modelRoutes = await this.startModelRequestRelays({
      // The Haolo network relay preserves Responses WebSocket frames as well as
      // HTTP/SSE. Custom GPT origins retain their existing direct transport.
      default: { baseUrl: requestedProviderBaseUrl, relay: false },
      deepSeek: { baseUrl: requestedDeepSeekBaseUrl, relay: true },
      mediaTools: { baseUrl: HAOLO_GATEWAY_BASE_URL, relay: false },
    });
    if (modelRoutes.mediaTools.relay) {
      childEnv = modelToolNetworkEnv(childEnv, modelRoutes.mediaTools.baseUrl);
    }
    const args = [
      ...defaultCodexConfigArgs({
        providerBaseUrl: modelRoutes.default.baseUrl,
        deepSeekProviderBaseUrl: modelRoutes.deepSeek.baseUrl,
        defaultProviderSupportsWebsockets: !modelRoutes.default.relay || Boolean(this.modelRelayWebSocketImpl),
      }),
      ...modelToolNetworkConfigArgs(childEnv, this.defaultResources.deepSeekMcpConfig?.action),
      "app-server",
      "--listen",
      `ws://127.0.0.1:${port}`,
    ];
    try {
      this.child = spawn(command, args, {
        cwd: processCwd,
        env: childEnv,
        windowsHide: true,
        shell,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      await this.stopModelRequestRelays();
      throw error;
    }

    this.child.stdout?.on("data", (chunk) => this.emitLog("stdout", chunk));
    this.child.stderr?.on("data", (chunk) => this.emitLog("stderr", chunk));
    this.child.once("exit", (code, signal) => {
      const wasReady = this.status === "ready";
      this.status = "stopped";
      this.activeRuntimeTurns.clear();
      void this.stopModelRequestRelays();
      this.rejectAll(new Error(`app-server exited with code ${code ?? "null"}, signal ${signal ?? "null"}`));
      this.emit("status", this.getStatus({ exitCode: code, signal }));
      if (wasReady) {
        this.emit("server-exit", { code, signal });
      }
    });
    this.child.once("error", (error) => {
      this.status = "failed";
      void this.stopModelRequestRelays();
      this.emit("status", this.getStatus({ error: error.message }));
    });

    try {
      await waitForReady(`http://127.0.0.1:${port}/readyz`, START_TIMEOUT_MS, this.child);
      await this.connectWebSocket(`ws://127.0.0.1:${port}`);
      const init = await this.request("initialize", {
        clientInfo: this.clientInfo,
        capabilities: { experimentalApi: true },
      });
      this.sendNotification("initialized", {});
      this.defaultResources = syncDefaultCodexResources(this.codexHome, { authEnv: defaultAuth.env });
      if (this.defaultResources.action === "synced" && this.defaultResources.copied?.length) {
        this.emitLog("system", "resynced default Haolo resources after app-server initialization");
        this.emitDefaultResourceSyncErrors(this.defaultResources);
      }
      this.status = "ready";
      this.init = init;
      this.emit("status", this.getStatus({ init }));
      this.emit("ready", init);
      return this.getStatus({ init });
    } catch (error) {
      this.status = "failed";
      this.emit("status", this.getStatus({ error: error.message }));
      await this.stop();
      throw error;
    }
  }

  onceReady(timeoutMs = START_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (this.status === "ready") {
        resolve();
        return;
      }
      const onReady = () => cleanup(resolve);
      const onStatus = (status) => {
        if (status.state === "failed" || status.state === "stopped") {
          cleanup(() => reject(new Error(status.error || "app-server stopped before ready")));
        }
      };
      const timer = setTimeout(() => {
        cleanup(() => reject(new Error("timed out waiting for app-server readiness")));
      }, timeoutMs);
      const cleanup = (finish) => {
        clearTimeout(timer);
        this.off("ready", onReady);
        this.off("status", onStatus);
        finish();
      };
      this.on("ready", onReady);
      this.on("status", onStatus);
    });
  }

  async connectWebSocket(url) {
    this.ws = new WebSocket(url, { perMessageDeflate: false });
    this.ws.on("message", (data) => this.handleMessage(data.toString()));
    this.ws.on("error", (error) => this.emit("transport-error", error));
    this.ws.on("close", () => {
      if (this.status === "ready") {
        this.status = "stopped";
        this.emit("status", this.getStatus());
      }
      this.rejectAll(new Error("app-server websocket closed"));
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out opening app-server websocket")), START_TIMEOUT_MS);
      this.ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      this.emit("protocol-error", { error: error.message, raw });
      return;
    }

    if (Object.hasOwn(message, "id") && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        const timedOut = this.takeTimedOutRequest(message.id);
        if (timedOut) {
          this.emit("late-response", {
            id: message.id,
            method: timedOut.method,
            lateByMs: Math.max(0, Date.now() - timedOut.timedOutAt),
            raw: message,
          });
          return;
        }
        this.emit("protocol-error", { error: `response for unknown id ${message.id}`, raw: message });
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message || "JSON-RPC error");
        error.data = message.error;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method && Object.hasOwn(message, "id")) {
      this.emit("server-request", message);
      return;
    }

    if (message.method) {
      // Observe every turn before UI filtering, including hidden workflow and
      // trading-analysis sessions, so provider recovery cannot interrupt them.
      const threadId = message.params?.threadId;
      const turnId = message.params?.turn?.id || message.params?.turnId;
      if (threadId && message.method === "turn/started") this.activeRuntimeTurns.set(threadId, turnId || null);
      if (threadId && ["turn/completed", "turn/failed"].includes(message.method)
        && (!this.activeRuntimeTurns.get(threadId) || this.activeRuntimeTurns.get(threadId) === turnId)) {
        this.activeRuntimeTurns.delete(threadId);
      }
      if (threadId && message.method === "thread/status/changed" && message.params?.status?.type === "active"
        && !this.activeRuntimeTurns.has(threadId)) this.activeRuntimeTurns.set(threadId, null);
      if (threadId && message.method === "thread/closed") this.activeRuntimeTurns.delete(threadId);
      this.emit("notification", message);
      return;
    }

    this.emit("protocol-error", { error: "unknown message shape", raw: message });
  }

  request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    return requestWithThreadHistoryRecovery({
      request: (rpcMethod, rpcParams, rpcTimeout) => this.requestRaw(rpcMethod, rpcParams, rpcTimeout),
      method,
      params,
      timeoutMs,
      codexHome: this.codexHome,
      onRecovery: (event) => this.emitLog("system", `[thread-history-recovery] ${JSON.stringify(event)}`),
    });
  }

  requestRaw(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    params = migrateDeepSeekModelSelection(params);
    try { assertAllowedModelRequest(params); } catch (error) { return Promise.reject(error); }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("app-server websocket is not open"));
    }
    const id = this.nextId++;
    const payload = { id, method, params };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.rememberTimedOutRequest(id, method);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
    });
    this.ws.send(JSON.stringify(payload));
    return promise;
  }

  rememberTimedOutRequest(id, method) {
    const timedOutAt = Date.now();
    for (const [requestId, entry] of this.timedOutRequests) {
      if (timedOutAt - entry.timedOutAt > TIMED_OUT_REQUEST_RETENTION_MS) {
        this.timedOutRequests.delete(requestId);
      }
    }
    this.timedOutRequests.set(id, { method, timedOutAt });
    while (this.timedOutRequests.size > TIMED_OUT_REQUEST_MAX_ENTRIES) {
      const oldestId = this.timedOutRequests.keys().next().value;
      if (oldestId === undefined) break;
      this.timedOutRequests.delete(oldestId);
    }
  }

  takeTimedOutRequest(id) {
    const entry = this.timedOutRequests.get(id);
    if (!entry) return null;
    this.timedOutRequests.delete(id);
    return Date.now() - entry.timedOutAt <= TIMED_OUT_REQUEST_RETENTION_MS ? entry : null;
  }

  sendNotification(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({ method, params }));
  }

  respond(id, result) {
    this.ws?.send(JSON.stringify({ id, result }));
  }

  respondError(id, code, message) {
    this.ws?.send(JSON.stringify({ id, error: { code, message } }));
  }

  async stop() {
    this.status = "stopping";
    this.emit("status", this.getStatus());
    try {
      this.ws?.close();
    } catch {
      // ignore close errors
    }
    this.ws = null;
    await stopProcessTree(this.child);
    this.activeRuntimeTurns.clear();
    this.child = null;
    await this.stopModelRequestRelays();
    this.status = "stopped";
    this.emit("status", this.getStatus());
  }

  async startModelRequestRelays(routes) {
    await this.stopModelRequestRelays();
    const result = {};
    const relaysByUpstream = new Map();
    const enabled = modelRequestRelayEnabled();
    for (const [name, requestedRoute] of Object.entries(routes)) {
      const route = requestedRoute && typeof requestedRoute === "object"
        ? requestedRoute
        : { baseUrl: requestedRoute, relay: true };
      const baseUrl = normalizeProviderBaseUrl(route.baseUrl);
      const routingRequired = Boolean(baseUrl && this.modelRelayFetch && haoloRoute(baseUrl));
      if (!baseUrl || (!routingRequired && (!enabled || route.relay === false))) {
        result[name] = { baseUrl, relay: false };
        continue;
      }
      const key = baseUrl.toLowerCase();
      let relay = relaysByUpstream.get(key);
      if (!relay) {
        try {
          relay = new ModelRequestRelay({
            upstreamBaseUrl: baseUrl,
            fetch: this.modelRelayFetch || undefined,
            WebSocketImpl: this.modelRelayWebSocketImpl,
          });
          relay.on("request-metrics", (metrics) => this.emitModelRelayMetrics(metrics));
          relay.on("request-error", (error) => {
            if (!error.aborted) {
              this.emitLog("system", `[model-transport] upstream error ${error.code}`);
            }
          });
          await relay.start();
          relaysByUpstream.set(key, relay);
          this.modelRequestRelays.push(relay);
        } catch (error) {
          if (routingRequired) {
            await this.stopModelRequestRelays();
            throw Object.assign(new Error("Haolo model routing relay is unavailable"), { code: "HAOLO_MODEL_ROUTE_UNAVAILABLE", cause: error });
          }
          this.emitLog(
            "system",
            `[model-transport] compression relay unavailable; using direct transport (${error.message})`,
          );
          result[name] = { baseUrl, relay: false };
          continue;
        }
      }
      result[name] = {
        baseUrl: relay.localBaseUrl(),
        relay: true,
        upstreamBaseUrl: baseUrl,
      };
    }
    this.modelTransport = {
      enabled: this.modelRequestRelays.length > 0,
      routes: Object.entries(result).map(([name, route]) => ({
        name,
        relay: route.relay,
        upstreamOrigin: route.upstreamBaseUrl ? new URL(route.upstreamBaseUrl).origin : null,
      })),
    };
    if (this.modelTransport.enabled) {
      this.emitLog(
        "system",
        `[model-transport] enabled loopback compression relay for ${this.modelRequestRelays.length} upstream(s)`,
      );
    }
    return result;
  }

  async stopModelRequestRelays() {
    const relays = this.modelRequestRelays.splice(0);
    await Promise.allSettled(relays.map((relay) => relay.stop()));
    this.modelTransport = { enabled: false, routes: [] };
  }

  emitModelRelayMetrics(metrics) {
    const compression = metrics?.compression;
    if (compression?.fallbackApplied) {
      this.emitLog(
        "system",
        `[model-transport] upstream rejected ${compression.encoding}; disabled request compression for this route and retried safely`,
      );
      return;
    }
    if (!compression?.applied) return;
    const savedPercent = Math.max(0, Math.round((compression.savingsRatio || 0) * 100));
    this.emitLog(
      "system",
      `[model-transport] ${compression.encoding} ${formatTransportBytes(compression.originalBytes)} -> ${formatTransportBytes(compression.wireBytes)} (-${savedPercent}%) in ${Math.round(compression.elapsedMs)}ms; ${metrics.status || "-"} ${Math.round(metrics.durationMs)}ms`,
    );
  }

  rejectAll(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
    this.timedOutRequests.clear();
  }

  emitLog(stream, chunk) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    let emitted = 0;
    let omitted = 0;
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) {
        if (emitted >= APP_SERVER_LOG_MAX_LINES_PER_CHUNK) {
          omitted += 1;
          continue;
        }
        emitted += 1;
        this.emit("log", { stream, line: boundedAppServerLogLine(line) });
      }
    }
    if (omitted) {
      this.emit("log", { stream, line: `[app-server output truncated: omitted ${omitted} additional log lines in one chunk]` });
    }
  }

  emitDefaultResourceSyncErrors(result) {
    const errors = Array.isArray(result?.errors) ? result.errors : [];
    for (const error of errors) {
      this.emitLog("system", `default resource sync warning: ${formatSyncErrorForLog(error)}`);
    }
  }

  getStatus(extra = {}) {
    return {
      state: this.status,
      port: this.port,
      command: this.command,
      pid: this.child?.pid ?? null,
      codexHome: this.codexHome,
      defaultConfig: this.defaultConfig,
      defaultResources: this.defaultResources,
      defaultAuth: this.defaultAuth,
      providerRuntime: this.providerRuntime,
      modelTransport: this.modelTransport,
      ...extra,
    };
  }
}

export function loadDefaultCodexConfig() {
  if (process.env.HAOLO_DESKTOP_SKIP_DEFAULT_CONFIG === "1") {
    return { action: "skipped", reason: "HAOLO_DESKTOP_SKIP_DEFAULT_CONFIG=1" };
  }

  const templatePath = resolveDefaultCodexTemplate(DEFAULT_CODEX_CONFIG_FILE);
  if (!templatePath) {
    return { action: "missing-template" };
  }

  return { action: "loaded", configPath: templatePath };
}

export function syncDefaultCodexResources(codexHome, options = {}) {
  if (process.env.HAOLO_DESKTOP_SKIP_DEFAULT_RESOURCE_SYNC === "1") {
    return { action: "skipped", reason: "HAOLO_DESKTOP_SKIP_DEFAULT_RESOURCE_SYNC=1" };
  }
  if (!codexHome) {
    return { action: "missing-codex-home" };
  }

  const targets = codexHomeSyncTargets(codexHome, options);
  let managedModelCatalog = null;
  let managedModelCatalogError = null;
  if (options.bundledModelCatalog || options.codexCommand) {
    try {
      const bundledCatalog = options.bundledModelCatalog || readBundledCodexModelCatalog(options.codexCommand);
      managedModelCatalog = buildManagedLongContextModelCatalog(bundledCatalog);
    } catch (error) {
      managedModelCatalogError = resourceSyncError(MANAGED_MODEL_CATALOG_FILE, error);
    }
  }
  const aggregate = {
    action: "synced",
    codexHome,
    codexHomes: targets,
    copied: [],
    errors: [],
    deepSeekMcpConfig: null,
    githubMcpConfig: null,
    chromeMcpConfig: null,
    personalContextMcpConfig: null,
    builtinPluginConfig: null,
    modelCatalogConfig: null,
  };
  if (managedModelCatalogError) aggregate.errors.push(managedModelCatalogError);
  for (const targetHome of targets) {
    const result = syncDefaultCodexResourcesInto(targetHome, {
      ...options,
      managedModelCatalog,
    });
    aggregate.copied.push(
      ...result.copied.map((item) => (samePath(targetHome, codexHome) ? item : `${path.relative(codexHome, targetHome)}:${item}`)),
    );
    aggregate.errors.push(...result.errors);
    if (samePath(targetHome, codexHome)) {
      aggregate.deepSeekMcpConfig = result.deepSeekMcpConfig;
      aggregate.githubMcpConfig = result.githubMcpConfig;
      aggregate.chromeMcpConfig = result.chromeMcpConfig;
      aggregate.personalContextMcpConfig = result.personalContextMcpConfig;
      aggregate.builtinPluginConfig = result.builtinPluginConfig;
      aggregate.modelCatalogConfig = result.modelCatalogConfig;
    }
  }
  return aggregate;
}

function syncDefaultCodexResourcesInto(codexHome, options = {}) {
  const configPath = resolveDefaultCodexTemplate(DEFAULT_CODEX_CONFIG_FILE);
  const skillsPath = resolveDefaultCodexTemplate(DEFAULT_CODEX_SKILLS_DIR);
  const pluginsPath = resolveDefaultCodexTemplate(DEFAULT_CODEX_PLUGINS_DIR);
  const copied = [];
  const errors = [];

  try {
    fs.mkdirSync(codexHome, { recursive: true });
  } catch (error) {
    return { action: "sync-failed", codexHome, copied, errors: [resourceSyncError(codexHome, error)] };
  }

  if (configPath) {
    const targetConfig = path.join(codexHome, DEFAULT_CODEX_CONFIG_FILE);
    try {
      if (!fs.existsSync(targetConfig)) {
        fs.cpSync(configPath, targetConfig, { force: true });
        copied.push(DEFAULT_CODEX_CONFIG_FILE);
      }
      const contextDefaults = syncMissingManagedCodexConfigDefaults(configPath, targetConfig);
      if (contextDefaults.action === "updated") {
        copied.push(`${DEFAULT_CODEX_CONFIG_FILE}:context-defaults`);
      }
      const currentConfig = fs.readFileSync(targetConfig, "utf8");
      const migratedConfig = migrateHaoloGatewayConfig(currentConfig);
      if (migratedConfig !== currentConfig) {
        fs.writeFileSync(targetConfig, migratedConfig, "utf8");
        copied.push(`${DEFAULT_CODEX_CONFIG_FILE}:gateway-domain`);
      }
    } catch (error) {
      errors.push(resourceSyncError(DEFAULT_CODEX_CONFIG_FILE, error));
    }
  }

  let modelCatalogConfig = { action: "skipped", reason: "missing-managed-model-catalog" };
  if (options.managedModelCatalog && configPath) {
    try {
      modelCatalogConfig = syncManagedModelCatalog(codexHome, options.managedModelCatalog);
      if (modelCatalogConfig.catalogUpdated) {
        copied.push(MANAGED_MODEL_CATALOG_FILE);
      }
      if (modelCatalogConfig.configUpdated) {
        copied.push(`${DEFAULT_CODEX_CONFIG_FILE}:model-catalog`);
      }
    } catch (error) {
      errors.push(resourceSyncError(MANAGED_MODEL_CATALOG_FILE, error));
      modelCatalogConfig = { action: "sync-failed", error: error?.message || String(error) };
    }
  }

  if (skillsPath) {
    const sourceSystemSkills = path.join(skillsPath, ".system");
    if (fs.existsSync(sourceSystemSkills)) {
      const targetSystemSkills = path.join(codexHome, DEFAULT_CODEX_SKILLS_DIR, ".system");
      const systemEntries = safeReadDir(sourceSystemSkills, errors, path.join(DEFAULT_CODEX_SKILLS_DIR, ".system"));
      if (systemEntries) safeMkdirSync(targetSystemSkills, errors, path.join(DEFAULT_CODEX_SKILLS_DIR, ".system"));
      for (const entry of systemEntries || []) {
        const source = path.join(sourceSystemSkills, entry.name);
        const target = path.join(targetSystemSkills, entry.name);
        const relativeTarget = path.join(DEFAULT_CODEX_SKILLS_DIR, ".system", entry.name);
        if (COPY_ONCE_SYSTEM_SKILLS.has(entry.name)) {
          if (hasCopyOnceSystemSkillMarker(target)) {
            continue;
          }
          safeRemoveSync(target, errors, relativeTarget);
          if (safeCopyDirectoryChanged(source, target, copied, relativeTarget, errors)) {
            safeWriteCopyOnceSystemSkillMarker(target, errors, relativeTarget);
          }
          continue;
        }
        safeCopyDirectoryChanged(source, target, copied, relativeTarget, errors);
      }
    }

    const targetSkills = path.join(codexHome, DEFAULT_CODEX_SKILLS_DIR);
    safeMkdirSync(targetSkills, errors, DEFAULT_CODEX_SKILLS_DIR);
    for (const entry of safeReadDir(skillsPath, errors, DEFAULT_CODEX_SKILLS_DIR) || []) {
      if (!entry.isDirectory() || entry.name === ".system") {
        continue;
      }
      const source = path.join(skillsPath, entry.name);
      const target = path.join(targetSkills, entry.name);
      const relativeTarget = path.join(DEFAULT_CODEX_SKILLS_DIR, entry.name);
      try {
        if (!fs.existsSync(target)) {
          safeCopyDirectoryChanged(source, target, copied, relativeTarget, errors);
        }
      } catch (error) {
        errors.push(resourceSyncError(relativeTarget, error));
      }
    }
  }

  if (pluginsPath && options.skipPlugins !== true) {
    copied.push(...syncDefaultCodexPlugins(pluginsPath, codexHome, errors));
  }

  const githubMcpConfig = syncManagedGitHubMcpConfig(codexHome);
  if (githubMcpConfig.action === "updated") {
    copied.push(`${DEFAULT_CODEX_CONFIG_FILE}:mcp_servers.github`);
  }

  const chromeMcpConfig = syncManagedChromeMcpConfig(codexHome);
  if (chromeMcpConfig.action === "updated") {
    copied.push(`${DEFAULT_CODEX_CONFIG_FILE}:mcp_servers.chrome`);
  }

  const personalContextMcpConfig = syncManagedPersonalContextMcpConfig(codexHome);
  if (personalContextMcpConfig.action === "updated") {
    copied.push(`${DEFAULT_CODEX_CONFIG_FILE}:mcp_servers.personal_context`);
  }

  const builtinPluginConfig =
    pluginsPath && options.skipPlugins !== true
      ? syncBuiltinPluginRegistration(codexHome, pluginsPath)
      : { action: "skipped", reason: options.skipPlugins === true ? "skipPlugins=true" : "missing-plugins-template" };
  if (builtinPluginConfig.action === "updated") {
    copied.push(`${DEFAULT_CODEX_CONFIG_FILE}:builtin-plugins`);
  }
  if (options.skipPlugins !== true) {
    const registeredPluginIds = new Set(builtinPluginConfig.pluginIds || []);
    const missingPluginIds = [...HAOLO_BUILTIN_PLUGIN_IDS].filter((pluginId) => !registeredPluginIds.has(pluginId));
    if (missingPluginIds.length) {
      errors.push(
        resourceSyncError(
          `${DEFAULT_CODEX_PLUGINS_DIR}:marketplaces`,
          new Error(`Bundled plugin marketplace resources are missing: ${missingPluginIds.join(", ")}`),
        ),
      );
    }
  }
  if (builtinPluginConfig.action.endsWith?.("failed")) {
    errors.push(resourceSyncError(`${DEFAULT_CODEX_CONFIG_FILE}:builtin-plugins`, new Error(builtinPluginConfig.error || builtinPluginConfig.action)));
  }

  const deepSeekMcpConfig = syncManagedDeepSeekMcpConfig(codexHome, options);
  if (deepSeekMcpConfig.action === "updated") {
    copied.push(`${DEFAULT_CODEX_CONFIG_FILE}:mcp_servers.deepseek`);
  }

  return {
    action: "synced",
    codexHome,
    copied,
    errors,
    deepSeekMcpConfig,
    githubMcpConfig,
    chromeMcpConfig,
    personalContextMcpConfig,
    builtinPluginConfig,
    modelCatalogConfig,
  };
}

export function buildManagedLongContextModelCatalog(value, { platform = process.platform } = {}) {
  const catalog = typeof value === "string" ? JSON.parse(value) : JSON.parse(JSON.stringify(value));
  if (!catalog || !Array.isArray(catalog.models) || !catalog.models.length) {
    throw new Error("Bundled Haolo model catalog must contain at least one model.");
  }

  catalog.models = catalog.models.filter((model) => !isRetiredExecutionModel(model?.slug));
  const updatedSlugs = new Set();
  for (const model of catalog.models) {
    const slug = typeof model?.slug === "string" ? model.slug : "";
    if (!MANAGED_LONG_CONTEXT_MODEL_SLUGS.has(slug)) continue;
    if (updatedSlugs.has(slug)) {
      throw new Error(`Bundled Haolo model catalog contains duplicate model ${slug}.`);
    }
    updatedSlugs.add(slug);
    model.context_window = MANAGED_MODEL_CONTEXT_WINDOW;
    model.max_context_window = MANAGED_MODEL_CONTEXT_WINDOW;
    model.auto_compact_token_limit = MANAGED_MODEL_AUTO_COMPACT_TOKEN_LIMIT;
    model.effective_context_window_percent = MANAGED_MODEL_EFFECTIVE_CONTEXT_WINDOW_PERCENT;
  }

  // The retained macOS 0.144.1 runtime predates the native Astra entry. Do not
  // discard its entire catalog (including DeepSeek's max/tool metadata) or
  // fabricate native Astra capabilities from another model's metadata.
  const missingSlugs = [...MANAGED_LONG_CONTEXT_MODEL_SLUGS].filter((slug) => !updatedSlugs.has(slug));
  if (missingSlugs.includes("gpt-6-sol")) {
    const source = catalog.models.find((model) => model?.slug === "gpt-6-astra") || catalog.models.find((model) => model?.slug === "gpt-5.6-sol");
    if (source) {
      const model = JSON.parse(JSON.stringify(source));
      model.slug = "gpt-6-sol";
      model.display_name = "GPT-6 Sol";
      catalog.models.push(model);
      updatedSlugs.add("gpt-6-sol");
    }
  }
  const unresolvedMissingSlugs = [...MANAGED_LONG_CONTEXT_MODEL_SLUGS].filter((slug) => (
    !updatedSlugs.has(slug) && !(platform === "darwin" && slug === "gpt-6-astra")
  ));
  if (unresolvedMissingSlugs.length) {
    throw new Error(`Bundled Haolo model catalog is missing managed models: ${unresolvedMissingSlugs.join(", ")}.`);
  }
  const deepSeekCatalog = readDeepSeekCodexModelCatalog();
  const deepSeekModels = Array.isArray(deepSeekCatalog?.models)
    ? deepSeekCatalog.models
    : [];
  if (deepSeekModels.length !== 1 || deepSeekModels[0]?.slug !== LEGACY_DEEPSEEK_FLASH_MODEL) {
    throw new Error("Bundled DeepSeek Codex catalog must contain exactly deepseek-v4-flash.");
  }
  const deepSeekModel = JSON.parse(JSON.stringify(deepSeekModels[0]));
  deepSeekModel.display_name = "GPT-6 Astra";
  deepSeekModel.slug = DEEPSEEK_EXECUTION_MODEL;
  if (
    deepSeekModel.minimal_client_version !== "0.144.0" ||
    deepSeekModel.prefer_websockets !== false ||
    deepSeekModel.shell_type !== "shell_command" ||
    deepSeekModel.apply_patch_tool_type !== "freeform" ||
    !Array.isArray(deepSeekModel.input_modalities) ||
    deepSeekModel.input_modalities.join(",") !== "text" ||
    !Array.isArray(deepSeekModel.supported_reasoning_levels) ||
    !deepSeekModel.supported_reasoning_levels.some((level) => level?.effort === "max")
  ) {
    throw new Error("Bundled DeepSeek Codex catalog does not match the required official Flash contract.");
  }
  catalog.models = catalog.models.filter((model) => !isDeepSeekFlashModel(model?.slug));
  catalog.models.push(deepSeekModel);
  return catalog;
}

function readDeepSeekCodexModelCatalog() {
  const catalogPath = resolveDefaultCodexTemplate(DEEPSEEK_CODEX_MODEL_CATALOG_FILE);
  if (!catalogPath) {
    throw new Error(`Missing bundled DeepSeek Codex catalog: ${DEEPSEEK_CODEX_MODEL_CATALOG_FILE}`);
  }
  const catalog = readJsonFile(catalogPath);
  if (!catalog) {
    throw new Error(`Invalid bundled DeepSeek Codex catalog: ${catalogPath}`);
  }
  const canonicalHash = createHash("sha256")
    .update(JSON.stringify(catalog))
    .digest("hex");
  if (canonicalHash !== DEEPSEEK_CODEX_MODEL_CATALOG_CANONICAL_SHA256) {
    throw new Error(
      `Bundled DeepSeek Codex catalog integrity check failed: ${catalogPath}`,
    );
  }
  return catalog;
}

function readBundledCodexModelCatalog(command) {
  if (typeof command !== "string" || !command.trim()) {
    throw new Error("Haolo runtime command is unavailable for managed model catalog generation.");
  }
  const output = execFileSync(command, ["debug", "models", "--bundled"], {
    encoding: "utf8",
    windowsHide: true,
    shell: needsShell(command),
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(String(output || ""));
}

function syncManagedModelCatalog(codexHome, catalog) {
  const configPath = path.join(codexHome, DEFAULT_CODEX_CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return { action: "skipped", reason: "missing-config", catalogUpdated: false, configUpdated: false };
  }

  const currentConfig = fs.readFileSync(configPath, "utf8");
  const existingAssignment = findTopLevelTomlAssignment(currentConfig, "model_catalog_json");
  const managedValue = JSON.stringify(MANAGED_MODEL_CATALOG_FILE);
  if (existingAssignment && topLevelTomlAssignmentValue(existingAssignment) !== managedValue) {
    return { action: "preserved-existing", catalogUpdated: false, configUpdated: false };
  }

  const catalogPath = path.join(codexHome, MANAGED_MODEL_CATALOG_FILE);
  const serializedCatalog = `${JSON.stringify(catalog, null, 2)}\n`;
  const catalogUpdated = !fs.existsSync(catalogPath) || fs.readFileSync(catalogPath, "utf8") !== serializedCatalog;
  if (catalogUpdated) writeJsonFileAtomic(catalogPath, catalog);

  let configUpdated = false;
  if (!existingAssignment) {
    const nextConfig = insertTopLevelTomlAssignments(currentConfig, [`model_catalog_json = ${managedValue}`]);
    fs.writeFileSync(configPath, nextConfig, "utf8");
    configUpdated = true;
  }

  return {
    action: catalogUpdated || configUpdated ? "updated" : "unchanged",
    catalogPath,
    catalogUpdated,
    configUpdated,
  };
}

function topLevelTomlAssignmentValue(assignment) {
  const separator = String(assignment || "").indexOf("=");
  if (separator < 0) return null;
  return String(assignment).slice(separator + 1).replace(/\s+#.*$/, "").trim();
}

function codexHomeSyncTargets(codexHome, options = {}) {
  const targets = [];
  const add = (candidate) => {
    if (typeof candidate !== "string" || !candidate.trim()) return;
    const resolved = path.resolve(candidate);
    if (!targets.some((target) => samePath(target, resolved))) {
      targets.push(resolved);
    }
  };
  add(codexHome);

  // Newer upstream Codex builds may derive their home from HOME/USERPROFILE and
  // then append ".codex", even when CODEX_HOME is present. Haolo sets
  // HOME/USERPROFILE to <codexHome>/runtime-home for isolation, so keep that
  // derived location overlaid with the Haolo-bundled system skills too.
  if (options.includeRuntimeDotCodex !== false && path.basename(path.resolve(codexHome)).toLowerCase() !== CODEX_DOT_DIR) {
    add(path.join(codexHome, CODEX_RUNTIME_HOME_DIR, CODEX_DOT_DIR));
  }
  for (const extraHome of options.extraCodexHomes || []) {
    add(extraHome);
  }
  return targets;
}

function syncDefaultCodexPlugins(pluginsPath, codexHome, errors) {
  const copied = [];
  const targetPlugins = path.join(codexHome, DEFAULT_CODEX_PLUGINS_DIR);
  const indexPath = path.join(targetPlugins, MANAGED_PLUGIN_INDEX_FILE);
  const previousIndex = readManagedPluginIndex(indexPath);
  const nextIndex = { version: MANAGED_PLUGIN_INDEX_VERSION, plugins: {} };
  const currentRelativeRoots = new Set();
  const managedVersionsByPlugin = new Map();

  for (const relativeLegacyPath of LEGACY_DEFAULT_CODEX_PLUGIN_DIRS) {
    safeRemoveSync(path.join(targetPlugins, relativeLegacyPath), errors, path.join(DEFAULT_CODEX_PLUGINS_DIR, relativeLegacyPath));
    removeEmptyAncestorDirs(targetPlugins, path.dirname(relativeLegacyPath), errors);
  }

  for (const pluginRoot of findCodexPluginRoots(pluginsPath, errors)) {
    const relativePluginRoot = path.relative(pluginsPath, pluginRoot);
    if (!relativePluginRoot || relativePluginRoot.startsWith("..") || path.isAbsolute(relativePluginRoot)) {
      continue;
    }
    const normalizedRelativeRoot = normalizeManagedPluginRelativePath(relativePluginRoot);
    currentRelativeRoots.add(normalizedRelativeRoot);
    const pluginBase = normalizeManagedPluginRelativePath(path.dirname(relativePluginRoot));
    const managedVersions = managedVersionsByPlugin.get(pluginBase) || new Set();
    managedVersions.add(path.basename(relativePluginRoot));
    managedVersionsByPlugin.set(pluginBase, managedVersions);
    const target = path.join(targetPlugins, relativePluginRoot);
    const relativeTarget = path.join(DEFAULT_CODEX_PLUGINS_DIR, relativePluginRoot);
    const syncResult = safeMirrorManagedPluginDirectory(
      pluginRoot,
      target,
      relativeTarget,
      previousIndex.plugins?.[normalizedRelativeRoot],
      errors,
    );
    if (syncResult.changed) copied.push(relativeTarget);
    if (syncResult.indexEntry) nextIndex.plugins[normalizedRelativeRoot] = syncResult.indexEntry;
  }

  let pruned = pruneManagedPluginDirectories({
    targetPlugins,
    previousIndex,
    currentRelativeRoots,
    managedVersionsByPlugin,
    errors,
  });
  if (pruned) copied.push(`${DEFAULT_CODEX_PLUGINS_DIR}:pruned`);

  if (!managedPluginIndexesEqual(previousIndex, nextIndex) || pruned) {
    try {
      writeJsonFileAtomic(indexPath, nextIndex);
    } catch (error) {
      errors.push(resourceSyncError(path.join(DEFAULT_CODEX_PLUGINS_DIR, MANAGED_PLUGIN_INDEX_FILE), error));
    }
  }

  return copied;
}

function safeMirrorManagedPluginDirectory(source, target, label, previousEntry, errors) {
  try {
    const sourceDigest = managedPluginSourceDigest(source);
    const targetFingerprint = directoryMetadataFingerprint(target);
    if (
      previousEntry?.sourceDigest === sourceDigest &&
      previousEntry?.targetFingerprint &&
      previousEntry.targetFingerprint === targetFingerprint
    ) {
      return { changed: false, indexEntry: previousEntry };
    }

    replaceDirectoryFromSource(source, target);
    return {
      changed: true,
      indexEntry: {
        sourceDigest,
        targetFingerprint: directoryMetadataFingerprint(target),
      },
    };
  } catch (error) {
    errors.push(resourceSyncError(label, error));
    return { changed: false, indexEntry: previousEntry || null };
  }
}

function replaceDirectoryFromSource(source, target) {
  const parent = path.dirname(target);
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const staging = path.join(parent, `.${path.basename(target)}.haolo-staging-${nonce}`);
  const backup = path.join(parent, `.${path.basename(target)}.haolo-backup-${nonce}`);
  fs.mkdirSync(parent, { recursive: true });
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  let movedExisting = false;
  try {
    copyDirectoryTreeSync(source, staging);
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      movedExisting = true;
    }
    fs.renameSync(staging, target);
    if (movedExisting) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    try {
      if (!fs.existsSync(target) && movedExisting && fs.existsSync(backup)) {
        fs.renameSync(backup, target);
      }
    } catch {
      // Keep the original copy/swap error; the leftover backup is recoverable on the next sync.
    }
    try {
      fs.rmSync(staging, { recursive: true, force: true });
    } catch {
      // Ignore staging cleanup failures and retain the original error.
    }
    throw error;
  }
}

function copyDirectoryTreeSync(source, target) {
  const sourceStat = fs.statSync(source);
  if (!sourceStat.isDirectory()) {
    const error = new Error(`Managed plugin source is not a directory: ${source}`);
    error.code = "ENOTDIR";
    throw error;
  }

  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const childSource = path.join(source, entry.name);
    const childTarget = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryTreeSync(childSource, childTarget);
    } else if (entry.isFile()) {
      copyFileWithMetadataSync(childSource, childTarget);
    } else if (entry.isSymbolicLink()) {
      copySymbolicLinkSync(childSource, childTarget);
    } else {
      const error = new Error(`Unsupported managed plugin file type: ${childSource}`);
      error.code = "ENOTSUP";
      throw error;
    }
  }
}

function copyFileWithMetadataSync(source, target) {
  const sourceStat = fs.statSync(source);
  fs.copyFileSync(source, target);
  fs.chmodSync(target, sourceStat.mode);
  fs.utimesSync(target, sourceStat.atime, sourceStat.mtime);
}

function copySymbolicLinkSync(source, target) {
  const linkTarget = fs.readlinkSync(source);
  const type =
    process.platform === "win32"
      ? fs.statSync(source).isDirectory()
        ? "junction"
        : "file"
      : undefined;
  fs.symlinkSync(linkTarget, target, type);
}

function managedPluginSourceDigest(source) {
  const inventory = directoryInventory(source, { includeContent: false });
  const inventoryFingerprint = hashDirectoryInventory(inventory, { includeContent: false });
  const cached = managedPluginSourceDigestCache.get(path.resolve(source));
  if (cached?.inventoryFingerprint === inventoryFingerprint) return cached.sourceDigest;
  const sourceDigest = hashDirectoryInventory(directoryInventory(source, { includeContent: true }), { includeContent: true });
  managedPluginSourceDigestCache.set(path.resolve(source), { inventoryFingerprint, sourceDigest });
  return sourceDigest;
}

function directoryMetadataFingerprint(root) {
  if (!fs.existsSync(root)) return null;
  return hashDirectoryInventory(directoryInventory(root, { includeContent: false }), { includeContent: false });
}

function directoryInventory(root, { includeContent }) {
  const entries = [];
  const visit = (current, relativeDir = "") => {
    const children = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolutePath = path.join(current, child.name);
      const relativePath = path.posix.join(relativeDir.split(path.sep).join(path.posix.sep), child.name);
      if (child.isDirectory()) {
        entries.push({ path: `${relativePath}/`, type: "directory" });
        visit(absolutePath, path.join(relativeDir, child.name));
      } else if (child.isFile()) {
        const stat = fs.statSync(absolutePath);
        entries.push({
          path: relativePath,
          type: "file",
          size: stat.size,
          mtimeMs: Math.trunc(stat.mtimeMs),
          content: includeContent ? fs.readFileSync(absolutePath) : null,
        });
      } else if (child.isSymbolicLink()) {
        entries.push({ path: relativePath, type: "symlink", link: fs.readlinkSync(absolutePath) });
      }
    }
  };
  visit(root);
  return entries;
}

function hashDirectoryInventory(entries, { includeContent }) {
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.type);
    hash.update("\0");
    hash.update(entry.path);
    hash.update("\0");
    if (entry.type === "file") {
      hash.update(String(entry.size));
      hash.update("\0");
      if (includeContent) hash.update(entry.content);
      else hash.update(String(entry.mtimeMs));
    } else if (entry.type === "symlink") {
      hash.update(entry.link);
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function pruneManagedPluginDirectories({
  targetPlugins,
  previousIndex,
  currentRelativeRoots,
  managedVersionsByPlugin,
  errors,
}) {
  let changed = false;
  const removeManagedRoot = (relativeRoot) => {
    const resolved = resolveManagedPluginTarget(targetPlugins, relativeRoot);
    if (!resolved) return;
    if (fs.existsSync(resolved)) {
      if (safeRemoveSync(resolved, errors, path.join(DEFAULT_CODEX_PLUGINS_DIR, relativeRoot))) changed = true;
    }
  };

  for (const previousRelativeRoot of Object.keys(previousIndex.plugins || {})) {
    if (!currentRelativeRoots.has(previousRelativeRoot)) removeManagedRoot(previousRelativeRoot);
  }

  for (const [pluginBase, currentVersions] of managedVersionsByPlugin) {
    const targetBase = resolveManagedPluginTarget(targetPlugins, pluginBase);
    if (!targetBase || !fs.existsSync(targetBase)) continue;
    for (const entry of safeReadDir(targetBase, errors, path.join(DEFAULT_CODEX_PLUGINS_DIR, pluginBase)) || []) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && !currentVersions.has(entry.name)) {
        removeManagedRoot(normalizeManagedPluginRelativePath(path.join(pluginBase, entry.name)));
      }
    }
  }
  return changed;
}

function resolveManagedPluginTarget(targetPlugins, relativeRoot) {
  if (!relativeRoot || path.isAbsolute(relativeRoot)) return null;
  const targetRoot = path.resolve(targetPlugins);
  const resolved = path.resolve(targetRoot, relativeRoot);
  const relative = path.relative(targetRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function normalizeManagedPluginRelativePath(value) {
  return String(value || "").split(path.sep).join(path.posix.sep);
}

function readManagedPluginIndex(indexPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (parsed?.version === MANAGED_PLUGIN_INDEX_VERSION && parsed.plugins && typeof parsed.plugins === "object") {
      return parsed;
    }
  } catch {
    // Missing or invalid indexes are safely rebuilt from the bundled source.
  }
  return { version: MANAGED_PLUGIN_INDEX_VERSION, plugins: {} };
}

function managedPluginIndexesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function writeJsonFileAtomic(filePath, value) {
  writeTextFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTextFileAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, value, "utf8");
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failures and retain the original write error.
    }
    throw error;
  }
}

function removeEmptyAncestorDirs(root, relativeDir, errors) {
  let current = path.join(root, relativeDir);
  while (current.startsWith(root) && current !== root) {
    try {
      fs.rmdirSync(current);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") {
        errors.push(resourceSyncError(path.relative(root, current) || current, error));
      }
      return;
    }
    current = path.dirname(current);
  }
}

function findCodexPluginRoots(root, errors) {
  const pluginRoots = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }

    const manifestPath = path.join(current, ".codex-plugin", "plugin.json");
    if (fs.existsSync(manifestPath)) {
      pluginRoots.push(current);
      continue;
    }

    const entries = safeReadDir(current, errors, path.relative(root, current) || DEFAULT_CODEX_PLUGINS_DIR);
    for (const entry of entries || []) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      }
    }
  }

  return pluginRoots.sort();
}

function hasCopyOnceSystemSkillMarker(skillPath) {
  return fs.existsSync(path.join(skillPath, COPY_ONCE_SYSTEM_SKILL_MARKER));
}

function writeCopyOnceSystemSkillMarker(skillPath) {
  fs.mkdirSync(skillPath, { recursive: true });
  fs.writeFileSync(
    path.join(skillPath, COPY_ONCE_SYSTEM_SKILL_MARKER),
    "Managed by haolo_desktop. Existing marked copy-once system skills are preserved on startup.\n",
    "utf8",
  );
}

function safeWriteCopyOnceSystemSkillMarker(skillPath, errors, label) {
  try {
    writeCopyOnceSystemSkillMarker(skillPath);
  } catch (error) {
    errors.push(resourceSyncError(`${label}:${COPY_ONCE_SYSTEM_SKILL_MARKER}`, error));
  }
}

function safeReadDir(dirPath, errors, label) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    errors.push(resourceSyncError(label, error));
    return null;
  }
}

function safeMkdirSync(dirPath, errors, label) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
  } catch (error) {
    errors.push(resourceSyncError(label, error));
    return false;
  }
}

function safeRemoveSync(target, errors, label) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch (error) {
    errors.push(resourceSyncError(label, error));
    return false;
  }
}

function safeCopyDirectoryChanged(source, target, copied, label, errors) {
  try {
    if (!fs.existsSync(source)) return false;
    const changed = copyDirectoryChanged(source, target, label, errors);
    if (changed) copied.push(label);
    return changed;
  } catch (error) {
    errors.push(resourceSyncError(label, error));
    return false;
  }
}

function copyDirectoryChanged(source, target, label, errors) {
  const stat = fs.statSync(source);
  if (!stat.isDirectory()) {
    copyFileChanged(source, target);
    return true;
  }
  if (!safeMkdirSync(target, errors, label)) return false;
  let changed = false;
  const entries = safeReadDir(source, errors, label);
  for (const entry of entries || []) {
    const childSource = path.join(source, entry.name);
    const childTarget = path.join(target, entry.name);
    const childLabel = path.join(label, entry.name);
    try {
      if (entry.isDirectory()) {
        changed = copyDirectoryChanged(childSource, childTarget, childLabel, errors) || changed;
      } else if (entry.isFile()) {
        changed = copyFileChanged(childSource, childTarget) || changed;
      }
    } catch (error) {
      errors.push(resourceSyncError(childLabel, error));
    }
  }
  return changed;
}

function copyFileChanged(source, target) {
  const sourceStat = fs.statSync(source);
  const targetStat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (
    targetStat?.isFile() &&
    targetStat.size === sourceStat.size &&
    Math.trunc(targetStat.mtimeMs) >= Math.trunc(sourceStat.mtimeMs)
  ) {
    return false;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tempTarget = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.copyFileSync(source, tempTarget);
    fs.renameSync(tempTarget, target);
  } catch (error) {
    try {
      fs.rmSync(tempTarget, { force: true });
    } catch {
      // Ignore cleanup failures; the original error is more useful.
    }
    throw error;
  }
  return true;
}

function syncMissingManagedCodexConfigDefaults(templatePath, targetPath) {
  const template = fs.readFileSync(templatePath, "utf8");
  const current = fs.readFileSync(targetPath, "utf8");
  const additions = [];
  const removedKeys = [];
  const forcedKeys = [];
  let next = current;

  for (const [key, legacyValue] of LEGACY_MANAGED_CONTEXT_CONFIG_VALUES) {
    const removed = removeExactTopLevelTomlAssignment(next, key, legacyValue);
    next = removed.text;
    if (removed.removed) removedKeys.push(key);
  }
  for (const { section, key, value } of LEGACY_MANAGED_SECTION_CONFIG_VALUES) {
    const removed = removeExactTomlSectionAssignment(next, section, key, value);
    next = removed.text;
    if (removed.removed) removedKeys.push(`${section}.${key}`);
  }
  for (const { section, key, value } of FORCED_MANAGED_SECTION_CONFIG_VALUES) {
    if (process.platform !== "win32" && section === "windows") continue;
    const forced = forceTomlSectionAssignment(next, section, key, value);
    next = forced.text;
    if (forced.updated) forcedKeys.push(`${section}.${key}`);
  }

  next = additions.length ? insertTopLevelTomlAssignments(next, additions) : next;
  const insertedKeys = additions.map((assignment) => assignment.slice(0, assignment.indexOf("=")).trim());
  for (const { section, key } of MANAGED_SECTION_CONFIG_KEYS) {
    if (findTomlSectionAssignment(next, section, key) || findTopLevelDottedTomlAssignment(next, section, key)) {
      continue;
    }
    const templateAssignment = findTomlSectionAssignment(template, section, key);
    if (!templateAssignment) continue;
    const assignment = key === "http_headers"
      ? templateAssignment.replace(/(\bversion\s*=\s*")[^"]*"/, `$1${DEFAULT_PROVIDER_CODEX_VERSION}"`)
      : templateAssignment;
    next = insertTomlSectionAssignment(next, section, assignment.trim());
    insertedKeys.push(`${section}.${key}`);
  }

  if (next === current) {
    return { action: "unchanged", keys: [] };
  }

  writeTextFileAtomic(targetPath, next);
  return {
    action: "updated",
    keys: [
      ...removedKeys.map((key) => `removed:${key}`),
      ...forcedKeys.map((key) => `forced:${key}`),
      ...insertedKeys,
    ],
  };
}

function removeExactTopLevelTomlAssignment(text, key, expectedValue) {
  const source = String(text || "");
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const assignmentPattern = new RegExp(`^(?:${escapeRegExp(key)}|"${escapeRegExp(key)}"|'${escapeRegExp(key)}')\\s*=\\s*([^#]+?)\\s*(?:#.*)?$`);
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].replace(/^\uFEFF/, "").trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^\[\[?/.test(trimmed)) break;
    const match = trimmed.match(assignmentPattern);
    const actualValue = match?.[1]?.trim();
    const matchesExpected =
      match
      && (expectedValue instanceof RegExp ? expectedValue.test(actualValue) : actualValue === expectedValue);
    if (!matchesExpected) continue;
    lines.splice(index, 1);
    return { text: lines.join(newline), removed: true };
  }
  return { text: source, removed: false };
}

function findTopLevelTomlAssignment(text, key) {
  const escapedKey = escapeRegExp(key);
  const assignmentPattern = new RegExp(`^(?:${escapedKey}|"${escapedKey}"|'${escapedKey}')\\s*=`);
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.replace(/^\uFEFF/, "").trimStart();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (/^\[\[?/.test(trimmed)) {
      break;
    }
    if (assignmentPattern.test(trimmed)) {
      return line;
    }
  }
  return null;
}

function insertTopLevelTomlAssignments(text, assignments) {
  const current = String(text || "");
  const newline = current.includes("\r\n") ? "\r\n" : "\n";
  const bom = current.startsWith("\uFEFF") ? "\uFEFF" : "";
  const lines = current.slice(bom.length).split(/\r?\n/);
  const firstTableIndex = lines.findIndex((line) => /^\s*\[\[?/.test(line));
  const rootEnd = firstTableIndex === -1 ? lines.length : firstTableIndex;
  let insertionIndex = 0;

  for (let index = 0; index < rootEnd; index += 1) {
    const trimmed = lines[index].replace(/^\uFEFF/, "").trimStart();
    if (isTopLevelTomlAssignmentLine(trimmed)) {
      insertionIndex = index + 1;
    }
  }

  lines.splice(insertionIndex, 0, ...assignments);
  return `${bom}${lines.join(newline)}`;
}

function findTomlSectionAssignment(text, section, key) {
  const document = splitTomlDocument(text);
  const bounds = findTomlSectionBounds(document.lines, section);
  if (!bounds) return null;
  const escapedKey = escapeRegExp(key);
  const assignmentPattern = new RegExp(`^(?:${escapedKey}|"${escapedKey}"|'${escapedKey}')\\s*=`);
  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    const trimmed = document.lines[index].trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (assignmentPattern.test(trimmed)) return document.lines[index];
  }
  return null;
}

function removeExactTomlSectionAssignment(text, section, key, expectedValue) {
  const document = splitTomlDocument(text);
  const bounds = findTomlSectionBounds(document.lines, section);
  if (!bounds) return { text: String(text || ""), removed: false };
  const escapedKey = escapeRegExp(key);
  const assignmentPattern = new RegExp(
    `^(?:${escapedKey}|"${escapedKey}"|'${escapedKey}')\\s*=\\s*([^#]+?)\\s*(?:#.*)?$`,
  );
  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    const trimmed = document.lines[index].trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(assignmentPattern);
    const actualValue = match?.[1]?.trim();
    const matchesExpected =
      match
      && (expectedValue instanceof RegExp ? expectedValue.test(actualValue) : actualValue === expectedValue);
    if (!matchesExpected) continue;
    document.lines.splice(index, 1);
    return { text: `${document.bom}${document.lines.join(document.newline)}`, removed: true };
  }
  return { text: String(text || ""), removed: false };
}

function forceTomlSectionAssignment(text, section, key, value) {
  const source = String(text || "");
  const document = splitTomlDocument(source);
  const bounds = findTomlSectionBounds(document.lines, section);
  const escapedKey = escapeRegExp(key);
  const assignmentPattern = new RegExp(
    `^(\\s*)(?:${escapedKey}|"${escapedKey}"|'${escapedKey}')(\\s*=\\s*)([^#]*?)(\\s*(?:#.*)?)$`,
  );
  if (bounds) {
    for (let index = bounds.start + 1; index < bounds.end; index += 1) {
      const match = document.lines[index].match(assignmentPattern);
      if (!match) continue;
      if (match[3].trim() === value) return { text: source, updated: false };
      document.lines[index] = `${match[1]}${key}${match[2]}${value}${match[4]}`;
      return { text: `${document.bom}${document.lines.join(document.newline)}`, updated: true };
    }
  }

  const escapedSection = escapeRegExp(section);
  const dottedAssignmentPattern = new RegExp(
    `^(\\s*)(?:${escapedSection}|"${escapedSection}"|'${escapedSection}')\\s*\\.\\s*(?:${escapedKey}|"${escapedKey}"|'${escapedKey}')(\\s*=\\s*)([^#]*?)(\\s*(?:#.*)?)$`,
  );
  const topLevelEnd = document.lines.findIndex((line) => /^\s*\[\[?/.test(line));
  const end = topLevelEnd === -1 ? document.lines.length : topLevelEnd;
  for (let index = 0; index < end; index += 1) {
    const match = document.lines[index].match(dottedAssignmentPattern);
    if (!match) continue;
    if (match[3].trim() === value) return { text: source, updated: false };
    document.lines[index] = `${match[1]}${section}.${key}${match[2]}${value}${match[4]}`;
    return { text: `${document.bom}${document.lines.join(document.newline)}`, updated: true };
  }

  return {
    text: insertTomlSectionAssignment(source, section, `${key} = ${value}`),
    updated: true,
  };
}

function findTopLevelDottedTomlAssignment(text, section, key) {
  const escapedSection = escapeRegExp(section);
  const escapedKey = escapeRegExp(key);
  const assignmentPattern = new RegExp(
    `^(?:${escapedSection}|"${escapedSection}"|'${escapedSection}')\\s*\\.\\s*(?:${escapedKey}|"${escapedKey}"|'${escapedKey}')\\s*=`,
  );
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.replace(/^\uFEFF/, "").trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^\[\[?/.test(trimmed)) break;
    if (assignmentPattern.test(trimmed)) return line;
  }
  return null;
}

function insertTomlSectionAssignment(text, section, assignment) {
  const document = splitTomlDocument(text);
  const bounds = findTomlSectionBounds(document.lines, section);
  if (!bounds) {
    const current = String(text || "").trimEnd();
    return `${current}${current ? `${document.newline}${document.newline}` : ""}[${section}]${document.newline}${assignment}${document.newline}`;
  }
  let insertionIndex = bounds.start + 1;
  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    const trimmed = document.lines[index].trim();
    if (trimmed && !trimmed.startsWith("#")) insertionIndex = index + 1;
  }
  document.lines.splice(insertionIndex, 0, assignment);
  return `${document.bom}${document.lines.join(document.newline)}`;
}

function splitTomlDocument(text) {
  const current = String(text || "");
  const newline = current.includes("\r\n") ? "\r\n" : "\n";
  const bom = current.startsWith("\uFEFF") ? "\uFEFF" : "";
  return { bom, newline, lines: current.slice(bom.length).split(/\r?\n/) };
}

function findTomlSectionBounds(lines, section) {
  const escapedSection = escapeRegExp(section);
  const headerPattern = new RegExp(
    `^\\s*\\[\\s*(?:${escapedSection}|"${escapedSection}"|'${escapedSection}')\\s*\\]\\s*(?:#.*)?$`,
  );
  const start = lines.findIndex((line) => headerPattern.test(line));
  if (start === -1) return null;
  const nextHeader = lines.findIndex((line, index) => index > start && /^\s*\[\[?/.test(line));
  return { start, end: nextHeader === -1 ? lines.length : nextHeader };
}

function isTopLevelTomlAssignmentLine(line) {
  if (!line || line.startsWith("#")) return false;
  return /^(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')\s*=/.test(line);
}

function resourceSyncError(target, error) {
  return {
    target,
    code: error?.code || null,
    message: error?.message || String(error),
  };
}

function formatSyncErrorForLog(error) {
  const code = error?.code ? `${error.code} ` : "";
  return `${error?.target || "unknown"}: ${code}${error?.message || ""}`.trim();
}

function syncManagedDeepSeekMcpConfig(codexHome, options = {}) {
  if (process.env.HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP === "1") {
    return { action: "skipped", reason: "HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP=1" };
  }

  const serverPath = resolveBundledDeepSeekMcpServer();
  if (!serverPath) {
    return { action: "missing-server" };
  }

  const command = resolveBundledDeepSeekMcpCommand();
  if (!command) {
    return { action: "missing-command", serverPath };
  }

  const configPath = path.join(codexHome, DEFAULT_CODEX_CONFIG_FILE);
  let current = "";
  try {
    current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  } catch (error) {
    return { action: "read-failed", configPath, error: error.message };
  }

  const hasManagedDeepSeekConfig = current.includes(MANAGED_DEEPSEEK_MCP_CONFIG_START);
  if (!hasManagedDeepSeekConfig && hasDeepSeekMcpConfig(current)) {
    return { action: "preserved-existing", configPath, serverPath };
  }

  const managedBlock = withDocumentNewlines(
    buildManagedDeepSeekMcpConfig({ command, serverPath, authEnv: options.authEnv || {} }),
    current,
  );
  const next = hasManagedDeepSeekConfig
    ? replaceManagedTomlBlock(
        current,
        MANAGED_DEEPSEEK_MCP_CONFIG_START,
        MANAGED_DEEPSEEK_MCP_CONFIG_END,
        managedBlock,
      )
    : appendTomlBlock(current, managedBlock);
  if (next === current) {
    return { action: "unchanged", configPath, serverPath };
  }

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, next, "utf8");
  } catch (error) {
    return { action: "write-failed", configPath, error: error.message };
  }

  return { action: "updated", configPath, serverPath };
}

function buildManagedDeepSeekMcpConfig({ command, serverPath, authEnv = {} }) {
  const lines = [
    MANAGED_DEEPSEEK_MCP_CONFIG_START,
    "[mcp_servers.deepseek]",
    `command = "${tomlString(command)}"`,
    `args = ["${tomlString(serverPath)}"]`,
    "startup_timeout_sec = 20",
    "",
    "[mcp_servers.deepseek.env]",
    'ELECTRON_RUN_AS_NODE = "1"',
  ];
  for (const key of ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL"]) {
    if (typeof authEnv[key] === "string" && authEnv[key].trim()) {
      lines.push(`${key} = "${tomlString(authEnv[key].trim())}"`);
    }
  }
  lines.push(MANAGED_DEEPSEEK_MCP_CONFIG_END);
  return lines.join("\n");
}

function hasDeepSeekMcpConfig(text) {
  return /^\s*\[mcp_servers\.deepseek(?:\]|\.)/m.test(String(text || ""));
}

function syncManagedGitHubMcpConfig(codexHome) {
  if (process.env.HAOLO_DESKTOP_SKIP_BUILTIN_GITHUB_MCP === "1") {
    return { action: "skipped", reason: "HAOLO_DESKTOP_SKIP_BUILTIN_GITHUB_MCP=1" };
  }
  const serverPath = resolveBundledGitHubMcpServer();
  if (!serverPath) return { action: "missing-server" };
  const command = resolveBundledDeepSeekMcpCommand();
  if (!command) return { action: "missing-command", serverPath };

  const configPath = path.join(codexHome, DEFAULT_CODEX_CONFIG_FILE);
  let current = "";
  try {
    current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  } catch (error) {
    return { action: "read-failed", configPath, error: error.message };
  }
  const hasManagedConfig = current.includes(MANAGED_GITHUB_MCP_CONFIG_START);
  if (!hasManagedConfig && hasGitHubMcpConfig(current)) {
    return { action: "preserved-existing", configPath, serverPath };
  }
  const managedBlock = withDocumentNewlines(
    buildManagedGitHubMcpConfig({ command, serverPath }),
    current,
  );
  const next = hasManagedConfig
    ? replaceManagedTomlBlock(
        current,
        MANAGED_GITHUB_MCP_CONFIG_START,
        MANAGED_GITHUB_MCP_CONFIG_END,
        managedBlock,
      )
    : appendTomlBlock(current, managedBlock);
  if (next === current) return { action: "unchanged", configPath, serverPath };
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, next, "utf8");
  } catch (error) {
    return { action: "write-failed", configPath, error: error.message };
  }
  return { action: "updated", configPath, serverPath };
}

function buildManagedGitHubMcpConfig({ command, serverPath }) {
  return [
    MANAGED_GITHUB_MCP_CONFIG_START,
    "[mcp_servers.github]",
    `command = "${tomlString(command)}"`,
    `args = ["${tomlString(serverPath)}"]`,
    'env_vars = ["HAOLO_GITHUB_BROKER_URL", "HAOLO_GITHUB_BROKER_TOKEN"]',
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 130",
    'default_tools_approval_mode = "writes"',
    "",
    "[mcp_servers.github.env]",
    'ELECTRON_RUN_AS_NODE = "1"',
    MANAGED_GITHUB_MCP_CONFIG_END,
  ].join("\n");
}

function hasGitHubMcpConfig(text) {
  return /^\s*\[mcp_servers\.github(?:\]|\.)/m.test(String(text || ""));
}

function syncManagedChromeMcpConfig(codexHome) {
  if (process.env.HAOLO_DESKTOP_SKIP_BUILTIN_CHROME_MCP === "1") {
    return { action: "skipped", reason: "HAOLO_DESKTOP_SKIP_BUILTIN_CHROME_MCP=1" };
  }
  const serverPath = resolveBundledChromeMcpServer();
  if (!serverPath) return { action: "missing-server" };
  const command = resolveBundledDeepSeekMcpCommand();
  if (!command) return { action: "missing-command", serverPath };

  const configPath = path.join(codexHome, DEFAULT_CODEX_CONFIG_FILE);
  let current = "";
  try {
    current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  } catch (error) {
    return { action: "read-failed", configPath, error: error.message };
  }
  const hasManagedConfig = current.includes(MANAGED_CHROME_MCP_CONFIG_START);
  if (!hasManagedConfig && hasChromeMcpConfig(current)) {
    return { action: "preserved-existing", configPath, serverPath };
  }
  const managedBlock = withDocumentNewlines(buildManagedChromeMcpConfig({ command, serverPath }), current);
  const next = hasManagedConfig
    ? replaceManagedTomlBlock(current, MANAGED_CHROME_MCP_CONFIG_START, MANAGED_CHROME_MCP_CONFIG_END, managedBlock)
    : appendTomlBlock(current, managedBlock);
  if (next === current) return { action: "unchanged", configPath, serverPath };
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, next, "utf8");
  } catch (error) {
    return { action: "write-failed", configPath, error: error.message };
  }
  return { action: "updated", configPath, serverPath };
}

function buildManagedChromeMcpConfig({ command, serverPath }) {
  return [
    MANAGED_CHROME_MCP_CONFIG_START,
    "[mcp_servers.chrome]",
    `command = "${tomlString(command)}"`,
    `args = ["${tomlString(serverPath)}"]`,
    'env_vars = ["HAOLO_CHROME_BROKER_URL", "HAOLO_CHROME_BROKER_TOKEN"]',
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 45",
    'default_tools_approval_mode = "writes"',
    "",
    "[mcp_servers.chrome.env]",
    'ELECTRON_RUN_AS_NODE = "1"',
    MANAGED_CHROME_MCP_CONFIG_END,
  ].join("\n");
}

function hasChromeMcpConfig(text) {
  return /^\s*\[mcp_servers\.chrome(?:\]|\.)/m.test(String(text || ""));
}

function syncManagedPersonalContextMcpConfig(codexHome) {
  if (process.env.HAOLO_DESKTOP_SKIP_BUILTIN_PERSONAL_CONTEXT_MCP === "1") {
    return { action: "skipped", reason: "HAOLO_DESKTOP_SKIP_BUILTIN_PERSONAL_CONTEXT_MCP=1" };
  }
  const serverPath = resolveBundledPersonalContextMcpServer();
  if (!serverPath) return { action: "missing-server" };
  const command = resolveBundledDeepSeekMcpCommand();
  if (!command) return { action: "missing-command", serverPath };

  const configPath = path.join(codexHome, DEFAULT_CODEX_CONFIG_FILE);
  let current = "";
  try {
    current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  } catch (error) {
    return { action: "read-failed", configPath, error: error.message };
  }
  const hasManagedConfig = current.includes(MANAGED_PERSONAL_CONTEXT_MCP_CONFIG_START);
  if (!hasManagedConfig && hasPersonalContextMcpConfig(current)) {
    return { action: "preserved-existing", configPath, serverPath };
  }
  const managedBlock = withDocumentNewlines(
    buildManagedPersonalContextMcpConfig({ command, serverPath }),
    current,
  );
  const next = hasManagedConfig
    ? replaceManagedTomlBlock(
        current,
        MANAGED_PERSONAL_CONTEXT_MCP_CONFIG_START,
        MANAGED_PERSONAL_CONTEXT_MCP_CONFIG_END,
        managedBlock,
      )
    : appendTomlBlock(current, managedBlock);
  if (next === current) return { action: "unchanged", configPath, serverPath };
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, next, "utf8");
  } catch (error) {
    return { action: "write-failed", configPath, error: error.message };
  }
  return { action: "updated", configPath, serverPath };
}

function buildManagedPersonalContextMcpConfig({ command, serverPath }) {
  return [
    MANAGED_PERSONAL_CONTEXT_MCP_CONFIG_START,
    "[mcp_servers.personal_context]",
    `command = "${tomlString(command)}"`,
    `args = ["${tomlString(serverPath)}"]`,
    'env_vars = ["HAOLO_PERSONAL_CONTEXT_BROKER_URL", "HAOLO_PERSONAL_CONTEXT_BROKER_TOKEN"]',
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 135",
    'default_tools_approval_mode = "writes"',
    "",
    "[mcp_servers.personal_context.env]",
    'ELECTRON_RUN_AS_NODE = "1"',
    MANAGED_PERSONAL_CONTEXT_MCP_CONFIG_END,
  ].join("\n");
}

function hasPersonalContextMcpConfig(text) {
  return /^\s*\[mcp_servers\.personal_context(?:\]|\.)/m.test(String(text || ""));
}

function replaceManagedTomlBlock(text, startMarker, endMarker, block) {
  const current = String(text || "");
  const start = current.indexOf(startMarker);
  const markerEnd = current.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || markerEnd < start) return appendTomlBlock(current, block);
  const end = markerEnd + endMarker.length;
  return `${current.slice(0, start)}${String(block || "").trim()}${current.slice(end)}`;
}

function withDocumentNewlines(block, document) {
  const newline = String(document || "").includes("\r\n") ? "\r\n" : "\n";
  return String(block || "").split(/\r?\n/).join(newline);
}

function appendTomlBlock(text, block) {
  const trimmedText = String(text || "").trimEnd();
  const trimmedBlock = String(block || "").trim();
  return `${trimmedText}${trimmedText ? "\n\n" : ""}${trimmedBlock}\n`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function loadDefaultCodexAuthEnv(options = {}) {
  if (process.env.HAOLO_DESKTOP_SKIP_DEFAULT_AUTH === "1") {
    return {
      status: { action: "skipped", reason: "HAOLO_DESKTOP_SKIP_DEFAULT_AUTH=1" },
      env: {},
    };
  }

  const templatePath = resolveDefaultCodexTemplate(DEFAULT_CODEX_AUTH_FILE);
  const templateAuth = templatePath ? readJsonFile(templatePath) || {} : {};
  const userAuth = options.authPath ? readJsonFile(options.authPath) || {} : {};
  const mergedAuth = migrateHaoloGatewayAuth({ ...templateAuth, ...nonEmptyAuthEntries(userAuth) });
  const authEnv = authObjectToEnv(mergedAuth);
  const modelBaseUrl = firstString(
    mergedAuth.LLMHUB_BASE_URL,
    mergedAuth.SUB2API_BASE_URL,
    mergedAuth.TRANSIT_BASE_URL,
    mergedAuth.MODEL_BASE_URL,
    mergedAuth.OPENAI_BASE_URL,
  );
  if (Object.keys(authEnv).length) {
    return {
      status: {
        action: Object.keys(nonEmptyAuthEntries(userAuth)).length ? "loaded-user-auth-file" : "loaded",
        authPath: options.authPath || templatePath,
        defaultAuthPath: templatePath || null,
        envKeys: Object.keys(authEnv),
        modelBaseUrl,
      },
      env: authEnv,
      modelBaseUrl,
    };
  }

  if (!templatePath) {
    return {
      status: { action: "missing-template" },
      env: {},
    };
  }

  return {
    status: { action: "missing-openai-api-key", authPath: options.authPath || templatePath, defaultAuthPath: templatePath },
    env: {},
  };
}

function nonEmptyAuthEntries(auth) {
  return Object.fromEntries(
    Object.entries(auth || {}).filter(([, value]) => typeof value === "string" && value.trim()),
  );
}

function authObjectToEnv(auth) {
  const env = {};
  for (const key of ["LLMHUB_API_KEY", "SUB2API_API_KEY", "OPENAI_API_KEY"]) {
    if (typeof auth[key] === "string" && auth[key].trim()) {
      env[key] = auth[key].trim();
    }
  }
  for (const key of ["LLMHUB_BASE_URL", "SUB2API_BASE_URL"]) {
    if (typeof auth[key] === "string" && auth[key].trim()) {
      env[key] = auth[key].trim();
    }
  }
  if (typeof auth.DEEPSEEK_API_KEY === "string" && auth.DEEPSEEK_API_KEY.trim()) {
    env.DEEPSEEK_API_KEY = auth.DEEPSEEK_API_KEY.trim();
  }
  if (typeof auth.DEEPSEEK_BASE_URL === "string" && auth.DEEPSEEK_BASE_URL.trim()) {
    env.DEEPSEEK_BASE_URL = auth.DEEPSEEK_BASE_URL.trim();
  }
  if (typeof auth.DEEPSEEK_MODEL === "string" && auth.DEEPSEEK_MODEL.trim()) {
    env.DEEPSEEK_MODEL = auth.DEEPSEEK_MODEL.trim();
  }
  return env;
}

export async function sanitizeAppServerProxyEnv(baseEnv = {}, options = {}) {
  const env = { ...baseEnv };
  const proxyEntries = Object.entries(env)
    .filter(([key, value]) => PROXY_ENV_NAME_PATTERN.test(key) && typeof value === "string" && value.trim())
    .map(([key, value]) => ({
      key,
      endpoint: parseLocalProxyEndpoint(value),
    }))
    .filter((entry) => entry.endpoint);

  if (!proxyEntries.length) {
    return { env, removed: [] };
  }

  const probeEndpoint =
    typeof options.probeEndpoint === "function" ? options.probeEndpoint : probeLocalProxyEndpoint;
  const endpointAvailability = new Map();
  await Promise.all(
    proxyEntries.map(async ({ endpoint }) => {
      const endpointKey = `${endpoint.host}:${endpoint.port}`;
      if (endpointAvailability.has(endpointKey)) return;
      const availabilityPromise = Promise.resolve()
        .then(() => probeEndpoint(endpoint))
        .then(Boolean)
        .catch(() => false);
      endpointAvailability.set(endpointKey, availabilityPromise);
      await availabilityPromise;
    }),
  );

  const removed = [];
  for (const { key, endpoint } of proxyEntries) {
    const available = await endpointAvailability.get(`${endpoint.host}:${endpoint.port}`);
    if (available) continue;
    delete env[key];
    removed.push(key);
  }
  return { env, removed };
}

function parseLocalProxyEndpoint(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!isLoopbackProxyHost(host)) return null;
  const explicitPort = Number.parseInt(parsed.port, 10);
  const port =
    Number.isInteger(explicitPort) && explicitPort > 0
      ? explicitPort
      : parsed.protocol === "https:"
        ? 443
        : parsed.protocol.startsWith("socks")
          ? 1080
          : 80;
  return { host, port };
}

function isLoopbackProxyHost(host) {
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "::" ||
    host === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/.test(host)
  );
}

async function probeLocalProxyEndpoint(endpoint) {
  const hosts =
    endpoint.host === "localhost"
      ? ["127.0.0.1", "::1"]
      : endpoint.host === "0.0.0.0"
        ? ["127.0.0.1"]
        : endpoint.host === "::"
          ? ["::1"]
          : [endpoint.host];
  const results = await Promise.all(
    hosts.map((host) => probeTcpEndpoint(host, endpoint.port, LOCAL_PROXY_PROBE_TIMEOUT_MS)),
  );
  return results.some(Boolean);
}

function probeTcpEndpoint(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = createConnection({ host, port });
    const finish = (available) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(available);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

export function buildAppServerEnv({
  baseEnv = {},
  codexHome,
  authEnv = {},
  providerEnv = {},
  authPath,
  modelBaseUrl,
}) {
  const isolatedHome = codexHome ? path.join(codexHome, CODEX_RUNTIME_HOME_DIR) : null;
  const workspaceDependenciesNodeModules = resolveWorkspaceDependenciesNodeModules(baseEnv);
  const ripgrepCommand = resolveRipgrepCommand(baseEnv);
  const ripgrepConfigPath = isolatedHome ? path.join(isolatedHome, ".config", "ripgrep", RIPGREP_CONFIG_FILE) : null;
  const isolatedEnv = isolatedHome
    ? {
        CODEX_HOME: codexHome,
        HAOLO_AI_HOME: codexHome,
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        XDG_CACHE_HOME: path.join(isolatedHome, ".cache"),
        XDG_CONFIG_HOME: path.join(isolatedHome, ".config"),
        XDG_DATA_HOME: path.join(isolatedHome, ".local", "share"),
      }
    : {};
  if (isolatedHome && process.platform === "win32") {
    const resolvedHome = path.resolve(isolatedHome);
    const parsed = path.parse(resolvedHome);
    isolatedEnv.HOMEDRIVE = parsed.root.replace(/[\\\/]+$/, "") || baseEnv.HOMEDRIVE || "";
    isolatedEnv.HOMEPATH = resolvedHome.slice(parsed.root.length - (parsed.root.endsWith("\\") ? 1 : 0));
  }
  const runtimeEnv = workspaceDependenciesNodeModules
    ? { [WORKSPACE_DEPENDENCIES_NODE_MODULES_ENV]: workspaceDependenciesNodeModules }
    : {};
  const ripgrepEnv = {
    ...(ripgrepConfigPath ? { RIPGREP_CONFIG_PATH: ripgrepConfigPath } : {}),
    ...(ripgrepCommand ? buildRipgrepPathEnv(baseEnv, ripgrepCommand) : {}),
  };
  const pythonEnv = {
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
  const credentialFileEnv =
    typeof authPath === "string" && authPath.trim()
      ? { HAOLO_MODEL_CREDENTIALS_FILE: path.resolve(authPath) }
      : {};
  const next = {
    ...baseEnv,
    ...pythonEnv,
    ...isolatedEnv,
    ...runtimeEnv,
    ...ripgrepEnv,
    ...credentialFileEnv,
    ...authEnv,
    ...providerEnv,
  };
  const runtimeBinDir = firstString(
    baseEnv.HAOLO_DESKTOP_RUNTIME_BIN_DIR,
    process.env.HAOLO_DESKTOP_RUNTIME_BIN_DIR,
  );
  isolateHaoloRuntimeEnvironment(next, runtimeBinDir);
  const originatorOverride = firstString(baseEnv[HAOLO_CODEX_ORIGINATOR_OVERRIDE_ENV]);
  if (originatorOverride) {
    // Opt-in diagnostic/rollout escape hatch for a server-registered Haolo
    // originator. Keep the default initialize clientInfo as `haolo_desktop`.
    next[CODEX_ORIGINATOR_OVERRIDE_ENV] = originatorOverride;
  }
  const baseUrl = normalizeProviderBaseUrl(modelBaseUrl || DEFAULT_PROVIDER_BASE_URL);
  if (baseUrl) {
    next.TRANSIT_BASE_URL = baseUrl;
    next.MODEL_BASE_URL = baseUrl;
    next.OPENAI_BASE_URL = baseUrl;
  }
  return migrateHaoloGatewayAuth(next);
}

export function resolveAppServerProcessCwd({
  workspaceCwd,
  runtimeHome,
  command,
  currentCwd = process.cwd(),
  platform = process.platform,
} = {}) {
  const workspace = path.resolve(String(workspaceCwd || currentCwd || "."));
  if (platform !== "win32" || !/[^\x00-\x7f]/.test(workspace)) {
    return workspace;
  }

  const candidates = [runtimeHome];
  if (typeof command === "string" && path.isAbsolute(command)) {
    candidates.push(path.dirname(command));
  }
  candidates.push(currentCwd);

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const resolved = path.resolve(candidate);
    if (!/[^\x00-\x7f]/.test(resolved) && fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return workspace;
}

function resolveWorkspaceDependenciesNodeModules(baseEnv = {}) {
  const configured = baseEnv[WORKSPACE_DEPENDENCIES_NODE_MODULES_ENV];
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }

  const home = firstString(baseEnv.USERPROFILE, os.homedir());
  if (!home) {
    return null;
  }
  const candidate = path.join(
    home,
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "node",
    "node_modules",
  );
  return fs.existsSync(path.join(candidate, "@oai", "artifact-tool", "package.json")) ? candidate : null;
}

function resolveRipgrepCommand(baseEnv = {}) {
  const configured = firstString(baseEnv.HAOLO_DESKTOP_RG_PATH, baseEnv.RIPGREP_PATH, process.env.HAOLO_DESKTOP_RG_PATH, process.env.RIPGREP_PATH);
  if (configured && fs.existsSync(configured)) return configured;
  const executableName = process.platform === "win32" ? "rg.exe" : "rg";
  const candidates = [];
  const runtimeBinDir = firstString(baseEnv.HAOLO_DESKTOP_RUNTIME_BIN_DIR, process.env.HAOLO_DESKTOP_RUNTIME_BIN_DIR);
  if (runtimeBinDir) candidates.push(path.join(runtimeBinDir, executableName));
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, executableName));
    candidates.push(path.join(process.resourcesPath, "bin", executableName));
  }
  candidates.push(path.resolve(__dirname, "../../resources/bin", executableName));
  candidates.push(path.resolve(__dirname, "../../../youle_desktop/resources/bin", executableName));
  candidates.push(...pathExecutableCandidates(firstString(baseEnv.PATH, baseEnv.Path, baseEnv.path, process.env.PATH), executableName));
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function pathExecutableCandidates(pathValue, executableName) {
  if (!pathValue) return [];
  return String(pathValue)
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, executableName));
}

function buildRipgrepPathEnv(baseEnv, ripgrepCommand) {
  const pathKey = Object.keys(baseEnv).find((key) => key.toLowerCase() === "path") || "PATH";
  const currentPath = firstString(baseEnv[pathKey], process.env[pathKey], process.env.PATH) || "";
  const rgDir = path.dirname(ripgrepCommand);
  const parts = currentPath.split(path.delimiter).filter(Boolean);
  const hasRgDir = parts.some((entry) => samePath(entry, rgDir));
  return {
    RIPGREP_PATH: ripgrepCommand,
    [pathKey]: hasRgDir ? currentPath : [rgDir, currentPath].filter(Boolean).join(path.delimiter),
  };
}

function ensureAppServerEnvDirs(env) {
  for (const name of ["HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"]) {
    const dir = env?.[name];
    if (typeof dir === "string" && dir.trim()) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  ensureRipgrepConfig(env?.RIPGREP_CONFIG_PATH);
}

function ensureRipgrepConfig(configPath) {
  if (typeof configPath !== "string" || !configPath.trim()) return;
  const content = ripgrepConfigText();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  try {
    if (fs.existsSync(configPath) && fs.readFileSync(configPath, "utf8") === content) return;
  } catch {
    // Rewrite unreadable stale files below.
  }
  fs.writeFileSync(configPath, content, "utf8");
}

function ripgrepConfigText() {
  return [
    "# Managed by Haolo Desktop. Keep generated and dependency trees out of agent code search.",
    ...RIPGREP_EXCLUDED_GLOBS.map((glob) => `--glob=!${glob}`),
    "",
  ].join("\n");
}

function boundedAppServerLogLine(line) {
  const text = String(line || "");
  if (text.length <= APP_SERVER_LOG_LINE_MAX_CHARS) return text;
  const headLength = Math.max(0, APP_SERVER_LOG_LINE_MAX_CHARS - APP_SERVER_LOG_LINE_TAIL_CHARS);
  return [
    text.slice(0, headLength),
    `[app-server log line truncated: ${text.length} chars total]`,
    text.slice(-APP_SERVER_LOG_LINE_TAIL_CHARS),
  ].join("\n");
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function formatTransportBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MiB`;
}

function samePath(left, right) {
  if (!left || !right) return false;
  const normalize = (value) => path.resolve(value).replace(/[\\\/]+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

function resolveDefaultCodexTemplate(fileName) {
  const relativePath = path.join(DEFAULT_CODEX_RESOURCE_DIR, fileName);
  const candidates = [];
  const runtimeResourceDir = process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR;
  if (runtimeResourceDir) {
    candidates.push(path.join(runtimeResourceDir, relativePath));
  }
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, relativePath));
  }
  candidates.push(path.resolve(__dirname, "../../resources", relativePath));
  candidates.push(path.resolve(__dirname, "../../../youle_desktop/resources", relativePath));
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function defaultCodexConfigArgs(options = {}) {
  if (process.env.HAOLO_DESKTOP_SKIP_PROVIDER_OVERRIDES === "1") {
    return [];
  }
  const providerBaseUrl = normalizeProviderBaseUrl(firstString(options.providerBaseUrl, DEFAULT_PROVIDER_BASE_URL));
  const deepSeekProviderBaseUrl = normalizeProviderBaseUrl(
    firstString(options.deepSeekProviderBaseUrl, providerBaseUrl, DEEPSEEK_EXECUTION_DEFAULT_BASE_URL),
  );
  const args = [
    "-c",
    `model_provider="${DEFAULT_PROVIDER_ID}"`,
    "-c",
    `model="${DEFAULT_MODEL}"`,
    "-c",
    `model_reasoning_effort="${DEFAULT_MODEL_REASONING_EFFORT}"`,
    "-c",
    "features.network_proxy.enabled=false",
    "-c",
    `features.multi_agent_v2.max_concurrent_threads_per_session=${DEFAULT_AGENT_MAX_THREADS_PER_SESSION}`,
    "-c",
    `model_providers.${DEFAULT_PROVIDER_ID}.name="${DEFAULT_PROVIDER_ID}"`,
    "-c",
    `model_providers.${DEFAULT_PROVIDER_ID}.base_url="${providerBaseUrl}"`,
    "-c",
    `model_providers.${DEFAULT_PROVIDER_ID}.wire_api="${DEFAULT_PROVIDER_WIRE_API}"`,
    "-c",
    `model_providers.${DEFAULT_PROVIDER_ID}.requires_openai_auth=true`,
    "-c",
    `model_providers.${DEFAULT_PROVIDER_ID}.env_key="OPENAI_API_KEY"`,
    "-c",
    `model_providers.${DEFAULT_PROVIDER_ID}.http_headers.version="${DEFAULT_PROVIDER_CODEX_VERSION}"`,
    "-c",
    `model_providers.${DEFAULT_PROVIDER_ID}.http_headers.X-Haolo-Model-Pool="${DEFAULT_PROVIDER_MODEL_POOL}"`,
    "-c",
    `model_providers.${DEFAULT_PROVIDER_ID}.http_headers.X-Haolo-Model-Capability="${DEFAULT_PROVIDER_MODEL_CAPABILITY}"`,
    "-c",
    `model_providers.${DEEPSEEK_EXECUTION_PROVIDER_ID}.name="DeepSeek"`,
    "-c",
    `model_providers.${DEEPSEEK_EXECUTION_PROVIDER_ID}.base_url="${deepSeekProviderBaseUrl}"`,
    "-c",
    `model_providers.${DEEPSEEK_EXECUTION_PROVIDER_ID}.wire_api="responses"`,
    "-c",
    `model_providers.${DEEPSEEK_EXECUTION_PROVIDER_ID}.requires_openai_auth=false`,
    "-c",
    `model_providers.${DEEPSEEK_EXECUTION_PROVIDER_ID}.env_key="${DEEPSEEK_EXECUTION_ENV_KEY}"`,
    "-c",
    `model_providers.${DEEPSEEK_EXECUTION_PROVIDER_ID}.supports_websockets=false`,
    // Native sampling retries misclassify HTTP 403 as disconnects. The host
    // owns finite transient recovery and must see terminal denials immediately.
    "-c",
    `model_providers.${DEEPSEEK_EXECUTION_PROVIDER_ID}.request_max_retries=0`,
    "-c",
    `model_providers.${DEEPSEEK_EXECUTION_PROVIDER_ID}.stream_max_retries=0`,
    "-c",
    `model_providers.${DEEPSEEK_EXECUTION_PROVIDER_ID}.http_headers.version="${DEFAULT_PROVIDER_CODEX_VERSION}"`,
    "-c",
    `model_providers.${DEEPSEEK_EXECUTION_PROVIDER_ID}.http_headers.X-Haolo-Model-Pool="${DEFAULT_PROVIDER_MODEL_POOL}"`,
    "-c",
    `model_providers.${DEEPSEEK_EXECUTION_PROVIDER_ID}.http_headers.X-Haolo-Model-Capability="${DEFAULT_PROVIDER_MODEL_CAPABILITY}"`,
  ];
  if (process.platform === "win32") {
    args.splice(6, 0, "-c", `windows.sandbox="${DEFAULT_WINDOWS_SANDBOX_MODE}"`);
  }
  if (options.defaultProviderSupportsWebsockets === false) {
    args.push(
      "-c",
      `model_providers.${DEFAULT_PROVIDER_ID}.supports_websockets=false`,
    );
  }
  return args;
}

async function resolveExecutionProviderRuntime(resolver) {
  if (typeof resolver !== "function") {
    return {
      env: {},
      deepSeek: null,
      status: { deepSeek: { available: false, reason: "missing-resolver" } },
    };
  }
  try {
    const value = await resolver();
    const apiKey = firstString(value?.deepSeek?.apiKey, value?.deepseek?.apiKey);
    const baseUrl = normalizeProviderBaseUrl(
      firstString(
        value?.deepSeek?.baseUrl,
        value?.deepseek?.baseUrl,
        DEEPSEEK_EXECUTION_DEFAULT_BASE_URL,
      ),
    );
    const routeGroupId = Number(
      value?.deepSeek?.routeGroupId ?? value?.deepseek?.routeGroupId,
    );
    if (!apiKey) {
      return {
        env: {},
        deepSeek: null,
        status: { deepSeek: { available: false, reason: "missing-credential" } },
      };
    }
    const deepSeek = {
      baseUrl,
      routeGroupId:
        Number.isSafeInteger(routeGroupId) && routeGroupId > 0
          ? routeGroupId
          : null,
    };
    return {
      env: { [DEEPSEEK_EXECUTION_ENV_KEY]: apiKey },
      deepSeek,
      status: { deepSeek: { available: true, ...deepSeek } },
    };
  } catch (error) {
    return {
      env: {},
      deepSeek: null,
      status: {
        deepSeek: {
          available: false,
          reason: "resolver-error",
          error: error?.message || String(error),
        },
      },
    };
  }
}

function normalizeProviderBaseUrl(value) {
  return normalizeHaoloGatewayBaseUrl(value);
}

function resolveBundledDeepSeekMcpServer() {
  return resolveBundledMcpServer(DEEPSEEK_MCP_SERVER_FILE);
}

function resolveBundledGitHubMcpServer() {
  return resolveBundledMcpServer(GITHUB_MCP_SERVER_FILE);
}

function resolveBundledChromeMcpServer() {
  return resolveBundledMcpServer(CHROME_MCP_SERVER_FILE);
}

function resolveBundledPersonalContextMcpServer() {
  return resolveBundledMcpServer(PERSONAL_CONTEXT_MCP_SERVER_FILE);
}

function resolveBundledMcpServer(relativeFile) {
  const candidates = [];
  const runtimeResourceDir = process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR;
  if (runtimeResourceDir) {
    candidates.push(path.join(runtimeResourceDir, relativeFile));
  }
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, relativeFile));
  }
  candidates.push(path.resolve(__dirname, "../../resources", relativeFile));
  candidates.push(path.resolve(__dirname, "../../../youle_desktop/resources", relativeFile));
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function resolveBundledDeepSeekMcpCommand() {
  const candidates = [];
  if (process.versions?.electron || process.resourcesPath) {
    candidates.push(process.execPath);
  }
  if (process.platform === "win32") {
    candidates.push(path.resolve(__dirname, "../../node_modules/electron/dist/electron.exe"));
    candidates.push(path.resolve(__dirname, "../../../node_modules/electron/dist/electron.exe"));
    candidates.push(path.resolve(__dirname, "../../../youle_desktop/node_modules/electron/dist/electron.exe"));
  } else if (process.platform === "darwin") {
    candidates.push(path.resolve(__dirname, "../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"));
    candidates.push(path.resolve(__dirname, "../../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"));
  } else {
    candidates.push(path.resolve(__dirname, "../../node_modules/electron/dist/electron"));
    candidates.push(path.resolve(__dirname, "../../../node_modules/electron/dist/electron"));
  }
  candidates.push(process.execPath);
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || process.execPath;
}

function tomlString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function resolveCodexCommand(cwd = process.cwd()) {
  const envCommand = process.env.HAOLO_DESKTOP_CODEX_BIN || process.env.CODEX_DESKTOP_CODEX_BIN || process.env.CODEX_BIN;
  if (envCommand && fs.existsSync(envCommand)) {
    return envCommand;
  }

  for (const candidate of youleAiCandidates(cwd)) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const repoRoot = findRepoRoot(cwd) || findRepoRoot(path.resolve(__dirname, "../../.."));
  const localNames = process.platform === "win32" ? ["codex.exe", "codex"] : ["codex"];
  if (repoRoot) {
    for (const name of localNames) {
      const candidate = path.join(repoRoot, "codex-rs", "target", "debug", name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  for (const candidate of packagedCandidates()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  for (const candidate of npmGlobalCandidates()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  for (const candidate of pathCandidates()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === "win32" ? "codex.cmd" : "codex";
}

export function resolveYouleAiCommand(cwd = process.cwd()) {
  const envCommand = process.env.HAOLO_DESKTOP_YOULE_BIN || process.env.HAOLO_DESKTOP_YOULE_AI_BIN;
  if (envCommand && fs.existsSync(envCommand)) {
    return envCommand;
  }
  for (const candidate of youleAiCandidates(cwd)) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return resolveCodexCommand(cwd);
}

function findRepoRoot(start) {
  let current = path.resolve(start);
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "codex-rs", "Cargo.toml"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

function packagedCandidates() {
  const candidates = [];
  const runtimeBinDir = process.env.HAOLO_DESKTOP_RUNTIME_BIN_DIR;
  if (runtimeBinDir) {
    candidates.push(path.join(runtimeBinDir, PACKAGED_CODEX_BIN));
  }
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, PACKAGED_CODEX_BIN));
    candidates.push(path.join(process.resourcesPath, "codex"));
    candidates.push(path.join(process.resourcesPath, "bin", PACKAGED_CODEX_BIN));
  }
  if (PACKAGED_CODEX_PLATFORM_BIN_DIR) {
    candidates.push(path.resolve(__dirname, "../../resources/bin", PACKAGED_CODEX_PLATFORM_BIN_DIR, PACKAGED_CODEX_BIN));
    candidates.push(path.resolve(__dirname, "../../../youle_desktop/resources/bin", PACKAGED_CODEX_PLATFORM_BIN_DIR, PACKAGED_CODEX_BIN));
  }
  candidates.push(path.resolve(__dirname, "../../resources/bin", PACKAGED_CODEX_BIN));
  candidates.push(path.resolve(__dirname, "../../../youle_desktop/resources/bin", PACKAGED_CODEX_BIN));
  return candidates;
}

function youleAiCandidates(cwd) {
  const candidates = [];
  const runtimeBinDir = process.env.HAOLO_DESKTOP_RUNTIME_BIN_DIR;
  if (runtimeBinDir) {
    candidates.push(path.join(runtimeBinDir, PACKAGED_CODEX_BIN));
  }
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "bin", PACKAGED_CODEX_BIN));
    candidates.push(path.join(process.resourcesPath, PACKAGED_CODEX_BIN));
  }
  if (PACKAGED_CODEX_PLATFORM_BIN_DIR && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "bin", PACKAGED_CODEX_PLATFORM_BIN_DIR, PACKAGED_CODEX_BIN));
  }
  const repoRoot = findRepoRoot(cwd) || findRepoRoot(path.resolve(__dirname, "../../.."));
  if (repoRoot) {
    candidates.push(path.join(repoRoot, "youle_desktop", "resources", "bin", PACKAGED_CODEX_BIN));
  }
  candidates.push(path.resolve(__dirname, "../../resources/bin", PACKAGED_CODEX_BIN));
  if (PACKAGED_CODEX_PLATFORM_BIN_DIR) {
    candidates.push(path.resolve(__dirname, "../../resources/bin", PACKAGED_CODEX_PLATFORM_BIN_DIR, PACKAGED_CODEX_BIN));
  }
  candidates.push(path.resolve(__dirname, "../../../youle_desktop/resources/bin", PACKAGED_CODEX_BIN));
  return candidates;
}

function npmGlobalCandidates() {
  if (process.platform !== "win32") {
    return [];
  }
  const root = process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex");
  if (!root) {
    return [];
  }
  const vendor = path.join(root, "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc");
  return [
    path.join(vendor, "bin", "codex.exe"),
    path.join(vendor, "codex", "codex.exe"),
    path.join(root, "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"),
    path.join(root, "vendor", "x86_64-pc-windows-msvc", "codex", "codex.exe"),
  ];
}

function pathCandidates() {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const names = process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];
  const found = [];
  for (const name of names) {
    try {
      const output = execFileSync(command, [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          found.push(trimmed);
        }
      }
    } catch {
      // keep looking
    }
  }
  return found;
}

function needsShell(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error("failed to allocate a local port"));
        }
      });
    });
  });
}

async function waitForReady(url, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      throw new Error(`app-server exited before ready with code ${child.exitCode}`);
    }
    try {
      const response = await fetchReadyCheck(url, Math.min(READY_CHECK_REQUEST_TIMEOUT_MS, Math.max(1, deadline - Date.now())));
      if (response.ok) {
        return;
      }
      lastError = new Error(`ready check returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error("timed out waiting for app-server readiness");
}

async function fetchReadyCheck(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

export function defaultWorkspace() {
  return process.env.HAOLO_DESKTOP_WORKSPACE || process.env.CODEX_DESKTOP_WORKSPACE || findRepoRoot(process.cwd()) || os.homedir();
}
