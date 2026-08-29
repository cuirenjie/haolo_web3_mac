import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { syncDefaultCodexResources } from "../src/main/app-server-client.mjs";
import { CHROME_TOOL_DEFINITIONS } from "../src/main/chrome/contract.mjs";
import { ChromeMcpBridge } from "../src/main/chrome/mcp-bridge.mjs";
import { ChromeToolRuntime } from "../src/main/chrome/tool-runtime.mjs";

const chromeMcpServer = new URL("../resources/mcp/chrome-server/index.mjs", import.meta.url);
const chromePluginRoot = new URL("../resources/default-haolo-ai/plugins/cache/haolo-bundled/chrome/0.1.0/", import.meta.url);

test("Chrome runtime fails closed, isolates writes, and sanitizes authorized reads", async () => {
  const broker = new MockChromeBroker();
  const runtime = new ChromeToolRuntime({ broker });
  try {
    await assert.rejects(
      runtime.invoke({ tool: "read_page", arguments: { tab_id: 7 }, context: fixedContext() }),
      { code: "CHROME_SITE_PERMISSION_REQUIRED" },
    );
    broker.emit("message", {
      profileId: "profile_abcdefgh",
      envelope: {
        type: "extension.site.permission",
        payload: { origin: "https://example.test", mode: "once", decision: "allow" },
      },
    });
    const snapshot = await runtime.invoke({ tool: "read_page", arguments: { tab_id: 7 }, context: fixedContext() });
    assert.equal(snapshot.provenance.trust, "untrusted_web_content");
    assert.equal(snapshot.elements.some((element) => element.type === "password"), false);
    assert.equal(snapshot.forms.some((control) => control.type === "password"), false);
    assert.equal(snapshot.links[0].href, "https://example.test/reference");
    assert.equal(broker.calls.at(-1).payload.tool, "read_page");
    const click = await runtime.invoke({
      tool: "click",
      arguments: { tab_id: 7, target: { element_id: "he_1" } },
      context: fixedContext(),
    });
    assert.equal(click.ok, true);
    assert.equal(click.task_surface.tab.tab_id, 8);
    assert.equal(broker.calls.some((call) => call.type === "task.tab.create"), true);
    assert.equal(broker.calls.at(-1).payload.arguments.tab_id, 8);

    const secondClick = await runtime.invoke({
      tool: "click",
      arguments: { tab_id: 7, target: { element_id: "he_1" } },
      context: fixedContext(),
    });
    assert.equal(secondClick.ok, true);
    assert.equal(broker.calls.filter((call) => call.type === "task.tab.create").length, 1);
    assert.equal(broker.calls.at(-1).payload.arguments.tab_id, 8);

    const prepared = await runtime.invoke({
      tool: "prepare_external_action",
      arguments: { tab_id: 7, action: "send", target: { element_id: "he_send" }, summary: "Send the prepared reply" },
      context: fixedContext(),
    });
    assert.equal(prepared.approval_required, true);
    assert.equal(prepared.operation.status, "prepared");
    assert.equal(prepared.preview.prepared, true);
    const commitPromise = runtime.invoke({
      tool: "commit_external_action",
      arguments: prepared.commit_after_approval,
      context: fixedContext(),
    });
    await new Promise((resolve) => setImmediate(resolve));
    runtime.approveOperation(prepared.operation.id);
    const committed = await commitPromise;
    assert.equal(committed.operation.status, "committed");
    assert.equal(committed.result.committed, true);
    const replay = await runtime.invoke({
      tool: "commit_external_action",
      arguments: prepared.commit_after_approval,
      context: fixedContext(),
    });
    assert.equal(replay.replayed, true);
    assert.equal(broker.calls.filter((call) => call.payload?.tool === "commit_external_action").length, 1);
  } finally {
    runtime.dispose();
  }
});

