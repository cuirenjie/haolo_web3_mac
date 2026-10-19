import type { TradingDrawingModel } from './trading-expert-drawing.ts';
import { manualDrawingDefaults } from './trading-drawing-defaults.ts';

export interface HorizontalLineTextStyle {
  textColor?: string;
  italic?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  textVerticalAlign?: 'top' | 'middle' | 'bottom';
  showPriceLabel?: boolean;
}

export function normalizeHorizontalLineTextStyle(value: HorizontalLineTextStyle): HorizontalLineTextStyle {
  return {
    ...(typeof value.textColor === 'string' && /^#[\da-f]{6}$/i.test(value.textColor) ? { textColor: value.textColor.toLowerCase() } : {}),
    ...(value.italic === true ? { italic: true } : {}),
    ...(['left', 'center', 'right'].includes(value.textAlign ?? '') ? { textAlign: value.textAlign } : {}),
    ...(['top', 'middle', 'bottom'].includes(value.textVerticalAlign ?? '') ? { textVerticalAlign: value.textVerticalAlign } : {}),
    ...(typeof value.showPriceLabel === 'boolean' ? { showPriceLabel: value.showPriceLabel } : {}),
  };
}

export const horizontalLineSettingsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 3-.6 2.4-2 .9-2.2-.7-2 3.4L5 10.7v2.6L3.2 15l2 3.4 2.2-.7 2 .9.6 2.4h4l.6-2.4 2-.9 2.2.7 2-3.4-1.8-1.7v-2.6L20.8 9l-2-3.4-2.2.7-2-.9L14 3Z"/><circle cx="12" cy="12" r="3"/></svg>';

// Shared by manual drawing tools; the legacy name keeps existing integrations stable.
// Each chart owns its dialog. Edits stay in the form until Confirm, so Escape,
// Cancel, chart switches and teardown cannot accidentally save a partial edit.
export class HorizontalLineSettingsDialog {
  private dialog: HTMLDialogElement | null = null;
  get open() { return Boolean(this.dialog?.open); }

  close() {
    this.dialog?.close();
    this.dialog?.remove();
    this.dialog = null;
  }

  show(drawing: TradingDrawingModel, onConfirm: (next: TradingDrawingModel) => void, host: HTMLElement, trigger?: HTMLElement, initialTab: 'style' | 'text' = 'style', label = '水平线') {
    this.close();
    const dialog = document.createElement('dialog');
    this.dialog = dialog;
    dialog.className = 'trading-horizontal-line-dialog';
    dialog.dataset.i18nDrawing = '';
    dialog.setAttribute('aria-label', label);
    const priceOnly = drawing.tool === 'horizontal-line';
    const first = drawing.points[0], last = drawing.points.at(-1)!;
    const closed = drawing.tool === 'multi-point-polyline' && drawing.points.length > 3
      && first.time === last.time && first.price === last.price;
    const editablePoints = closed ? drawing.points.slice(0, -1) : drawing.points;
    const coordinates = editablePoints.map(point => ({ price: String(point.price), time: new Date(point.time * 1000).toISOString().slice(0, 19) }));
    let coordinateIndex = 0;
    const id = `horizontal-line-${crypto.randomUUID()}`;
    dialog.innerHTML = `
      <form>
        <header><h2>水平线</h2><button type="button" data-line-cancel aria-label="关闭"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
        <div class="trading-line-settings-tabs" role="tablist" aria-label="绘图设置">
          ${[['style', '样式'], ['text', '文本'], ['coordinates', '坐标']].map(([tab, label], i) => `<button type="button" role="tab" id="${id}-${tab}-tab" aria-controls="${id}-${tab}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-line-tab="${tab}">${label}</button>`).join('')}
        </div>
        <section role="tabpanel" id="${id}-style" aria-labelledby="${id}-style-tab" data-line-panel="style">
          <div class="trading-line-settings-row"><span>线条</span><div class="trading-line-settings-controls"><input name="color" type="color" aria-label="线条颜色"><select name="lineStyle" aria-label="选择样式"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select><select name="lineWidth" aria-label="选择线宽">${[1, 2, 3, 4].map(n => `<option value="${n}">${n}px</option>`).join('')}</select></div></div>
          <label class="trading-line-settings-check"><input name="showPriceLabel" type="checkbox"><span>价格标签</span></label>
        </section>
        <section role="tabpanel" id="${id}-text" aria-labelledby="${id}-text-tab" data-line-panel="text" hidden>
          <div class="trading-line-text-controls"><input name="textColor" type="color" aria-label="文本颜色"><select name="fontSize" aria-label="字体大小">${[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36].map(n => `<option value="${n}">${n}</option>`).join('')}</select><button type="button" data-line-toggle="bold" aria-label="加粗" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h8a4 4 0 0 1 0 8H6V4h7a4 4 0 0 1 0 8"/></svg></button><button type="button" data-line-toggle="italic" aria-label="斜体" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4h9M5 20h9M15 4 9 20"/></svg></button></div>
          <textarea name="text" maxlength="240" aria-label="文本输入" placeholder="请输入内容…"></textarea>
          <div class="trading-line-settings-row"><span>文字对齐</span><div class="trading-line-settings-controls"><select name="textVerticalAlign" aria-label="文字垂直对齐"><option value="top">顶部</option><option value="middle">中间</option><option value="bottom">底部</option></select><select name="textAlign" aria-label="文字水平对齐"><option value="left">居左</option><option value="center">居中</option><option value="right">居右</option></select></div></div>
        </section>
        <section role="tabpanel" id="${id}-coordinates" aria-labelledby="${id}-coordinates-tab" data-line-panel="coordinates" hidden>
          ${editablePoints.length > 1 ? `<label class="trading-line-settings-row"><span>端点</span><select name="coordinatePoint" aria-label="端点">${editablePoints.map((_point, index) => `<option value="${index}">#${index + 1}</option>`).join('')}</select></label>` : ''}
          <label class="trading-line-settings-row"><span>价格</span><input name="price" type="number" step="any" required aria-label="价格"></label>
          ${priceOnly ? '' : '<label class="trading-line-settings-row"><span>时间 (UTC)</span><input name="time" type="datetime-local" step="1" min="2000-01-01T00:00" max="2100-01-01T00:00" required aria-label="时间 (UTC)"></label>'}
        </section>
        <footer><button type="button" data-line-cancel>取消</button><button type="submit" class="primary">确认</button></footer>
      </form>`;
    const form = dialog.querySelector('form')!;
    dialog.querySelector('h2')!.textContent = label;
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const defaults = manualDrawingDefaults(drawing.tool);
    const values = {
      color: drawing.color ?? defaults.color,
      lineStyle: drawing.lineStyle ?? defaults.lineStyle ?? 'solid',
      lineWidth: drawing.lineWidth ?? defaults.lineWidth ?? 2,
      textColor: drawing.textColor ?? drawing.color ?? defaults.color,
      fontSize: drawing.fontSize ?? 12,
      text: drawing.text ?? '',
      textAlign: drawing.textAlign ?? 'center',
      textVerticalAlign: drawing.textVerticalAlign ?? 'middle',
      price: drawing.points[0].price,
    };
    for (const [name, value] of Object.entries(values)) {
      const input = field(name);
      // Preserve valid imported sizes/widths that are not in the preset list.
      if (input instanceof HTMLSelectElement && ![...input.options].some(option => option.value === String(value))) {
        input.add(new Option(String(value), String(value)));
      }
      input.value = String(value);
    }
    (field('showPriceLabel') as HTMLInputElement).checked = drawing.showPriceLabel !== false;
    if (!priceOnly) field('time').value = coordinates[0].time;
    if (!drawing.drawingScope || drawing.drawingScope === 'main') (field('price') as HTMLInputElement).min = String(Number.MIN_VALUE);
    for (const name of ['bold', 'italic'] as const) dialog.querySelector(`[data-line-toggle="${name}"]`)?.setAttribute('aria-pressed', String(Boolean(drawing[name])));
    const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[data-line-tab]')];
    const selectTab = (tab: HTMLButtonElement) => {
      for (const item of tabs) {
        item.setAttribute('aria-selected', String(item === tab));
        item.tabIndex = item === tab ? 0 : -1;
      }
      dialog.querySelectorAll<HTMLElement>('[data-line-panel]').forEach(panel => { panel.hidden = panel.dataset.linePanel !== tab.dataset.lineTab; });
    };
    const saveCoordinate = () => {
      coordinates[coordinateIndex] = { price: field('price').value, time: priceOnly ? coordinates[coordinateIndex].time : field('time').value };
    };
    const showCoordinate = (index: number) => {
      coordinateIndex = index;
      field('price').value = coordinates[index].price;
      if (!priceOnly) field('time').value = coordinates[index].time;
      if (editablePoints.length > 1) field('coordinatePoint').value = String(index);
    };
    field('coordinatePoint')?.addEventListener('change', () => {
      saveCoordinate();
      showCoordinate(Number(field('coordinatePoint').value));
    });
    dialog.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
      if (target?.hasAttribute('data-line-cancel')) this.close();
      if (target?.dataset.lineTab) selectTab(target);
      if (target?.dataset.lineToggle) target.setAttribute('aria-pressed', String(target.getAttribute('aria-pressed') !== 'true'));
    });
    dialog.addEventListener('keydown', event => {
      const index = tabs.indexOf(event.target as HTMLButtonElement);
      if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
      selectTab(tabs[next]);
      tabs[next].focus();
    });
    // Invalid price inputs may be on a hidden tab when Confirm is clicked.
    form.addEventListener('invalid', () => selectTab(tabs[2]), true);
    form.addEventListener('submit', event => {
      event.preventDefault();
      saveCoordinate();
      const points = drawing.points.map(point => ({ ...point }));
      for (const [index, coordinate] of coordinates.entries()) {
        const price = Number(coordinate.price);
        const time = priceOnly || coordinate.time === new Date(points[index].time * 1000).toISOString().slice(0, 19)
          ? points[index].time : Date.parse(`${coordinate.time}Z`) / 1000;
        if (!coordinate.price.trim() || !Number.isFinite(price) || !Number.isFinite(time)
          || (drawing.drawingScope === 'main' || !drawing.drawingScope) && price <= 0
          || time < 946684800 || time > 4102444800) {
          selectTab(tabs[2]); showCoordinate(index); form.reportValidity(); return;
        }
        points[index] = { ...points[index], price, time };
      }
      if (closed) points[points.length - 1] = { ...points[0] };
      const next: TradingDrawingModel = {
        ...drawing,
        color: field('color').value,
        lineStyle: field('lineStyle').value as TradingDrawingModel['lineStyle'],
        lineWidth: Number(field('lineWidth').value),
        text: field('text').value.slice(0, 240),
        textColor: field('textColor').value,
        fontSize: Number(field('fontSize').value),
        bold: dialog.querySelector('[data-line-toggle="bold"]')?.getAttribute('aria-pressed') === 'true',
        italic: dialog.querySelector('[data-line-toggle="italic"]')?.getAttribute('aria-pressed') === 'true',
        textAlign: field('textAlign').value as TradingDrawingModel['textAlign'],
        textVerticalAlign: field('textVerticalAlign').value as TradingDrawingModel['textVerticalAlign'],
        showPriceLabel: (field('showPriceLabel') as HTMLInputElement).checked,
        points,
      };
      this.close();
      onConfirm(next);
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.addEventListener('close', () => { if (trigger?.isConnected) trigger.focus(); });
    host.append(dialog);
    dialog.showModal();
    const activeTab = tabs.find(tab => tab.dataset.lineTab === initialTab) ?? tabs[0];
    selectTab(activeTab);
    if (initialTab === 'text') field('text').focus({ preventScroll: true });
    else activeTab.focus();
  }
}
