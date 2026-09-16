import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AppServerClient,
  DEEPSEEK_EXECUTION_ENV_KEY,
  DEEPSEEK_EXECUTION_MODEL,
  buildManagedLongContextModelCatalog,
  buildAppServerEnv,
  defaultCodexConfigArgs,
  loadDefaultCodexAuthEnv,
  resolveAppServerProcessCwd,
  sanitizeAppServerProxyEnv,
  syncDefaultCodexResources,
} from "../src/main/app-server-client.mjs";

const bundledRuntimeVersion = JSON.parse(fs.readFileSync(new URL(
  process.platform === "darwin" ? "../resources/bin/codex-runtime-macos.json" : "../resources/bin/codex-runtime.json",
  import.meta.url,
), "utf8")).version;

test("late responses after request timeout stay correlated and do not become protocol errors", async () => {
  const client = new AppServerClient();
  const sent = [];
  const lateResponses = [];
  const protocolErrors = [];
  client.ws = {
    readyState: 1,
    send(payload) {
      sent.push(JSON.parse(payload));
    },
  };
  client.on("late-response", (event) => lateResponses.push(event));
  client.on("protocol-error", (event) => protocolErrors.push(event));

  await assert.rejects(
    client.request("turn/interrupt", { threadId: "thread-1", turnId: "turn-1" }, 10),
    /turn\/interrupt timed out after 10ms/,
  );
  client.handleMessage(JSON.stringify({ id: sent[0].id, result: {} }));

  assert.equal(client.pending.size, 0);
  assert.equal(client.timedOutRequests.size, 0);
  assert.deepEqual(protocolErrors, []);
  assert.equal(lateResponses.length, 1);
  assert.equal(lateResponses[0].id, sent[0].id);
  assert.equal(lateResponses[0].method, "turn/interrupt");
  assert.ok(lateResponses[0].lateByMs >= 0);

  client.handleMessage(JSON.stringify({ id: sent[0].id + 1, result: {} }));
  assert.equal(protocolErrors.length, 1);
  assert.equal(protocolErrors[0].error, `response for unknown id ${sent[0].id + 1}`);
});

const MANAGED_MODEL_SLUGS = ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
const MANAGED_TOP_LEVEL_CONTEXT_KEYS = [
  "model_context_window",
  "model_auto_compact_token_limit",
  "model_auto_compact_token_limit_scope",
  "compact_prompt",
];

function assertLegacyContextPinsAbsent(config) {
  assert.doesNotMatch(config, /^model_context_window\s*=\s*272000\s*$/m);
  assert.doesNotMatch(config, /^(?:model_auto_compact_token_limit|"model_auto_compact_token_limit")\s*=\s*244800\s*$/m);
  assert.doesNotMatch(config, /^model_context_window\s*=\s*1050000\s*$/m);
  assert.doesNotMatch(config, /^(?:model_auto_compact_token_limit|"model_auto_compact_token_limit")\s*=\s*800000\s*$/m);
}

function assertManagedTopLevelContextPinsAbsent(config) {
  for (const key of MANAGED_TOP_LEVEL_CONTEXT_KEYS) {
    assert.doesNotMatch(config, new RegExp(`^${key}\\s*=`, "m"));
  }
}

function assertRemotePluginDisabled(config) {
  assert.match(config, /^\[features\][\s\S]*?^remote_plugin\s*=\s*false\s*$/m);
}

function assertWindowsSandboxCompatibilityMode(config) {
  assert.match(config, /^\[features\.network_proxy\][\s\S]*?^enabled\s*=\s*false\s*$/m);
  if (/^\[windows\]$/m.test(config)) {
    assert.match(config, /^\[windows\][\s\S]*?^sandbox\s*=\s*"unelevated"\s*$/m);
  } else {
    assert.notEqual(process.platform, "win32");
  }
}

function bundledModelCatalogFixture() {
  return {
    models: [
      ...MANAGED_MODEL_SLUGS.map((slug, index) => ({
        slug,
        context_window: index === 0 ? 272_000 : 372_000,
        max_context_window: index === 0 ? 272_000 : 372_000,
        auto_compact_token_limit: null,
        effective_context_window_percent: 95,
        preserved: `${slug}-metadata`,
      })),
      {
        slug: "gpt-5.4-mini",
        context_window: 128_000,
        max_context_window: 128_000,
        preserved: "unmanaged-model",
      },
    ],
  };
}

function assertWebsocketCompatibilityMode(config) {
  assert.match(config, /^supports_websockets\s*=\s*true\s*$/m);
  assert.match(config, /^request_max_retries\s*=\s*2\s*$/m);
  assert.match(config, /^stream_max_retries\s*=\s*3\s*$/m);
  assert.doesNotMatch(config, /^responses_websockets_v2\s*=/m);
}

