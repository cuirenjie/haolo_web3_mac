import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import test from "node:test";
import { AppServerClient, resolveYouleAiCommand, syncDefaultCodexResources } from "../src/main/app-server-client.mjs";
import {
  HAOLO_BUILTIN_PLUGIN_IDS,
  installedPluginRoot,
  listInstalledCodexPlugins,
  removeInstalledCodexPlugin,
  runCodexPluginCommand,
  setPluginEnabledInConfig,
  syncBuiltinPluginRegistration,
} from "../src/main/plugin-manager.mjs";

const EXPECTED_PLUGIN_IDS = [
  "chrome@haolo-bundled",
  "documents@haolo-primary-runtime",
  "latex@haolo-bundled",
  "presentations@haolo-primary-runtime",
  "spreadsheets@haolo-primary-runtime",
];

test("builtin plugin registration is idempotent and preserves explicit disabled state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-plugin-config-"));
  try {
    const pluginsSourceRoot = createMinimalPluginSources(tempRoot);
    const codexHome = path.join(tempRoot, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    const configPath = path.join(codexHome, "config.toml");
    fs.writeFileSync(
      configPath,
      [
        'model = "user-model"',
        "",
        "[marketplaces.haolo-bundled]",
        'source_type = "local"',
        'source = "C:\\\\stale"',
        "",
        '[plugins."documents@haolo-primary-runtime"]',
        "enabled = false",
        "",
      ].join("\n"),
      "utf8",
    );

    const first = syncBuiltinPluginRegistration(codexHome, pluginsSourceRoot);
    const firstConfig = fs.readFileSync(configPath, "utf8");
    const second = syncBuiltinPluginRegistration(codexHome, pluginsSourceRoot);
    const secondConfig = fs.readFileSync(configPath, "utf8");

    assert.equal(first.action, "updated");
    assert.deepEqual([...HAOLO_BUILTIN_PLUGIN_IDS].sort(), EXPECTED_PLUGIN_IDS);
    assert.deepEqual(first.pluginIds.sort(), EXPECTED_PLUGIN_IDS);
    assert.equal(second.action, "unchanged");
    assert.equal(secondConfig, firstConfig);
    assert.equal((firstConfig.match(/^\[marketplaces\.haolo-bundled\]$/gm) || []).length, 1);
    assert.equal((firstConfig.match(/^\[marketplaces\.haolo-primary-runtime\]$/gm) || []).length, 1);
    assert.match(
      firstConfig,
      /^\[plugins\."documents@haolo-primary-runtime"\]\s*\r?\nenabled = false$/m,
    );
    for (const pluginId of EXPECTED_PLUGIN_IDS.filter((pluginId) => !pluginId.startsWith("documents@"))) {
      assert.match(firstConfig, new RegExp(`^\\[plugins\\."${escapeRegExp(pluginId)}"\\]\\s*\\r?\\nenabled = true$`, "m"));
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("plugin enabled writes target the canonical plugin table only", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-plugin-toggle-"));
  try {
    const configPath = path.join(tempRoot, "config.toml");
    fs.writeFileSync(
      configPath,
      [
        'model = "keep-me"',
        "",
        '[plugins."documents@haolo-primary-runtime"]',
        "enabled = true",
        "",
        '[plugins."spreadsheets@haolo-primary-runtime"]',
        "enabled = true",
        "",
      ].join("\n"),
      "utf8",
    );

    setPluginEnabledInConfig(configPath, "documents@haolo-primary-runtime", false);
    const config = fs.readFileSync(configPath, "utf8");

    assert.match(config, /^model = "keep-me"$/m);
    assert.match(config, /^\[plugins\."documents@haolo-primary-runtime"\]\s*\r?\nenabled = false$/m);
    assert.match(config, /^\[plugins\."spreadsheets@haolo-primary-runtime"\]\s*\r?\nenabled = true$/m);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("plugin registration preserves array tables, comments, equivalent headers, and CRLF", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-plugin-toml-"));
  try {
    const pluginsSourceRoot = createMinimalPluginSources(tempRoot);
    const codexHome = path.join(tempRoot, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    const configPath = path.join(codexHome, "config.toml");
    fs.writeFileSync(
      configPath,
      [
        'model = "keep-me"',
        "",
        "[marketplaces.haolo-bundled] # stale managed table",
        'source = "stale-bundled"',
        "",
        "[[custom.routes]]",
        'name = "keep-array-table"',
        "",
        '[marketplaces . "haolo-primary-runtime"] # equivalent stale table',
        'source = "stale-primary"',
        "",
        '[plugins . "documents@haolo-primary-runtime"] # user comment',
        "enabled = false # keep disabled",
        "",
      ].join("\r\n"),
      "utf8",
    );

    const result = syncBuiltinPluginRegistration(codexHome, pluginsSourceRoot);
    const config = fs.readFileSync(configPath, "utf8");

    assert.equal(result.action, "updated");
    assert.match(config, /\[\[custom\.routes\]\]\r\nname = "keep-array-table"/);
    assert.doesNotMatch(config, /stale-bundled|stale-primary/);
    assert.match(
      config,
      /^\[plugins\s*\.\s*"documents@haolo-primary-runtime"\]\s*# user comment\r?\nenabled = false # keep disabled$/m,
    );
    assert.equal((config.match(/documents@haolo-primary-runtime/g) || []).length, 1);
    assert.equal(/(?<!\r)\n/.test(config), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("plugin registration fails closed for malformed managed markers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-plugin-marker-"));
  try {
    const pluginsSourceRoot = createMinimalPluginSources(tempRoot);
    const codexHome = path.join(tempRoot, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    const configPath = path.join(codexHome, "config.toml");
    const malformedConfigs = [
      [
        'model = "keep-before"',
        "# >>> haolo_desktop managed builtin plugin marketplaces",
        "[marketplaces.haolo-bundled]",
        'source = "must-not-be-truncated"',
        'model_reasoning_effort = "high"',
      ].join("\n"),
      [
        'model = "keep-before"',
        "# <<< haolo_desktop managed builtin plugin marketplaces",
        'model_reasoning_effort = "high"',
      ].join("\n"),
    ];

    for (const malformed of malformedConfigs) {
      fs.writeFileSync(configPath, malformed, "utf8");
      const result = syncBuiltinPluginRegistration(codexHome, pluginsSourceRoot);
      assert.equal(result.action, "invalid-config");
      assert.equal(fs.readFileSync(configPath, "utf8"), malformed);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("installed plugin roots reject Windows traversal and unsafe path segments", () => {
  const codexHome = path.resolve(os.tmpdir(), "haolo-safe-plugin-home");
  assert.equal(
    installedPluginRoot(codexHome, {
      marketplaceName: "haolo-primary-runtime",
      name: "documents",
      version: "26.601.10930",
    }),
    path.join(codexHome, "plugins", "cache", "haolo-primary-runtime", "documents", "26.601.10930"),
  );

  for (const plugin of [
    { marketplaceName: "../../../../escape", name: "documents", version: "1" },
    { marketplaceName: "market", name: "..\\escape", version: "1" },
    { marketplaceName: "C:\\outside", name: "documents", version: "1" },
    { marketplaceName: "market", name: "CON", version: "1" },
    { marketplaceName: "market", name: "documents", version: "1.0.0." },
  ]) {
    assert.equal(installedPluginRoot(codexHome, plugin), null);
  }
});

test("plugin mutation commands reject invalid plugin IDs before spawning", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-plugin-id-"));
  try {
    const configPath = path.join(tempRoot, "config.toml");
    assert.throws(() => setPluginEnabledInConfig(configPath, "--help", true), /Invalid plugin ID/);
    await assert.rejects(
      removeInstalledCodexPlugin({
        command: process.execPath,
        codexHome: path.join(tempRoot, "codex-home"),
        cwd: tempRoot,
        pluginId: "--config=model=evil",
      }),
      /Invalid plugin ID/,
    );
    assert.equal(fs.existsSync(configPath), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("plugin commands wait for closed output pipes and enforce a timeout", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-plugin-command-"));
  try {
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      process.nextTick(() => {
        child.emit("exit", 0, null);
        child.stdout.emit("data", Buffer.from(JSON.stringify({ late: true })));
        child.emit("close", 0, null);
      });
      return child;
    };
    const payload = await runCodexPluginCommand({
      command: process.execPath,
      codexHome: path.join(tempRoot, "close-home"),
      cwd: tempRoot,
      args: ["ignored"],
      timeoutMs: 5_000,
      spawnImpl,
    });
    assert.deepEqual(payload, { late: true });

    await assert.rejects(
      runCodexPluginCommand({
        command: process.execPath,
        codexHome: path.join(tempRoot, "timeout-home"),
        cwd: tempRoot,
        args: ["-e", "setInterval(() => {}, 1_000);"],
        timeoutMs: 100,
      }),
      /timed out after 100ms/,
    );
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("default resource sync registers five installed plugins for the bundled Codex runtime", async (t) => {
  if (process.platform !== "win32") {
    t.skip("The bundled Haolo Codex probe is Windows-only");
    return;
  }
  const command = resolveYouleAiCommand(process.cwd());
  if (!command || !fs.existsSync(command)) {
    t.skip("Bundled Haolo Codex executable is unavailable");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-plugin-runtime-"));
  const previousSkipDeepSeek = process.env.HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP;
  try {
    process.env.HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP = "1";
    const codexHome = path.join(tempRoot, "codex-home");
    const first = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false });
    const second = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false });
    const payload = await listInstalledCodexPlugins({ command, codexHome, cwd: tempRoot });

    assert.deepEqual(
      payload.installed.map((plugin) => plugin.pluginId).sort(),
      EXPECTED_PLUGIN_IDS,
    );
    assert.equal(payload.installed.every((plugin) => plugin.enabled === true), true);
    assert.equal(second.copied.some((entry) => /^plugins[\\/]/.test(entry)), false);
    for (const plugin of payload.installed) {
      const root = installedPluginRoot(codexHome, plugin);
      assert.equal(fs.existsSync(path.join(root, ".codex-plugin", "plugin.json")), true);
    }
    assert.equal(first.builtinPluginConfig.action, "updated");
    assert.equal(second.builtinPluginConfig.action, "unchanged");

    const client = new AppServerClient({ cwd: tempRoot, codexHome, codexCommand: command });
    try {
      await client.start();
      const runtimeConfig = await client.request("config/read", {});
      const catalog = JSON.parse(fs.readFileSync(path.join(codexHome, "haolo-model-catalog.json"), "utf8"));
      assert.match(String(runtimeConfig?.config?.model_catalog_json || ""), /haolo-model-catalog\.json$/);
      for (const slug of ["gpt-6-astra", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
        const model = catalog.models.find((candidate) => candidate.slug === slug);
        assert.equal(model.context_window, 400_000);
        assert.equal(model.max_context_window, 400_000);
        assert.equal(model.auto_compact_token_limit, 300_000);
      }
      const skillsResult = await client.request("skills/list", { cwds: [tempRoot], forceReload: true });
      const pluginSkillNames = (skillsResult?.data?.[0]?.skills || [])
        .filter((skill) => String(skill?.path || "").includes(`${path.sep}plugins${path.sep}cache${path.sep}`))
        .map((skill) => String(skill.name).toLowerCase())
        .sort();
      assert.deepEqual(pluginSkillNames, [
        "chrome:chrome",
        "documents:documents",
        "latex:latex-compile",
        "latex:latex-doctor",
        "latex:texlive-runtime-installer",
        "presentations:presentations",
        "spreadsheets:spreadsheets",
      ]);
      assert.deepEqual(skillsResult?.data?.[0]?.errors || [], []);
    } finally {
      await client.stop();
    }
  } finally {
    if (previousSkipDeepSeek === undefined) delete process.env.HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP;
    else process.env.HAOLO_DESKTOP_SKIP_BUILTIN_DEEPSEEK_MCP = previousSkipDeepSeek;
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("bundled primary plugin skills start with YAML frontmatter without a UTF-8 BOM", () => {
  const skillFiles = [
    "resources/default-haolo-ai/plugins/cache/haolo-primary-runtime/documents/26.601.10930/skills/documents/SKILL.md",
    "resources/default-haolo-ai/plugins/cache/haolo-primary-runtime/presentations/26.601.10930/skills/presentations/SKILL.md",
    "resources/default-haolo-ai/plugins/cache/haolo-primary-runtime/spreadsheets/26.601.10930/skills/spreadsheets/SKILL.md",
  ];
  for (const relativePath of skillFiles) {
    const bytes = fs.readFileSync(new URL(`../${relativePath}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 3)], [45, 45, 45]);
  }
});

function createMinimalPluginSources(tempRoot) {
  const pluginsRoot = path.join(tempRoot, "plugins");
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
  for (const marketplace of marketplaces) {
    const root = path.join(pluginsRoot, "cache", marketplace.name);
    const marketplacePath = path.join(root, ".agents", "plugins", "marketplace.json");
    fs.mkdirSync(path.dirname(marketplacePath), { recursive: true });
    fs.writeFileSync(marketplacePath, JSON.stringify({ name: marketplace.name, plugins: [] }), "utf8");
    for (const plugin of marketplace.plugins) {
      const manifestPath = path.join(root, plugin.name, plugin.version, ".codex-plugin", "plugin.json");
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      fs.writeFileSync(manifestPath, JSON.stringify({ name: plugin.name, version: plugin.version }), "utf8");
    }
  }
  return pluginsRoot;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
