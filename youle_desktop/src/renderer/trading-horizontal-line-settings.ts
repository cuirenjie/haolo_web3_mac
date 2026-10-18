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

export const horizontalLineSettingsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-1 3-3 1v4l2 2-1 3 3 3 3-1 3 1 3-3-1-3 2-2V7l-3-1-1-3Z"/><circle cx="12" cy="11" r="3"/></svg>';

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

  show(drawing: TradingDrawingModel, onConfirm: (next: TradingDrawingModel) => void, host: HTMLElement, trigger?: HTMLElement) {
    this.close();
    const dialog = document.createElement('dialog');
    this.dialog = dialog;
    dialog.className = 'trading-horizontal-line-dialog';
    dialog.dataset.i18nDrawing = '';
    dialog.setAttribute('aria-label', '水平线');
    const id = `horizontal-line-${crypto.randomUUID()}`;
    dialog.innerHTML = `
      <form>
        <header><h2>水平线</h2><button type="button" data-line-cancel aria-label="关闭">×</button></header>
        <div class="trading-line-settings-tabs" role="tablist" aria-label="水平线设置">
          ${[['style', '样式'], ['text', '文本'], ['coordinates', '坐标']].map(([tab, label], i) => `<button type="button" role="tab" id="${id}-${tab}-tab" aria-controls="${id}-${tab}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-line-tab="${tab}">${label}</button>`).join('')}
        </div>
        <section role="tabpanel" id="${id}-style" aria-labelledby="${id}-style-tab" data-line-panel="style">
          <div class="trading-line-settings-row"><span>线条</span><input name="color" type="color" aria-label="线条颜色"><select name="lineStyle" aria-label="选择样式"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select><select name="lineWidth" aria-label="选择线宽">${[1, 2, 3, 4].map(n => `<option value="${n}">${n}px</option>`).join('')}</select></div>
          <label class="trading-line-settings-row"><input name="showPriceLabel" type="checkbox">价格标签</label>
        </section>
        <section role="tabpanel" id="${id}-text" aria-labelledby="${id}-text-tab" data-line-panel="text" hidden>
          <div class="trading-line-text-controls"><input name="textColor" type="color" aria-label="文本颜色"><select name="fontSize" aria-label="字体大小">${[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36].map(n => `<option value="${n}">${n}</option>`).join('')}</select><button type="button" data-line-toggle="bold" aria-label="加粗" aria-pressed="false"><b>B</b></button><button type="button" data-line-toggle="italic" aria-label="斜体" aria-pressed="false"><i>I</i></button></div>
          <textarea name="text" maxlength="240" aria-label="文本输入" placeholder="请输入内容…"></textarea>
          <div class="trading-line-settings-row"><span>文字对齐</span><select name="textVerticalAlign" aria-label="文字垂直对齐"><option value="top">顶部</option><option value="middle">中间</option><option value="bottom">底部</option></select><select name="textAlign" aria-label="文字水平对齐"><option value="left">居左</option><option value="center">居中</option><option value="right">居右</option></select></div>
        </section>
        <section role="tabpanel" id="${id}-coordinates" aria-labelledby="${id}-coordinates-tab" data-line-panel="coordinates" hidden>
          <label class="trading-line-settings-row"><span>#1(价格)</span><input name="price" type="number" step="any" required aria-label="#1(价格)"></label>
        </section>
        <footer><button type="button" data-line-cancel>取消</button><button type="submit" class="primary">确认</button></footer>
      </form>`;
    const form = dialog.querySelector('form')!;
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
      textVerticalAlign: drawing.textVerticalAlign ?? 'top',
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
      const price = Number(field('price').value);
      if (!field('price').value.trim() || !Number.isFinite(price)) return;
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
        points: drawing.points.map(point => ({ ...point, price })),
      };
      this.close();
      onConfirm(next);
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.addEventListener('close', () => { if (trigger?.isConnected) trigger.focus(); });
    host.append(dialog);
    dialog.showModal();
    tabs[0].focus();
  }
}