function withRuntimeConfigFixture(run) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-context-config-"));
  const resourceRoot = path.join(tempRoot, "runtime-resources");
  const defaultResourceRoot = path.join(resourceRoot, "default-haolo-ai");
  const previousResourceDir = process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR;
  const previousSkipDeepSeek = process.env.HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP;
  try {
    fs.mkdirSync(path.join(defaultResourceRoot, "skills"), { recursive: true });
    fs.copyFileSync(
      new URL("../resources/default-haolo-ai/config.toml", import.meta.url),
      path.join(defaultResourceRoot, "config.toml"),
    );
    process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR = resourceRoot;
    process.env.HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP = "1";
    return run({ tempRoot, resourceRoot });
  } finally {
    if (previousResourceDir === undefined) {
      delete process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR;
    } else {
      process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR = previousResourceDir;
    }
    if (previousSkipDeepSeek === undefined) {
      delete process.env.HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP;
    } else {
      process.env.HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP = previousSkipDeepSeek;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function withBuiltinPluginFixture(run) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-plugin-sync-"));
  const resourceRoot = path.join(tempRoot, "runtime-resources");
  const defaultResourceRoot = path.join(resourceRoot, "default-haolo-ai");
  const pluginsRoot = path.join(defaultResourceRoot, "plugins");
  const previousResourceDir = process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR;
  const previousSkipDeepSeek = process.env.HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP;
  const marketplaces = [
    {
      name: "haolo-bundled",
      plugins: [
        { name: "chrome", version: "0.1.0" },
        { name: "latex", version: "0.2.2" },
      ],
    },
    {
      name: "haolo-primary-runtime",
      plugins: [
        { name: "documents", version: "26.601.10930" },
        { name: "presentations", version: "26.601.10930" },
        { name: "spreadsheets", version: "26.601.10930" },
      ],
    },
  ];
  try {
    fs.mkdirSync(path.join(defaultResourceRoot, "skills"), { recursive: true });
    fs.copyFileSync(
      new URL("../resources/default-haolo-ai/config.toml", import.meta.url),
      path.join(defaultResourceRoot, "config.toml"),
    );
    for (const marketplace of marketplaces) {
      const marketplaceRoot = path.join(pluginsRoot, "cache", marketplace.name);
      const marketplaceManifest = path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json");
      fs.mkdirSync(path.dirname(marketplaceManifest), { recursive: true });
      fs.writeFileSync(marketplaceManifest, JSON.stringify({ name: marketplace.name }), "utf8");
      for (const plugin of marketplace.plugins) {
        const pluginRoot = path.join(marketplaceRoot, plugin.name, plugin.version);
        fs.mkdirSync(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
        fs.writeFileSync(
          path.join(pluginRoot, ".codex-plugin", "plugin.json"),
          JSON.stringify({ name: plugin.name, version: plugin.version }),
          "utf8",
        );
        fs.writeFileSync(path.join(pluginRoot, "payload.txt"), `${plugin.name}:v1`, "utf8");
      }
    }
    process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR = resourceRoot;
    process.env.HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP = "1";
    return run({ tempRoot, pluginsRoot });
  } finally {
    if (previousResourceDir === undefined) delete process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR;
    else process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR = previousResourceDir;
    if (previousSkipDeepSeek === undefined) delete process.env.HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP;
    else process.env.HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP = previousSkipDeepSeek;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("bundled runtime config uses per-model context defaults and pins remote plugin behavior", () => {
  const config = fs.readFileSync(new URL("../resources/default-haolo-ai/config.toml", import.meta.url), "utf8");

  assert.match(config, /^model\s*=\s*"gpt-5\.6-sol"\s*$/m);
  assert.match(config, /^model_reasoning_effort\s*=\s*"high"\s*$/m);
  assert.doesNotMatch(config, /^disable_response_storage\s*=/m);
  assertManagedTopLevelContextPinsAbsent(config);
  assertLegacyContextPinsAbsent(config);
  assertRemotePluginDisabled(config);
  assertWindowsSandboxCompatibilityMode(config);
  assertWebsocketCompatibilityMode(config);
  assert.match(
    config,
    /^http_headers\s*=\s*\{\s*version\s*=\s*"0\.153\.4",\s*"X-Haolo-Model-Pool"\s*=\s*"execution",\s*"X-Haolo-Model-Capability"\s*=\s*"root_execution"\s*\}\s*$/m,
  );
  assert.match(config, /^\[model_providers\.deepseek\]$/m);
  assert.match(config, /^wire_api\s*=\s*"responses"$/m);
  assert.match(config, /^env_key\s*=\s*"HAOLO_DEEPSEEK_EXECUTION_TOKEN"$/m);
  assert.match(config, /^supports_websockets\s*=\s*false$/m);
  assert.doesNotMatch(config, /x-openai-internal-codex-responses-lite/i);
});

test("runtime provider overrides always send the bundled Codex version without forcing Responses Lite", () => {
  const args = defaultCodexConfigArgs({ providerBaseUrl: "https://relay.example.test/v1" });

  assert.ok(args.includes('model="gpt-5.6-sol"'));
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.equal(args.includes('windows.sandbox="unelevated"'), process.platform === "win32");
  assert.ok(args.includes("features.network_proxy.enabled=false"));
  assert.ok(args.includes("features.multi_agent_v2.max_concurrent_threads_per_session=1"));
  assert.equal(args.some((arg) => arg.startsWith("agents.max_threads=")), false);
  for (const provider of ["haolo_ai", "deepseek"]) {
    assert.ok(args.includes(`model_providers.${provider}.http_headers.version="${bundledRuntimeVersion}"`));
  }
  assert.ok(args.includes('model_providers.haolo_ai.http_headers.X-Haolo-Model-Pool="execution"'));
  assert.ok(args.includes('model_providers.haolo_ai.http_headers.X-Haolo-Model-Capability="root_execution"'));
  assert.ok(args.includes('model_providers.deepseek.name="DeepSeek"'));
  assert.ok(args.includes('model_providers.deepseek.wire_api="responses"'));
  assert.ok(args.includes('model_providers.deepseek.requires_openai_auth=false'));
  assert.ok(args.includes('model_providers.deepseek.env_key="HAOLO_DEEPSEEK_EXECUTION_TOKEN"'));
  assert.ok(args.includes('model_providers.deepseek.supports_websockets=false'));
  assert.equal(args.some((arg) => /model_providers\.haolo_ai\.supports_websockets/i.test(arg)), false);
  assert.ok(args.includes("model_providers.deepseek.request_max_retries=0"));
  assert.ok(args.includes("model_providers.deepseek.stream_max_retries=0"));
  assert.equal(args.some((arg) => /model_providers\.haolo_ai\.(?:request|stream)_max_retries/.test(arg)), false);
  assert.equal(args.some((arg) => /responses_websockets_v2/i.test(arg)), false);
  assert.equal(args.some((arg) => /x-openai-internal-codex-responses-lite/i.test(arg)), false);
});

test("direct GPT provider preserves Responses WebSocket transport", () => {
  const directArgs = defaultCodexConfigArgs({
    providerBaseUrl: "https://relay.example.test/v1",
  });
  const relayedArgs = defaultCodexConfigArgs({
    providerBaseUrl: "http://127.0.0.1:43123/v1",
    defaultProviderSupportsWebsockets: false,
  });

  assert.equal(
    directArgs.some((arg) => /model_providers\.haolo_ai\.supports_websockets=false/i.test(arg)),
    false,
  );
  assert.ok(relayedArgs.includes("model_providers.haolo_ai.supports_websockets=false"));
});

test("model request relay bypasses GPT and relays HTTP-only DeepSeek", async () => {
  const client = new AppServerClient();
  try {
    const routes = await client.startModelRequestRelays({
      default: { baseUrl: "https://gpt.example.test/v1", relay: false },
      deepSeek: { baseUrl: "https://deepseek.example.test/v1", relay: true },
    });

    assert.deepEqual(routes.default, {
      baseUrl: "https://gpt.example.test/v1",
      relay: false,
    });
    assert.equal(routes.deepSeek.relay, true);
    assert.match(routes.deepSeek.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    assert.equal(client.modelTransport.enabled, true);
    assert.deepEqual(
      client.modelTransport.routes.map(({ name, relay }) => ({ name, relay })),
      [
        { name: "default", relay: false },
        { name: "deepSeek", relay: true },
      ],
    );
  } finally {
    await client.stopModelRequestRelays();
  }
});

test("default resource sync gives a new Codex home per-model context policies", () => {
  withRuntimeConfigFixture(({ tempRoot }) => {
    const codexHome = path.join(tempRoot, "new-codex-home");
    const result = syncDefaultCodexResources(codexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
      bundledModelCatalog: bundledModelCatalogFixture(),
    });
    const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
    const catalog = JSON.parse(fs.readFileSync(path.join(codexHome, "haolo-model-catalog.json"), "utf8"));

    assert.equal(result.action, "synced");
    assert.ok(result.copied.includes("config.toml"));
    assertManagedTopLevelContextPinsAbsent(config);
    assert.match(config, /^model_catalog_json\s*=\s*"haolo-model-catalog\.json"\s*$/m);
    assert.ok(result.copied.includes("haolo-model-catalog.json"));
    assert.ok(result.copied.includes("config.toml:model-catalog"));
    for (const slug of MANAGED_MODEL_SLUGS) {
      const model = catalog.models.find((candidate) => candidate.slug === slug);
      assert.equal(model.context_window, 400_000);
      assert.equal(model.max_context_window, 400_000);
      assert.equal(model.auto_compact_token_limit, 300_000);
      assert.equal(model.effective_context_window_percent, 95);
      assert.equal(model.preserved, `${slug}-metadata`);
    }
    assert.equal(catalog.models.find((candidate) => candidate.slug === "gpt-5.4-mini").context_window, 128_000);
    const deepSeek = catalog.models.find((candidate) => candidate.slug === DEEPSEEK_EXECUTION_MODEL);
    assert.ok(deepSeek);
    assert.equal(deepSeek.prefer_websockets, false);
    assert.equal(deepSeek.minimal_client_version, "0.144.0");
    assert.deepEqual(deepSeek.input_modalities, ["text"]);
    assert.equal(deepSeek.shell_type, "shell_command");
    assert.equal(deepSeek.apply_patch_tool_type, "freeform");
    assert.ok(deepSeek.supported_reasoning_levels.some((level) => level.effort === "max"));
    assertLegacyContextPinsAbsent(config);
    assertRemotePluginDisabled(config);
    assertWindowsSandboxCompatibilityMode(config);
    assertWebsocketCompatibilityMode(config);
  });
});

test("default resource sync backfills an old config while forcing the managed Haolo WebSocket transport", () => {
  withRuntimeConfigFixture(({ tempRoot }) => {
    const oldCodexHome = path.join(tempRoot, "old-codex-home");
    fs.mkdirSync(oldCodexHome, { recursive: true });
    fs.writeFileSync(
      path.join(oldCodexHome, "config.toml"),
      [
        "# Existing user config from an older desktop release.",
        'model = "user-selected-model"',
        "",
        "[model_providers.user_provider]",
        'name = "user_provider"',
        "",
      ].join("\n"),
      "utf8",
    );

    const firstResult = syncDefaultCodexResources(oldCodexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
    });
    const firstConfig = fs.readFileSync(path.join(oldCodexHome, "config.toml"), "utf8");
    const secondResult = syncDefaultCodexResources(oldCodexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
    });
    const secondConfig = fs.readFileSync(path.join(oldCodexHome, "config.toml"), "utf8");

    assert.ok(firstResult.copied.includes("config.toml:context-defaults"));
    assertManagedTopLevelContextPinsAbsent(firstConfig);
    assertLegacyContextPinsAbsent(firstConfig);
    assertRemotePluginDisabled(firstConfig);
    assertWindowsSandboxCompatibilityMode(firstConfig);
    assertWebsocketCompatibilityMode(firstConfig);
    assert.match(firstConfig, /^model = "user-selected-model"$/m);
    assert.equal(secondConfig, firstConfig);
    assert.equal(secondResult.copied.includes("config.toml:context-defaults"), false);

    const customCodexHome = path.join(tempRoot, "custom-codex-home");
    fs.mkdirSync(customCodexHome, { recursive: true });
    fs.writeFileSync(
      path.join(customCodexHome, "config.toml"),
      [
        "model_context_window = 400000",
        '"model_auto_compact_token_limit" = 300000',
        'compact_prompt = "Keep my custom checkpoint format."',
        'model_catalog_json = "custom-models.json"',
        "",
        "[features]",
        "plugins = true",
        "",
      ].join("\n"),
      "utf8",
    );

    syncDefaultCodexResources(customCodexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
      bundledModelCatalog: bundledModelCatalogFixture(),
    });
    const customConfig = fs.readFileSync(path.join(customCodexHome, "config.toml"), "utf8");

    assert.match(customConfig, /^model_context_window = 400000$/m);
    assert.match(customConfig, /^"model_auto_compact_token_limit" = 300000$/m);
    assert.doesNotMatch(customConfig, /^model_auto_compact_token_limit_scope\s*=/m);
    assert.match(customConfig, /^compact_prompt = "Keep my custom checkpoint format\."$/m);
    assert.match(customConfig, /^model_catalog_json = "custom-models\.json"$/m);
    assert.equal(fs.existsSync(path.join(customCodexHome, "haolo-model-catalog.json")), false);
    assertRemotePluginDisabled(customConfig);
    assertWindowsSandboxCompatibilityMode(customConfig);
    assertWebsocketCompatibilityMode(customConfig);
    assert.equal((customConfig.match(/^model_context_window\s*=/gm) || []).length, 1);
    assert.equal((customConfig.match(/^(?:model_auto_compact_token_limit|"model_auto_compact_token_limit")\s*=/gm) || []).length, 1);

    const explicitFeatureHome = path.join(tempRoot, "explicit-feature-home");
    fs.mkdirSync(explicitFeatureHome, { recursive: true });
    fs.writeFileSync(
      path.join(explicitFeatureHome, "config.toml"),
      [
        'model = "user-selected-model"',
        "",
        "[features]",
        "remote_plugin = true",
        "plugins = true",
        "",
        "[model_providers.haolo_ai]",
        "supports_websockets = false",
        "request_max_retries = 3",
        "stream_max_retries = 4",
        "",
      ].join("\n"),
      "utf8",
    );
    syncDefaultCodexResources(explicitFeatureHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
    });
    const explicitFeatureConfig = fs.readFileSync(path.join(explicitFeatureHome, "config.toml"), "utf8");
    assert.match(explicitFeatureConfig, /^remote_plugin = true$/m);
    assert.match(explicitFeatureConfig, /^supports_websockets = true$/m);
    assertWindowsSandboxCompatibilityMode(explicitFeatureConfig);
    assert.match(explicitFeatureConfig, /^request_max_retries = 3$/m);
    assert.match(explicitFeatureConfig, /^stream_max_retries = 4$/m);
    assert.equal((explicitFeatureConfig.match(/^remote_plugin\s*=/gm) || []).length, 1);
    assert.equal((explicitFeatureConfig.match(/^supports_websockets\s*=/gm) || []).length, 1);
    assert.equal((explicitFeatureConfig.match(/^request_max_retries\s*=/gm) || []).length, 1);
    assert.equal((explicitFeatureConfig.match(/^stream_max_retries\s*=/gm) || []).length, 1);
  });
});

