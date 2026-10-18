export type SettingValue = string | number | boolean | null;
export type SettingValues = Record<string, SettingValue>;
type Edit = { key: string; value: SettingValue; changeId: string; changedAt: number };
type Receipt = { schemaVersion: 1; version: number; serverTime: number; entries: Edit[] };
type Upload = { schemaVersion: 1; mutationId: string; operations: Edit[] };
export const LEGACY_SETTINGS_TIME = 946684800000;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const newer = (a: Edit, b: Edit) => a.changedAt > b.changedAt || (a.changedAt === b.changedAt && a.changeId > b.changeId);

/** Durable per-field outbox. A read, render or account switch is never an edit. */
export class SettingsReplica {
  entries: Record<string, Edit> = {};
  pending: Record<string, Edit> = {};
  upload: Upload | null = null;
  migrated: string[] = [];
  version = 0;
  offset = 0;
  clockKnown = false;
  lastStamp = 0;
  constructor(saved?: string | null) {
    if (saved) {
      const data = JSON.parse(saved);
      for (const key of ['entries', 'pending', 'upload', 'migrated', 'version', 'offset', 'clockKnown', 'lastStamp'] as const)
        if (data[key] !== undefined) (this as any)[key] = data[key];
    }
  }
  serialize() { return JSON.stringify(this); }
  get dirty() { return this.upload !== null || Object.keys(this.pending).length > 0; }
  values(): SettingValues { return Object.fromEntries(Object.values(this.entries).map(e => [e.key, e.value])); }
  edit(before: SettingValues, after: SettingValues, legacy = false) {
    for (const [key, value] of Object.entries(after)) {
      if (before[key] === value || (legacy && this.entries[key])) continue;
      this.lastStamp = Math.max(Date.now() + this.offset, this.lastStamp + 1);
      const edit = { key, value, changeId: crypto.randomUUID(), changedAt: legacy ? LEGACY_SETTINGS_TIME : this.lastStamp };
      this.entries[key] = edit;
      this.pending[key] = edit;
    }
  }
  merge(receipt: Receipt, started = Date.now()) {
    if (receipt.schemaVersion !== 1 || !Number.isSafeInteger(receipt.version) || !Number.isFinite(receipt.serverTime)
      || !Array.isArray(receipt.entries)) throw new Error('SETTINGS_INVALID');
    if (receipt.version < this.version) return;
    const offset = receipt.serverTime - Math.trunc((started + Date.now()) / 2);
    if (!this.clockKnown && !this.upload) {
      for (const op of Object.values(this.pending)) if (op.changedAt !== LEGACY_SETTINGS_TIME) op.changedAt += offset;
    }
    this.offset = offset;
    this.clockKnown = true;
    this.version = receipt.version;
    const merged: Record<string, Edit> = {};
    for (const op of receipt.entries) {
      if (!op || typeof op.key !== 'string' || !Number.isFinite(op.changedAt) || typeof op.changeId !== 'string') throw new Error('SETTINGS_INVALID');
      merged[op.key] = copy(op);
    }
    for (const op of Object.values(this.pending)) {
      if (!merged[op.key] || (op.changedAt !== LEGACY_SETTINGS_TIME && newer(op, merged[op.key]))) merged[op.key] = op;
    }
    this.entries = merged;
    this.lastStamp = Math.max(receipt.serverTime, ...Object.values(merged).map(e => e.changedAt));
  }
  begin(): Upload {
    return this.upload ??= copy({ schemaVersion: 1, mutationId: crypto.randomUUID(), operations: Object.values(this.pending).slice(0, 1024) });
  }
  acknowledge() {
    for (const op of this.upload?.operations ?? []) if (this.pending[op.key]?.changeId === op.changeId) delete this.pending[op.key];
    this.upload = null;
  }
  correctClock() {
    const now = Date.now() + this.offset;
    const future = Object.values(this.pending).filter(op => op.changedAt > now + 300000);
    const delta = Math.max(0, ...future.map(op => op.changedAt - now));
    for (const op of future) { op.changedAt -= delta; this.entries[op.key] = op; }
    this.upload = null;
    this.lastStamp = Math.max(now, ...Object.values(this.entries).map(e => e.changedAt));
  }
}

export function flattenSettings(value: unknown, prefix: string): SettingValues {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return { [prefix]: value as SettingValue };
  if (!value || typeof value !== 'object') return {};
  return Object.assign({}, ...Object.entries(value).filter(([key]) => key !== 'version').map(([key, child]) => flattenSettings(child, `${prefix}.${key}`)));
}

/** Walk the local schema, never server-controlled property paths. */
export function applySettingValues<T>(template: T, values: SettingValues, prefix: string): T {
  if (template === null || typeof template !== 'object') return (prefix in values ? values[prefix] : template) as T;
  if (Array.isArray(template)) return template.map((v, i) => applySettingValues(v, values, `${prefix}.${i}`)) as T;
  return Object.fromEntries(Object.entries(template).map(([key, v]) => [key, applySettingValues(v, values, `${prefix}.${key}`)])) as T;
}

