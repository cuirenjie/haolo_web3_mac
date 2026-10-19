// Display preferences are local to a conversation. Never put them in drawing
// geometry, cloud synchronization payloads or the manual undo/redo history.
type DrawingIdentity = { id: string; symbol: string; drawingScope?: string };
export type TradingDrawingLayerVisibility = { aiHidden: boolean; manualHidden: boolean };
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
  private readonly onChange: () => void;

  constructor(session: string, onChange: () => void) {
    this.session = session.trim() || 'trading-expert-unassigned';
    this.state = this.read();
    this.onChange = onChange;
    window.addEventListener(changed, this.receive);
  }

  private readSession(session: string): VisibilityState {
    try {
      const value = JSON.parse(window.localStorage.getItem(prefix + encodeURIComponent(session)) || '{}');
      return { aiHidden: value.aiHidden === true, manualHidden: value.manualHidden === true, hidden: Array.isArray(value.hidden)
        ? [...new Set<string>((value.hidden as unknown[]).filter((key): key is string => typeof key === 'string'))] : [] };
    } catch { return { aiHidden: false, manualHidden: false, hidden: [] }; }
  }

  private read(): VisibilityState {
    const local = this.readSession(this.session);
    const shared = this.readSession(conversation(this.session));
    return { ...local, aiHidden: shared.aiHidden, manualHidden: shared.manualHidden };
  }

  private save() {
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
    window.dispatchEvent(new CustomEvent(changed, { detail: { session: this.session, state: this.state } }));
  }

  private readonly receive = (event: Event) => {
    const detail = (event as CustomEvent<{ session: string; state: VisibilityState }>).detail;
    if (conversation(detail.session) !== conversation(this.session)) return;
    this.state = { aiHidden: detail.state.aiHidden, manualHidden: detail.state.manualHidden,
      hidden: detail.session === this.session ? [...detail.state.hidden] : this.state.hidden };
    this.onChange();
  };

  get aiHidden() { return this.state.aiHidden; }
  get manualHidden() { return this.state.manualHidden; }
  layers(): TradingDrawingLayerVisibility { return { aiHidden: this.aiHidden, manualHidden: this.manualHidden }; }
  setLayers(update: Partial<TradingDrawingLayerVisibility>) {
    const next = { ...this.layers(), ...update };
    if (next.aiHidden === this.aiHidden && next.manualHidden === this.manualHidden) return;
    this.state = { ...this.state, ...next };
    this.save();
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
