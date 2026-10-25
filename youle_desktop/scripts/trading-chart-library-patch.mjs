import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Lightweight Charts 5.1.0 (Apache-2.0), unminified ESM distribution. Keep the
// installed package intact; Vite applies this same guarded patch in dev/build.
// An upgrade must review the upstream row lifecycle before accepting a hash.
const upstreamHash = '887eb4645fc3fd785614ec2389106aa881a74be84f4fa763488ce39d5d1ccb3e';
export function patchTradingChartLibrary(source) {
  if (createHash('sha256').update(source).digest('hex') !== upstreamHash) {
    throw new Error('Lightweight Charts source changed: review the retained render-point patch before upgrading.');
  }
  const prefix = 'this._internal__items = this._internal__series._internal_conflatedBars()._internal_rows().map(';
  if (source.split(prefix).length !== 3) throw new Error('Expected line and bar renderers in Lightweight Charts 5.1.0');
  // DataLayer creates a new plot row for every changed point. Backfill may
  // mutate an existing row's index, so identity alone is insufficient. The
  // saved item time guards that case. Style changes already recolor _items in
  // SeriesPaneViewBase._internal__updateOptions; never retain a separate item.
  const retainedMap = `this._internal__items = this._haoloMapRenderPoints(`;
  source = source.replaceAll(prefix, retainedMap);
  const marker = 'class SeriesPaneViewBase {';
  source = source.replace(marker, `${marker}
    _haoloMapRenderPoints(createItem) {
        const rows = this._internal__series._internal_conflatedBars()._internal_rows();
        const previousRows = this._haoloRenderRows || [];
        const previousItems = this._internal__items;
        this._haoloRenderRows = rows.slice();
        return rows.map((row, index) => {
            const item = previousItems[index];
            return previousRows[index] === row && item && item._internal_time === row._internal_index
                ? item : createItem(row);
        });
    }
`);
  // A multi-series snapshot should recalculate pane bounds / native hover once,
  // after every series sees the same revision. Time-domain and data writes stay
  // synchronous. Nested batches and throwing callers still flush in finally.
  source = source.replace('class ChartApi {', `class ChartApi {
    // Pixel-space navigation uses the native price transform (including log,
    // percentage and inversion) and native time boundaries. No CSS translation
    // or synthetic pointer events: candles, indicators and hit tests stay real.
    haoloPanByPixels(dx, dy, paneIndex) {
        const model = this._private__chartWidget._internal_model();
        const pane = model._internal_panes()[paneIndex];
        const time = model._internal_timeScale();
        if (!pane || time._internal_isEmpty() || !Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
        const scale = pane._internal_defaultPriceScale();
        const before = time._internal_rightOffset();
        const vertical = dy && !scale._internal_isEmpty() && !scale._internal_isAutoScale() && scale._internal_internalHeight() > 1;
        this.haoloBatchUpdates(() => {
            if (vertical) {
                model._internal_startScrollPrice(pane, scale, 0);
                try { model._internal_scrollPriceTo(pane, scale, dy); }
                finally { model._internal_endScrollPrice(pane, scale); }
            }
            if (dx) {
                model._internal_startScrollTime(0);
                try { model._internal_scrollTimeTo(dx); }
                finally { model._internal_endScrollTime(); }
            }
        });
        return { x: (before - time._internal_rightOffset()) * time._internal_barSpacing(), y: vertical ? dy : 0 };
    }
    haoloBatchUpdates(paint) {
        const model = this._private__chartWidget._internal_model();
        model._haoloBatchDepth = (model._haoloBatchDepth || 0) + 1;
        try { return paint(); }
        finally {
            model._haoloBatchDepth--;
            if (!model._haoloBatchDepth && model._haoloBatchDirty) {
                model._haoloBatchDirty = false;
                model._internal_recalculateAllPanes();
            }
        }
    }
`);
  for (const method of ['_internal_updateCrosshair()', '_internal_recalculatePane(pane)', '_internal_recalculateAllPanes()']) {
    const signature = `    ${method} {`;
    if (source.split(signature).length !== 2) throw new Error(`Unexpected chart batch hook: ${method}`);
    source = source.replace(signature, `${signature}
        if (this._haoloBatchDepth) { this._haoloBatchDirty = true; return; }`);
  }
  const replaceOnce = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Unexpected native chart navigation hook');
    source = source.replace(before, after);
  };
  // Seed from mouse-down, not the second drag event. The upstream path discarded
  // the first two movements, felt sticky, and became worse on a busy renderer.
  replaceOnce(`        this._private__mouseTouchDownEvent();
        this._private__setCrosshairPosition(event.localX, event.localY, event);`, `        this._private__mouseTouchDownEvent();
        this._private__pressedMouseTouchMoveEvent(event);
        this._private__setCrosshairPosition(event.localX, event.localY, event);`);
  replaceOnce(`        if (!this._private__isScrolling) {
            return;
        }`, `        if (!this._private__isScrolling) {
            this._private__startScrollingPos = null;
            return;
        }`);
  replaceOnce('model._internal_startScrollPrice(this._private__state, priceScale, event.localY);',
    'model._internal_startScrollPrice(this._private__state, priceScale, this._private__startScrollingPos._internal_localY);');
  replaceOnce('model._internal_startScrollTime(event.localX);',
    'model._internal_startScrollTime(this._private__startScrollingPos._internal_localX);');
  // Keep input synchronous, but calculate the final geometry/hover just once
  // after both axes have moved. Avoid duplicate crosshair work per mouse sample.
  replaceOnce(`    _internal_pressedMouseMoveEvent(event) {
        this._private__onMouseEvent();
        this._private__pressedMouseTouchMoveEvent(event);
        this._private__setCrosshairPosition(event.localX, event.localY, event);
    }`, `    _internal_pressedMouseMoveEvent(event) {
        const model = this._private__model();
        model._haoloBatchDepth = (model._haoloBatchDepth || 0) + 1;
        try {
            this._private__onMouseEvent();
            this._private__pressedMouseTouchMoveEvent(event);
        } finally {
            model._haoloBatchDepth--;
            if (!model._haoloBatchDepth && model._haoloBatchDirty) {
                model._haoloBatchDirty = false;
                model._internal_recalculateAllPanes();
            }
        }
        this._private__setCrosshairPosition(event.localX, event.localY, event);
    }`);
  return source;
}

export function tradingChartLibraryPlugin(libraryPath) {
  const normalized = libraryPath.replaceAll('\\', '/');
  // Vite's dependency hash does not include plugin implementation changes. Its
  // node_modules URLs can stay immutable in Chromium for a year, even when this
  // adapter changed. Version the actual patched bytes, for both dev and build.
  // A dedicated query also keeps Vite's no-cache/revalidation policy, so later
  // changes to rewritten dependency imports cannot reuse immutable old output.
  const patched = patchTradingChartLibrary(readFileSync(libraryPath, 'utf8'));
  const version = createHash('sha256').update(patched).digest('hex');
  return {
    name: 'haolo-retained-chart-render-points', enforce: 'pre',
    config() {
      return { resolve: { alias: [{
        find: /^lightweight-charts$/,
        replacement: `${normalized}?haolo_chart=${version}`,
      }] } };
    },
    transform(source, id) {
      if (id.replaceAll('\\', '/').split('?')[0] !== normalized) return null;
      return { code: patchTradingChartLibrary(source), map: null };
    },
  };
}
