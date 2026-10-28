import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const MAX_BYTES = 1024 ** 3;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function supportRoute(params = {}) {
  const action = params.action;
  if (action === "open") return { path: "/api/support/website/open", method: "POST", body: { locale: ["en", "zh-Hant", "ko", "ja", 'vi'].includes(params.locale) ? params.locale : "zh-CN" } };
  if (!UUID.test(String(params.sessionId || ""))) throw new Error("support_invalid_session");
  const prefix = `/api/support/website/sessions/${params.sessionId}`;
  if (action === "messages") return { path: `${prefix}/messages`, method: "GET" };
  if (action === "ai") return { path: `${prefix}/ai`, method: "GET" };
  if (action === "aiContext") return { path: `${prefix}/ai/context`, method: "PUT", body: params.context };
  if (action === "aiConsent" || action === "aiStep") {
    if (!UUID.test(String(params.actionId || ""))) throw new Error("support_invalid_operation");
    return { path: `${prefix}/ai/actions/${params.actionId}/${action === "aiConsent" ? "consent" : "step"}`, method: "POST", body: params.body };
  }
  if (action === "read") return { path: `${prefix}/read`, method: "POST", body: {} };
  if (action === "sign") {
    const { file_name, mime_type, size_bytes } = params;
    if (!file_name || String(file_name).length > 200 || !mime_type || !Number.isSafeInteger(size_bytes) || size_bytes <= 0 || size_bytes > MAX_BYTES) throw new Error("support_invalid_attachment");
    return { path: `${prefix}/attachments/sign`, method: "POST", body: { file_name, mime_type, size_bytes } };
  }
  if (action === "send") {
    const content = String(params.content || "").trim();
    const attachments = params.attachments || [];
    if (content.length > 4000 || !UUID.test(String(params.client_message_id || "")) || !Array.isArray(attachments) || attachments.length > 4 || (!content && !attachments.length)) throw new Error("support_invalid_message");
    return { path: `${prefix}/messages`, method: "POST", body: { content, client_message_id: params.client_message_id, attachments: attachments.map(({ kind, object_key, file_name, mime_type, size_bytes }) => ({ kind, object_key, file_name, mime_type, size_bytes })) } };
  }
  throw new Error("support_invalid_action");
}

// Upload bytes, never renderer-supplied paths or URLs. Credentials and signed
// upload targets stay in main; bounded chunks also cover pasted clipboard files.
export function createSupportUploads({ getClient, tempRoot = os.tmpdir() }) {
  const uploads = new Map();
  const pending = new Map();
  async function identity(client) {
    // Chunk ownership checks are local; only API requests may refresh auth.
    await client.load();
    const session = client.sessionSummary();
    if (!session?.authenticated || !session.profile?.id) throw new Error("support_auth_required");
    return `${client.baseUrl}:${session.profile.id}`;
  }
  async function remove(id) {
    const item = uploads.get(id);
    if (!item) return;
    uploads.delete(id);
    clearTimeout(item.timer);
    item.controller.abort();
    if (item.stream && !item.stream.closed) {
      await new Promise((resolve) => { item.stream.once("close", resolve); item.stream.destroy(); });
    }
    await item.handle?.close().catch(() => {});
    await fs.rm(item.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
  }
  async function execute(owner, params, reservation) {
    if (params.action === "cancel") {
      const item = uploads.get(params.uploadId);
      if (item && item.owner !== owner) throw new Error("support_upload_missing");
      await remove(params.uploadId);
      return {};
    }
    const client = getClient();
    const account = await identity(client);
    if (params.action === "begin") {
      const target = await client.supportRequest({ ...params, action: "sign" });
      if (await identity(client) !== account) throw new Error("support_auth_changed");
      if (reservation.cancelled) throw new Error("support_upload_cancelled");
      const url = new URL(target.upload_url, client.baseUrl);
      if (url.origin !== new URL(client.baseUrl).origin || url.pathname !== "/api/support/attachment-uploads" || url.username || url.password) throw new Error("support_invalid_upload_target");
      const directory = await fs.mkdtemp(path.join(tempRoot, "haolo-support-"));
      const file = path.join(directory, "attachment");
      let handle;
      try {
        handle = await fs.open(file, "wx");
        if (reservation.cancelled || await identity(client) !== account) throw new Error("support_upload_cancelled");
      } catch (error) {
        await handle?.close().catch(() => {});
        await fs.rm(directory, { recursive: true, force: true });
        throw error;
      }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { void remove(id); }, 15 * 60_000);
      timer.unref?.();
      uploads.set(id, { owner, account, directory, file, handle, target, url: url.href, size: params.size_bytes, received: 0, busy: false, controller: new AbortController(), timer });
      return { uploadId: id };
    }
    const item = uploads.get(params.uploadId);
    if (!item || item.owner !== owner) throw new Error("support_upload_missing");
    if (item.account !== account) { await remove(params.uploadId); throw new Error("support_auth_changed"); }
    if (item.busy) throw new Error("support_upload_busy");
    item.busy = true;
    try {
      if (params.action === "chunk") {
        const bytes = params.bytes;
        if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 1024 ** 2 || params.offset !== item.received || item.received + bytes.byteLength > item.size) throw new Error("support_invalid_chunk");
        let written = 0;
        while (written < bytes.byteLength) written += (await item.handle.write(bytes, written, bytes.byteLength - written, item.received + written)).bytesWritten;
        item.received += bytes.byteLength;
        return { received: item.received };
      }
      if (params.action !== "finish" || item.received !== item.size) throw new Error("support_incomplete_upload");
      await item.handle.close();
      item.handle = null;
      const stream = createReadStream(item.file);
      item.stream = stream;
      try {
        const response = await client.serviceFetch(item.url, {
          method: "PUT", headers: item.target.headers,
          body: Readable.toWeb(stream), duplex: "half", redirect: "error",
          signal: AbortSignal.any([item.controller.signal, AbortSignal.timeout(10 * 60_000)]),
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error("support_upload_failed");
        if (await identity(client) !== account) throw new Error("support_auth_changed");
        const { kind, object_key, file_name, mime_type, size_bytes } = item.target;
        return { kind, object_key, file_name, mime_type, size_bytes };
      } finally { stream.destroy(); await remove(params.uploadId); }
    } catch (error) { await remove(params.uploadId); throw error; }
    finally { item.busy = false; }
  }
  async function run(owner, params) {
    if (params.action !== "begin") return execute(owner, params);
    if (pending.has(owner) || [...uploads.values()].some(item => item.owner === owner)) throw new Error("support_upload_busy");
    const reservation = { cancelled: false };
    pending.set(owner, reservation);
    try { return await execute(owner, params, reservation); }
    finally { if (pending.get(owner) === reservation) pending.delete(owner); }
  }
  return { run, async disposeOwner(owner) {
    const reservation = pending.get(owner);
    if (reservation) reservation.cancelled = true;
    pending.delete(owner);
    await Promise.all([...uploads].filter(([, item]) => item.owner === owner).map(([id]) => remove(id)));
  } };
}
