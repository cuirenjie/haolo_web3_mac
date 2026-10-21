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
    this.presentationIndex = null;
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
    this.presentationIndex = null;
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
  async presentations(owner, thread) {
    if (!owner || !thread) return [];
    const dir = typeof this.directory === "function" ? this.directory() : this.directory;
    if (!dir) return structuredClone([...this.memory.values()]
      .filter(record => record.owner === owner && record.thread === thread)
      .flatMap(presentedItems));
    // Only cache the small delivered messages, never candles or analysis input.
    // Atomic artifact renames change the directory timestamp, including writes
    // by another process. A local save also invalidates immediately.
    let stamp;
    try { const stat = await fs.stat(dir); stamp = `${stat.mtimeMs}:${stat.ctimeMs}`; }
    catch (error) { if (error?.code === "ENOENT") return []; throw error; }
    if (!this.presentationIndex || this.presentationIndex.dir !== dir || this.presentationIndex.stamp !== stamp) {
      this.presentationIndex = { dir, stamp, promise: this.readPresentationIndex(dir) };
    }
    const index = await this.presentationIndex.promise;
    return structuredClone(index.get(JSON.stringify([owner, thread])) || []);
  }
  async readPresentationIndex(dir) {
    const index = new Map();
    for (const name of await fs.readdir(dir)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      let record;
      try {
        record = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
        if (typeof record.owner !== "string" || typeof record.thread !== "string"
            || `${this.key(record.owner, record.thread, record.ref)}.json` !== name) continue;
      } catch { continue; } // A corrupt/unrelated artifact must not hide other plans.
      const items = presentedItems(record);
      if (!items.length) continue;
      const key = JSON.stringify([record.owner, record.thread]);
      index.set(key, [...(index.get(key) || []), ...items]);
    }
    return index;
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
function presentedItems(record) {
  const items = record.effects?.present?.presentationItems;
  if (!Array.isArray(items)) return [];
  return items.filter(item => item?.type === "agentMessage" && typeof item.id === "string" && item.id
    && typeof item.text === "string" && item.text.trim()
    && ["execution-plan", "position-plan"].includes(item.__youleExecutionPlanPresentation));
}
const createHeadKey = (owner, thread, kind) => crypto.createHash("sha256").update(JSON.stringify([owner,thread,kind])).digest("hex");
