import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { CodexBusinessTools, businessToolResponse } from "../src/main/codex-business-tools.mjs";
import { businessPresentationItems } from "../src/shared/codex-business-presentation.mjs";
import { PersonalContextMcpBridge } from "../src/main/personal-context/mcp-bridge.mjs";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

function fixture() {
  let owner = "account-a";
  const events = [];
  const sender = { isDestroyed: () => false };
  const client = new EventEmitter();
  const broker = new CodexBusinessTools({ owner: () => owner, accountRead: async () => ({ available: false }), dispatch: (s, p) => events.push({ sender: s, ...p }) });
  const context = broker.bind("thread-a", { sender, client, contextId: "frozen-chart", userText: "确认" });
  return { broker, sender, client, context, events, changeOwner: () => { owner = "account-b"; } };
}

test("business capabilities bind actual user input, sender, account and frozen chart", async () => {
  const f = fixture();
  const promise = f.broker.invokeBound({ tool: "haolo_trading", arguments: { context_id: f.context.token, action: "alert", instruction: "invented approval" } });
  await new Promise(resolve => setImmediate(resolve));
  const call = f.events[0];
  assert.equal(call.userText, "确认");
  assert.equal(call.contextId, "frozen-chart");
  assert.equal(call.threadId, "thread-a");
  assert.equal(f.broker.resolve({}, { requestId: call.requestId, result: "wrong window" }), false);
  assert.equal(f.broker.resolve(f.sender, { requestId: call.requestId, result: "confirmed" }), true);
  assert.equal(await promise, "confirmed");
  f.broker.cancel("thread-a");
  await assert.rejects(f.broker.invokeBound({ tool: "haolo_trading", arguments: { context_id: f.context.token, action: "alert" } }), /expired/);
});

test("tool retransmission returns one run and cannot cross account/client/turn", async () => {
  const f = fixture();
  f.broker.start("thread-a", "turn-a", f.client);
  const p = { threadId: "thread-a", turnId: "turn-a", callId: "call", tool: "haolo_trading", arguments: { action: "analyze", instruction: "ETH" } };
  const first = f.broker.invoke(p, f.client);
  const second = f.broker.invoke(p, f.client);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.events.length, 1);
  await assert.rejects(f.broker.invoke({ ...p, turnId: "other" }, f.client), /owned/);
  await assert.rejects(f.broker.invoke(p, {}), /owned/);
  f.broker.resolve(f.sender, { requestId: f.events[0].requestId, result: { runId: "one" } });
  assert.deepEqual(await first, await second);
  f.changeOwner();
  await assert.rejects(f.broker.invokeBound({ tool: "haolo_trading", arguments: { context_id: f.context.token, action: "context" } }), /expired/);
  f.broker.cancel("thread-a");
});

test("cancellation fails pending work and ignores late or unrelated completions", async () => {
  const f = fixture();
  f.broker.start("thread-a", "turn-a", f.client);
  const promise = f.broker.invokeBound({ tool: "haolo_trading", arguments: { context_id: f.context.token, action: "analyze" } });
  await new Promise(resolve => setImmediate(resolve));
  f.broker.cancel("thread-a", "unrelated", "turn-old");
  assert.equal(f.broker.contexts.size, 1);
  f.broker.cancel("thread-a", "cancelled", "turn-a");
  await assert.rejects(promise, /cancelled/);
  assert.ok(f.events.some(event => event.cancel));
  assert.equal(f.broker.resolve(f.sender, { requestId: f.events[0].requestId, result: "late" }), false);
});

