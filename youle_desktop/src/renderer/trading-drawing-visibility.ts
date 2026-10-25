// Layer preferences can be projected from the account settings document.
// Individual object visibility stays local; neither belongs to geometry/undo.
type DrawingIdentity = { id: string; symbol: string; drawingScope?: string };
export const TRADING_VISIBILITY_LAYERS = [
  { key: 'aiHidden', label: '隐藏AI绘图' },
  { key: 'manualHidden', label: '隐藏手动绘图' },
  { key: 'dataHidden', label: '隐藏数据标注' },
  { key: 'ordersHidden', label: '隐藏仓位线' },
  { key: 'plansHidden', label: '隐藏计划线' },
] as const;
export type TradingDrawingVisibilityKey = typeof TRADING_VISIBILITY_LAYERS[number]['key'];
export type TradingDrawingLayerVisibility = Record<TradingDrawingVisibilityKey, boolean>;
export const DEFAULT_TRADING_DRAWING_VISIBILITY: TradingDrawingLayerVisibility = {
  aiHidden: false, manualHidden: false, dataHidden: false, ordersHidden: false, plansHidden: false,
};
function layersFrom(value: Partial<TradingDrawingLayerVisibility>): TradingDrawingLayerVisibility {
  return Object.fromEntries(TRADING_VISIBILITY_LAYERS.map(({ key }) => [key, value[key] === true])) as TradingDrawingLayerVisibility;
}
type VisibilityState = TradingDrawingLayerVisibility & { hidden: string[] };
const prefix = 'haolo.trading-market.drawing-visibility.v1.';
const changed = 'haolo-drawing-visibility-changed';
function conversation(session: string) { return session.replace(/::split-pane:\d+$/, ''); }

function identity(drawing: DrawingIdentity) {
  return JSON.stringify([drawing.symbol, drawing.drawingScope || 'main', drawing.id]);
}

export class TradingDrawingVisibility {
  private session: string;
  private state: VisibilityState;
  private readonly onChange: (layersEdited?: boolean) => void;

  constructor(session: string, onChange: (layersEdited?: boolean) => void) {
    this.session = session.trim() || 'trading-expert-unassigned';
    this.state = this.read();
    this.onChange = onChange;
    window.addEventListener(changed, this.receive);
  }

  private readSession(session: string): VisibilityState {
    try {
      const value = JSON.parse(window.localStorage.getItem(prefix + encodeURIComponent(session)) || '{}');
      return { ...layersFrom(value), hidden: Array.isArray(value.hidden)
        ? [...new Set<string>((value.hidden as unknown[]).filter((key): key is string => typeof key === 'string'))] : [] };
    } catch { return { ...DEFAULT_TRADING_DRAWING_VISIBILITY, hidden: [] }; }
  }

  private read(): VisibilityState {
    const local = this.readSession(this.session);
    const shared = this.readSession(conversation(this.session));
    return { ...local, ...layersFrom(shared) };
  }

  private save(layersEdited = false) {
    try {
      window.localStorage.setItem(prefix + encodeURIComponent(this.session), JSON.stringify(this.state));
      const root = conversation(this.session);
      if (root !== this.session) {
        // Layer switches span split charts; individual hidden objects stay in
        // each pane's original storage namespace.
        window.localStorage.setItem(prefix + encodeURIComponent(root), JSON.stringify({
          ...this.readSession(root), ...this.layers(),
        }));
      }
    }
    catch { /* Keep the current session usable if local storage is unavailable. */ }
    window.dispatchEvent(new CustomEvent(changed, { detail: { session: this.session, state: this.state, layersEdited } }));
  }

  private readonly receive = (event: Event) => {
    const detail = (event as CustomEvent<{ session: string; state: VisibilityState; layersEdited?: boolean }>).detail;
    if (conversation(detail.session) !== conversation(this.session)) return;
    this.state = { ...layersFrom(detail.state),
      hidden: detail.session === this.session ? [...detail.state.hidden] : this.state.hidden };
    this.onChange(detail.layersEdited === true);
  };

  get aiHidden() { return this.state.aiHidden; }
  get manualHidden() { return this.state.manualHidden; }
  get dataHidden() { return this.state.dataHidden; }
  get ordersHidden() { return this.state.ordersHidden; }
  get plansHidden() { return this.state.plansHidden; }
  get allHidden() { return TRADING_VISIBILITY_LAYERS.every(({ key }) => this.state[key]); }
  layers(): TradingDrawingLayerVisibility { return layersFrom(this.state); }
  applyAccountLayers(layers: TradingDrawingLayerVisibility) {
    const next = layersFrom(layers);
    if (TRADING_VISIBILITY_LAYERS.every(({ key }) => next[key] === this.state[key])) return;
    this.state = { ...this.state, ...next };
    this.save();
  }
  setLayers(update: Partial<TradingDrawingLayerVisibility>) {
    const next = { ...this.layers(), ...update };
    if (TRADING_VISIBILITY_LAYERS.every(({ key }) => next[key] === this.state[key])) return;
    this.state = { ...this.state, ...next };
    this.save(true);
  }
  setAll(hidden: boolean) { this.setLayers(layersFrom(Object.fromEntries(TRADING_VISIBILITY_LAYERS.map(({ key }) => [key, hidden])))); }
  // Older chart settings kept this preference globally. Use it only as the
  // initial value for conversations without an explicit data-layer choice.
  migrateLegacyDataVisibility(hidden: boolean) {
    if (!hidden || this.dataHidden) return;
    try {
      const stored = JSON.parse(window.localStorage.getItem(prefix + encodeURIComponent(conversation(this.session))) || '{}');
      if (typeof stored?.dataHidden === 'boolean') return;
    } catch { /* A missing/corrupt preference can inherit the legacy setting. */ }
    this.setLayers({ dataHidden: true });
  }
  toggleAi() { this.setLayers({ aiHidden: !this.aiHidden }); }
  isHidden(drawing: DrawingIdentity) { return this.state.hidden.includes(identity(drawing)); }
  toggle(drawing: DrawingIdentity) {
    const key = identity(drawing), hidden = this.isHidden(drawing);
    this.state.hidden = this.state.hidden.filter(candidate => candidate !== key);
    if (!hidden) this.state.hidden.push(key);
    this.save();
  }

  // Most recently hidden first. Restoring it makes the next hidden drawing
  // reachable on the next canvas click, including after a reload or deselect.
  latestHidden<T extends DrawingIdentity>(drawings: T[]): T | undefined {
    const byKey = new Map(drawings.map(drawing => [identity(drawing), drawing]));
    for (let i = this.state.hidden.length - 1; i >= 0; i--) {
      const drawing = byKey.get(this.state.hidden[i]);
      if (drawing) return drawing;
    }
  }

  switchSession(session: string, migrate: boolean) {
    session = session.trim() || 'trading-expert-unassigned';
    if (session === this.session) return;
    this.session = session;
    if (migrate) this.save();
    else this.state = this.read();
  }

  destroy() { window.removeEventListener(changed, this.receive); }
}
