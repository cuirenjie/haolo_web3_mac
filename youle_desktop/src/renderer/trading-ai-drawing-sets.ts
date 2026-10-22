// Completed drawings from one chat turn. The existing drawing array remains the
// selected view; this store owns the alternatives and the durable selection.
type Drawing = { symbol: string; interval?: string; strategyId?: string };
type Context = { marketId: string; interval: string };
type DrawingSet<T> = { id: string; revision: number; drawings: T[] };
type Group<T> = Context & { turnId: string; selectedId: string; sets: DrawingSet<T>[] };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const MAX_CONTEXTS = 24;
const MAX_SETS = 24;
const key = (session: string) => `haolo.trading-market.ai-drawing-sets.v1.${encodeURIComponent(session)}`;
const matches = (a: Context, b: Context) => a.marketId === b.marketId && a.interval === b.interval;
const inContext = (d: Drawing, c: Context) => d.symbol === c.marketId && d.interval === c.interval;

export class TradingAiDrawingSets<T extends Drawing> {
  private groups: Group<T>[] = [];
  private storage: Storage;
  private session: string;
  private normalize: (value: unknown[]) => T[];

  constructor(storage: Storage, session: string, normalize: (value: unknown[]) => T[]) {
    this.storage = storage;
    this.session = session;
    this.normalize = normalize;
    this.load();
  }

  private load() {
    try {
      const value = JSON.parse(this.storage.getItem(key(this.session)) || 'null');
      this.groups = value?.version === 1 && Array.isArray(value.groups) ? value.groups.slice(-MAX_CONTEXTS).flatMap((g: any) => {
        if (typeof g?.marketId !== 'string' || typeof g.interval !== 'string'
          || typeof g.turnId !== 'string' || !Array.isArray(g.sets)) return [];
        const sets = g.sets.slice(-MAX_SETS).flatMap((s: any) => {
          if (typeof s?.id !== 'string' || !Array.isArray(s.drawings)) return [];
          const drawings = this.normalize(s.drawings).filter(d => inContext(d, g));
          // An empty saved slot can be the user's deletion of its last label.
          // Keep its revision so an identical receipt cannot restore it.
          return [{ id: s.id, revision: Number(s.revision) || 0, drawings }];
        });
        if (!sets.length) return [];
        return [{ marketId: g.marketId, interval: g.interval, turnId: g.turnId, sets,
          selectedId: sets.some((s: DrawingSet<T>) => s.id === g.selectedId) ? g.selectedId : sets[0].id }];
      }) : [];
    } catch { this.groups = []; }
  }

  private save() {
    try {
      this.storage.setItem(key(this.session), JSON.stringify({ version: 1, groups: this.groups }));
      return true;
    } catch { return false; } // Keep the current session usable if storage is full.
  }

  info(context: Context) {
    const group = this.groups.find(g => matches(g, context));
    return { count: group?.sets.length || 0,
      index: group ? group.sets.findIndex(s => s.id === group.selectedId) : -1 };
  }

  upsert(context: Context, turnId: string, id: string, drawings: T[], revision = 0) {
    let group = this.groups.find(g => matches(g, context));
    if (!group || group.turnId !== turnId) {
      this.groups = this.groups.filter(g => !matches(g, context));
      group = { marketId: context.marketId, interval: context.interval, turnId, selectedId: id, sets: [] };
      this.groups.push(group);
    }
    const existing = group.sets.find(s => s.id === id);
    if (existing) {
      if (revision > existing.revision) {
        existing.drawings = structuredClone(drawings);
        existing.revision = revision;
      }
    } else if (drawings.length) {
      group.sets.push({ id, revision, drawings: structuredClone(drawings) });
      group.selectedId = id;
    }
    group.sets = group.sets.slice(-MAX_SETS);
    if (!group.sets.some(s => s.id === group.selectedId)) group.selectedId = group.sets[0]?.id || '';
    this.groups = this.groups.filter(g => g.sets.length).slice(-MAX_CONTEXTS);
    this.save();
  }

  // Preserve label sizing and deletions when leaving and revisiting a drawing.
  updateSelected(drawings: readonly T[]) {
    for (const group of this.groups) {
      const selected = group.sets.find(s => s.id === group.selectedId);
      if (selected) selected.drawings = structuredClone(drawings.filter(d => inContext(d, group)));
    }
    this.save();
  }

  selectedDrawings(fallback: readonly T[]): T[] {
    return [...fallback.filter(d => !this.groups.some(g => inContext(d, g))),
      ...this.groups.flatMap(g => structuredClone(g.sets.find(s => s.id === g.selectedId)?.drawings || []))];
  }

  next(context: Context) {
    const group = this.groups.find(g => matches(g, context));
    if (!group || group.sets.length < 2) return false;
    const index = group.sets.findIndex(s => s.id === group.selectedId);
    group.selectedId = group.sets[(index + 1) % group.sets.length].id;
    this.save();
    return true;
  }

  select(context: Context, id: string) {
    const group = this.groups.find(g => matches(g, context));
    if (!group?.sets.some(set => set.id === id)) return false;
    group.selectedId = id; this.save(); return true;
  }

  clear(context?: Context, strategyId?: string) {
    if (context && strategyId) {
      const group = this.groups.find(g => matches(g, context));
      if (group) {
        for (const set of group.sets) set.drawings = set.drawings.filter(d => d.strategyId !== strategyId);
        group.sets = group.sets.filter(s => s.drawings.length);
        if (!group.sets.some(s => s.id === group.selectedId)) group.selectedId = group.sets[0]?.id || '';
      }
      this.groups = this.groups.filter(g => g.sets.length);
    } else this.groups = context ? this.groups.filter(g => !matches(g, context)) : [];
    this.save();
  }

  switchSession(session: string, migrate: boolean) {
    const previous = this.session;
    this.session = session;
    if (!migrate) this.load();
    else if (this.save()) {
      try { this.storage.removeItem(key(previous)); } catch { /* Leave the recoverable copy. */ }
    }
  }
}