test("group member workflows serialize on their visible conversation and cancelled queued calls never start", async () => {
  const f = fixture();
  f.context.visibleThreadId = "group";
  const other = f.broker.bind("thread-b", { client: f.client, sender: f.sender, visibleThreadId: "group", userText: "second member" });
  const first = f.broker.invokeBound({ tool: "haolo_trading", arguments: { context_id: f.context.token, action: "alert" } });
  const second = f.broker.invokeBound({ tool: "haolo_trading", arguments: { context_id: other.token, action: "alert" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.events.filter(e => e.requestId).length, 1);
  f.broker.cancel("thread-b");
  const rejected = assert.rejects(second, /ended before/);
  f.broker.resolve(f.sender, { requestId: f.events[0].requestId, result: "first" });
  await first;
  await rejected;
  assert.equal(f.events.filter(e => e.arguments?.action === "alert").length, 1);
  f.broker.cancel("thread-a");
});

test("recovery renews the capability, retains successful actions and actual user confirmation can advance on steer", async () => {
  const f = fixture();
  f.broker.start("thread-a", "turn-a", f.client);
  const args = { action: "alert" }, oldToken = f.context.token;
  const first = f.broker.invokeBound({ tool: "haolo_trading", arguments: { context_id: oldToken, ...args } });
  await new Promise(resolve => setImmediate(resolve));
  f.broker.resolve(f.sender, { requestId: f.events[0].requestId, result: "draft-ready" });
  await first;
  f.broker.suspend("thread-a", "turn-a");
  await assert.rejects(f.broker.invokeBound({ tool: "haolo_trading", arguments: { context_id: oldToken, ...args } }), /expired/);
  assert.equal(f.events.some(e => e.release), false);
  f.broker.resume("thread-a", f.client);
  f.broker.start("thread-a", "turn-b", f.client);
  assert.equal(await f.broker.invokeBound({ tool: "haolo_trading", arguments: { context_id: f.context.token, ...args } }), "draft-ready");
  assert.equal(f.events.filter(e => e.arguments).length, 1);
  assert.equal(f.broker.updateInput("thread-a", { client: f.client, sender: {}, userText: "fake" }), false);
  f.broker.updateInput("thread-a", { client: f.client, sender: f.sender, userText: "创建刚才的预警" });
  const confirmation = f.broker.invokeBound({ tool: "haolo_trading", arguments: { context_id: f.context.token, ...args } });
  await new Promise(resolve => setImmediate(resolve));
  const latest = f.events.at(-1);
  assert.equal(latest.userText, "创建刚才的预警");
  f.broker.resolve(f.sender, { requestId: latest.requestId, result: "confirmed" });
  assert.equal(await confirmation, "confirmed");
  f.broker.cancel("thread-a");
});

test("native cards replay from the persisted tool result without synthetic turns", () => {
  const card = { id: "card-one", type: "agentMessage", text: "Verified plan", __youleCloudReports: [{ id: "cloud-run" }] };
  const response = businessToolResponse({ presentationItems: [card] });
  assert.deepEqual(businessPresentationItems({ type: "dynamicToolCall", tool: "haolo_trading", ...response }), [card]);
  assert.deepEqual(businessPresentationItems({ type: "mcpToolCall", tool: "haolo_trading", result: { content: [{ type: "text", text: response.contentItems[0].text }] } }), [card]);
  assert.deepEqual(businessPresentationItems({ type: "mcpToolCall", tool: "other", result: { content: [] } }), []);
});

test("MCP stdio to authenticated Host round trip preserves errors and context", { timeout: 10000 }, async () => {
  const bridge = new PersonalContextMcpBridge({
    envPrefix: "HAOLO_BUSINESS",
    tools: [{ name: "haolo_trading", description: "test", inputSchema: { type: "object" } }],
    invoke: async ({ arguments: args }) => {
      if (args.context_id === "fatal") throw Object.assign(new Error("result mismatch"), {
        code: "CLOUD_RESULT_CONTEXT_INVALID", retryable: false, terminal: true, nextAction: "stop",
      });
      if (args.context_id !== "valid") throw new Error("expired");
      return { report: "actual result", runId: "run-1" };
    },
  });
  const env = await bridge.start();
  const child = spawn(process.execPath, [fileURLToPath(new URL("../resources/mcp/business-server/index.mjs", import.meta.url))], {
    env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", line => { const msg = JSON.parse(line); pending.get(msg.id)?.(msg); });
  let id = 0;
  const call = (method, params) => new Promise(resolve => {
    const requestId = ++id; pending.set(requestId, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
  });
  try {
    assert.ok((await call("initialize", {})).result.capabilities.tools);
    assert.equal((await call("tools/list", {})).result.tools[0].name, "haolo_trading");
    const result = (await call("tools/call", { name: "haolo_trading", arguments: { context_id: "valid" } })).result;
    assert.equal(JSON.parse(result.content[0].text).runId, "run-1");
    assert.equal((await call("tools/call", { name: "haolo_trading", arguments: {} })).result.isError, true);
    const fatal = (await call("tools/call", { name: "haolo_analysis", arguments: { context_id: "fatal" } })).result;
    assert.equal(fatal.isError, true);
    assert.deepEqual(JSON.parse(fatal.content[0].text).error, {
      message: "result mismatch", code: "CLOUD_RESULT_CONTEXT_INVALID", retryable: false, terminal: true, nextAction: "stop",
    });
  } finally {
    lines.close(); child.kill(); await bridge.stop();
  }
});