type Surface = { snapshot: () => SettingValues; defaults: () => SettingValues; apply: (values: SettingValues) => void };
type Request = (params: Record<string, unknown>) => Promise<any>;
export class DesktopSettingsSync {
  private owner = '';
  private baseUrl = '';
  private epoch = 0;
  private key = '';
  private replica = new SettingsReplica();
  private surfaces = new Map<string, Surface>();
  private busy: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryAt = 0;
  private failures = 0;
  private applying = false;
  private _status: 'local' | 'pending' | 'synced' | 'error' = 'local';
  onStatus?: () => void;
  get status() { return this._status; }
  set status(value: 'local' | 'pending' | 'synced' | 'error') {
    if (value === this._status) return;
    this._status = value; this.onStatus?.();
  }
  private storage: Pick<Storage, 'getItem' | 'setItem'>;
  private request: Request;
  constructor(storage: Pick<Storage, 'getItem' | 'setItem'>, request: Request) { this.storage = storage; this.request = request; }
  private persist() { if (this.key) this.storage.setItem(this.key, this.replica.serialize()); }
  private publish() {
    this.applying = true;
    try {
      const values = this.replica.values();
      for (const surface of [...this.surfaces.values()]) surface.apply({ ...surface.defaults(), ...values });
    } finally { this.applying = false; }
  }
  private migrate(id: string, surface: Surface) {
    if (!this.owner || this.replica.migrated.includes(id)) return;
    const claimKey = 'haolo.settings-sync.legacy-owner.v1';
    const claim = this.storage.getItem(claimKey);
    if (!claim) this.storage.setItem(claimKey, this.key);
    if (!claim || claim === this.key) this.replica.edit(surface.defaults(), surface.snapshot(), true);
    this.replica.migrated.push(id);
    this.persist();
  }
  register(id: string, surface: Surface) {
    this.surfaces.set(id, surface);
    if (this.owner) {
      const applying = this.applying;
      try {
        this.migrate(id, surface);
        this.applying = true;
        surface.apply({ ...surface.defaults(), ...this.replica.values() });
      } catch { this.status = 'error'; }
      finally { this.applying = applying; }
      void this.sync(true);
    }
    return () => { if (this.surfaces.get(id) === surface) this.surfaces.delete(id); };
  }
  activate(owner: string, baseUrl: string) {
    baseUrl = baseUrl.replace(/\/$/, '');
    if (owner === this.owner && baseUrl === this.baseUrl) return;
    const hadOwner = !!this.owner;
    this.epoch++;
    this.busy = null;
    this.owner = owner;
    this.baseUrl = baseUrl;
    this.key = owner ? `haolo.settings-sync.v1:${encodeURIComponent(baseUrl)}:${encodeURIComponent(owner)}` : '';
    this.retryAt = 0; this.failures = 0;
    this.status = owner ? 'pending' : 'local';
    try {
      this.replica = new SettingsReplica(this.key ? this.storage.getItem(this.key) : null);
      for (const [id, surface] of this.surfaces) this.migrate(id, surface);
      if (owner || hadOwner) this.publish();
    } catch { this.status = 'error'; return; }
    if (this.timer) clearInterval(this.timer);
    this.timer = owner ? setInterval(() => { if (typeof document === 'undefined' || !document.hidden) void this.sync(); }, 5000) : null;
    void this.sync(true);
  }
  edit(before: SettingValues, after: SettingValues) {
    if (this.applying || !this.owner) return;
    this.replica.edit(before, after);
    this.status = 'pending';
    try { this.persist(); } catch { this.status = 'error'; return; }
    void this.sync(true);
  }
  sync(force = false): Promise<void> {
    if (!this.owner || this.busy || (!force && Date.now() < this.retryAt)) return this.busy ?? Promise.resolve();
    const epoch = this.epoch, replica = this.replica, owner = this.owner, baseUrl = this.baseUrl;
    const current = () => epoch === this.epoch;
    const read = async () => {
      const started = Date.now(), receipt = await this.request({ action: 'read', owner, baseUrl });
      if (!current()) throw new Error('SETTINGS_ACCOUNT_CHANGED');
      replica.merge(receipt, started); this.persist(); this.publish();
    };
    const operation = (async () => {
      try {
        this.persist();
        await read();
        for (let i = 0; replica.dirty && i < 8; i++) {
          const body = replica.begin(); this.persist();
          await this.request({ action: 'write', owner, baseUrl, body });
          if (!current()) return;
          replica.acknowledge(); this.persist();
          await read();
        }
        this.failures = 0; this.retryAt = 0;
        this.status = replica.dirty ? 'pending' : 'synced';
      } catch (error) {
        if (!current()) return;
        if (String(error).includes('SETTINGS_CLOCK_INVALID')) { replica.correctClock(); try { this.persist(); } catch {} }
        this.status = 'error';
        this.retryAt = Date.now() + Math.min(60000, 5000 * 2 ** Math.min(this.failures++, 4));
      }
    })();
    this.busy = operation;
    void operation.finally(() => { if (current() && this.busy === operation) this.busy = null; });
    return operation;
  }
  dispose() { this.epoch++; if (this.timer) clearInterval(this.timer); this.timer = null; }
}

let singleton: DesktopSettingsSync | undefined;
export function accountSettingsSync() {
  return singleton ??= new DesktopSettingsSync(window.localStorage, params => {
    const request = (window as any).codexDesktop?.clientSettings;
    if (!request) return Promise.reject(new Error('SETTINGS_UNAVAILABLE'));
    return request(params);
  });
}