test("default resource sync replaces elevated Windows sandbox settings in every Codex home", { skip: process.platform !== "win32" }, () => {
  withRuntimeConfigFixture(({ tempRoot }) => {
    const codexHome = path.join(tempRoot, "windows-sandbox-migration-home");
    const runtimeDotCodex = path.join(codexHome, "runtime-home", ".codex");
    for (const home of [codexHome, runtimeDotCodex]) {
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(
        path.join(home, "config.toml"),
        [
          "[features.network_proxy]",
          "enabled = true # stale desktop setting",
          "",
          "[windows]",
          'sandbox = "elevated" # stale desktop setting',
          "",
        ].join("\n"),
        "utf8",
      );
    }

    const first = syncDefaultCodexResources(codexHome, { skipPlugins: true });
    const second = syncDefaultCodexResources(codexHome, { skipPlugins: true });

    for (const home of first.codexHomes) {
      const migrated = fs.readFileSync(path.join(home, "config.toml"), "utf8");
      assert.match(migrated, /^enabled = false # stale desktop setting$/m);
      assert.match(migrated, /^sandbox = "unelevated" # stale desktop setting$/m);
      assert.equal((migrated.match(/^enabled\s*=/gm) || []).length, 1);
      assert.equal((migrated.match(/^sandbox\s*=/gm) || []).length, 1);
    }
    assert.ok(first.copied.includes("config.toml:context-defaults"));
    assert.equal(second.copied.includes("config.toml:context-defaults"), false);
  });
});

test("default resource sync forces a dotted Haolo WebSocket override without duplicating it", () => {
  withRuntimeConfigFixture(({ tempRoot }) => {
    const codexHome = path.join(tempRoot, "dotted-websocket-config-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      [
        'model_provider = "haolo_ai"',
        "model_providers.haolo_ai.supports_websockets = false # stale desktop setting",
        "",
      ].join("\n"),
      "utf8",
    );

    const first = syncDefaultCodexResources(codexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
    });
    const migrated = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
    const second = syncDefaultCodexResources(codexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
    });

    assert.match(
      migrated,
      /^model_providers\.haolo_ai\.supports_websockets = true # stale desktop setting$/m,
    );
    assert.equal((migrated.match(/supports_websockets\s*=/gm) || []).length, 1);
    assert.ok(first.copied.includes("config.toml:context-defaults"));
    assert.equal(second.copied.includes("config.toml:context-defaults"), false);
  });
});

