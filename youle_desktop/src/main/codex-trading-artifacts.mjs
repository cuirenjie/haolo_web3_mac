import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// The model receives an opaque reference, never a writable drawing/plan payload.
// Account + visible conversation are part of the storage key and checked on read.
export class CodexTradingArtifacts {
  constructor({ directory, now = Date.now } = {}) {
    this.directory = directory;
    this.now = now;
    this.memory = new Map();
    this.current = new Map();
  }
  key(owner, thread, ref) {
    if (!/^[a-f0-9-]{36}$/.test(ref)) throw new Error("Invalid analysis reference.");
    return crypto.createHash("sha256").update(JSON.stringify([owner, thread, ref])).digest("hex");
  }
  async put(owner, thread, result, metadata = {}) {
    const ref = crypto.randomUUID();
    const record = { ref, owner, thread, createdAt: this.now(), result, metadata, effects: {} };
    await this.save(record);
    return ref;
  }
  async save(record) {
    const key = this.key(record.owner, record.thread, record.ref);
    const copy = structuredClone(record);
    if (this.directory) {
      const dir = typeof this.directory === "function" ? this.directory() : this.directory;
      await fs.mkdir(dir, { recursive: true });
      const target = path.join(dir, `${key}.json`);
      const temporary = `${target}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(copy), { mode: 0o600 });
        await fs.rename(temporary, target);
      } finally { await fs.rm(temporary, { force: true }); }
    }
    this.memory.delete(key);
    this.memory.set(key, copy);
    // Durable records remain on disk; keep large candle/patch payloads out of
    // an unbounded process cache during long-running desktop sessions.
    if (this.directory) while (this.memory.size > 64) this.memory.delete(this.memory.keys().next().value);
  }
  async get(owner, thread, ref) {
    const key = this.key(owner, thread, ref);
    let record = this.memory.get(key);
    if (!record && this.directory) {
      const dir = typeof this.directory === "function" ? this.directory() : this.directory;
      try { record = JSON.parse(await fs.readFile(path.join(dir, `${key}.json`), "utf8")); }
      catch { /* Return the same error for absent and foreign references. */ }
    }
    if (!record || record.owner !== owner || record.thread !== thread || record.ref !== ref) throw new Error("Analysis reference is unavailable in this conversation.");
    return structuredClone(record);
  }
  async currentDraft(owner, thread, kind, ref = undefined) {
    const key = createHeadKey(owner, thread, kind);
    const dir = typeof this.directory === "function" ? this.directory() : this.directory;
    const file = dir ? path.join(dir, `head-${key}.json`) : null;
    if (ref !== undefined) {
      if (file) {
        await fs.mkdir(dir, { recursive: true });
        const temp = `${file}.${crypto.randomUUID()}.tmp`;
        try { await fs.writeFile(temp, JSON.stringify({ref}), {mode:0o600}); await fs.rename(temp,file); }
        finally { await fs.rm(temp,{force:true}); }
      }
      this.current.set(key, ref);
    } else if (!this.current.has(key) && file) {
      try { this.current.set(key, JSON.parse(await fs.readFile(file,"utf8")).ref); } catch { return null; }
    }
    return this.current.get(key) || null;
  }
}
const createHeadKey = (owner, thread, kind) => crypto.createHash("sha256").update(JSON.stringify([owner,thread,kind])).digest("hex");
