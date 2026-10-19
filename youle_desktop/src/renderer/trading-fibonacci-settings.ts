import type { TradingDrawingModel } from './trading-expert-drawing.ts';
import { colorPickerInput, openColorPicker, closeColorPicker } from './color-picker.ts';
import { fibonacciOptionsForDrawing, normalizeFibonacciOptions, FIB_INTERVAL_GROUPS, type FibonacciOptions } from './trading-fibonacci.ts';
import { localizeAppTree } from './app-language.mjs';


const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const sample = (width = 1, style = 'solid') => `<i class="fib-line-sample" style="border-top-width:${width}px;border-top-style:${style}"></i>`;
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function fibonacciSettingsDialog(drawing: TradingDrawingModel, confirm: (d: TradingDrawingModel) => void,
  close: () => void, host: HTMLElement, trigger?: HTMLElement, preview?: (d: TradingDrawingModel | null) => void) {
  const titles: Record<string, string> = {'gann-fan':'江恩扇','gann-square':'江恩正方','gann-square-fixed':'固定江恩正方','gann-box':'江恩箱','pitchfan':'倾斜扇形','fib-wedge':'斐波那契楔形','fib-speed-arcs':'斐波那契速度阻力弧','fib-spiral':'斐波那契螺旋','fib-circles':'斐波那契圈','fib-retracement':'斐波那契回撤','fib-trend-extension':'斐波那契趋势扩展','fib-channel':'斐波那契通道','fib-time-zone':'斐波那契时区','fib-speed-fan':'斐波那契速度阻力扇','fib-trend-time':'斐波那契趋势时间'};
  const title = titles[drawing.tool] ?? drawing.tool;
  const templateKey = drawing.tool === 'fib-retracement' ? 'haolo.fibonacci-templates.v1' : 'haolo.fibonacci-templates.v1.' + drawing.tool;
  const dialog = document.createElement('dialog');
  dialog.className = 'trading-horizontal-line-dialog trading-fib-dialog';
  dialog.dataset.i18nDrawing = '';
  dialog.setAttribute('aria-label', title);
  const uid = `fib-${crypto.randomUUID()}`;
  let options = fibonacciOptionsForDrawing(drawing);
  const check = (name: string, label: string) => `<label class="fib-check"><input type="checkbox" name="${name}" aria-label="${label}"><span>${label}</span></label>`;
  const popupButton = (key: string, label: string, content: string, cls = '') => `<button type="button" class="fib-control ${cls}" data-fib-menu="${key}" aria-label="${label}" aria-haspopup="menu" aria-expanded="false">${content}</button>`;
  dialog.innerHTML = `<form novalidate>
    <header><div class="fib-title"><h2>${title}</h2><input name="drawingName" maxlength="80" aria-label="绘图名称" hidden><button type="button" data-fib-rename aria-label="重命名"><svg viewBox="0 0 24 24"><path d="m15 4 5 5M4 20l1-6L16 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L10 19Z"/></svg></button></div><button type="button" data-line-cancel aria-label="关闭"><svg viewBox="0 0 24 24"><path d="m5 5 14 14M19 5 5 19"/></svg></button></header>
    <div class="trading-line-settings-tabs" role="tablist" aria-label="绘图设置">${[['style', '样式'], ['coordinates', '坐标'], ['visibility', '可见范围']].map(([key, label]) => `<button type="button" role="tab" data-line-tab="${key}" id="${uid}-${key}-tab" aria-controls="${uid}-${key}">${label}</button>`).join('')}</div>
    <div class="fib-scroll">
      <section role="tabpanel" data-line-panel="style" id="${uid}-style" aria-labelledby="${uid}-style-tab">
        <div class="fib-setting-row">${check('trendVisible', '趋势线')}<button type="button" class="fib-control fib-trend-control" data-fib-trend aria-label="趋势线样式" aria-haspopup="dialog" aria-expanded="false"><b></b>${sample(2, 'dashed')}</button></div>
        <div class="fib-setting-row"><span>档位线</span><div class="fib-controls">${popupButton('width', '选择线宽', sample(2), 'fib-width-control')}${popupButton('style', '选择样式', sample(), 'fib-style-control')}</div></div>
        <div class="fib-setting-row"><span>延伸</span>${popupButton('extension', '延伸', `<span data-fib-extension-label></span>${arrow}`, 'fib-extension-control')}</div>
        <div class="fib-setting-row" data-spiral-option>${check('counterclockwise', '逆时针')}</div><div class="fib-setting-row" data-arcs-option>${check('fullCircles', '完整圆')}</div><div class="fib-setting-row" data-gann-square-option>${check('gannFanVisible', '扇线')}${check('gannArcsVisible', '弧线')}</div><div class="fib-levels">${options.levels.map((level, i) => `<div class="fib-level" data-fib-level="${i}"><input type="checkbox" name="enabled${i}" aria-label="启用档位 ${i + 1}"><input type="number" name="level${i}" step="any" min="-1000" max="1000" required aria-label="档位 ${i + 1}">${colorPickerInput(level.color, `name="color${i}" aria-label="档位颜色 ${i + 1}"`)}</div>`).join('')}</div>
        <div class="fib-extra"><div class="fib-setting-row">${check('fillVisible', '背景填充')}<label class="fib-fill-opacity"><input name="fillOpacity" type="range" min="0" max="100" aria-label="背景不透明度"><output></output></label></div><div class="fib-controls">${check('showLevels', '显示档位')}${check('showPrices', '显示价格')}</div></div>
      </section>
      <section role="tabpanel" data-line-panel="coordinates" id="${uid}-coordinates" aria-labelledby="${uid}-coordinates-tab" hidden>
        ${drawing.points.map((_p, i) => `<fieldset><legend>#${i + 1}</legend><label class="fib-coordinate"><span>价格</span><input type="number" name="price${i}" step="any" ${!drawing.drawingScope || drawing.drawingScope === 'main' ? 'min="0.000000000001"' : ''} required aria-label="价格 #${i + 1}"></label><label class="fib-coordinate"><span>时间 (UTC+8)</span><input type="datetime-local" name="time${i}" step="1" min="2000-01-01T08:00" max="2100-01-01T08:00" required aria-label="时间 #${i + 1}"></label></fieldset>`).join('')}
      </section>
      <section role="tabpanel" data-line-panel="visibility" id="${uid}-visibility" aria-labelledby="${uid}-visibility-tab" hidden>
        <p class="fib-help">在以下时间周期显示</p>${FIB_INTERVAL_GROUPS.map((key, i) => `<div class="fib-visibility-row">${check(`visible-${key}`, ['秒', '分钟', '小时', '天', '周', '月'][i])}<input name="min-${key}" type="number" min="1" max="${[59, 59, 24, 366, 52, 12][i]}" step="1" required aria-label="最小周期 ${i + 1}"><span>—</span><input name="max-${key}" type="number" min="1" max="${[59, 59, 24, 366, 52, 12][i]}" step="1" required aria-label="最大周期 ${i + 1}"></div>`).join('')}
      </section>
    </div>
    <footer>${popupButton('template', '模板', `<span>模板</span>${arrow}`, 'fib-template-control')}<button type="button" data-line-cancel>取消</button><button type="submit" class="primary">确认</button></footer>
  </form>`;
  if (!['fib-retracement','fib-trend-extension','fib-channel'].includes(drawing.tool)) {
    dialog.querySelector('[data-fib-menu="extension"]')!.closest<HTMLElement>('.fib-setting-row')!.hidden = true;
    dialog.querySelector('[name="showPrices"]')!.closest<HTMLElement>('label')!.hidden = true;
  }
  dialog.querySelector<HTMLElement>('[data-spiral-option]')!.hidden = drawing.tool !== 'fib-spiral';
  if (drawing.tool === 'fib-spiral') { dialog.querySelector<HTMLElement>('.fib-levels')!.hidden = true; dialog.querySelector<HTMLElement>('.fib-extra')!.hidden = true; }
  dialog.querySelector<HTMLElement>('[data-arcs-option]')!.hidden = drawing.tool !== 'fib-speed-arcs';
  if (drawing.tool === 'pitchfan') dialog.querySelector('[name="showLevels"]')!.closest<HTMLElement>('label')!.hidden = true;
  if (['gann-box','gann-fan','fib-channel'].includes(drawing.tool)) dialog.querySelector('[name="trendVisible"]')!.closest<HTMLElement>('.fib-setting-row')!.hidden = true;
  const guideLabels: Record<string, string> = {'fib-speed-fan':'网格','fib-spiral':'半径线','fib-wedge':'边界线','pitchfan':'连接线','gann-square':'边框','gann-square-fixed':'边框'};
  if (guideLabels[drawing.tool]) {
    dialog.querySelector('[name="trendVisible"]')!.setAttribute('aria-label', guideLabels[drawing.tool]);
    dialog.querySelector('[name="trendVisible"]')!.nextElementSibling!.textContent = guideLabels[drawing.tool];
  }
  // Square borders share the level-0 color and the grid's width/style controls.
  if (drawing.tool.startsWith('gann-square')) dialog.querySelector<HTMLElement>('[data-fib-trend]')!.hidden = true;
  dialog.querySelector<HTMLElement>('[data-gann-square-option]')!.hidden = !drawing.tool.startsWith('gann-square');
  if (drawing.tool === 'gann-square-fixed') dialog.querySelector('[name="showLevels"]')!.closest<HTMLElement>('label')!.hidden = true;
  if (drawing.tool === 'gann-square') dialog.querySelector('[name="showLevels"]')!.nextElementSibling!.textContent = '范围和比率';
  const form = dialog.querySelector('form')!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const trend = dialog.querySelector<HTMLButtonElement>('[data-fib-trend]')!;
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[data-line-tab]')];
  const abort = new AbortController();
  let popup: HTMLElement | null = null, anchor: HTMLElement | null = null;
  const closeMenu = (focus = false) => {
    const previous = anchor;
    popup?.remove(); popup = null; anchor?.setAttribute('aria-expanded', 'false'); anchor = null;
    if (focus) previous?.focus({ preventScroll: true });
  };
  const selectTab = (tab: HTMLButtonElement) => {
    closeMenu(); closeColorPicker(dialog);
    tabs.forEach(t => { t.setAttribute('aria-selected', String(t === tab)); t.tabIndex = t === tab ? 0 : -1; });
    dialog.querySelectorAll<HTMLElement>('[data-line-panel]').forEach(p => { p.hidden = p.dataset.linePanel !== tab.dataset.lineTab; });
    dialog.querySelector('.fib-scroll')!.scrollTop = 0;
  };
  const refreshControls = () => {
    trend.disabled = !field('trendVisible').checked;
    trend.querySelector<HTMLElement>('b')!.style.background = options.trendColor;
    trend.querySelector<HTMLElement>('i')!.style.cssText = `border-top-width:${options.trendWidth}px;border-top-style:${options.trendStyle};color:${options.trendColor}`;
    dialog.querySelector<HTMLElement>('[data-fib-menu="width"] i')!.style.borderTopWidth = `${options.lineWidth}px`;
    dialog.querySelector<HTMLElement>('[data-fib-menu="style"] i')!.style.borderTopStyle = options.lineStyle;
    const labels = [options.extendLeft ? '左侧延长线' : '', options.extendRight ? '向右延长线' : ''].filter(Boolean);
    const summary = dialog.querySelector<HTMLElement>('[data-fib-extension-label]')!;
    summary.textContent = labels.length === 2 ? '左侧延长线, ...' : labels[0] || '不延伸';
    options.levels.forEach((_level, i) => {
      const enabled = field(`enabled${i}`).checked;
      field(`level${i}`).disabled = field(`color${i}`).disabled = !enabled;
      dialog.querySelector<HTMLElement>(`[data-fib-level="${i}"]`)!.dataset.disabled = String(!enabled);
    });
    FIB_INTERVAL_GROUPS.forEach(key => {
      field(`min-${key}`).disabled = field(`max-${key}`).disabled = !field(`visible-${key}`).checked;
    });
    field('fillOpacity').disabled = !field('fillVisible').checked;
    dialog.querySelector('output')!.textContent = `${field('fillOpacity').value}%`;
    localizeAppTree(dialog);
  };
  const setForm = () => {
    field('drawingName').value = options.name;
    const heading = dialog.querySelector('h2')!;
    if (options.name) heading.dataset.i18nSkip = '';
    else delete heading.dataset.i18nSkip;
    heading.textContent = options.name || title;
    for (const key of ['trendVisible', 'fillVisible', 'showLevels', 'showPrices', 'counterclockwise', 'fullCircles', 'gannFanVisible', 'gannArcsVisible'] as const) field(key).checked = options[key];
    field('fillOpacity').value = String(Math.round(options.fillOpacity * 100));
    options.levels.forEach((level, i) => {
      field(`enabled${i}`).checked = level.enabled;
      field(`level${i}`).value = String(level.value); field(`color${i}`).value = level.color;
      field(`color${i}`).style.setProperty('--color-value', level.color);
    });
    FIB_INTERVAL_GROUPS.forEach(key => {
      const range = options.visibility[key]; field(`visible-${key}`).checked = range.enabled;
      field(`min-${key}`).value = String(range.min); field(`max-${key}`).value = String(range.max);
    });
    refreshControls();
  };
  drawing.points.forEach((p, i) => { field(`price${i}`).value = String(p.price); field(`time${i}`).value = new Date((p.time + 28800) * 1000).toISOString().slice(0, 19); });
  const read = () => {
    options.name = field('drawingName').value.trim();
    for (const key of ['trendVisible', 'fillVisible', 'showLevels', 'showPrices', 'counterclockwise', 'fullCircles', 'gannFanVisible', 'gannArcsVisible'] as const) options[key] = field(key).checked;
    options.fillOpacity = Number(field('fillOpacity').value) / 100;
    options.levels.forEach((level, i) => { level.enabled = field(`enabled${i}`).checked; level.value = Number(field(`level${i}`).value); level.color = field(`color${i}`).value; });
    FIB_INTERVAL_GROUPS.forEach(key => {
      const min = field(`min-${key}`), max = field(`max-${key}`);
      options.visibility[key] = { enabled: field(`visible-${key}`).checked, min: Number(min.value), max: Number(max.value) };
      max.setCustomValidity(field(`visible-${key}`).checked && Number(min.value) > Number(max.value) ? '最大周期不能小于最小周期' : '');
    });
    return { ...drawing, fibonacci: normalizeFibonacciOptions(options, drawing.tool), color: undefined, lineWidth: undefined, lineStyle: undefined,
      points: drawing.points.map((p, i) => {
        const edited = Date.parse(`${field(`time${i}`).value}+08:00`) / 1000;
        return { ...p, price: Number(field(`price${i}`).value), time: edited === Math.floor(p.time) ? p.time : edited };
      }) };
  };
  const valid = () => [...form.querySelectorAll<HTMLInputElement>('input')].every(input => input.disabled || input.validity.valid);
  const updatePreview = () => { const next = read(); refreshControls(); if (valid()) preview?.(next); };
  form.addEventListener('input', updatePreview);
  form.addEventListener('change', updatePreview);
  const position = () => {
    if (!popup || !anchor) return;
    const r = anchor.getBoundingClientRect(), b = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(r.left, innerWidth - b.width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(r.bottom + b.height + 4 < innerHeight ? r.bottom + 4 : r.top - b.height - 4, innerHeight - b.height - 8))}px`;
  };
  let templates: { name: string; options: FibonacciOptions }[] = [];
  try {
    const saved = JSON.parse(localStorage.getItem(templateKey) || '[]');
    if (Array.isArray(saved)) templates = saved.filter(t => typeof t?.name === 'string').slice(0, 20).map(t => ({ name: t.name.slice(0, 60), options: normalizeFibonacciOptions(t.options, drawing.tool) }));
  } catch { /* Templates are optional; editing still works without storage. */ }
  const openMenu = (button: HTMLElement) => {
    if (anchor === button) { closeMenu(true); return; }
    closeMenu(); closeColorPicker(dialog);
    anchor = button;
    const kind = button.dataset.fibMenu!;
    popup = document.createElement('div'); popup.className = `fib-popup fib-popup-${kind}`;
    popup.popover = 'manual'; popup.dataset.i18nDrawing = ''; popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', button.getAttribute('aria-label') || '绘图设置');
    if (kind === 'width') popup.innerHTML = [1, 2, 3, 4].map(n => `<button type="button" role="menuitemradio" aria-checked="${n === options.lineWidth}" aria-label="${n}px" data-fib-width="${n}">${sample(n)}</button>`).join('');
    if (kind === 'style') popup.innerHTML = ['solid', 'dashed', 'dotted'].map((s, i) => `<button type="button" role="menuitemradio" aria-checked="${s === options.lineStyle}" data-fib-style="${s}">${sample(s === 'dotted' ? 2 : 1, s)}<span>${['实线', '短虚线', '点虚线'][i]}</span></button>`).join('');
    if (kind === 'extension') popup.innerHTML = ['extendLeft', 'extendRight'].map((key, i) => `<button type="button" role="menuitemcheckbox" aria-checked="${options[key as 'extendLeft']}" data-fib-extension="${key}"><b class="fib-menu-check"></b><span>${['左侧延长线', '向右延长线'][i]}</span></button>`).join('');
    if (kind === 'template') popup.innerHTML = `<button type="button" role="menuitem" data-fib-default>恢复默认</button>${templates.map((t, i) => `<button type="button" role="menuitem" data-fib-template="${i}"><span data-i18n-skip>${escape(t.name)}</span></button>`).join('')}<div class="fib-template-save"><input maxlength="60" placeholder="模板名称" aria-label="模板名称"><button type="button" data-fib-save>保存为模板</button><span role="status"></span></div>`;
    dialog.append(popup); popup.showPopover(); button.setAttribute('aria-expanded', 'true');
    popup.addEventListener('pointerdown', e => e.stopPropagation());
    popup.addEventListener('click', event => {
      event.stopPropagation();
      const item = (event.target as Element).closest<HTMLButtonElement>('button'); if (!item) return;
      if (item.dataset.fibWidth) { options.lineWidth = Number(item.dataset.fibWidth); updatePreview(); closeMenu(true); }
      else if (item.dataset.fibStyle) { options.lineStyle = item.dataset.fibStyle as FibonacciOptions['lineStyle']; updatePreview(); closeMenu(true); }
      else if (item.dataset.fibExtension) {
        const key = item.dataset.fibExtension as 'extendLeft' | 'extendRight'; options[key] = !options[key];
        item.setAttribute('aria-checked', String(options[key])); updatePreview();
      } else if (item.hasAttribute('data-fib-default') || item.dataset.fibTemplate !== undefined) {
        const name = field('drawingName').value;
        options = normalizeFibonacciOptions(item.hasAttribute('data-fib-default') ? undefined : templates[Number(item.dataset.fibTemplate)].options, drawing.tool);
        options.name = name; setForm(); updatePreview(); closeMenu(true);
      } else if (item.hasAttribute('data-fib-save')) {
        const input = popup!.querySelector('input')!, name = input.value.trim();
        if (!name) { input.focus(); return; }
        const next = read(); if (!valid()) { closeMenu(); form.reportValidity(); return; }
        const saved = [...templates.filter(t => t.name !== name), { name, options: { ...next.fibonacci, name: '' } }].slice(-20);
        try { localStorage.setItem(templateKey, JSON.stringify(saved)); templates = saved; closeMenu(true); }
        catch { popup!.querySelector('[role="status"]')!.textContent = '模板保存失败'; localizeAppTree(popup!); }
      }
    });
    localizeAppTree(popup); position(); popup.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  };
  document.addEventListener('pointerdown', event => {
    if (popup && event.target instanceof Node && !popup.contains(event.target) && !anchor?.contains(event.target)) closeMenu();
  }, { capture: true, signal: abort.signal });
  document.addEventListener('keydown', event => {
    if (!popup) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeMenu(true); return; }
    if (event.target instanceof HTMLInputElement) {
      if (event.key === 'Enter') { event.preventDefault(); popup.querySelector<HTMLButtonElement>('[data-fib-save]')?.click(); }
      return;
    }
    const items = [...popup.querySelectorAll<HTMLButtonElement>('button')], i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i >= 0 && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopImmediatePropagation(); items[i].click(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (i + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
    }
  }, { capture: true, signal: abort.signal });
  dialog.querySelector('.fib-scroll')!.addEventListener('scroll', () => closeMenu());
  window.addEventListener('resize', () => { closeMenu(); closeColorPicker(dialog); dialog.style.removeProperty('left'); dialog.style.removeProperty('top'); dialog.style.removeProperty('margin'); }, { signal: abort.signal });
  dialog.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (button?.hasAttribute('data-line-cancel')) close();
    else if (button?.dataset.lineTab) selectTab(button);
    else if (button?.dataset.fibMenu) openMenu(button);
    else if (button?.hasAttribute('data-fib-trend')) {
      closeMenu(); openColorPicker({ anchor: trend, value: options.trendColor, onChange: color => { options.trendColor = color; updatePreview(); },
        line: { width: options.trendWidth, style: options.trendStyle, onChange: (width, style) => { options.trendWidth = width; options.trendStyle = style; updatePreview(); } } });
    } else if (button?.hasAttribute('data-fib-rename')) {
      field('drawingName').hidden = false; dialog.querySelector<HTMLElement>('h2')!.hidden = true;
      field('drawingName').focus(); field('drawingName').select();
    }
  });
  field('drawingName').addEventListener('blur', () => {
    options.name = field('drawingName').value.trim(); field('drawingName').hidden = true;
    dialog.querySelector<HTMLElement>('h2')!.hidden = false; setForm();
  });
  dialog.addEventListener('keydown', event => {
    if (event.target === field('drawingName') && event.key === 'Enter') { event.preventDefault(); field('drawingName').blur(); return; }
    const i = tabs.indexOf(event.target as HTMLButtonElement);
    if (i < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    selectTab(tabs[next]); tabs[next].focus();
  });
  form.addEventListener('invalid', event => {
    const panel = (event.target as Element).closest<HTMLElement>('[data-line-panel]');
    const tab = tabs.find(t => t.dataset.lineTab === panel?.dataset.linePanel); if (tab) selectTab(tab);
  }, true);
  form.addEventListener('submit', event => {
    event.preventDefault(); closeMenu(); closeColorPicker(dialog);
    const next = read(); if (!form.reportValidity()) return;
    close(); confirm(next);
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('fib-settings-dispose', () => { abort.abort(); closeMenu(); closeColorPicker(dialog); preview?.(null); }, { once: true });
  dialog.addEventListener('close', () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); });
  // Move by the header without initiating a chart drag; keep the title reachable.
  const header = dialog.querySelector('header')!;
  let drag: { x: number; y: number; left: number; top: number } | null = null;
  header.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.target as Element).closest('button,input')) return;
    const rect = dialog.getBoundingClientRect(); drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    closeMenu(); closeColorPicker(dialog); header.setPointerCapture(event.pointerId); event.preventDefault();
  });
  header.addEventListener('pointermove', event => {
    if (!drag) return;
    dialog.style.margin = '0';
    dialog.style.left = `${Math.max(8, Math.min(innerWidth - dialog.offsetWidth - 8, drag.left + event.clientX - drag.x))}px`;
    dialog.style.top = `${Math.max(8, Math.min(innerHeight - dialog.offsetHeight - 8, drag.top + event.clientY - drag.y))}px`;
  });
  header.addEventListener('lostpointercapture', () => { drag = null; });
  host.append(dialog); setForm(); dialog.showModal(); selectTab(tabs[0]); tabs[0].focus();
  return dialog;
}