test("default resource sync forces WebSockets in both configured and runtime-derived Codex homes", () => {
  withRuntimeConfigFixture(({ tempRoot }) => {
    const codexHome = path.join(tempRoot, "dual-layout-home");
    const runtimeDotCodex = path.join(codexHome, "runtime-home", ".codex");
    for (const home of [codexHome, runtimeDotCodex]) {
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(
        path.join(home, "config.toml"),
        ["[model_providers.haolo_ai]", "supports_websockets = false", ""].join("\n"),
        "utf8",
      );
    }

    const result = syncDefaultCodexResources(codexHome, { skipPlugins: true });

    assert.deepEqual(result.codexHomes, [codexHome, runtimeDotCodex]);
    for (const home of result.codexHomes) {
      const migrated = fs.readFileSync(path.join(home, "config.toml"), "utf8");
      assert.match(migrated, /^supports_websockets = true$/m);
      assert.equal((migrated.match(/^supports_websockets\s*=/gm) || []).length, 1);
    }
  });
});

test("default resource sync removes only legacy Haolo-managed config values", () => {
  withRuntimeConfigFixture(({ tempRoot }) => {
    const codexHome = path.join(tempRoot, "legacy-managed-context-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      [
        'model = "gpt-5.5"',
        "model_context_window = 272000",
        '"model_auto_compact_token_limit" = 244800',
        'model_auto_compact_token_limit_scope = "total"',
        "",
        "[features]",
        "responses_websockets_v2 = true",
        "network_proxy = true",
        "plugins = true",
        "",
        "[model_providers.haolo_ai]",
        "stream_max_retries = 1",
        "",
      ].join("\n"),
      "utf8",
    );

    const first = syncDefaultCodexResources(codexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
    });
    const migrated = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
    const second = syncDefaultCodexResources(codexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
    });

    assertLegacyContextPinsAbsent(migrated);
    assertManagedTopLevelContextPinsAbsent(migrated);
    assert.doesNotMatch(migrated, /^responses_websockets_v2\s*=/m);
    assert.doesNotMatch(migrated, /^network_proxy\s*=/m);
    assertWindowsSandboxCompatibilityMode(migrated);
    assert.match(migrated, /^plugins = true$/m);
    assert.match(migrated, /^request_max_retries = 2$/m);
    assert.match(migrated, /^stream_max_retries = 3$/m);
    assert.ok(first.copied.includes("config.toml:context-defaults"));
    assert.equal(second.copied.includes("config.toml:context-defaults"), false);
  });
});

