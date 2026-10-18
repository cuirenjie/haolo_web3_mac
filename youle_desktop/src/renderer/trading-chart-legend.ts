/** Exact lookup in the chart's sorted time domain, including session gaps. */
export function tradingChartCandleIndex(candles: readonly { time: number }[], time: number) {
  if (!Number.isFinite(time)) return -1;
  let low = 0, high = candles.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const value = candles[middle].time;
    if (value === time) return middle;
    if (value < time) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

export interface TradingChartLegendRow {
  id: string;
  title: string;
  items: { text: string; color: string }[];
}

type Row = { element: HTMLElement; title: HTMLElement; values: HTMLElement[] };
const legends = new WeakMap<HTMLElement, Map<string, Map<string, Row>>>();

/** Keep legend nodes and only write changed values. Pointer movement must not
 * recreate the header and wake shell localization/layout for every sample.
 * Each owner updates only its own rows, preserving simulation/extension rows.
 */
export function updateTradingChartLegendRows(host: HTMLElement, attribute: string, rows: TradingChartLegendRow[]) {
  let owners = legends.get(host);
  if (!owners) legends.set(host, owners = new Map());
  let retained = owners.get(attribute);
  if (!retained) owners.set(attribute, retained = new Map());
  const ids = new Set(rows.map(row => row.id));
  for (const [id, row] of retained) {
    if (!ids.has(id)) { row.element.remove(); retained.delete(id); }
  }
  // A settings reset can clear the host independently of this cache.
  for (const row of rows) {
    let current = retained.get(row.id);
    if (!current) {
      const element = host.ownerDocument.createElement('div');
      element.className = 'trading-market-main-indicator-legend';
      element.setAttribute(attribute, row.id);
      const title = host.ownerDocument.createElement('strong');
      element.append(title);
      retained.set(row.id, current = { element, title, values: [] });
    }
    if (current.title.textContent !== row.title) current.title.textContent = row.title;
    while (current.values.length > row.items.length) current.values.pop()!.remove();
    row.items.forEach((item, index) => {
      let target = current!.values[index];
      if (!target) {
        target = host.ownerDocument.createElement('span');
        current!.values.push(target); current!.element.append(target);
      }
      if (target.textContent !== item.text) target.textContent = item.text;
      if (target.style.getPropertyValue('--main-indicator-series-color') !== item.color) {
        target.style.setProperty('--main-indicator-series-color', item.color);
      }
    });
  }
  // Stable order, also after external clearing/reordering of the host.
  let cursor = host.firstElementChild;
  for (const row of rows) {
    const element = retained.get(row.id)!.element;
    if (element !== cursor) host.insertBefore(element, cursor);
    cursor = element.nextElementSibling;
  }
}
