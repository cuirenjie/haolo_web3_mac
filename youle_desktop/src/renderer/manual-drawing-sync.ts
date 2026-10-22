import type { TradingDrawingModel } from './trading-expert-drawing.ts';
type WireDrawing = Omit<TradingDrawingModel, 'tool'> & {
    tool: string;
};
type Operation = {
    id: string;
    changeId: string;
    changedAt: number;
    drawing: WireDrawing | null;
};
type Receipt = {
    schemaVersion: 4;
    version: number;
    serverTime: number;
    marketKey: string;
    entries: Operation[];
};
type Api = (params: Record<string, unknown>) => Promise<any>;
// The deployed drawing API still accepts two anchors for positions/ghost feed
// and has no snapshot/options fields or anchored volume tools. Keep richer records in the durable local
// replica until that contract is upgraded; never let one reject other drawings.
export const drawingOperationCanUpload = (op: Operation) => !op.drawing || !(
    op.drawing.position || op.drawing.barsPattern || op.drawing.tool === 'sector'
    || op.drawing.imageOpacity !== undefined
    || ['note', 'callout', 'table', 'image'].includes(op.drawing.tool) && op.drawing.points.length > 1
    || op.drawing.vwap || op.drawing.volumeProfile || ['anchored-vwap', 'anchored-volume-profile'].includes(op.drawing.tool)
    || ['long-position', 'short-position', 'ghost-feed'].includes(op.drawing.tool) && op.drawing.points.length > 2
);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const fingerprint = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined && v !== null).sort(([a], [b]) => a.localeCompare(b))) : item);
export const newerDrawingEdit = (a: Operation, b: Operation) => a.changedAt > b.changedAt || (a.changedAt === b.changedAt && a.changeId > b.changeId);
export function canonicalDrawingMarket(value: string) {
    const [provider, ...parts] = value.split(':'), name = provider.toLowerCase();
    if (name === 'binance' && parts.length === 2) {
        const venue = parts[0].toLowerCase();
        if (['futures', 'usdm', 'spot'].includes(venue))
            return `binance:${venue === 'spot' ? 'spot' : 'usdm'}:${parts[1].toUpperCase()}`;
    }
    if (['ifind', 'finnhub', 'hyperliquid'].includes(name) && parts.length)
        return `${name}:${parts.join(':').toUpperCase()}`;
    throw new Error('DRAWING_MARKET_INVALID');
}
export const canonicalDrawingScope = (value: string) => value === 'main' ? value : `indicator:${value.replace(/^indicator:/, '').toUpperCase()}`;
export function canonicalDrawingInterval(value: string) { const map: Record<string, string> = { '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '120': '2h', '240': '4h', '360': '6h', '480': '8h', '720': '12h', '1D': '1d', '1W': '1w', '1Y': '1y' }; return map[value] || value; }
export function drawingToWire(d: TradingDrawingModel): WireDrawing {
    const result: WireDrawing = { id: d.id, tool: d.tool, symbol: canonicalDrawingMarket(d.symbol), drawingScope: canonicalDrawingScope(d.drawingScope || 'main'), points: d.points.map(p => ({ time: Math.round(p.time * 1000), price: p.price })), source: 'manual' };
    if (d.barsPattern) result.barsPattern = d.barsPattern;
    if (d.imageOpacity !== undefined) result.imageOpacity = d.imageOpacity;
    for (const key of ['interval', 'text', 'locked', 'color', 'lineWidth', 'lineStyle', 'fontSize', 'bold', 'textBackgroundColor', 'viewportAnchor', 'textColor', 'italic', 'textAlign', 'textVerticalAlign', 'showPriceLabel', 'regression', 'fibonacci', 'position', 'vwap', 'volumeProfile'] as const)
        if (d[key] !== undefined)
            Object.assign(result, { [key]: key === 'interval' ? canonicalDrawingInterval(d.interval!) : d[key] });
    return result;
}
export function drawingFromWire(d: WireDrawing, symbol: string): TradingDrawingModel { return { ...copy(d), tool: d.tool as TradingDrawingModel['tool'], symbol, drawingScope: d.drawingScope === 'main' ? 'main' : d.drawingScope?.toLowerCase(), points: d.points.map(p => ({ time: p.time / 1000, price: p.price })) }; }
// A replica stores only explicit edits. Merely receiving or opening a chart
// does not create a new timestamp and cannot overwrite another client's edit.
export class DrawingReplica {
    entries: Record<string, Operation> = {};
    pending: Record<string, Operation> = {};
    upload: Record<string, unknown> | null = null;
    offset = 0;
    clockKnown = false;
    lastStamp = 0;
    version = 0;
    interval = '1h';
    constructor(saved?: string | null) {
        if (saved)
            Object.assign(this, JSON.parse(saved));
    }
    serialize() { return JSON.stringify({ entries: this.entries, pending: this.pending, upload: this.upload, offset: this.offset, clockKnown: this.clockKnown, lastStamp: this.lastStamp, version: this.version, interval: this.interval }); }
    get dirty() { return !!this.upload || Object.values(this.pending).some(drawingOperationCanUpload); }
    edit(before: WireDrawing[], after: WireDrawing[], legacy = false) {
        const a = new Map(before.map(d => [d.id, d])), b = new Map(after.map(d => [d.id, d]));
        for (const id of new Set([...a.keys(), ...b.keys()])) {
            if (fingerprint(a.get(id)) === fingerprint(b.get(id)))
                continue;
            this.lastStamp = Math.max(Date.now() + this.offset, this.lastStamp + 1);
            const op = { id, changeId: crypto.randomUUID(), changedAt: legacy ? 946684800000 : this.lastStamp, drawing: b.get(id) ?? null };
            this.entries[id] = op;
            this.pending[id] = op;
        }
    }
    merge(receipt: Receipt, started = Date.now()) {
        if (receipt.schemaVersion !== 4 || !Array.isArray(receipt.entries) || !Number.isFinite(receipt.serverTime))
            throw new Error('DRAWING_INVALID');
        const offset = receipt.serverTime - Math.trunc((started + Date.now()) / 2);
        if (!this.clockKnown && !this.upload)
            for (const op of Object.values(this.pending))
                if (op.changedAt !== 946684800000)
                    op.changedAt += offset;
        this.offset = offset;
        this.clockKnown = true;
        this.version = receipt.version;
        const merged: Record<string, Operation> = {};
        for (const op of receipt.entries) {
            if (!op || typeof op.id !== 'string' || !Number.isFinite(op.changedAt) || typeof op.changeId !== 'string')
                throw new Error('DRAWING_INVALID');
            merged[op.id] = copy(op);
        }
        for (const op of Object.values(this.pending))
            if (!merged[op.id] || newerDrawingEdit(op, merged[op.id]))
                merged[op.id] = op;
        this.entries = merged;
        this.lastStamp = Math.max(receipt.serverTime, ...Object.values(merged).map(op => op.changedAt));
    }
    begin(market: string, interval: string) { return this.upload ??= copy({ schemaVersion: 4, mutationId: crypto.randomUUID(), marketKey: market, interval, operations: Object.values(this.pending).filter(drawingOperationCanUpload).slice(0, 600) }); }
    acknowledge() {
        for (const op of this.upload?.operations as Operation[] ?? [])
            if (this.pending[op.id]?.changeId === op.changeId)
                delete this.pending[op.id];
        this.upload = null;
    }
    correctRejectedClock() {
        const now = Date.now() + this.offset;
        const future = Object.values(this.pending).filter(op => op.changedAt > now + 300000);
        const delta = Math.max(0, ...future.map(op => op.changedAt - now));
        for (const op of future) {
            op.changedAt -= delta;
            this.entries[op.id] = op;
        }
        this.upload = null;
        this.lastStamp = Math.max(now, ...Object.values(this.entries).map(op => op.changedAt));
    }
    drawings() { return Object.values(this.entries).flatMap(op => op.drawing ? [op.drawing] : []); }
}
interface Surface {
    session: () => string;
    isNewTask: () => boolean;
    symbol: () => string;
    interval: () => string;
    scope: string;
    snapshot: () => TradingDrawingModel[];
    apply: (drawings: TradingDrawingModel[], symbol: string, persist?: boolean) => void;
    busy: () => boolean;
    status: (message: string) => void;
}
const texts = {
    clearTitle: ['清空绘图？', 'Clear drawings?', '清空繪圖？'],
    clearDescription: ['将清空所选范围的绘图及历史记录，手工画线的删除也会同步到其他设备的新任务。历史任务不受影响。此操作无法撤销。', 'Clear drawings and drawing history in the selected scope. Manual drawing deletions also sync to New task on other devices. Historical tasks are unaffected. This cannot be undone.', '將清空所選範圍的繪圖及歷史記錄，手工畫線的刪除也會同步到其他裝置的新任務。歷史任務不受影響。此操作無法復原。'],
    pending: ['画线已保留在本机，等待同步', 'Drawings saved on this device; waiting to sync', '畫線已保留在本機，等待同步'],
    localError: ['画线本机保存失败', 'Could not save drawings on this device', '畫線本機儲存失敗'],
    failed: ['暂时无法同步，请稍后重试', 'Unable to sync; try again shortly', '暫時無法同步，請稍後重試'],
} as const;
export function drawingSyncText(key: keyof typeof texts) { const lang = document.documentElement.dataset.language || document.documentElement.lang; return texts[key][lang === 'en' ? 1 : /TW|Hant/.test(lang) ? 2 : 0]; }
const bridge = () => (window as unknown as {
    codexDesktop?: {
        manualDrawings?: Api;
    };
}).codexDesktop?.manualDrawings;
const cachePrefix = 'haolo.manual-workspace-v1:';
const activeCaches = new Set<string>();
const draining = new Map<string, Promise<void>>();
// The session and scope distinguish local writers, never the remote canvas.
export const drawingCacheKey = (owner: string, market: string, session: string, scope: string) => cachePrefix + JSON.stringify([owner, market, session, scope]);
export async function drainDrawingOutbox(api: Api, owner: string, storage: Storage) {
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key?.startsWith(cachePrefix) || activeCaches.has(key) || draining.has(key))
            continue;
        let parts: string[], replica: DrawingReplica;
        try {
            parts = JSON.parse(key.slice(cachePrefix.length));
            if (parts[0] !== owner)
                continue;
            replica = new DrawingReplica(storage.getItem(key));
            if (!replica.dirty)
                continue;
        }
        catch {
            continue;
        }
        const market = parts[1];
        const work = (async () => {
            try {
                const started = Date.now();
                replica.merge(await api({ action: 'read', owner, market }), started);
                const body = replica.begin(market, replica.interval);
                storage.setItem(key, replica.serialize());
                await api({ action: 'write', owner, body });
                replica.acknowledge();
                storage.setItem(key, replica.serialize());
            }
            catch (error) {
                if (String(error).includes('DRAWING_CLOCK_INVALID')) {
                    replica.correctRejectedClock();
                    storage.setItem(key, replica.serialize());
                }
            }
        })();
        draining.set(key, work);
        await work;
        draining.delete(key);
    }
}
// Re-entering New task also restores the account's latest cached canvas offline.
// Pending operations stay with their original writer and keep their mutation ID.
function cachedWorkspace(owner: string, market: string, storage: Storage) {
    const replica = new DrawingReplica();
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key?.startsWith(cachePrefix))
            continue;
        try {
            const parts = JSON.parse(key.slice(cachePrefix.length));
            if (parts[0] !== owner || parts[1] !== market)
                continue;
            const saved = new DrawingReplica(storage.getItem(key));
            for (const op of Object.values(saved.entries))
                if (!replica.entries[op.id] || newerDrawingEdit(op, replica.entries[op.id]))
                    replica.entries[op.id] = copy(op);
            replica.lastStamp = Math.max(replica.lastStamp, saved.lastStamp);
        }
        catch { /* A damaged cache cannot replace other valid caches. */ }
    }
    return replica;
}
export class DesktopDrawingSync {
    private owner = '';
    private context = '';
    private storageKey = '';
    private session = '';
    private market = '';
    private replica = new DrawingReplica();
    private projected: WireDrawing[] = [];
    private initial: TradingDrawingModel[];
    private timer: ReturnType<typeof setInterval> | null = null;
    private debounce: ReturnType<typeof setTimeout> | null = null;
    private stopped = false;
    private running = false;
    private ready = false;
    private initialEdited = false;
    private readonly surface: Surface;
    constructor(surface: Surface) {
        this.surface = surface;
        this.initial = copy(surface.snapshot());
        if (!bridge())
            return;
        if (surface.isNewTask())
            surface.apply([], surface.symbol(), false);
        this.timer = setInterval(() => { if (!document.hidden)
            void this.sync(); }, 5000);
        window.addEventListener('haolo-drawing-workspace-clear', this.workspaceCleared);
        window.addEventListener('online', this.wake);
        window.addEventListener('focus', this.wake);
        void this.sync();
    }
    get automatic() { return this.surface.isNewTask(); }
    private wake = () => { void this.sync(); };
    private release() {
        this.save();
        activeCaches.delete(this.storageKey);
        this.storageKey = '';
        this.ready = false;
        this.context = '';
    }
    contextChanged() {
        if (!this.surface.isNewTask()) {
            this.release();
            return;
        }
        try {
            if (!this.ready || this.session !== this.surface.session() || this.market !== canonicalDrawingMarket(this.surface.symbol())) {
                this.initial = copy(this.surface.snapshot());
                void this.sync();
            }
        }
        catch { /* Unsupported markets remain local. */ }
    }
    private save() {
        try {
            if (this.storageKey)
                localStorage.setItem(this.storageKey, this.replica.serialize());
            return true;
        }
        catch {
            this.surface.status(drawingSyncText('localError'));
            return false;
        }
    }
    private show() {
        if (!this.ready || !this.surface.isNewTask() || this.surface.busy())
            return;
        const symbol = this.surface.symbol(), scope = canonicalDrawingScope(this.surface.scope);
        const figures = this.replica.drawings().filter(d => d.symbol === this.market && d.drawingScope === scope);
        this.projected = copy(figures);
        this.surface.apply(figures.map(d => drawingFromWire(d, symbol)), symbol);
    }
    changed() {
        if (this.stopped || !this.surface.isNewTask())
            return;
        if (!this.ready || this.session !== this.surface.session() || this.market !== canonicalDrawingMarket(this.surface.symbol())) {
            this.initial = copy(this.surface.snapshot());
            this.initialEdited = true;
            void this.sync();
            return;
        }
        const figures = this.surface.snapshot().filter(d => d.symbol === this.surface.symbol() && (d.drawingScope || 'main') === this.surface.scope).map(drawingToWire);
        this.replica.edit(this.projected, figures);
        this.projected = copy(figures);
        this.save();
        if (this.debounce)
            clearTimeout(this.debounce);
        this.debounce = setTimeout(() => { void this.sync(); }, 350);
    }
    async sync() {
        const api = bridge();
        if (!api || this.stopped || this.running)
            return;
        this.running = true;
        try {
            const account = await api({ action: 'session' });
            if (this.stopped)
                return;
            const owner = String(account.owner || '');
            if (!this.surface.isNewTask()) {
                this.release();
                this.owner = owner;
                return;
            }
            if (!owner) {
                // Clear an old account on logout once. Polling while signed out
                // must not repeatedly delete local drawings or an active draft.
                if (this.owner) {
                    this.release();
                    this.owner = '';
                    this.initial = [];
                    this.initialEdited = false;
                    this.surface.apply([], this.surface.symbol(), false);
                }
                return;
            }
            const localSession = this.surface.session(), market = canonicalDrawingMarket(this.surface.symbol());
            const context = JSON.stringify([owner, localSession, market]);
            if (context !== this.context || !this.ready) {
                // Account lookup can finish after the user has started typing.
                // Defer initialization just like ordinary remote projections;
                // an actual account change must still clear the previous owner.
                if (this.surface.busy() && (!this.owner || this.owner === owner))
                    return;
                this.release();
                this.owner = owner;
                this.session = localSession;
                this.market = market;
                this.context = context;
                this.surface.apply([], this.surface.symbol(), false);
                this.storageKey = drawingCacheKey(owner, market, localSession, this.surface.scope);
                activeCaches.add(this.storageKey);
                await draining.get(this.storageKey);
                if (this.stopped || !this.surface.isNewTask() || this.context !== context || this.surface.session() !== localSession)
                    return;
                const saved = localStorage.getItem(this.storageKey);
                this.replica = saved ? new DrawingReplica(saved) : cachedWorkspace(owner, market, localStorage);
                const claimKey = 'haolo.manual-legacy-owner:' + localSession, claim = localStorage.getItem(claimKey);
                if ((!saved || this.initialEdited) && (!claim || claim === owner)) {
                    localStorage.setItem(claimKey, owner);
                    const initial = this.initial.filter(d => { try {
                        return canonicalDrawingMarket(d.symbol) === market && (d.drawingScope || 'main') === this.surface.scope && !this.replica.entries[d.id];
                    }
                    catch {
                        return false;
                    } }).map(drawingToWire);
                    this.replica.edit([], initial, !this.initialEdited);
                }
                this.initialEdited = false;
                this.initial = [];
                this.save();
                this.ready = true;
                this.show();
            }
            const valid = () => !this.stopped && this.surface.isNewTask() && this.owner === owner && this.context === context && this.surface.session() === localSession && canonicalDrawingMarket(this.surface.symbol()) === market;
            const read = async () => { const started = Date.now(); const result = await api({ action: 'read', owner, market }); if (valid())
                this.replica.merge(result, started); };
            await read();
            if (!valid())
                return;
            if (this.replica.dirty) {
                this.replica.interval = canonicalDrawingInterval(this.surface.interval());
                const body = this.replica.begin(market, this.replica.interval);
                if (!this.save())
                    return;
                await api({ action: 'write', owner, body });
                if (!valid())
                    return;
                this.replica.acknowledge();
                this.save();
                await read();
                if (!valid())
                    return;
            }
            this.save();
            this.show();
        }
        catch (error) {
            if (!this.ready)
                this.context = '';
            if (String(error).includes('DRAWING_CLOCK_INVALID')) {
                this.replica.correctRejectedClock();
                this.save();
            }
            if (!this.stopped && this.surface.isNewTask())
                this.surface.status(drawingSyncText(this.replica.dirty ? 'pending' : 'failed'));
        }
        finally {
            this.running = false;
            if (this.owner && !this.stopped)
                void drainDrawingOutbox(api, this.owner, localStorage);
        }
    }
    private workspaceCleared = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (!this.ready || !this.surface.isNewTask() || detail?.owner !== this.owner || !detail.markets?.includes(this.market))
            return;
        const before = this.replica.drawings();
        this.replica.edit(before, before.filter(d => detail.scope && d.drawingScope !== detail.scope));
        this.save();
        this.show();
        void this.sync();
    };
    clearKnown(drawings: TradingDrawingModel[], scope?: string) {
        if (!this.surface.isNewTask())
            return;
        if (!this.ready) {
            this.changed();
            return;
        }
        const canonicalScope = scope ? canonicalDrawingScope(scope) : null;
        const groups = new Map<string, WireDrawing[]>();
        for (const d of drawings) {
            try {
                const wire = drawingToWire(d);
                if (canonicalScope && wire.drawingScope !== canonicalScope)
                    continue;
                const figures = groups.get(wire.symbol) || [];
                figures.push(wire);
                groups.set(wire.symbol, figures);
            }
            catch { }
        }
        for (const [market, figures] of groups) {
            if (activeCaches.has(drawingCacheKey(this.owner, market, this.session, this.surface.scope)))
                continue;
            const tombstoneKey = drawingCacheKey(this.owner, market, this.session, 'clear:' + crypto.randomUUID());
            const replica = new DrawingReplica();
            replica.offset = this.replica.offset;
            replica.clockKnown = this.replica.clockKnown;
            replica.lastStamp = this.replica.lastStamp;
            replica.edit(figures, []);
            try {
                localStorage.setItem(tombstoneKey, replica.serialize());
            }
            catch {
                this.surface.status(drawingSyncText('localError'));
            }
        }
        window.dispatchEvent(new CustomEvent('haolo-drawing-workspace-clear', { detail: { owner: this.owner, scope: canonicalScope, markets: [...new Set([...groups.keys(), this.market])] } }));
    }
    destroy() {
        this.stopped = true;
        this.release();
        if (this.timer)
            clearInterval(this.timer);
        if (this.debounce)
            clearTimeout(this.debounce);
        window.removeEventListener('haolo-drawing-workspace-clear', this.workspaceCleared);
        window.removeEventListener('online', this.wake);
        window.removeEventListener('focus', this.wake);
    }
}