test("default resource sync aligns provider headers with the host runtime and remains idempotent", () => {
  withRuntimeConfigFixture(({ tempRoot }) => {
    const codexHome = path.join(tempRoot, "legacy-codex-header-home");
    fs.mkdirSync(codexHome, { recursive: true });
    const staleVersion = process.platform === "darwin" ? "0.153.4" : "0.144.1";
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      [
        "[model_providers.haolo_ai]",
        `http_headers = { version = "${staleVersion}", "X-Haolo-Model-Pool" = "execution", "X-Haolo-Model-Capability" = "root_execution" }`,
        "",
        "[model_providers.deepseek]",
        `http_headers = { version = "${staleVersion}", "X-Haolo-Model-Pool" = "execution", "X-Haolo-Model-Capability" = "root_execution" }`,
        "",
      ].join("\n"),
      "utf8",
    );

    const result = syncDefaultCodexResources(codexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
    });
    const migrated = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");

    assert.equal(migrated.split(`version = "${bundledRuntimeVersion}"`).length - 1, 2);
    assert.equal(migrated.includes(`version = "${staleVersion}"`), false);
    const second = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false, skipPlugins: true });
    assert.equal(second.copied.includes("config.toml:context-defaults"), false);
    assert.ok(result.copied.includes("config.toml:context-defaults"));
  });
});

test("default resource sync removes the previous direct-API-sized managed context profile", () => {
  withRuntimeConfigFixture(({ tempRoot }) => {
    const codexHome = path.join(tempRoot, "legacy-million-token-context-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      [
        'model = "gpt-5.6-sol"',
        "model_context_window = 1050000",
        '"model_auto_compact_token_limit" = 800000',
        'model_auto_compact_token_limit_scope = "total"',
        "",
        "[features]",
        "plugins = true",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = syncDefaultCodexResources(codexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
      bundledModelCatalog: bundledModelCatalogFixture(),
    });
    const migrated = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
    const catalog = JSON.parse(fs.readFileSync(path.join(codexHome, "haolo-model-catalog.json"), "utf8"));

    assertManagedTopLevelContextPinsAbsent(migrated);
    assertLegacyContextPinsAbsent(migrated);
    assert.ok(result.copied.includes("config.toml:context-defaults"));
    assert.equal(catalog.models.find((model) => model.slug === "gpt-5.6-sol").context_window, 400_000);
    assert.equal(catalog.models.find((model) => model.slug === "gpt-5.6-sol").auto_compact_token_limit, 300_000);
  });
});

test("managed model catalog fails closed when a required GPT-6/5.5/5.6 entry is missing", () => {
  const catalog = bundledModelCatalogFixture();
  catalog.models = catalog.models.filter((model) => model.slug !== "gpt-5.6-luna");
  assert.throws(
    () => buildManagedLongContextModelCatalog(catalog),
    /missing managed models: gpt-5\.6-luna/,
  );
});

