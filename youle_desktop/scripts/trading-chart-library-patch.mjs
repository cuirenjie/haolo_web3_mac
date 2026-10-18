import { createHash } from 'node:crypto';

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
  return source;
}

export function tradingChartLibraryPlugin(libraryPath) {
  const normalized = libraryPath.replaceAll('\\', '/');
  return {
    name: 'haolo-retained-chart-render-points', enforce: 'pre',
    transform(source, id) {
      if (id.replaceAll('\\', '/').split('?')[0] !== normalized) return null;
      return { code: patchTradingChartLibrary(source), map: null };
    },
  };
}
