import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NativeSupport, supportFileType, supportMediaUrl } from "../src/renderer/native-support.ts";
import { supportRoute, createSupportUploads } from "../src/main/native-support.mjs";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const payload = (id = ID, messages = []) => ({ session: { id, status: "active", created_at: "2026-10-24T01:00:00Z" }, messages, support_online: true });
function fixture(t, request) {
  const calls = [], stored = new Map();
  const support = new NativeSupport({
    bridge: { supportRequest: async (params) => { calls.push(params); return request ? request(params) : { ok: true, data: payload(params.sessionId || ID) }; }, supportUpload: async () => ({ ok: true }) },
    storage: { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    locale: () => "zh-CN", visible: () => true, changed() {},
  });
  support.setAccount("https://haolo.com::one");
  t.after(() => support.dispose());
  return { support, calls, stored };
}
test("open, send, exit and reopen history use only support APIs and preserve model state", async (t) => {
  const { support, calls } = fixture(t);
  await support.open();
  support.entry().draft = "客服问题";
  await support.send();
  assert.equal(support.entry().draft, "");
  support.close();
  assert.equal(support.records.length, 1);
  await support.open(ID);
  assert.equal(calls.at(-1).action, "messages");
  assert.equal(support.currentId, ID);
  assert.ok(calls.every((call) => ["open", "messages", "send", "read"].includes(call.action)));
});
test("failed send keeps draft and reuses idempotency key; changed content uses a new key", async (t) => {
  const { support, calls } = fixture(t, (params) => params.action === "send" ? { ok: false, status: 503 } : { ok: true, data: payload() });
  await support.open(); support.entry().draft = "保留草稿";
  await support.send(); await support.send();
  const sent = calls.filter((call) => call.action === "send");
  assert.equal(sent[0].client_message_id, sent[1].client_message_id);
  assert.equal(support.entry().draft, "保留草稿");
  support.entry().draft = "修改后的问题"; await support.send();
  assert.notEqual(calls.filter((call) => call.action === "send").at(-1).client_message_id, sent[0].client_message_id);
});
test("recent support history persists across account activation and never appears in another account", async (t) => {
  const { support, calls } = fixture(t);
  await support.open(); support.close();
  support.setAccount("https://haolo.com::two"); assert.equal(support.records.length, 0);
  support.setAccount("https://haolo.com::one"); assert.equal(support.records[0].id, ID);
  await support.open(support.records[0].id);
  assert.equal(calls.at(-1).action, "messages");
});
test("double send is suppressed and leaving during send does not reopen support", async (t) => {
  let finish;
  const { support, calls } = fixture(t, (p) => p.action === "send" ? new Promise((resolve) => { finish = resolve; }) : { ok: true, data: payload() });
  await support.open(); support.entry().draft = "问题";
  const pending = support.send(); await support.send(); support.close();
  finish({ ok: true }); await pending;
  assert.equal(calls.filter((p) => p.action === "send").length, 1);
  assert.equal(support.active, false);
});
test("account switch fences an old open response and restores only matching account history", async (t) => {
  let finish;
  const { support, stored } = fixture(t, () => new Promise((resolve) => { finish = resolve; }));
  const pending = support.open(); support.setAccount("https://haolo.com::two");
  finish({ ok: true, data: payload() }); await pending;
  assert.equal(support.records.length, 0); assert.equal(support.active, false);
  assert.equal(stored.size, 0);
});
test("older selection response cannot replace current history and exit fences pending open", async (t) => {
  const pending = new Map();
  const { support } = fixture(t, (p) => new Promise((resolve) => pending.set(p.sessionId, resolve)));
  const first = support.open(ID), second = support.open(OTHER);
  pending.get(OTHER)({ ok: true, data: payload(OTHER) }); await second;
  support.close(); pending.get(ID)({ ok: true, data: payload(ID) }); await first;
  assert.equal(support.currentId, OTHER); assert.equal(support.active, false); assert.equal(support.records.length, 2);
});
test("polling captures withdrawn text and session closure, marks only visible support as read", async (t) => {
  let text = "客服原回复", status = "active";
  const { support, calls } = fixture(t, () => ({ ok: true, data: { ...payload(ID, [{ id: "reply", role: "agent", text, created_at: "2026-10-24T02:00:00Z" }]), session: { id: ID, status } } }));
  await support.open();
  assert.equal(support.records[0].unread, 0);
  support.close(); text = "消息已撤回"; status = "resolved";
  const reads = calls.filter((p) => p.action === "read").length;
  await support.refresh(ID);
  assert.equal(support.entry(ID).payload.messages[0].text, "消息已撤回");
  assert.equal(support.canSend(), false);
  assert.equal(calls.filter((p) => p.action === "read").length, reads);
});
test("file validation, HTTPS URL filtering, 4000 character limit and attachment-only send", async (t) => {
  const { support, calls } = fixture(t);
  await support.open();
  assert.equal(supportFileType({ name: "诊断.JSON", type: "" }), "application/json");
  assert.equal(supportMediaUrl("javascript:alert(1)"), "");
  assert.equal(supportMediaUrl("https://user:secret@example.com/a"), "");
  support.chooseFile(new File([], "empty.txt")); assert.equal(support.entry().error, "emptyFile");
  support.chooseFile(new File(["x"], "bad.html")); assert.equal(support.entry().error, "badType");
  support.entry().draft = "x".repeat(4001); await support.send();
  assert.equal(calls.filter((p) => p.action === "send").length, 0);
  support.entry().draft = ""; support.entry().file = new File(["{}"], "data.json");
  support.entry().uploaded = { kind: "file", object_key: "existing-key", file_name: "data.json", mime_type: "application/json", size_bytes: 2 };
  await support.send(); assert.equal(calls.find((p) => p.action === "send").attachments.length, 1);
});
test("support API is allowlisted, uses existing auth refresh and rejects malformed routes", async () => {
  assert.throws(() => supportRoute({ action: "messages", sessionId: "../admin" }));
  assert.throws(() => supportRoute({ action: "delete", sessionId: ID }));
  const calls = [];
  const client = new YouleApiClient({ serviceFetch: async (url, init) => { calls.push({ url, init }); return calls.length === 1 ? Response.json({}, { status: 401 }) : Response.json(payload()); } });
  client.loaded = true; client.token = "test-old"; client.profile = { id: "one" }; client.save = async () => {};
  client.refreshAccessToken = async ({ force }) => { if (force) client.token = "test-new"; return client.token; };
  await client.supportRequest({ action: "open", locale: "en" });
  assert.equal(new URL(calls[0].url).pathname, "/api/support/website/open");
  assert.equal(calls[1].init.headers.Authorization, "Bearer test-new");
  assert.deepEqual(JSON.parse(calls[1].init.body), { locale: "en" });
});
test("chunked upload transfers exact bytes through service transport and cleans temporary files", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "native-support-test-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  let received;
  const client = { baseUrl: "https://haolo.com", load: async () => {}, sessionSummary: () => ({ authenticated: true, profile: { id: "one" } }),
    supportRequest: async () => ({ upload_url: "/api/support/attachment-uploads", headers: { "Content-Type": "text/plain", "X-Support-Upload-Token": "test" }, kind: "file", object_key: "support/test", file_name: "x.txt", mime_type: "text/plain", size_bytes: 3 }),
    serviceFetch: async (url, init) => { assert.equal(url, "https://haolo.com/api/support/attachment-uploads"); assert.equal(init.headers.Authorization, undefined); received = await new Response(init.body).text(); return new Response(null, { status: 204 }); },
  };
  const uploads = createSupportUploads({ getClient: () => client, tempRoot });
  const { uploadId } = await uploads.run(7, { action: "begin", sessionId: ID, file_name: "x.txt", mime_type: "text/plain", size_bytes: 3 });
  await assert.rejects(uploads.run(8, { action: "chunk", uploadId, offset: 0, bytes: new Uint8Array([97]) }), /missing/);
  await uploads.run(7, { action: "chunk", uploadId, offset: 0, bytes: new Uint8Array([97, 98, 99]) });
  const attachment = await uploads.run(7, { action: "finish", uploadId });
  assert.equal(received, "abc"); assert.equal(attachment.object_key, "support/test"); assert.deepEqual(await readdir(tempRoot), []);
});
test("source wiring keeps native support out of model submit, message scroller and web entry points", async () => {
  const main = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const view = await readFile(new URL("../src/renderer/native-support-view.ts", import.meta.url), "utf8");
  const block = main.slice(main.indexOf("function openNativeSupport("), main.indexOf("function bindWebsiteSupportEvents("));
  assert.doesNotMatch(block, /state\.currentThreadId\s*=|state\.composerText\s*=|interruptTurn|sendUserMessage|startTurn|stopTurn/);
  assert.doesNotMatch(view, /id="composerInput"|id="messageScroller"|iframe|webview/);
  assert.match(block, /rememberActiveComposerDraft/);
});