test("builtin plugin sync skips unchanged payloads and mirrors changed managed version directories", () => {
  withBuiltinPluginFixture(({ tempRoot, pluginsRoot }) => {
    const codexHome = path.join(tempRoot, "codex-home");
    const relativeDocumentsRoot = path.join(
      "cache",
      "haolo-primary-runtime",
      "documents",
      "26.601.10930",
    );
    const sourceDocumentsRoot = path.join(pluginsRoot, relativeDocumentsRoot);
    const targetDocumentsRoot = path.join(codexHome, "plugins", relativeDocumentsRoot);
    const staleVersionRoot = path.join(
      codexHome,
      "plugins",
      "cache",
      "haolo-primary-runtime",
      "documents",
      "25.1.0",
    );

    const first = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false });
    const second = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false });
    assert.equal(first.errors.length, 0);
    assert.equal(second.errors.length, 0);
    assert.equal(second.copied.some((entry) => entry.startsWith(`plugins${path.sep}cache${path.sep}`)), false);

    fs.writeFileSync(path.join(targetDocumentsRoot, "stale.txt"), "remove me", "utf8");
    fs.mkdirSync(staleVersionRoot, { recursive: true });
    fs.writeFileSync(path.join(staleVersionRoot, "stale.txt"), "old version", "utf8");

    const repaired = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false });
    assert.equal(repaired.errors.length, 0);
    assert.equal(fs.existsSync(path.join(targetDocumentsRoot, "stale.txt")), false);
    assert.equal(fs.existsSync(staleVersionRoot), false);
    assert.ok(repaired.copied.includes(path.join("plugins", relativeDocumentsRoot)));
    assert.ok(repaired.copied.includes("plugins:pruned"));

    fs.writeFileSync(path.join(sourceDocumentsRoot, "payload.txt"), "documents:v2-with-new-content", "utf8");
    const updated = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false });
    assert.equal(updated.errors.length, 0);
    assert.equal(fs.readFileSync(path.join(targetDocumentsRoot, "payload.txt"), "utf8"), "documents:v2-with-new-content");
    assert.ok(updated.copied.includes(path.join("plugins", relativeDocumentsRoot)));

    const unchanged = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false });
    assert.equal(unchanged.errors.length, 0);
    assert.equal(unchanged.copied.some((entry) => entry.startsWith(`plugins${path.sep}cache${path.sep}`)), false);
  });
});

test("builtin plugin sync avoids recursive fs.cpSync and supports non-ASCII paths", () => {
  withBuiltinPluginFixture(({ tempRoot, pluginsRoot }) => {
    const codexHome = path.join(tempRoot, "用户目录", "codex-home");
    const relativePluginRoot = path.join(
      "cache",
      "haolo-primary-runtime",
      "documents",
      "26.601.10930",
    );
    const sourcePluginRoot = path.join(pluginsRoot, relativePluginRoot);
    const unicodeRelativePath = path.join("中文目录", "使用说明.txt");
    fs.mkdirSync(path.dirname(path.join(sourcePluginRoot, unicodeRelativePath)), { recursive: true });
    fs.writeFileSync(path.join(sourcePluginRoot, unicodeRelativePath), "中文资源内容", "utf8");

    const originalCpSync = fs.cpSync;
    fs.cpSync = (...args) => {
      if (args[2]?.recursive) {
        throw new Error("recursive fs.cpSync must not be used for managed plugin sync");
      }
      return originalCpSync(...args);
    };

    try {
      const result = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false });
      assert.equal(result.errors.length, 0);
      assert.equal(
        fs.readFileSync(path.join(codexHome, "plugins", relativePluginRoot, unicodeRelativePath), "utf8"),
        "中文资源内容",
      );
    } finally {
      fs.cpSync = originalCpSync;
    }
  });
});

test("builtin plugin sync keeps the previous managed copy when staging fails", () => {
  withBuiltinPluginFixture(({ tempRoot, pluginsRoot }) => {
    const codexHome = path.join(tempRoot, "codex-home");
    const relativePluginRoot = path.join(
      "cache",
      "haolo-primary-runtime",
      "documents",
      "26.601.10930",
    );
    const sourcePayload = path.join(pluginsRoot, relativePluginRoot, "payload.txt");
    const targetPluginRoot = path.join(codexHome, "plugins", relativePluginRoot);
    const targetPayload = path.join(targetPluginRoot, "payload.txt");

    const first = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false });
    assert.equal(first.errors.length, 0);
    assert.equal(fs.readFileSync(targetPayload, "utf8"), "documents:v1");

    fs.writeFileSync(sourcePayload, "documents:v2-copy-failure", "utf8");
    const originalCopyFileSync = fs.copyFileSync;
    fs.copyFileSync = (source, target, ...rest) => {
      if (path.resolve(source) === path.resolve(sourcePayload)) {
        const error = new Error("simulated managed plugin copy failure");
        error.code = "EACCES";
        throw error;
      }
      return originalCopyFileSync(source, target, ...rest);
    };

    try {
      const failed = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false });
      assert.ok(failed.errors.some((error) => /simulated managed plugin copy failure/.test(error.message)));
      assert.equal(fs.readFileSync(targetPayload, "utf8"), "documents:v1");
      assert.equal(
        fs.readdirSync(path.dirname(targetPluginRoot)).some((name) => name.includes(".haolo-staging-")),
        false,
      );
    } finally {
      fs.copyFileSync = originalCopyFileSync;
    }
  });
});

test("builtin plugin sync reports incomplete marketplace resources", () => {
  withBuiltinPluginFixture(({ tempRoot, pluginsRoot }) => {
    fs.rmSync(
      path.join(
        pluginsRoot,
        "cache",
        "haolo-primary-runtime",
        "spreadsheets",
        "26.601.10930",
        ".codex-plugin",
        "plugin.json",
      ),
      { force: true },
    );
    const result = syncDefaultCodexResources(path.join(tempRoot, "incomplete-home"), {
      includeRuntimeDotCodex: false,
    });
    const marketplaceError = result.errors.find((error) => error.target === "plugins:marketplaces");
    assert.ok(marketplaceError);
    assert.match(marketplaceError.message, /spreadsheets@haolo-primary-runtime/);
  });
});