test("Chrome loopback bridge requires its bearer token and forwards context", async () => {
  const received = [];
  const bridge = new ChromeMcpBridge({ invoke: async (payload) => { received.push(payload); return { ok: true }; } });
  const env = await bridge.start();
  try {
    const unauthorized = await fetch(`${env.HAOLO_CHROME_BROKER_URL}/v1/tools/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "chrome_status", arguments: {} }),
    });
    assert.equal(unauthorized.status, 401);
    const authorized = await fetch(`${env.HAOLO_CHROME_BROKER_URL}/v1/tools/call`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.HAOLO_CHROME_BROKER_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ tool: "chrome_status", arguments: {}, context: fixedContext() }),
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), { ok: true });
    assert.equal(received[0].context.threadId, "thread_test");
  } finally {
    await bridge.stop();
  }
});

test("Chrome runtime binds uploads to registered artifacts and history approval is one-time", async () => {
  const broker = new MockChromeBroker();
  const runtime = new ChromeToolRuntime({ broker });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-chrome-artifact-"));
  try {
    const uploadPath = path.join(tempRoot, "report.txt");
    fs.writeFileSync(uploadPath, "approved upload", "utf8");
    runtime.registerArtifact({ artifactId: "chrome_artifact_abcdefgh", filePath: uploadPath, context: fixedContext() });
    broker.emit("message", {
      profileId: "profile_abcdefgh",
      envelope: { type: "extension.site.permission", payload: { origin: "https://example.test", mode: "once", decision: "allow" } },
    });
    const upload = await runtime.invoke({
      tool: "upload_file",
      arguments: { tab_id: 7, target: { element_id: "he_upload" }, artifact_id: "chrome_artifact_abcdefgh" },
      context: fixedContext(),
    });
    assert.equal(upload.approval_required, true);
    runtime.approveOperation(upload.operation.id);
    const uploaded = await runtime.invoke({
      tool: "commit_external_action",
      arguments: upload.commit_after_approval,
      context: fixedContext(),
    });
    assert.equal(uploaded.result.committed, true);
    const uploadCommitCall = broker.calls.find((call) => call.payload?.prepared_tool === "upload_file");
    assert.equal(uploadCommitCall.payload.authorized_artifact.artifact_id, "chrome_artifact_abcdefgh");
    assert.equal(uploadCommitCall.payload.authorized_artifact.path, uploadPath);

    const historyPromise = runtime.invoke({ tool: "read_history", arguments: { query: "Haolo", max_results: 5 }, context: fixedContext() });
    await new Promise((resolve) => setImmediate(resolve));
    const historyPending = runtime.pendingApprovals().find((entry) => entry.type === "history");
    assert.equal(historyPending.request.status, "prepared");
    runtime.approveHistoryRequest(historyPending.request.id);
    const history = await historyPromise;
    assert.equal(history.results.length, 1);
    const nextHistoryPromise = runtime.invoke({ tool: "read_history", arguments: { query: "Haolo", max_results: 5 }, context: fixedContext() });
    await new Promise((resolve) => setImmediate(resolve));
    const nextHistory = runtime.pendingApprovals().find((entry) => entry.type === "history");
    assert.equal(nextHistory.request.status, "prepared");
    runtime.rejectApproval(nextHistory.request.id);
    await assert.rejects(nextHistoryPromise, { code: "CHROME_APPROVAL_DECLINED" });
  } finally {
    runtime.dispose();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("standalone Chrome MCP publishes the frozen 18-tool contract", async () => {
  const bridge = new ChromeMcpBridge({ invoke: async (payload) => ({ tool: payload.tool, connected: true }) });
  const env = await bridge.start();
  const child = spawn(process.execPath, [fileURLToPath(chromeMcpServer)], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rpc = jsonLineRpc(child);
  try {
    const initialized = await rpc.call("initialize", { protocolVersion: "2025-03-26" });
    assert.equal(initialized.serverInfo.name, "haolo-chrome-mcp");
    const listed = await rpc.call("tools/list", {});
    assert.equal(listed.tools.length, 18);
    assert.equal(listed.tools.find((tool) => tool.name === "read_page").annotations.readOnlyHint, true);
    assert.equal(listed.tools.find((tool) => tool.name === "click").annotations.readOnlyHint, false);
    const result = await rpc.call("tools/call", { name: "chrome_status", arguments: {} });
    assert.equal(result.structuredContent.connected, true);
  } finally {
    child.kill();
    await bridge.stop();
  }
});

test("bundled tools JSON, plugin manifest, marketplace, and managed MCP config stay in sync", () => {
  const tools = JSON.parse(fs.readFileSync(new URL("../resources/mcp/chrome-server/tools.json", import.meta.url), "utf8"));
  assert.deepEqual(tools, CHROME_TOOL_DEFINITIONS);
  const manifest = JSON.parse(fs.readFileSync(new URL(".codex-plugin/plugin.json", chromePluginRoot), "utf8"));
  const skill = fs.readFileSync(new URL("skills/chrome/SKILL.md", chromePluginRoot), "utf8");
  const marketplace = JSON.parse(fs.readFileSync(new URL("../resources/default-haolo-ai/plugins/cache/haolo-bundled/.agents/plugins/marketplace.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "chrome");
  assert.match(skill, /^name: chrome$/m);
  assert.match(skill, /untrusted web content/);
  assert.match(skill, /prepare\/approval\/commit/);
  assert.ok(marketplace.plugins.some((plugin) => plugin.name === "chrome" && plugin.source.path === "./chrome/0.1.0"));

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-chrome-config-"));
  try {
    const codexHome = path.join(tempRoot, "codex-home");
    const first = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false });
    const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
    assert.equal(first.errors.length, 0);
    assert.equal(first.chromeMcpConfig.action, "updated");
    assert.match(config, /^\[mcp_servers\.chrome\]$/m);
    assert.match(config, /^env_vars = \["HAOLO_CHROME_BROKER_URL", "HAOLO_CHROME_BROKER_TOKEN"\]$/m);
    assert.match(config, /^\[plugins\."chrome@haolo-bundled"\]$/m);
    assert.doesNotMatch(config, /HAOLO_CHROME_BROKER_TOKEN\s*=/);
    const second = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false });
    assert.equal(second.chromeMcpConfig.action, "unchanged");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

class MockChromeBroker extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.taskTabCreated = false;
  }

  status() {
    return { running: true, profiles: [{ profileId: "profile_abcdefgh" }] };
  }

  async call(profileId, type, payload, context) {
    this.calls.push({ profileId, type, payload, context });
    if (type === "task.tab.create") {
      this.taskTabCreated = true;
      return {
        task_id: context.taskId,
        reused: false,
        tab: {
          tab_id: 8,
          source_tab_id: 7,
          window_id: 1,
          group_id: 2,
          isolated: true,
          title: "Example task",
          url: "https://example.test/page",
          origin: "https://example.test",
        },
      };
    }
    if (payload.tool === "list_tabs") {
      const tabs = [{ tab_id: 7, title: "Example", url: "https://example.test/page", origin: "https://example.test" }];
      if (this.taskTabCreated) tabs.push({ tab_id: 8, title: "Example task", url: "https://example.test/page", origin: "https://example.test" });
      return { profile_id: profileId, tabs };
    }
    if (payload.tool === "read_page") {
      return {
        url: "https://example.test/page#secret",
        title: "Example",
        text: "Visible page text",
        headings: [{ level: 1, text: "Example" }],
        links: [{ element_id: "he_1", text: "Reference", href: "https://example.test/reference#fragment" }],
        elements: [
          { element_id: "he_1", role: "link", name: "Reference", href: "https://example.test/reference" },
          { element_id: "he_2", role: "textbox", name: "Password", type: "password" },
        ],
        forms: [
          { element_id: "he_3", role: "textbox", name: "Email", type: "email", value_present: true },
          { element_id: "he_2", role: "textbox", name: "Password", type: "password", value_present: true },
        ],
      };
    }
    if (payload.tool === "prepare_external_action") {
      return {
        prepared: true,
        action: "send",
        target: { element_id: "he_send", role: "button", name: "Send now" },
        target_signature: { element_id: "he_send", role: "button", name: "Send now", tag: "button", type: "submit", form_action: "https://example.test/send", form_method: "post" },
      };
    }
    if (payload.tool === "upload_file") return { prepared: true, marker: "hu_test", target_signature: { element_id: "he_upload" } };
    if (payload.tool === "commit_external_action") return { committed: true, action: payload.prepared_tool || "send" };
    if (payload.tool === "read_history") return { query: payload.arguments.query, results: [{ title: "Haolo", url: "https://example.test/haolo" }], permission_revoked: true };
    return { ok: true };
  }
}

function fixedContext() {
  return { threadId: "thread_test", turnId: "turn_test", taskId: "task_test" };
}

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
    for (const operation of pending.values()) operation.reject(new Error(`Chrome MCP exited with code ${code}`));
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
