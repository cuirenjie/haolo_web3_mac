import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => Object.assign(new Error(code), {code});
const originOf = value => value && typeof value.sourceThreadId === 'string' && value.sourceThreadId.trim()
  && !value.sourceThreadId.startsWith('cloud-run:') ? {
    sourceThreadId:value.sourceThreadId.trim(), storageSessionId:String(value.storageSessionId || value.sourceThreadId),
    analysisJobId:String(value.analysisJobId || ''),
  } : null;

// Local recovery metadata contains user instructions. Protect it with the same
// OS encryption boundary as account memory; never fall back to plain JSON.
export class CloudRunJournal {
  #queue = Promise.resolve();
  constructor({storagePath, safeStorage}) {
    this.storagePath = path.resolve(storagePath);
    this.safeStorage = safeStorage;
  }
  async #read() {
    if (!this.safeStorage?.isEncryptionAvailable()) throw fail('SECURE_STORAGE_UNAVAILABLE');
    let data;
    try { data = await fs.readFile(this.storagePath); }
    catch (error) { if (error.code === 'ENOENT') return {schemaVersion:1, owners:{}}; throw error; }
    let result;
    try { result = JSON.parse(this.safeStorage.decryptString(data)); }
    catch { throw fail('CLOUD_RUN_JOURNAL_INVALID'); }
    if (result?.schemaVersion !== 1 || !result.owners || typeof result.owners !== 'object' || Array.isArray(result.owners)) throw fail('CLOUD_RUN_JOURNAL_INVALID');
    return result;
  }
  async get(owner, key) {
    await this.#queue;
    return (await this.#read()).owners[hash(owner)]?.[hash(key)] ?? null;
  }
  async list(owner) {
    await this.#queue;
    return Object.values((await this.#read()).owners[hash(owner)] || {});
  }
  async origins(owner) {
    await this.#queue;
    const state = await this.#read(), id = hash(owner);
    return {...Object.fromEntries(Object.values(state.owners[id] || {})
      .filter(record => record.runId && originOf(record.origin)).map(record => [record.runId, originOf(record.origin)])),
      ...state.origins?.[id]};
  }
  rememberOrigin(owner, runId, origin) {
    if (!runId || !originOf(origin)) return Promise.reject(fail('CLOUD_PLAN_SOURCE_INVALID'));
    const task = this.#queue.then(async () => {
      const state = await this.#read();
      ((state.origins ||= {})[hash(owner)] ||= {})[runId] = originOf(origin);
      await this.#write(state);
    });
    this.#queue = task.catch(() => {});
    return task;
  }
  async #write(state) {
    await fs.mkdir(path.dirname(this.storagePath), {recursive:true});
    const temporary = `${this.storagePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, this.safeStorage.encryptString(JSON.stringify(state)), {mode:0o600});
      await fs.rename(temporary, this.storagePath);
    } finally { await fs.rm(temporary, {force:true}); }
  }
  put(owner, key, value) {
    const task = this.#queue.then(async () => {
      const state = await this.#read();
      const records = state.owners[hash(owner)] ||= {};
      // Keep only the small source link after recovery payloads are pruned.
      // Existing v1 journals are upgraded on their next write.
      const origins = (state.origins ||= {})[hash(owner)] ||= {};
      for (const record of [...Object.values(records), value]) {
        if (record.runId && originOf(record.origin) && !origins[record.runId]) origins[record.runId] = originOf(record.origin);
      }
      // Only remove acknowledged terminal records, never uncertain submissions.
      for (const [id, record] of Object.entries(records)) {
        if (record.acknowledged && Date.now() - record.updatedAt > 7 * 86400000) delete records[id];
      }
      if (!records[hash(key)] && Object.keys(records).length >= 500) throw fail('CLOUD_RUN_JOURNAL_FULL');
      records[hash(key)] = structuredClone({...value, updatedAt:Date.now()});
      await this.#write(state);
    });
    this.#queue = task.catch(() => {});
    return task;
  }
}
