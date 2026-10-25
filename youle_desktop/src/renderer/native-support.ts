export type SupportAttachment = { kind: string; name?: string; file_name?: string; url?: string; mime_type?: string; size_bytes?: number; object_key?: string };
import { SupportAssist, SUPPORT_EXECUTOR_VERSIONS, validateSupportProposal, type SupportAI, type SupportProposal } from "./support-assist.ts";
import { supportRuntime } from "./support-runtime.ts";
export type SupportMessage = { id: string; role: string; text?: string; created_at?: string; attachments?: SupportAttachment[]; sender_type?: string; support_event?: string };
// Older servers gave the first user message and the joined event the same
// transaction timestamp, then sorted their UUIDs. Repair only that tied pair.
export function supportDisplayMessages(messages: SupportMessage[]) {
  const ordered = [...messages];
  for (let i = 0; i < ordered.length - 1; i++) {
    const joined = ordered[i], user = ordered[i + 1];
    if (joined.support_event === "joined" && user.role === "user" && joined.created_at &&
        joined.created_at === user.created_at) {
      ordered[i] = user; ordered[i + 1] = joined; i++;
    }
  }
  return ordered;
}
export type SupportPayload = { session: { id: string; status: string; created_at?: string; updated_at?: string }; messages: SupportMessage[]; support_online?: boolean; ai?: SupportAI | null };
export type SupportRecord = { id: string; title: string; status: string; updatedAt: number; readIds: string[]; unread: number };
export type SupportResult = { ok: boolean; data?: any; status?: number; code?: string };
export type SupportBridge = { supportRequest(params: any): Promise<SupportResult>; supportUpload(params: any): Promise<SupportResult> };
export type SupportEntry = { payload?: SupportPayload; draft: string; file?: File; preview?: string; uploaded?: SupportAttachment; pendingId?: string; pendingText?: string; pendingFile?: File; sending: boolean; loading: boolean; error: string; progress: number };
const FILE_TYPES: Record<string, string> = {
  apk: "application/vnd.android.package-archive", exe: "application/vnd.microsoft.portable-executable", dmg: "application/x-apple-diskimage", ipa: "application/octet-stream",
  zip: "application/zip", "7z": "application/x-7z-compressed", rar: "application/vnd.rar", json: "application/json", txt: "text/plain", md: "text/markdown", markdown: "text/markdown", csv: "text/csv", pdf: "application/pdf", rtf: "application/rtf",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const MEDIA_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
export const SUPPORT_ACCEPT = Object.keys({ ...FILE_TYPES, ...MEDIA_TYPES }).map((extension) => `.${extension}`).join(",");
export function supportFileType(file: Pick<File, "name" | "type">) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return FILE_TYPES[extension] || MEDIA_TYPES[extension] || (Object.values(MEDIA_TYPES).includes(file.type) ? file.type : "");
}
export function supportMediaUrl(value?: string) {
  try { const url = new URL(value || ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
export function supportError(error: any) {
  if (["support_auth_changed", "support_auth_required"].includes(error?.code)) return "expired";
  if (error?.status === 401) return "expired";
  if (error?.status === 404) return "missing";
  if (error?.status === 409) return "ended";
  if (error?.status === 429) return "rateLimit";
  return "failed";
}

export class NativeSupport {
  active = false;
  currentId = "";
  records: SupportRecord[] = [];
  entries = new Map<string, SupportEntry>();
  opening = false;
  error = "";
  account = "";
  assisting = false;
  assistPinned = false;
  readonly deviceId = crypto.randomUUID();
  private assist?: SupportAssist;
  private generation = 0;
  private selection = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private fetching = new Set<string>();
  private readPending = new Set<string>();
  private uploads = new Set<string>();
  constructor(private options: { bridge: SupportBridge; storage: Pick<Storage, "getItem" | "setItem">; locale: () => string; visible: () => boolean; changed: (history: boolean) => void; context?: () => Record<string, unknown> }) {}
  private key() { return `haolo-native-support:v1:${this.account}`; }
  setAccount(account: string) {
    if (this.account === account) return;
    this.assist?.abort(); this.assistPinned = false;
    this.generation++; this.selection++;
    for (const uploadId of this.uploads) void this.uploadRequest({ action: "cancel", uploadId }).catch(() => {});
    this.uploads.clear();
    clearTimeout(this.timer);
    for (const entry of this.entries.values()) if (entry.preview) URL.revokeObjectURL(entry.preview);
    this.entries.clear(); this.fetching.clear(); this.readPending.clear();
    this.active = false; this.currentId = ""; this.opening = false; this.error = ""; this.account = account; this.records = [];
    if (account) {
      try {
        const stored = JSON.parse(this.options.storage.getItem(this.key()) || "[]");
        if (Array.isArray(stored)) this.records = stored.filter((r) => /^[a-f0-9-]{36}$/i.test(r?.id) && typeof r.title === "string").map((r) => ({ ...r, readIds: Array.isArray(r.readIds) ? r.readIds : [], unread: Number(r.unread) || 0 })).slice(0, 100);
      } catch { /* Corrupt history must not prevent opening support. */ }
      this.schedule();
    }
  }
  private persist() {
    try { this.options.storage.setItem(this.key(), JSON.stringify(this.records.slice(0, 100))); } catch { /* The live conversation remains usable if storage is full. */ }
  }
  entry(id = this.currentId): SupportEntry {
    let entry = this.entries.get(id);
    if (!entry) { entry = { draft: "", sending: false, loading: false, error: "", progress: 0 }; this.entries.set(id, entry); }
    return entry;
  }
  private async request(params: any) {
    const result = await this.options.bridge.supportRequest(params);
    if (!result.ok) throw result;
    return result.data;
  }
  private async uploadRequest(params: any) {
    const result = await this.options.bridge.supportUpload(params);
    if (!result.ok) throw result;
    return result.data;
  }
  private apply(payload: SupportPayload) {
    if (!payload?.session?.id || !Array.isArray(payload.messages)) throw new Error("Invalid support response");
    const id = payload.session.id;
    this.entry(id).payload = payload;
    if (id === this.currentId && payload.ai?.mode !== "ai") this.assist?.abort();
    const previous = this.records.find((record) => record.id === id);
    const messages = payload.messages;
    const title = String(messages.find((message) => message.role === "user" && message.text)?.text || "").replace(/\s+/g, " ").slice(0, 60);
    const readIds = previous?.readIds || [];
    const updatedAt = Math.max(...[payload.session.created_at, payload.session.updated_at, ...messages.map((message) => message.created_at)].map((time) => Date.parse(time || "") || 0), previous?.updatedAt || 0) || Date.now();
    const record = { id, title, updatedAt, status: payload.session.status, readIds, unread: messages.filter((m) => m.role !== "user" && !readIds.includes(m.id)).length };
    this.records = [record, ...this.records.filter((r) => r.id !== id)].sort((a, b) => b.updatedAt - a.updatedAt);
    this.persist();
  }
  async open(id = "") {
    if (!this.account) return;
    if (this.opening && !id) return;
    this.active = true; this.error = "";
    const generation = this.generation, selection = ++this.selection;
    this.currentId = id; this.opening = true;
    this.options.changed(false);
    try {
      const payload = await this.request(id ? { action: "messages", sessionId: id } : { action: "open", locale: this.options.locale() });
      if (generation !== this.generation) return;
      this.apply(payload);
      await this.configure(payload.session.id);
      if (selection === this.selection) { this.currentId = payload.session.id; this.opening = false; }
      this.options.changed(true);
      await this.markRead(payload.session.id);
    } catch (error) {
      if (generation === this.generation && selection === this.selection) { this.error = supportError(error); this.opening = false; this.options.changed(false); }
    }
  }
  close() { if (this.assisting) return; this.active = false; this.assistPinned = false; this.selection++; this.opening = false; }
  private async configure(id: string) {
    if (!this.options.context) return;
    await this.request({ action: "aiContext", sessionId: id, context: this.productContext() });
  }
  replyLocale() { return this.entry().payload?.ai?.reply_locale || this.options.locale(); }
  private productContext() {
    return { ...this.options.context?.(), ...supportRuntime, channel: "haolo_windows_web3",
      action_versions: Object.fromEntries(Object.entries(supportRuntime.action_versions).filter(([key, v]) => SUPPORT_EXECUTOR_VERSIONS[key] === v)),
      device_id: this.deviceId, surface: "windows", locale: this.options.locale() };
  }
  async decide(proposal: SupportProposal, accepted: boolean) {
    if (this.assisting || proposal.device_id !== this.deviceId) return;
    const sid = this.currentId, account = this.account;
    const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    this.assisting = true;
    try {
      if (accepted) validateSupportProposal(proposal, this.productContext());
      const result = await this.timedRequest({ action: "aiConsent", sessionId: sid, actionId: proposal.id, body: { decision: accepted ? "accept" : "decline", epoch: proposal.epoch, device_id: this.deviceId, token } });
      if (!accepted) return;
      this.assistPinned = true;
      const authorize = async () => {
        if (account !== this.account || sid !== this.currentId) throw new Error("support_account_changed");
        const data = await this.timedRequest({ action: "ai", sessionId: sid });
        if (data.ai?.mode !== "ai" || data.ai.epoch !== proposal.epoch || !data.ai.actions?.some((a: SupportProposal) => a.id === proposal.id && a.status === "running")) throw new Error("support_operation_superseded");
      };
      this.assist = new SupportAssist({ locale: () => proposal.reply_locale || this.replyLocale(), authorize,
        theme: () => document.documentElement.dataset.theme || "", themePersisted: () => this.options.storage.getItem("haolo.appearance.theme") });
      await this.assist.run(result.plan, (index, stage, outcome) => this.timedRequest({ action: "aiStep", sessionId: sid, actionId: proposal.id, body: { index, stage, result: outcome || "", device_id: this.deviceId, token } }));
    } catch {
      if (account === this.account) this.entry(sid).error = "failed";
    } finally {
      this.assisting = false; this.assist = undefined;
      if (account === this.account) { await this.refresh(sid); this.options.changed(true); }
    }
  }
  private async timedRequest(params: any) {
    let timer: ReturnType<typeof setTimeout>;
    try { return await Promise.race([this.request(params), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("support_operation_timeout")), 9000); })]); }
    finally { clearTimeout(timer!); }
  }
  async refresh(id = this.currentId) {
    if (!id || !this.account || this.fetching.has(id) || this.entry(id).sending) return;
    const generation = this.generation;
    this.fetching.add(id);
    try {
      const payload = await this.request({ action: "messages", sessionId: id });
      if (generation !== this.generation) return;
      // A send started while this GET was in flight; do not replace its result.
      if (this.entry(id).sending) return;
      const before = JSON.stringify(this.entry(id).payload);
      this.apply(payload);
      if (this.active && this.currentId === id) this.error = "";
      if (before !== JSON.stringify(payload)) this.options.changed(true);
      await this.markRead(id);
    } catch (error) {
      if (generation !== this.generation) return;
      if (this.active && this.currentId === id) { this.error = supportError(error); this.options.changed(false); }
    } finally { if (generation === this.generation) this.fetching.delete(id); }
  }
  async markRead(id = this.currentId) {
    if (!this.active || id !== this.currentId || !this.options.visible() || this.readPending.has(id)) return;
    const record = this.records.find((r) => r.id === id);
    if (!record?.unread) return;
    const generation = this.generation;
    const ids = (this.entry(id).payload?.messages || []).filter((m) => m.role !== "user").map((m) => m.id);
    this.readPending.add(id);
    try {
      await this.request({ action: "read", sessionId: id });
      if (generation !== this.generation) return;
      const current = this.records.find((r) => r.id === id);
      if (current) { current.readIds = ids; current.unread = (this.entry(id).payload?.messages || []).filter((m) => m.role !== "user" && !ids.includes(m.id)).length; this.persist(); this.options.changed(true); }
    } catch { /* Retried on the next visible poll. */ }
    finally { if (generation === this.generation) this.readPending.delete(id); }
  }
  private schedule() {
    clearTimeout(this.timer);
    const generation = this.generation;
    this.timer = setTimeout(async () => {
      if (generation !== this.generation) return;
      const ids = this.active && this.options.visible() ? [this.currentId] : this.records.filter((r) => ["waiting", "active"].includes(r.status)).map((r) => r.id);
      for (const id of ids) { if (generation !== this.generation) return; await this.refresh(id); }
      if (generation === this.generation) this.schedule();
    }, this.active ? 1800 : 5000);
  }
  canSend() { return !this.assisting && !this.opening && ["waiting", "active"].includes(this.entry().payload?.session.status || "") && !this.entry().sending; }
  chooseFile(file?: File) {
    if (!file || !this.canSend()) return;
    const entry = this.entry();
    entry.error = !file.size ? "emptyFile" : file.size > 1024 ** 3 ? "tooLarge" : !supportFileType(file) ? "badType" : "";
    if (!entry.error) {
      this.removeFile(false); entry.file = file;
      const type = supportFileType(file);
      if (/^(image|video)\//.test(type)) entry.preview = URL.createObjectURL(file);
    }
    this.options.changed(false);
  }
  removeFile(notify = true) {
    const entry = this.entry();
    if (entry.sending) return;
    if (entry.preview) URL.revokeObjectURL(entry.preview);
    entry.file = undefined; entry.preview = undefined; entry.uploaded = undefined;
    if (notify) this.options.changed(false);
  }
  async send() {
    const id = this.currentId, entry = this.entry(id), generation = this.generation;
    const content = entry.draft.trim(), file = entry.file;
    if (!this.canSend() || (!content && !file)) return;
    if (content.length > 4000) { entry.error = "tooLong"; this.options.changed(false); return; }
    if (!entry.pendingId || entry.pendingText !== content || entry.pendingFile !== file) {
      entry.pendingId = crypto.randomUUID(); entry.pendingText = content; entry.pendingFile = file;
    }
    entry.sending = true; entry.error = ""; entry.progress = 0; this.options.changed(false);
    let uploadId = "";
    try {
      if (file && !entry.uploaded) {
        const started = await this.uploadRequest({ action: "begin", sessionId: id, file_name: file.name, mime_type: supportFileType(file), size_bytes: file.size });
        uploadId = started.uploadId;
        this.uploads.add(uploadId);
        for (let offset = 0; offset < file.size; offset += 1024 ** 2) {
          if (generation !== this.generation) return;
          const bytes = new Uint8Array(await file.slice(offset, offset + 1024 ** 2).arrayBuffer());
          await this.uploadRequest({ action: "chunk", uploadId, offset, bytes });
          entry.progress = Math.floor(Math.min(offset + bytes.length, file.size) / file.size * 90);
          this.options.changed(false);
        }
        entry.uploaded = await this.uploadRequest({ action: "finish", uploadId });
        this.uploads.delete(uploadId);
        uploadId = ""; entry.progress = 100;
      }
      if (generation !== this.generation) return;
      await this.configure(id);
      await this.request({ action: "send", sessionId: id, content, client_message_id: entry.pendingId, attachments: entry.uploaded ? [entry.uploaded] : [] });
      if (generation !== this.generation) return;
      entry.draft = ""; entry.pendingId = undefined; entry.pendingFile = undefined; entry.pendingText = undefined;
      if (entry.preview) URL.revokeObjectURL(entry.preview);
      entry.file = undefined; entry.preview = undefined; entry.uploaded = undefined;
    } catch (error) {
      if (generation === this.generation) { entry.error = supportError(error); if (entry.error === "ended") void this.refresh(id); }
    } finally {
      if (uploadId) { this.uploads.delete(uploadId); await this.uploadRequest({ action: "cancel", uploadId }).catch(() => {}); }
      if (generation === this.generation) { entry.sending = false; this.options.changed(false); }
    }
    if (generation === this.generation) await this.refresh(id);
  }
  dispose() { this.setAccount(""); }
}
