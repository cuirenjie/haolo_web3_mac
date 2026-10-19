import { localizeAppTree } from './app-language.mjs';

// Shared by every desktop color entry. Alpha is stored as CSS #RRGGBBAA.
export const COLOR_PALETTE = [
  '#ffffff','#dadada','#bdbdbd','#9e9e9e','#808080','#606060','#434343','#2b2b2b','#111111','#000000',
  '#f23645','#ff9800','#ffeb3b','#4caf50','#089981','#00bcd4','#2962ff','#673ab7','#9c27b0','#e91e63',
  '#ffcdd2','#ffe0b2','#fff9c4','#c8e6c9','#b2dfdb','#b2ebf2','#bbdefb','#d1c4e9','#e1bee7','#f8bbd0',
  '#ef9a9a','#ffcc80','#fff59d','#a5d6a7','#80cbc4','#80deea','#90caf9','#b39ddb','#ce93d8','#f48fb1',
  '#e57373','#ffb74d','#fff176','#81c784','#4db6ac','#4dd0e1','#64b5f6','#9575cd','#ba68c8','#f06292',
  '#ef5350','#ffa726','#ffee58','#66bb6a','#26a69a','#26c6da','#42a5f5','#7e57c2','#ab47bc','#ec407a',
  '#b71c1c','#f57c00','#fbc02d','#388e3c','#00695c','#0097a7','#1e40d9','#512da8','#7b1fa2','#c2185b',
  '#801922','#e65100','#ff8f00','#1b5e20','#003d33','#006064','#12349e','#311b92','#4a148c','#880e4f',
] as const;
export const CUSTOM_COLORS_KEY = 'haolo.custom-colors.v1';
export function normalizeColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value) ? value.toLowerCase() : undefined;
}
export function splitColor(value: string) {
  const color = normalizeColor(value) ?? '#2962ff';
  return { hex: color.slice(0, 7), opacity: color.length === 9 ? Math.round(parseInt(color.slice(7), 16) / 255 * 100) : 100 };
}
export function withOpacity(hex: string, opacity: number) {
  const percent = Math.max(0, Math.min(100, Number.isFinite(opacity) ? opacity : 100));
  return hex.slice(0, 7) + (percent === 100 ? '' : Math.round(percent * 255 / 100).toString(16).padStart(2, '0'));
}
export function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}
export function hexToHsv(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const hue = delta === 0 ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: hue * 60, s: max === 0 ? 0 : delta / max, v: max };
}
export function customColors(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(normalizeColor).filter((x): x is string => Boolean(x)).map(x => x.slice(0, 7)))].slice(-30) : [];
}
export function colorPickerInput(value: string, attributes: string) {
  const color = normalizeColor(value) ?? '#2962ff';
  return `<input type="text" data-color-picker-input readonly role="button" aria-haspopup="dialog" aria-expanded="false" ${attributes} value="${color}" style="--color-value:${color}"/>`;
}
type Options = { anchor: HTMLElement; value: string; onChange: (color: string) => void; onClose?: () => void;
  line?: { width: number; style: 'solid' | 'dashed' | 'dotted'; onChange: (width: number, style: 'solid' | 'dashed' | 'dotted') => void } };
