import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import test from "node:test";
import { CodexProviderConversations } from "../src/main/codex-provider-conversation.mjs";
import { CodexBusinessTools } from "../src/main/codex-business-tools.mjs";

function fixture(t, { complete = true, timeoutMs = 1000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-provider-root-"));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.match(path.basename(dir), /^haolo-provider-root-/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const client = new EventEmitter(), calls = [], registered = [], presentations = [];
  const broker = new CodexBusinessTools({ owner: () => "owner", dispatch: () => {} });
  let next = 0;
  const runner = new CodexProviderConversations({
    indexPath: path.join(dir, "index.json"), owner: () => "owner", broker, timeoutMs,
    configure: async () => ({ cwd: dir, model: "root-codex" }),
    registerThread: id => registered.push(id),
    onToolCompleted: value => presentations.push(value),
    request: async (_client, method, params) => {
      calls.push({ method, params });
      if (method === "thread/start") return { thread: { id: `root-${++next}` } };
      if (method === "thread/resume") return { thread: { id: params.threadId } };
      if (method !== "turn/start") return {};
      const turnId = `turn-${calls.length}`;
      queueMicrotask(async () => {
        client.emit("notification", { method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
        if (!complete) return;
        const context = broker.contexts.get(params.threadId);
        if (context.selectedModel) await broker.invokeBound({ tool: "haolo_selected_model", arguments: { context_id: context.token } });
        client.emit("notification", { method: "item/completed", params: { threadId: params.threadId, item: { type: "mcpToolCall", tool: "haolo_trading", result: { content: [] } } } });
        client.emit("notification", { method: "item/completed", params: { threadId: params.threadId, item: { type: "agentMessage", text: "root composed answer", phase: "final_answer" } } });
        client.emit("notification", { method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      });
      return { turn: { id: turnId } };
    },
  });
  return { dir, runner, client, calls, registered, broker, presentations, params: { threadId: "visible-contact", provider: "external", model: "chosen", text: "question", businessContextId: "captured" } };
}

test("selected provider and media metadata execute only after root Codex, and the same conversation resumes", async t => {
  const f = fixture(t);
  let runs = 0;
  const selectedModel = async () => {
    assert.ok(f.calls.some(c => c.method === "turn/start"));
    runs++;
    return { text: "provider answer", derived_media_artifacts: [{ id: "media" }], local_file_access: { granted: true }, billing_session: { status: "complete" } };
  };
  const first = await f.runner.run({ client: f.client, params: f.params, selectedModel });
  assert.equal(first.text, "root composed answer");
  assert.deepEqual(first.derived_media_artifacts, [{ id: "media" }]);
  assert.equal(first.local_file_access.granted, true);
  assert.equal(f.presentations[0].threadId, "visible-contact");
  const second = await f.runner.run({ client: f.client, params: { ...f.params, text: "followup" }, selectedModel });
  assert.equal(first.codexThreadId, second.codexThreadId);
  assert.equal(f.calls.filter(c => c.method === "thread/start").length, 1);
  assert.equal(f.calls.filter(c => c.method === "thread/resume").length, 1);
  assert.equal(runs, 2);
  assert.equal(f.broker.contexts.size, 0);
  assert.equal(f.client.listenerCount("notification"), 0);
});

test("group members using the same model retain separate root histories", async t => {
  const f = fixture(t);
  const selectedModel = async () => ({ text: "member answer" });
  const a = await f.runner.run({ client: f.client, params: { ...f.params, groupChatMemberId: "a" }, selectedModel });
  const b = await f.runner.run({ client: f.client, params: { ...f.params, groupChatMemberId: "b" }, selectedModel });
  assert.notEqual(a.codexThreadId, b.codexThreadId);
});

test("workflow intake cannot finish before native cards have been durably delivered to its visible thread", async t => {
  const f = fixture(t);
  let persist, finished = false;
  f.runner.onToolCompleted = () => new Promise(resolve => { persist = resolve; });
  const result = f.runner.run({ client: f.client, params: f.params, selectedModel: async () => ({ text: "answer" }) }).then(value => { finished = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof persist, "function");
  assert.equal(finished, false);
  assert.equal(f.broker.contexts.size, 1);
  persist();
  await result;
  assert.equal(finished, true);
});

test("cancellation interrupts Codex and discards the selected provider context", async t => {
  const f = fixture(t, { complete: false });
  const controller = new AbortController();
  const pending = f.runner.run({ client: f.client, params: f.params, selectedModel: async () => ({}), signal: controller.signal });
  await new Promise(r => setImmediate(r));
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.ok(f.calls.some(c => c.method === "turn/interrupt"));
  assert.equal(f.broker.contexts.size, 0);
  assert.equal(f.client.listenerCount("notification"), 0);
});

test("timeout interrupts the unfinished root instead of leaving background work running", async t => {
  const f = fixture(t, { complete: false, timeoutMs: 15 });
  const keepAlive = setInterval(() => {}, 1000);
  let cancelled = false;
  try {
    await assert.rejects(f.runner.run({ client: f.client, params: f.params, selectedModel: async () => ({}), cancel: () => { cancelled = true; } }), /timed out/);
    assert.equal(cancelled, true);
    assert.ok(f.calls.some(c => c.method === "turn/interrupt"));
    assert.equal(f.broker.contexts.size, 0);
  } finally { clearInterval(keepAlive); }
});

test("isolated channel messages create fresh roots and never submit stored transcripts or previous media", async t => {
  const f = fixture(t);
  const params = { ...f.params, provider: "channel-codex", messages: [{ role: "user", content: "old private history" }] };
  const first = await f.runner.run({ client: f.client, params, isolated: true, mediaInputs: [{ type: "localImage", path: "current.png" }] });
  const second = await f.runner.run({ client: f.client, params: { ...params, text: "second message only" }, isolated: true });
  assert.notEqual(first.codexThreadId, second.codexThreadId);
  assert.equal(f.calls.filter(c => c.method === "thread/resume").length, 0);
  assert.equal(f.calls.filter(c => c.method === "thread/start").every(c => c.params.ephemeral), true);
  assert.equal(f.calls.filter(c => c.method === "thread/delete").length, 2);
  assert.equal(fs.existsSync(path.join(f.dir, "index.json")), false);
  const starts = f.calls.filter(c => c.method === "turn/start");
  assert.doesNotMatch(JSON.stringify(starts), /old private history|Previous conversation/);
  assert.equal(starts[0].params.input[1].path, "current.png");
  assert.equal(starts[1].params.input.length, 1);
  assert.match(starts[1].params.input[0].text, /second message only/);
});

test("duplicate channel failures never launch a GPT continuation",async t=>{
 const f=fixture(t,{complete:false});let recoveries=0;f.runner.recoverTurn=async()=>{recoveries++;return {model:'gpt-5.6-sol'}};
 const pending=f.runner.run({client:f.client,params:f.params,isolated:true});pending.catch(()=>{});
 await new Promise(r=>setImmediate(r));const context=[...f.broker.contexts.values()][0];
 const failed={method:'turn/completed',params:{threadId:context.threadId,turn:{id:context.turnId,status:'failed',error:{message:'HTTP 503 service unavailable'}}}};
 f.client.emit('notification',failed);f.client.emit('notification',failed);
 await assert.rejects(pending,/503/);assert.equal(recoveries,0);assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);
 assert.equal(f.calls.filter(c=>c.method==='thread/delete').length,1);assert.equal(f.broker.contexts.size,0);
});

test("isolated recovery is bounded and never retries account/permission failures", async t => {
  for (const [message, expectedRecoveries] of [["HTTP 503 service unavailable", 0], ["authentication failed HTTP 401", 0]]) {
    const f = fixture(t, { complete: false });
    let recoveries = 0, cleanup;
    f.runner.configure = async () => ({ cwd: f.dir, model: "selected", effort: "max" });
    f.runner.recoverTurn = async () => { recoveries++; return { model: "fallback" }; };
    f.runner.unregisterThread = (id, value) => { cleanup = { id, ...value }; };
    const pending = f.runner.run({ client: f.client, params: f.params, isolated: true });
    pending.catch(() => {});
    await new Promise(r => setImmediate(r));
    for (let i = 0; i <= expectedRecoveries; i++) {
      const context = [...f.broker.contexts.values()][0];
      f.client.emit("notification", { method: "turn/completed", params: { threadId: context.threadId,
        turn: { id: context.turnId, status: "failed", error: { message } } } });
      await new Promise(r => setImmediate(r));
    }
    await assert.rejects(pending, new RegExp(message));
    assert.equal(recoveries, expectedRecoveries);
    const starts = f.calls.filter(c => c.method === "turn/start");
    assert.equal(starts.length, expectedRecoveries + 1);
    assert.equal(starts[0].params.effort, "max");
    assert.equal(cleanup.deleted, true);
    assert.equal(f.broker.contexts.size, 0);
    assert.equal(f.client.listenerCount("notification"), 0);
  }
});
