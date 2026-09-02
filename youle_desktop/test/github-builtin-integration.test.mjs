import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { syncDefaultCodexResources } from "../src/main/app-server-client.mjs";
import { GitHubMcpBridge } from "../src/main/github-mcp-bridge.mjs";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";

const githubSkillRoot = new URL("../resources/default-haolo-ai/skills/github/", import.meta.url);
const githubMcpServer = new URL("../resources/mcp/github-server/index.mjs", import.meta.url);

test("GitHub is globally registered as an MCP server and does not depend on invoking the skill", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-github-config-"));
  try {
    const codexHome = path.join(tempRoot, "codex-home");
    const result = syncDefaultCodexResources(codexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
    });
    const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");

    assert.equal(result.errors.length, 0);
    assert.equal(result.githubMcpConfig.action, "updated");
    assert.match(config, /^\[mcp_servers\.github\]$/m);
    assert.match(config, /^env_vars = \["HAOLO_GITHUB_BROKER_URL", "HAOLO_GITHUB_BROKER_TOKEN"\]$/m);
    assert.match(config, /^default_tools_approval_mode = "writes"$/m);
    assert.match(config, /github-server(?:\\\\|\/)index\.mjs/);
    assert.doesNotMatch(config, /HAOLO_GITHUB_BROKER_TOKEN\s*=/);
    assert.doesNotMatch(config, /skills[\\/]github/i);
    assert.equal(fs.existsSync(path.join(codexHome, "skills", "github", "SKILL.md")), true);
    const second = syncDefaultCodexResources(codexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
    });
    assert.equal(second.githubMcpConfig.action, "unchanged");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("bundled GitHub skill has an MCP dependency and write-safety contract", () => {
  const skill = fs.readFileSync(new URL("SKILL.md", githubSkillRoot), "utf8");
  const metadata = fs.readFileSync(new URL("agents/openai.yaml", githubSkillRoot), "utf8");
  const tools = fs.readFileSync(new URL("references/tools.md", githubSkillRoot), "utf8");

  assert.match(skill, /^name: github$/m);
  assert.match(skill, /explicit confirmation/);
  assert.match(skill, /short-lived local bridge/);
  assert.match(skill, /credential_mode.*github_user/);
  assert.match(skill, /设置 → GitHub → 连接 GitHub/);
  assert.match(metadata, /type: "mcp"[\s\S]*value: "github"/);
  assert.match(tools, /list_my_repositories/);
  assert.match(tools, /connected GitHub user/);
  assert.match(tools, /create_or_update_file/);
  assert.match(tools, /GITHUB_WRITE_DISABLED/);
});

test("loopback bridge rejects unauthenticated calls and forwards authenticated tool calls", async () => {
  const received = [];
  const bridge = new GitHubMcpBridge({
    invoke: async (payload) => {
      received.push(payload);
      return { tool: payload.tool, result: { enabled: true } };
    },
  });
  const env = await bridge.start();
  try {
    const unauthorized = await fetch(`${env.HAOLO_GITHUB_BROKER_URL}/v1/tools/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "github_status", arguments: {} }),
    });
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${env.HAOLO_GITHUB_BROKER_URL}/v1/tools/call`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.HAOLO_GITHUB_BROKER_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ tool: "github_status", arguments: {} }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { tool: "github_status", result: { enabled: true } });
    assert.deepEqual(received, [{ tool: "github_status", arguments: {} }]);
  } finally {
    await bridge.stop();
  }
});

