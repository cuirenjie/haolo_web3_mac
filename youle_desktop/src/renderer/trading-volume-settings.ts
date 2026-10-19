import type { TradingDrawingModel } from './trading-expert-drawing.ts';
import { colorPickerInput } from './color-picker.ts';
import { normalizeAnchoredVwapOptions, normalizeFixedVolumeOptions, VWAP_SOURCES } from './trading-volume-drawings.ts';

export function volumeSettingsDialog(drawing: TradingDrawingModel, confirm: (next: TradingDrawingModel) => void, close: () => void, host: HTMLElement, trigger?: HTMLElement) {
  const vwap = drawing.tool === 'anchored-vwap';
  const title = vwap ? '锚定VWAP' : drawing.tool === 'fixed-range-volume' ? '固定范围成交量分布图' : '锚定成交量分布图';
  const options = vwap ? normalizeAnchoredVwapOptions(drawing.vwap) : normalizeFixedVolumeOptions(drawing.volumeProfile);
  const dialog = document.createElement('dialog');
  dialog.className = 'trading-horizontal-line-dialog trading-volume-settings-dialog'; dialog.dataset.i18nDrawing = ''; dialog.setAttribute('aria-label', title);
  const uid = `volume-${crypto.randomUUID()}`;
  const check = (key: string, label: string) => `<label class="trading-line-settings-check"><input name="${key}" type="checkbox"><span>${label}</span></label>`;
  const numeric = (key: string, label: string, min: number, max: number, step = 'any') => `<label class="trading-line-settings-row"><span>${label}</span><input name="${key}" type="number" min="${min}" max="${max}" step="${step}" required aria-label="${label}"></label>`;
  const picker = (key: string, label: string, value: string) => `<label class="trading-line-settings-row"><span>${label}</span>${colorPickerInput(value, `name="${key}" aria-label="${label}"`)}</label>`;
  const select = (key: string, label: string, choices: string[][]) => `<label class="trading-line-settings-row"><span>${label}</span><select name="${key}" aria-label="${label}">${choices.map(([v, text]) => `<option value="${v}">${text}</option>`).join('')}</select></label>`;
  const inputs = vwap
    ? select('source', '来源', VWAP_SOURCES.map(s => [s, s.toUpperCase()])) + select('bandMode', '偏差带计算方式', [['standard-deviation', '标准差'], ['percentage', '百分比']]) + numeric('multiplier', '偏差带倍数', 0, 100) + check('showBands', '显示上下轨')
    : select('rowLayout', '行布局', [['number', '行数'], ['ticks', '每行跳动数']]) + numeric('rows', '价格档数', 1, 500, '1') + numeric('ticksPerRow', '每行跳动数', 1, 1e9, '1') + numeric('valueArea', '价值区域成交量 (%)', 0, 100) + numeric('widthPercent', '柱状图宽度 (%)', 1, 100);
  const style = vwap
    ? picker('color', '线条颜色', drawing.color ?? '#1e88e5') + numeric('lineWidth', '线宽', 1, 8, '1') + select('lineStyle', '线型', [['solid', '实线'], ['dashed', '虚线'], ['dotted', '点线']])
      + picker('bandColor', '上下轨颜色', normalizeAnchoredVwapOptions(drawing.vwap).bandColor) + numeric('fillOpacity', '填充不透明度', 0, 1, '.01') + check('showPriceLabel', '价格标签')
    : picker('upColor', '上涨成交量颜色', normalizeFixedVolumeOptions(drawing.volumeProfile).upColor) + picker('downColor', '下跌成交量颜色', normalizeFixedVolumeOptions(drawing.volumeProfile).downColor)
      + picker('backgroundColor', '背景颜色', normalizeFixedVolumeOptions(drawing.volumeProfile).backgroundColor) + numeric('backgroundOpacity', '填充不透明度', 0, 1, '.01') + check('showPoc', '显示 POC');
  const count = drawing.tool === 'fixed-range-volume' ? 2 : 1;
  dialog.innerHTML = `<form><header><h2>${title}</h2><button type="button" data-line-cancel aria-label="关闭">×</button></header>
    <div class="trading-line-settings-tabs" role="tablist" aria-label="绘图设置">${[['inputs', '参数'], ['style', '样式'], ['coordinates', '坐标']].map(([key, label]) => `<button type="button" role="tab" data-line-tab="${key}" id="${uid}-${key}-tab" aria-controls="${uid}-${key}">${label}</button>`).join('')}</div>
    <section role="tabpanel" data-line-panel="inputs" id="${uid}-inputs" aria-labelledby="${uid}-inputs-tab">${inputs}</section>
    <section role="tabpanel" data-line-panel="style" id="${uid}-style" aria-labelledby="${uid}-style-tab" hidden>${style}</section>
    <section role="tabpanel" data-line-panel="coordinates" id="${uid}-coordinates" aria-labelledby="${uid}-coordinates-tab" hidden>${Array.from({ length: count }, (_, i) => `<label class="trading-line-settings-row"><span>${i ? '终点时间 (UTC+8)' : '起点时间 (UTC+8)'}</span><input name="time${i}" type="datetime-local" step="1" required></label>`).join('')}<p>时间吸附到已有 K 线，价格由行情数据计算。</p></section>
    <footer><button type="button" data-line-cancel>取消</button><button type="submit" class="primary">确认</button></footer></form>`;
  const form = dialog.querySelector('form')!;
  const field = (key: string) => form.elements.namedItem(key) as HTMLInputElement | HTMLSelectElement;
  const values = { ...options, ...(vwap ? { color: drawing.color ?? '#1e88e5', lineWidth: drawing.lineWidth ?? 1, lineStyle: drawing.lineStyle ?? 'solid', showPriceLabel: drawing.showPriceLabel !== false } : {}) };
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'boolean') (field(key) as HTMLInputElement).checked = value; else field(key).value = String(value);
  }
  if (!vwap) {
    const layout = () => { field('rows').closest<HTMLElement>('label')!.hidden = field('rowLayout').value === 'ticks'; field('ticksPerRow').closest<HTMLElement>('label')!.hidden = field('rowLayout').value !== 'ticks'; };
    field('rowLayout').addEventListener('change', layout); layout();
  }
  drawing.points.slice(0, count).forEach((point, i) => { field(`time${i}`).value = new Date((point.time + 28800) * 1000).toISOString().slice(0, 19); });
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[data-line-tab]')];
  const activate = (tab: HTMLButtonElement) => {
    tabs.forEach(t => { t.setAttribute('aria-selected', String(t === tab)); t.tabIndex = t === tab ? 0 : -1; });
    dialog.querySelectorAll<HTMLElement>('[data-line-panel]').forEach(p => { p.hidden = p.dataset.linePanel !== tab.dataset.lineTab; });
  };
  dialog.addEventListener('click', e => { const b = (e.target as Element).closest<HTMLButtonElement>('button'); if (b?.hasAttribute('data-line-cancel')) close(); if (b?.dataset.lineTab) activate(b); });
  dialog.addEventListener('keydown', e => {
    const i = tabs.indexOf(e.target as HTMLButtonElement); if (i < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    activate(tabs[next]); tabs[next].focus();
  });
  form.addEventListener('invalid', e => { const panel = (e.target as Element).closest<HTMLElement>('[data-line-panel]'); const tab = tabs.find(t => t.dataset.lineTab === panel?.dataset.linePanel); if (tab) activate(tab); }, true);
  form.addEventListener('submit', e => {
    e.preventDefault(); const edited: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) edited[key] = typeof value === 'boolean' ? (field(key) as HTMLInputElement).checked : typeof value === 'number' ? Number(field(key).value) : field(key).value;
    const points = drawing.points.slice(0, count).map((p, i) => ({ ...p, time: Date.parse(`${field(`time${i}`).value}+08:00`) / 1000 }));
    if (points.some(p => !Number.isFinite(p.time))) return;
    const next: TradingDrawingModel = { ...drawing, points, ...(vwap ? { vwap: normalizeAnchoredVwapOptions(edited), color: String(edited.color), lineWidth: Number(edited.lineWidth), lineStyle: edited.lineStyle as TradingDrawingModel['lineStyle'], showPriceLabel: Boolean(edited.showPriceLabel) } : { volumeProfile: normalizeFixedVolumeOptions(edited) }) };
    close(); confirm(next);
  });
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (trigger?.isConnected) trigger.focus(); });
  host.append(dialog); dialog.showModal(); activate(tabs[0]); tabs[0].focus(); return dialog;
}