type PickerState = { active: { anchor: HTMLElement; close: (focus?: boolean) => void } | null; installed: boolean };
// One owner even when development modules are imported under multiple URLs.
const pickerGlobal = globalThis as typeof globalThis & { __haoloColorPicker?: PickerState };
const pickerState = pickerGlobal.__haoloColorPicker ??= { active: null, installed: false };
export function closeColorPicker(owner?: HTMLElement) {
  if (!owner || pickerState.active && owner.contains(pickerState.active.anchor)) pickerState.active?.close();
}
export function openColorPicker(options: Options) {
  const { anchor, onChange } = options;
  if (pickerState.active?.anchor === anchor) { pickerState.active.close(true); return; }
  pickerState.active?.close();
  const initial = splitColor(options.value);
  let hex = initial.hex, opacity = initial.opacity, hsv = hexToHsv(hex);
  let saved: string[] = [];
  try { saved = customColors(JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY) ?? '[]')); } catch { /* Storage can be unavailable. */ }
  const popup = document.createElement('div');
  popup.className = 'haolo-color-picker';
  popup.popover = 'manual';
  popup.dataset.i18nDrawing = '';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', '选择颜色');
  popup.innerHTML = `<div data-color-palette-view>
    <div class="haolo-color-grid" data-color-presets></div>
    <div class="haolo-color-custom"><div class="haolo-color-grid" data-color-custom></div><button type="button" class="haolo-color-add" data-color-add title="添加自定义颜色" aria-label="添加自定义颜色">＋</button></div>
    <label class="haolo-color-opacity-label" for="haolo-color-opacity">不透明度</label>
    <div class="haolo-color-opacity"><input id="haolo-color-opacity" data-color-opacity type="range" min="0" max="100" aria-label="不透明度"><label><input data-color-percent type="number" min="0" max="100" aria-label="不透明度百分比"><span>%</span></label></div>
  </div><div data-color-custom-view hidden>
    <div class="haolo-color-custom-header"><span data-color-preview></span><input data-color-hex aria-label="十六进制颜色" maxlength="7" spellcheck="false"><button type="button" data-color-save>增加</button></div>
    <div class="haolo-color-editor"><div class="haolo-color-plane" data-color-plane tabindex="0" role="slider" aria-label="饱和度和明度"><i></i></div><input class="haolo-color-hue" data-color-hue type="range" min="0" max="360" step="1" aria-label="色相"></div>
    <button class="haolo-color-back" type="button" data-color-back>返回色板</button>
  </div>`;
  (anchor.closest('dialog') ?? document.body).append(popup);
  popup.showPopover();
  anchor.setAttribute('aria-expanded', 'true');
  const get = <T extends HTMLElement>(selector: string) => popup.querySelector<T>(selector)!;
  const palette = get('[data-color-palette-view]'), custom = get('[data-color-custom-view]');
  if (options.line) {
    const line = options.line;
    const controls = document.createElement('div');
    controls.className = 'haolo-color-line-controls';
    controls.innerHTML = `<span>厚度</span><div role="group" aria-label="选择线宽">${[1, 2, 3, 4].map(width => `<button type="button" data-color-line-width="${width}" aria-label="${width}px" aria-pressed="${width === line.width}"><i style="border-top-width:${width}px"></i></button>`).join('')}</div><span>线条样式</span><div role="group" aria-label="选择样式">${(['solid', 'dashed', 'dotted'] as const).map((style, i) => `<button type="button" data-color-line-style="${style}" aria-label="${['实线', '短虚线', '点虚线'][i]}" aria-pressed="${style === line.style}"><i style="border-top-style:${style}"></i></button>`).join('')}</div>`;
    palette.append(controls);
    controls.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLElement>('button');
      if (button?.dataset.colorLineWidth) line.width = Number(button.dataset.colorLineWidth);
      else if (button?.dataset.colorLineStyle) line.style = button.dataset.colorLineStyle as typeof line.style;
      else return;
      controls.querySelectorAll<HTMLElement>('[data-color-line-width]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.colorLineWidth) === line.width)));
      controls.querySelectorAll<HTMLElement>('[data-color-line-style]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.colorLineStyle === line.style)));
      line.onChange(line.width, line.style);
    });
  }
  const plane = get('[data-color-plane]'), hue = get<HTMLInputElement>('[data-color-hue]');
  const hexInput = get<HTMLInputElement>('[data-color-hex]');
  const range = get<HTMLInputElement>('[data-color-opacity]'), percent = get<HTMLInputElement>('[data-color-percent]');
  const swatches = (colors: readonly string[]) => colors.map(color => `<button type="button" data-color-swatch="${color}" aria-label="${color}" title="${color}" aria-pressed="false" style="--swatch:${color}"></button>`).join('');
  get('[data-color-presets]').innerHTML = swatches(COLOR_PALETTE);
  const renderSaved = () => { get('[data-color-custom]').innerHTML = swatches(saved); };
  const position = () => {
    if (!anchor.isConnected || !anchor.checkVisibility()) { close(); return; }
    const r = anchor.getBoundingClientRect(), box = popup.getBoundingClientRect();
    const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
    popup.style.left = `${Math.max(8, Math.min(r.left - 12, width - box.width - 8))}px`;
    const below = r.bottom + 6;
    popup.style.top = `${Math.max(8, Math.min(below + box.height <= height - 8 ? below : r.top - box.height - 6, height - box.height - 8))}px`;
  };
  const render = () => {
    range.value = percent.value = String(opacity);
    popup.style.setProperty('--color-value', hex);
    popup.querySelectorAll<HTMLElement>('[data-color-swatch]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.colorSwatch === hex)));
    hexInput.value = hex;
    hexInput.setAttribute('aria-invalid', 'false');
    get<HTMLButtonElement>('[data-color-save]').disabled = false;
    get('[data-color-preview]').style.background = hex;
    plane.style.setProperty('--hue', hsvToHex(hsv.h, 1, 1));
    plane.style.setProperty('--saturation', `${hsv.s * 100}%`);
    plane.style.setProperty('--brightness', `${(1 - hsv.v) * 100}%`);
    plane.setAttribute('aria-valuetext', `${Math.round(hsv.s * 100)}%, ${Math.round(hsv.v * 100)}%`);
    hue.value = String(hsv.h);
  };
  let appliedHex = hex;
  const apply = () => { appliedHex = hex; render(); onChange(withOpacity(hex, opacity)); };
  const switchView = (editing: boolean) => {
    palette.hidden = editing; custom.hidden = !editing;
    if (editing) { hsv = hexToHsv(hex); render(); hexInput.focus(); hexInput.select(); }
    else { hex = appliedHex; hsv = hexToHsv(hex); render(); get('[data-color-add]').focus(); }
    position();
  };
  // Events inside the floating panel must not reach chart selection/drag handlers.
  popup.addEventListener('pointerdown', event => event.stopPropagation());
  popup.addEventListener('click', event => {
    event.stopPropagation();
    const target = (event.target as Element).closest<HTMLElement>('button');
    if (target?.dataset.colorSwatch) { hex = target.dataset.colorSwatch; hsv = hexToHsv(hex); apply(); }
    if (target?.hasAttribute('data-color-add')) switchView(true);
    if (target?.hasAttribute('data-color-back')) { switchView(false); }
    if (target?.hasAttribute('data-color-save')) {
      saved = customColors([...saved.filter(c => c !== hex), hex]);
      try { localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(saved)); } catch { /* Still usable for this session. */ }
      renderSaved(); apply(); switchView(false);
    }
  });
  for (const control of [range, percent]) control.addEventListener('input', () => {
    if (control.value === '' || !Number.isFinite(control.valueAsNumber)) return;
    opacity = Math.round(Math.max(0, Math.min(100, control.valueAsNumber))); apply();
  });
  percent.addEventListener('blur', render);
  hexInput.addEventListener('input', () => {
    const value = normalizeColor(hexInput.value);
    get<HTMLButtonElement>('[data-color-save]').disabled = !value;
    hexInput.setAttribute('aria-invalid', String(!value));
    if (value) { hex = value; hsv = hexToHsv(hex); render(); }
  });
  hue.addEventListener('input', () => { hsv.h = hue.valueAsNumber; hex = hsvToHex(hsv.h, hsv.s, hsv.v); render(); });
  const pick = (event: PointerEvent) => {
    const r = plane.getBoundingClientRect();
    hsv.s = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width));
    hsv.v = 1 - Math.max(0, Math.min(1, (event.clientY - r.top) / r.height));
    hex = hsvToHex(hsv.h, hsv.s, hsv.v); render();
  };
  plane.addEventListener('pointerdown', event => { event.preventDefault(); plane.focus(); plane.setPointerCapture(event.pointerId); pick(event); });
  plane.addEventListener('pointermove', event => { if (plane.hasPointerCapture(event.pointerId)) pick(event); });
  plane.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    hsv.s = Math.max(0, Math.min(1, hsv.s + (event.key === 'ArrowRight' ? .01 : event.key === 'ArrowLeft' ? -.01 : 0)));
    hsv.v = Math.max(0, Math.min(1, hsv.v + (event.key === 'ArrowUp' ? .01 : event.key === 'ArrowDown' ? -.01 : 0)));
    hex = hsvToHex(hsv.h, hsv.s, hsv.v); render();
  });
  const outside = (event: PointerEvent) => { if (event.target instanceof Node && !popup.contains(event.target) && !anchor.contains(event.target)) close(); };
  const keyboard = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!custom.hidden) switchView(false); else close(true); }
    if (event.key === 'Enter' && event.target === hexInput) { event.preventDefault(); get<HTMLButtonElement>('[data-color-save]').click(); }
  };
  let frame = 0;
  const monitor = () => { position(); if (popup.isConnected) frame = requestAnimationFrame(monitor); };
  const close = (focus = false) => {
    cancelAnimationFrame(frame);
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keyboard, true);
    popup.remove(); anchor.setAttribute('aria-expanded', 'false');
    if (pickerState.active?.anchor === anchor) pickerState.active = null;
    options.onClose?.();
    if (focus && anchor.isConnected) anchor.focus({ preventScroll: true });
  };
  pickerState.active = { anchor, close };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', keyboard, true);
  renderSaved(); render(); localizeAppTree(popup); position();
  get(`[data-color-swatch="${hex}"]`)?.focus({ preventScroll: true });
  frame = requestAnimationFrame(monitor);
}

if (typeof document !== 'undefined' && !pickerState.installed) {
  pickerState.installed = true;
  const launch = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.hasAttribute('data-color-picker-input') || input.disabled) return;
    if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    openColorPicker({ anchor: input, value: input.value, onChange: value => {
      input.value = value; input.style.setProperty('--color-value', value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } });
  };
  document.addEventListener('click', launch, true);
  document.addEventListener('keydown', launch, true);
}