test("standalone GitHub MCP exposes tools without loading the GitHub skill", async () => {
  const bridge = new GitHubMcpBridge({
    invoke: async (payload) => ({ tool: payload.tool, result: { enabled: true } }),
  });
  const env = await bridge.start();
  const child = spawn(process.execPath, [fileURLToPath(githubMcpServer)], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rpc = jsonLineRpc(child);
  try {
    const initialized = await rpc.call("initialize", { protocolVersion: "2025-03-26" });
    assert.equal(initialized.serverInfo.name, "haolo-github-mcp");
    const listed = await rpc.call("tools/list", {});
    assert.ok(listed.tools.length >= 20);
    assert.equal(listed.tools.find((item) => item.name === "list_my_repositories").annotations.readOnlyHint, true);
    assert.equal(listed.tools.find((item) => item.name === "get_repository").annotations.readOnlyHint, true);
    assert.equal(listed.tools.find((item) => item.name === "create_issue").annotations.readOnlyHint, false);
    const result = await rpc.call("tools/call", { name: "github_status", arguments: {} });
    assert.equal(result.structuredContent.result.enabled, true);
  } finally {
    child.kill();
    await bridge.stop();
  }
});

test("Youle API client sends GitHub tools through the authenticated backend route", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init = {}) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ tool: "get_repository", result: { full_name: "acme/demo" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    const result = await client.callGitHubTool({
      tool: "get_repository",
      arguments: { owner: "acme", repo: "demo" },
    });

    assert.equal(request.url, "https://haolo.example/api/github/tools/call");
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.headers.Authorization, "Bearer haolo-session-token");
    assert.deepEqual(JSON.parse(request.init.body), {
      tool: "get_repository",
      arguments: { owner: "acme", repo: "demo" },
    });
    assert.equal(result.result.full_name, "acme/demo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Youle API client manages the current user's GitHub authorization without exposing tokens", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const pathname = new URL(String(url)).pathname;
    const body = pathname.endsWith("/status")
      ? { connected: true, login: "joie", attribution: "user" }
      : pathname.endsWith("/start")
        ? { authorization_url: "https://github.com/login/oauth/authorize?state=opaque" }
        : { disconnected: true };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";

    const status = await client.getGitHubConnectionStatus();
    const started = await client.startGitHubAuthorization();
    const disconnected = await client.disconnectGitHub();

    assert.equal(status.login, "joie");
    assert.match(started.authorization_url, /^https:\/\/github\.com\//);
    assert.equal(disconnected.disconnected, true);
    assert.deepEqual(
      requests.map((request) => [new URL(request.url).pathname, request.init.method]),
      [
        ["/api/github/oauth/status", "GET"],
        ["/api/github/oauth/start", "POST"],
        ["/api/github/oauth/connection", "DELETE"],
      ],
    );
    for (const request of requests) {
      assert.equal(request.init.headers.Authorization, "Bearer haolo-session-token");
      assert.doesNotMatch(JSON.stringify(request), /gh[our]_/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub settings remain implemented but are hidden from the desktop UI", () => {
  const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const settingsDialog = renderer.slice(
    renderer.indexOf("function renderSettingsDialog"),
    renderer.indexOf("function renderGitHubSettingsPanel"),
  );
  const settingsOpener = renderer.slice(
    renderer.indexOf("function openSettingsDialog"),
    renderer.indexOf("async function refreshGitHubConnection"),
  );

  assert.match(renderer, /const ENABLE_GITHUB_SETTINGS_UI = false;/);
  assert.match(settingsDialog, /ENABLE_GITHUB_SETTINGS_UI[\s\S]*data-settings-tab="github"/);
  assert.match(settingsDialog, /state\.settings\.tab === "github" && !ENABLE_GITHUB_SETTINGS_UI[\s\S]*\? "general"/);
  assert.match(settingsOpener, /if \(tab === "github" && !ENABLE_GITHUB_SETTINGS_UI\) tab = "general";/);
  assert.match(renderer, /draft\.status === "active" && ENABLE_GITHUB_SETTINGS_UI \? `<button[^`]+data-personal-strategy-github/);
  assert.match(renderer, /data-settings-tab="github"/);
  assert.match(renderer, /data-action="github-connect"/);
  assert.match(
    renderer,
    /const refreshBusy = github\.loading \|\| github\.disconnecting;/,
  );
  assert.match(
    renderer,
    /data-action="github-refresh" \$\{refreshBusy \? "disabled" : ""\}/,
  );
  assert.match(
    renderer,
    /<p class="github-settings-help">连接账号后[^<]+<\/p>\s*<div class="github-settings-actions github-settings-actions-centered">\s*<button[^>]+data-action="github-connect"[\s\S]*?data-action="github-refresh"/,
  );
  assert.match(
    renderer,
    /refreshGitHubConnection\(\{ concludeAuthorization: true \}\)/,
  );
  assert.match(
    renderer,
    /if \(github\.status\.connected \|\| concludeAuthorization\) \{[\s\S]*?github\.authorizing = false;/,
  );
  assert.match(renderer, /data-action="github-install"/);
  assert.match(renderer, /data-action="github-disconnect"/);
  assert.doesNotMatch(renderer, /用你自己的 GitHub 身份操作|令牌不会保存在本机/);
  assert.doesNotMatch(renderer, /github-account-avatar" aria-hidden="true">G<\/div>/);
  assert.match(
    renderer,
    /github-account-card \$\{reconnecting[\s\S]{0,200}github-account-avatar" aria-hidden="true">\s*<svg viewBox="0 0 24 24">/,
  );
  assert.doesNotMatch(
    styles,
    /\.github-settings-intro|\.github-settings-mark|\.github-settings-security-note/,
  );
  assert.match(styles, /\.github-account-avatar svg \{[\s\S]*?fill: currentColor;/);
  assert.match(styles, /\.github-settings-actions button:focus-visible/);
  assert.match(styles, /\.github-settings-actions button:disabled/);
  assert.match(styles, /\.github-settings-actions-centered\s*\{\s*justify-content:\s*center;/);
  assert.match(
    styles,
    /\.github-settings-actions \[data-action="github-connect"\] \{\s*padding-inline: 12\.5px;/,
  );
  assert.match(styles, /html\[data-theme="dark"\] \.github-account-card\.connected/);
  assert.match(styles, /html\[data-theme="dark"\] \.github-primary-button:hover:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.github-settings-actions button:disabled/);
});

function jsonLineRpc(child) {
  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const operation = pending.get(message.id);
      if (!operation) continue;
      pending.delete(message.id);
      if (message.error) operation.reject(new Error(message.error.message));
      else operation.resolve(message.result);
    }
  });
  child.on("exit", (code) => {
    for (const operation of pending.values()) {
      operation.reject(new Error(`GitHub MCP exited with code ${code}`));
    }
    pending.clear();
  });
  return {
    call(method, params) {
      const id = nextId++;
      const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return promise;
    },
  };
}