test("app server environment uses an isolated Haolo runtime home", () => {
  const codexHome = path.join("C:", "Users", "Tester", "AppData", "Roaming", "haolo_desktop", "haolo-ai-home");
  const authPath = path.join("C:", "Users", "Tester", "AppData", "Roaming", "haolo_desktop", "default-haolo-ai", "auth.json");
  const workspaceDependencies = path.join("C:", "Users", "Tester", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
  const env = buildAppServerEnv({
    baseEnv: {
      HOME: path.join("C:", "Users", "Tester"),
      USERPROFILE: path.join("C:", "Users", "Tester"),
      XDG_CACHE_HOME: path.join("C:", "Users", "Tester", ".cache"),
      CODEX_WORKSPACE_DEPENDENCIES_NODE_MODULES: workspaceDependencies,
    },
    codexHome,
    authEnv: {},
    providerEnv: { [DEEPSEEK_EXECUTION_ENV_KEY]: "opaque-relay-token" },
    authPath,
    modelBaseUrl: "https://haolo.pro/v1",
  });

  const runtimeHome = path.join(codexHome, "runtime-home");
  assert.equal(env.CODEX_HOME, codexHome);
  assert.equal(env.HAOLO_AI_HOME, codexHome);
  assert.equal(env.HOME, runtimeHome);
  assert.equal(env.USERPROFILE, runtimeHome);
  assert.equal(env.XDG_CACHE_HOME, path.join(runtimeHome, ".cache"));
  assert.equal(env.XDG_CONFIG_HOME, path.join(runtimeHome, ".config"));
  assert.equal(env.XDG_DATA_HOME, path.join(runtimeHome, ".local", "share"));
  assert.equal(env.PYTHONIOENCODING, "utf-8");
  assert.equal(env.PYTHONUTF8, "1");
  assert.equal(env.CODEX_WORKSPACE_DEPENDENCIES_NODE_MODULES, workspaceDependencies);
  assert.equal(env.HAOLO_MODEL_CREDENTIALS_FILE, path.resolve(authPath));
  assert.equal(env[DEEPSEEK_EXECUTION_ENV_KEY], "opaque-relay-token");
  assert.equal(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE, undefined);
});

test("app server removes unavailable loopback proxy variables before spawning", async () => {
  const checked = [];
  const baseEnv = {
    HTTPS_PROXY: "http://127.0.0.1:7897",
    http_proxy: "localhost:7897",
    ALL_PROXY: "socks5://[::1]:7897",
    NO_PROXY: "localhost,127.0.0.1,::1",
    HAOLO_KEEP_ME: "yes",
  };
  const result = await sanitizeAppServerProxyEnv(baseEnv, {
    probeEndpoint: async (endpoint) => {
      checked.push(endpoint);
      return false;
    },
  });

  assert.deepEqual(result.removed.sort(), ["ALL_PROXY", "HTTPS_PROXY", "http_proxy"]);
  assert.equal(result.env.HTTPS_PROXY, undefined);
  assert.equal(result.env.http_proxy, undefined);
  assert.equal(result.env.ALL_PROXY, undefined);
  assert.equal(result.env.NO_PROXY, baseEnv.NO_PROXY);
  assert.equal(result.env.HAOLO_KEEP_ME, "yes");
  assert.equal(baseEnv.HTTPS_PROXY, "http://127.0.0.1:7897");
  assert.ok(checked.length >= 1);
});

test("app server preserves reachable local proxies and non-local proxies", async () => {
  let probeCount = 0;
  const result = await sanitizeAppServerProxyEnv(
    {
      HTTPS_PROXY: "http://localhost:7897",
      ALL_PROXY: "http://proxy.example.test:8080",
    },
    {
      probeEndpoint: async () => {
        probeCount += 1;
        return true;
      },
    },
  );

  assert.deepEqual(result.removed, []);
  assert.equal(result.env.HTTPS_PROXY, "http://localhost:7897");
  assert.equal(result.env.ALL_PROXY, "http://proxy.example.test:8080");
  assert.equal(probeCount, 1);
});

test("Windows app server starts outside a Unicode workspace while keeping the workspace logical path unchanged", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-app-server-cwd-"));
  try {
    const runtimeHome = path.join(tempRoot, "runtime-home");
    fs.mkdirSync(runtimeHome, { recursive: true });
    const workspace = path.join(path.parse(tempRoot).root, "Users", "Tester", "Desktop", "翻译");

    assert.equal(
      resolveAppServerProcessCwd({
        workspaceCwd: workspace,
        runtimeHome,
        platform: "win32",
      }),
      path.resolve(runtimeHome),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("app server preserves normal process cwd behavior for ASCII Windows workspaces and other platforms", () => {
  const workspace = path.resolve("D:\\workspaces\\haolo-test");
  const runtimeHome = path.resolve("C:\\runtime-home");

  assert.equal(
    resolveAppServerProcessCwd({ workspaceCwd: workspace, runtimeHome, platform: "win32" }),
    workspace,
  );
  assert.equal(
    resolveAppServerProcessCwd({ workspaceCwd: path.resolve("/tmp/中文项目"), runtimeHome, platform: "linux" }),
    path.resolve("/tmp/中文项目"),
  );
});

test("app server environment maps an explicit Haolo originator override without changing the default", () => {
  const env = buildAppServerEnv({
    baseEnv: {
      HAOLO_DESKTOP_CODEX_ORIGINATOR_OVERRIDE: "haolo_desktop_registered",
    },
    codexHome: null,
    authEnv: {},
  });

  assert.equal(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE, "haolo_desktop_registered");
});

test("app server isolates inherited Codex Desktop state and prioritizes the Haolo runtime", () => {
  const runtimeBinDir = path.resolve("/opt/haolo-desktop-runtime/test/bin");
  const systemCodexDir = path.resolve("/opt/Codex Desktop/resources");
  const env = buildAppServerEnv({
    baseEnv: {
      PATH: [systemCodexDir, "/usr/bin"].join(path.delimiter),
      HAOLO_DESKTOP_RUNTIME_BIN_DIR: runtimeBinDir,
      CODEX_INSTALL_DIR: systemCodexDir,
      CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Desktop",
      CODEX_PERMISSION_PROFILE: ":danger-full-access",
      CODEX_SQLITE_HOME: path.resolve("D:\\CodexData\\state"),
      CODEX_THREAD_ID: "thread-parent",
    },
    codexHome: path.resolve("/Users/tester/haolo-home"),
    authEnv: {},
  });

  assert.equal(env.PATH.split(path.delimiter)[0], runtimeBinDir);
  assert.equal(env.HAOLO_DESKTOP_RUNTIME_BIN_DIR, runtimeBinDir);
  assert.equal(env.CODEX_INSTALL_DIR, undefined);
  assert.equal(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE, undefined);
  assert.equal(env.CODEX_PERMISSION_PROFILE, undefined);
  assert.equal(env.CODEX_SQLITE_HOME, undefined);
  assert.equal(env.CODEX_THREAD_ID, undefined);
});

test("app server environment exposes ripgrep and generated search guardrails", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-rg-env-"));
  try {
    const binDir = path.join(tempRoot, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const rgPath = path.join(binDir, process.platform === "win32" ? "rg.exe" : "rg");
    fs.writeFileSync(rgPath, "", "utf8");
    const codexHome = path.join(tempRoot, "haolo-ai-home");

    const env = buildAppServerEnv({
      baseEnv: {
        HOME: tempRoot,
        USERPROFILE: tempRoot,
        Path: binDir,
      },
      codexHome,
      authEnv: {},
      modelBaseUrl: "https://haolo.pro/v1",
    });

    assert.equal(env.RIPGREP_PATH, rgPath);
    assert.equal(String(env.Path || env.PATH).split(path.delimiter)[0], binDir);
    assert.equal(env.RIPGREP_CONFIG_PATH, path.join(codexHome, "runtime-home", ".config", "ripgrep", "haolo-ripgrep.config"));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("default resource sync overlays Haolo bundled skills into latest Codex home layouts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-codex-home-"));
  try {
    const codexHome = path.join(tempRoot, "haolo-ai-home");
    const runtimeDotCodex = path.join(codexHome, "runtime-home", ".codex");
    const officialImagegenSkill = path.join(runtimeDotCodex, "skills", ".system", "imagegen", "SKILL.md");
    fs.mkdirSync(path.dirname(officialImagegenSkill), { recursive: true });
    fs.writeFileSync(
      officialImagegenSkill,
      "---\nname: imagegen\n---\n\n# Official Imagegen\n\nDefault built-in tool mode.\n",
      "utf8",
    );

    const result = syncDefaultCodexResources(codexHome, { skipPlugins: true });
    assert.equal(result.action, "synced");
    assert.deepEqual(result.codexHomes, [codexHome, runtimeDotCodex]);

    for (const home of result.codexHomes) {
      const imageSkill = fs.readFileSync(path.join(home, "skills", ".system", "imagegen", "SKILL.md"), "utf8");
      assert.match(imageSkill, /aihubcc\/gpt-image-2/);
      assert.match(imageSkill, /prompt-presets/);
      assert.match(imageSkill, /Fast preset gate/);
      assert.doesNotMatch(imageSkill, /Default built-in tool mode/);
      assert.equal(
        fs.existsSync(path.join(home, "skills", ".system", "imagegen", "scripts", "generate_openai_image.py")),
        true,
      );
      assert.equal(
        fs.existsSync(path.join(home, "skills", ".system", "imagegen", "scripts", "resolve_prompt_preset.py")),
        true,
      );

      const videoSkill = fs.readFileSync(path.join(home, "skills", ".system", "videogen", "SKILL.md"), "utf8");
      assert.match(videoSkill, /grok-imagine-video-1\.5/);
      assert.match(videoSkill, /Video Expert capability API/);
      assert.match(videoSkill, /--model "grok-imagine-video-1\.5"/);
      assert.match(videoSkill, /never calls a provider directly/);
      assert.equal(
        fs.existsSync(path.join(home, "skills", ".system", "videogen", "scripts", "generate_seedance_video.py")),
        true,
      );

      const ripgrepSkillPath = path.join(home, "skills", "ripgrep", "SKILL.md");
      const ripgrepSkill = fs.readFileSync(ripgrepSkillPath, "utf8");
      assert.match(ripgrepSkill, /name: "ripgrep"/);
      assert.match(ripgrepSkill, /Use rg for fast code and text search/);
      assert.match(ripgrepSkill, /BurntSushi\/ripgrep/);
      assert.equal(ripgrepSkillPath.includes(path.join("skills", ".system")), false);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("default auth env exposes AIHubCC media credentials to app-server children", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-default-auth-"));
  const previousResourceDir = process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR;
  try {
    const resourceDir = path.join(tempRoot, "default-haolo-ai");
    fs.mkdirSync(resourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(resourceDir, "auth.json"),
      JSON.stringify(
        {
          LLMHUB_API_KEY: "sk-llmhub",
          LLMHUB_BASE_URL: "https://haolo.pro/v1",
          SUB2API_API_KEY: "sk-sub2api",
          OPENAI_API_KEY: "sk-openai",
        },
        null,
        2,
      ),
      "utf8",
    );
    process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR = tempRoot;

    const result = loadDefaultCodexAuthEnv();

    assert.equal(result.env.LLMHUB_API_KEY, "sk-llmhub");
    assert.equal(result.env.LLMHUB_BASE_URL, "https://haolo.pro/v1");
    assert.equal(result.env.SUB2API_API_KEY, "sk-sub2api");
    assert.equal(result.env.OPENAI_API_KEY, "sk-openai");
    assert.equal(result.modelBaseUrl, "https://haolo.pro/v1");
  } finally {
    if (previousResourceDir === undefined) {
      delete process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR;
    } else {
      process.env.HAOLO_DESKTOP_RUNTIME_RESOURCE_DIR = previousResourceDir;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
