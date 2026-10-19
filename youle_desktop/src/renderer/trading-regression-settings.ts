import type { TradingDrawingModel } from './trading-expert-drawing.ts';
import { colorPickerInput } from './color-picker.ts';
import { normalizeRegressionTrendOptions, REGRESSION_SOURCES } from './trading-regression-trend.ts';

// Use the same dialog owner as other drawing settings so cancellation, chart
// switches and teardown retain their existing transactional behavior.
export function regressionSettingsDialog(drawing: TradingDrawingModel, confirm: (d: TradingDrawingModel) => void,
  close: () => void, host: HTMLElement, trigger?: HTMLElement) {
  const dialog = document.createElement('dialog');
  dialog.className = 'trading-horizontal-line-dialog trading-regression-dialog';
  dialog.dataset.i18nDrawing = '';
  dialog.setAttribute('aria-label', '回归趋势');
  const options = normalizeRegressionTrendOptions(drawing.regression);
  const uid = `regression-${crypto.randomUUID()}`;
  const check = (name: string, label: string) => `<label class="trading-line-settings-check"><input type="checkbox" name="${name}"><span>${label}</span></label>`;
  const number = (name: string, label: string, min: number, max: number, step = 'any') => `<label class="trading-line-settings-row"><span>${label}</span><input type="number" name="${name}" min="${min}" max="${max}" step="${step}" required aria-label="${label}"></label>`;
  dialog.innerHTML = `<form>
    <header><h2>回归趋势</h2><button type="button" data-line-cancel aria-label="关闭">×</button></header>
    <div class="trading-line-settings-tabs" role="tablist" aria-label="绘图设置">${[['inputs', '参数'], ['style', '样式'], ['coordinates', '坐标']].map(([key, label]) => `<button type="button" role="tab" data-line-tab="${key}" id="${uid}-${key}-tab" aria-controls="${uid}-${key}">${label}</button>`).join('')}</div>
    <section role="tabpanel" data-line-panel="inputs" id="${uid}-inputs" aria-labelledby="${uid}-inputs-tab">
      ${number('upperDeviation', '上方偏差', -100, 100)}${number('lowerDeviation', '下方偏差', -100, 100)}
      ${check('useUpperDeviation', '使用上方偏差')}${check('useLowerDeviation', '使用下方偏差')}
      <label class="trading-line-settings-row"><span>来源</span><select name="source" aria-label="来源">${REGRESSION_SOURCES.map((s, i) => `<option value="${s}">${['收盘价', '开盘价', '最高价', '最低价', '(H + L) / 2', '(H + L + C) / 3', '(O + H + L + C) / 4'][i]}</option>`).join('')}</select></label>
    </section>
    <section role="tabpanel" data-line-panel="style" id="${uid}-style" aria-labelledby="${uid}-style-tab" hidden>
      ${(['base', 'upper', 'lower'] as const).map((part, i) => `<div class="trading-line-settings-row">${check(['showBase', 'showUpper', 'showLower'][i], ['基准线', '上轨', '下轨'][i])}${colorPickerInput(drawing.color ?? options[`${part}Color`], `name="${part}Color" aria-label="${['基准线颜色', '上轨颜色', '下轨颜色'][i]}"`)}<select name="${part}Width" aria-label="线宽">${[.5, 1, 2, 3, 4, 5, 8].map(n => `<option value="${n}">${n}px</option>`).join('')}</select><select name="${part}Style" aria-label="线型"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></div>`).join('')}
      ${number('fillOpacity', '填充不透明度', 0, 1, '.05')}
      ${check('extendRight', '向右延长')}${check('showPearson', 'Pearson’s R')}
    </section>
    <section role="tabpanel" data-line-panel="coordinates" id="${uid}-coordinates" aria-labelledby="${uid}-coordinates-tab" hidden>
      ${[0, 1].map(i => `<label class="trading-line-settings-row"><span>${i ? '终点时间 (UTC+8)' : '起点时间 (UTC+8)'}</span><input name="time${i}" type="datetime-local" step="1" required></label>`).join('')}
      <p>两个端点只选择 K 线区间，价格由回归计算。</p>
    </section>
    <footer><button type="button" data-line-cancel>取消</button><button type="submit" class="primary">确认</button></footer>
  </form>`;
  const form = dialog.querySelector('form')!;
  const field = (key: string) => form.elements.namedItem(key) as HTMLInputElement | HTMLSelectElement;
  for (const [key, value] of Object.entries(options)) {
    const control = field(key);
    if (typeof value === 'boolean') (control as HTMLInputElement).checked = value;
    else {
      const part = key.replace(/Color|Width|Style$/, '');
      const override = key.endsWith('Color') ? drawing.color : key.endsWith('Width') ? drawing.lineWidth : key.endsWith('Style') ? drawing.lineStyle : undefined;
      const actual = ['base', 'upper', 'lower'].includes(part) ? override ?? value : value;
      if (control instanceof HTMLSelectElement && ![...control.options].some(o => o.value === String(actual))) control.add(new Option(String(actual), String(actual)));
      control.value = String(actual);
    }
  }
  drawing.points.slice(0, 2).forEach((p, i) => { field(`time${i}`).value = new Date((p.time + 28800) * 1000).toISOString().slice(0, 19); });
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[data-line-tab]')];
  const select = (tab: HTMLButtonElement) => {
    for (const t of tabs) { t.setAttribute('aria-selected', String(t === tab)); t.tabIndex = t === tab ? 0 : -1; }
    dialog.querySelectorAll<HTMLElement>('[data-line-panel]').forEach(p => { p.hidden = p.dataset.linePanel !== tab.dataset.lineTab; });
  };
  dialog.addEventListener('click', e => {
    const button = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('button') : null;
    if (button?.hasAttribute('data-line-cancel')) close();
    if (button?.dataset.lineTab) select(button);
  });
  dialog.addEventListener('keydown', e => {
    const i = tabs.indexOf(e.target as HTMLButtonElement);
    if (i < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    select(tabs[next]); tabs[next].focus();
  });
  form.addEventListener('invalid', e => {
    const panel = (e.target as Element).closest<HTMLElement>('[data-line-panel]');
    const tab = tabs.find(t => t.dataset.lineTab === panel?.dataset.linePanel); if (tab) select(tab);
  }, true);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options)) values[key] = typeof value === 'boolean' ? (field(key) as HTMLInputElement).checked : typeof value === 'number' ? Number(field(key).value) : field(key).value;
    const points = drawing.points.slice(0, 2).map((p, i) => ({ ...p, time: Date.parse(`${field(`time${i}`).value}+08:00`) / 1000 }));
    if (points.some(p => !Number.isFinite(p.time)) || points[0].time === points[1].time) {
      select(tabs[2]); field('time1').setCustomValidity('回归趋势至少需要两根有效 K 线'); form.reportValidity(); return;
    }
    const next = { ...drawing, points, regression: normalizeRegressionTrendOptions(values), color: undefined, lineWidth: undefined, lineStyle: undefined };
    close(); confirm(next);
  });
  field('time1').addEventListener('input', () => field('time1').setCustomValidity(''));
  field('time0').addEventListener('input', () => field('time1').setCustomValidity(''));
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (trigger?.isConnected) trigger.focus(); });
  host.append(dialog); dialog.showModal(); select(tabs[0]); tabs[0].focus();
  return dialog;
}
