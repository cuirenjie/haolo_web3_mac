/** One setting value is the atomic cross-device theme selection (v1). */
export type CustomTheme = { color: string; opacity: number };
export const DEFAULT_CUSTOM_THEME: CustomTheme = { color: '#12349e', opacity: 100 };
export function decodeCustomTheme(value: unknown): CustomTheme | null {
  const match = typeof value === 'string' && /^custom:(#[0-9a-f]{6}):(100|[1-9]?\d)$/i.exec(value);
  return match && match[1].toLowerCase() !== '#ffffff' ? { color: match[1].toLowerCase(), opacity: Number(match[2]) } : null;
}
export function encodeCustomTheme(theme: CustomTheme): string {
  const value = `custom:${theme.color.toLowerCase()}:${theme.opacity}`;
  if (!decodeCustomTheme(value)) throw new Error('Invalid custom theme');
  return value;
}

/** Encoded-sRGB luminance: black=100, #b3b3b3≈30. White and non-control colored surfaces stay unchanged.
 * Alpha belongs to the paint, never the element (text must remain untouched).
 */
export function mapSurfaceColor(source: string, theme: CustomTheme, control = false): string {
  const original = source;
  const named: Record<string, string> = { white: '#ffffff', black: '#000000', transparent: '#00000000' };
  source = named[source.toLowerCase()] ?? source;
  let rgba: number[];
  if (/^#[\da-f]{3,8}$/i.test(source)) {
    let hex = source.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return source;
    rgba = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    rgba.push(hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1);
  } else {
    const m = /^rgba?\(\s*([\d.]+%?)[, ]+([\d.]+%?)[, ]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(source);
    if (!m) return source;
    const channel = (v: string) => parseFloat(v) * (v.endsWith('%') ? 2.55 : 1);
    rgba = [channel(m[1]), channel(m[2]), channel(m[3]), m[4] === undefined ? 1 : parseFloat(m[4]) / (m[4].endsWith('%') ? 100 : 1)];
  }
  const channels = rgba.slice(0, 3);
  if (channels.every(c => c >= 255 - 1e-6) || rgba[3] === 0) return original;
  // Include the slightly cool/warm neutral grays used by existing UI tokens.
  if (!control && Math.max(...channels) - Math.min(...channels) > 16) return original;
  const density = Math.max(0, Math.min(1, 1 - (.2126 * rgba[0] + .7152 * rgba[1] + .0722 * rgba[2]) / 255));
  const rgb = [1, 3, 5].map(i => Math.round(255 + (parseInt(theme.color.slice(i, i + 2), 16) - 255) * density));
  return `rgba(${rgb.join(', ')}, ${Number((rgba[3] * theme.opacity / 100).toFixed(5))})`;
}

const paint = /^(background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|box-shadow|accent-color|column-rule(?:-color)?)$/;
const colors = /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|rgba?\([^()]*\)|\b(?:white|black)\b/gi;
const sample = /(?:swatch|color-value|color-preview|color-plane|color-hue|color-opacity|color-percent|color-preset|color-custom|color-grid|data-color|color-picker-input|drawing.*(?:color|fill)|candle|rising|falling)/i;

export function mapSurfacePaint(value: string, theme: CustomTheme, control = false): string {
  // Do not rewrite embedded images, SVGs, or color samples/data series.
  if (/url\(/i.test(value)) return value;
  return value.replace(colors, color => mapSurfaceColor(color, theme, control));
}

let active: CustomTheme | null = null;
let sheet: HTMLStyleElement | undefined;
let observer: MutationObserver | undefined;
let scheduled = false;
const originals = new Map<HTMLElement | SVGElement, Map<string, { original: string; mapped: string; priority: string }>>();
export function currentCustomTheme() { return active; }
export function customChartSurface(value: string) {
  const theme = typeof document === 'undefined' ? active : decodeCustomTheme(document.documentElement.dataset.customTheme);
  return theme ? mapSurfaceColor(value, theme) : value;
}

function resolveVariables(value: string, local: CSSStyleDeclaration, root: CSSStyleDeclaration, depth = 0): string {
  if (depth > 12) return value;
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (all, name, fallback) => {
    if (sample.test(name)) return all;
    const v = local.getPropertyValue(name) || root.getPropertyValue(name) || fallback;
    return v ? resolveVariables(v.trim(), local, root, depth + 1) : all;
  });
}

// Separate paint aliases preserve inherited component palettes without ever
// changing a variable also used by text. Fallbacks retain non-color variables.
const surfaceAlias = (name: string, control = false) => `--haolo-${control ? 'control' : 'surface'}-${name.slice(2)}`;
const exemptSelector = ':is([data-custom-theme-exempt],.haolo-color-picker)';
// A scrim darkens everything behind a modal, including text and market data.
// Preserve the barrier itself, while allowing its dialog/control children to tint.
const barrierSelector = '[data-theme-backdrop],[class*="backdrop"],[class*="scrim"],[class~="overlay"],[class$="-overlay"],[class*="-overlay "],[class~="mask"],[class$="-mask"],[class*="-mask "]';
const controlSelector = 'button,input,select,textarea,progress,meter,[role="button"],[role="switch"],[role="checkbox"],[role="radio"],[role="slider"],[role="tab"],[role="option"]';
function guardedSelectors(selector: string, control = false): string {
  const parts: string[] = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (quote) { if (c === quote && selector[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { parts.push(selector.slice(start, i)); start = i + 1; }
  }
  parts.push(selector.slice(start));
  const guard = `:not(:where(${exemptSelector},${exemptSelector} *,${barrierSelector}))${control ? `:where(${controlSelector},:is(${controlSelector}) *)` : ''}`;
  return parts.filter(part => !/::backdrop\b/i.test(part)).map(part => {
    const pseudo = part.indexOf('::');
    return pseudo < 0 ? part + guard : part.slice(0, pseudo) + guard + part.slice(pseudo);
  }).join(',');
}
function paintProperties(style: CSSStyleDeclaration) {
  // Chromium enumerates pending-substitution shorthand longhands with empty
  // values. Read the shorthand too or background: var(--panel) is lost.
  return [...new Set([...style, ...['background', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'outline']
    .filter(p => style.getPropertyValue(p).includes('var('))])];
}
function surfacePaint(value: string, theme: CustomTheme, local: CSSStyleDeclaration, root: CSSStyleDeclaration, control = false) {
  if (/url\(/i.test(value) || /var\(\s*--(?:swatch|color-value)/.test(value)) return value;
  if (/rgba?\(\s*var\(/.test(value)) {
    const resolved = resolveVariables(value, local, root);
    if (!/var\(/.test(resolved)) return mapSurfacePaint(resolved, theme, control);
  }
  return mapSurfacePaint(value, theme, control).replace(/var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)/g, (all, name) => sample.test(name) ? all : `var(${surfaceAlias(name, control)}, ${all})`);
}

function refreshStyles() {
  scheduled = false;
  if (!active || !sheet) return;
  const theme = active;
  // Original variables are intentionally untouched: foregrounds share some of them.
  const root = getComputedStyle(document.documentElement);
  const walk = (rules: CSSRuleList): string => [...rules].map(rule => {
    if (rule instanceof CSSKeyframesRule) {
      if (/(?:backdrop|scrim|overlay)/i.test(rule.name)) return '';
      let changed = false;
      const frames = [...rule.cssRules].map(raw => {
        const frame = raw as CSSKeyframeRule;
        const style = document.createElement('div').style;
        style.cssText = frame.style.cssText;
        for (const p of paintProperties(frame.style).filter(p => paint.test(p))) {
          const source = frame.style.getPropertyValue(p);
          const mapped = surfacePaint(source, theme, frame.style, root);
          if (mapped !== source) { style.setProperty(p, mapped); changed = true; }
        }
        return `${frame.keyText}{${style.cssText}}`;
      }).join('');
      // A replacement animation must retain transforms, timing and text colors.
      return changed ? `@keyframes ${rule.name}{${frames}}` : '';
    }
    if (rule instanceof CSSStyleRule) {
      if (sample.test(rule.selectorText) || /data-theme\s*=\s*["']dark/.test(rule.selectorText)) return '';
      const selector = guardedSelectors(rule.selectorText);
      if (!selector) return '';
      const normal: string[] = [], controls: string[] = [];
      for (const p of paintProperties(rule.style).filter(p => paint.test(p) || p.startsWith('--'))) {
        if (sample.test(p) || /^--haolo-(surface|control)-/.test(p)) continue;
        const source = rule.style.getPropertyValue(p);
        const priority = rule.style.getPropertyPriority(p) ? ' !important' : '';
        const mapped = surfacePaint(source, theme, rule.style, root);
        const controlled = surfacePaint(source, theme, rule.style, root, true);
        if (p.startsWith('--')) {
          normal.push(`${surfaceAlias(p)}:${mapped}${priority};`, `${surfaceAlias(p, true)}:${controlled}${priority};`);
        } else {
          // Preserve unchanged white/transparent overrides in the cascade too;
          // otherwise an earlier tinted gray rule would win from this last sheet.
          normal.push(`${p}:${mapped}${priority};`);
          if (controlled !== mapped) controls.push(`${p}:${controlled}${priority};`);
        }
      }
      return (normal.length ? `${selector}{${normal.join('')}}` : '')
        + (controls.length ? `${guardedSelectors(rule.selectorText, true)}{${controls.join('')}}` : '');
    }
    if (rule instanceof CSSImportRule) { try { return rule.styleSheet ? walk(rule.styleSheet.cssRules) : ''; } catch { return ''; } }
    if ('cssRules' in rule) {
      const body = walk((rule as CSSGroupingRule).cssRules);
      return body ? `${rule.cssText.slice(0, rule.cssText.indexOf('{'))}{${body}}` : '';
    }
    return '';
  }).join('\n');
  sheet.textContent = [...document.styleSheets].filter(s => s.ownerNode !== sheet).map(s => {
    try { return walk(s.cssRules); } catch { return ''; } // External pages retain their own origin/theme.
  }).join('\n');
  document.head.append(sheet);
  document.querySelectorAll<HTMLElement | SVGElement>('[style]').forEach(mapInline);
}

function mapInline(el: HTMLElement | SVGElement) {
  if (!active || el === sheet) return;
  if (el.matches(barrierSelector) || el.hasAttribute('data-theme-surface-mapped') || sample.test(el.className?.toString() ?? '') || el.closest('[data-custom-theme-exempt], .haolo-color-picker, [data-color-presets], [data-color-custom], [data-color-custom-view], [data-color-opacity], .haolo-color-opacity, [data-theme-color-sample]')) {
    // A reused surface can become a modal barrier after it was already painted.
    for (const [p, v] of originals.get(el) ?? []) {
      if (el.style.getPropertyValue(p) === v.mapped) el.style.setProperty(p, v.original, v.priority);
    }
    originals.delete(el);
    return;
  }
  const properties = paintProperties(el.style).filter(p => paint.test(p) || p.startsWith('--') && !/^--haolo-(surface|control)-/.test(p) && !sample.test(p));
  if (!properties.length) return;
  let saved = originals.get(el);
  const root = getComputedStyle(document.documentElement);
  const isControl = Boolean(el.closest(controlSelector));
  const targets = properties.flatMap(source => source.startsWith('--')
    ? [false, true].map(control => ({ source, p: surfaceAlias(source, control), control }))
    : [{ source, p: source, control: isControl }]);
  for (const { source: sourceProperty, p, control } of targets) {
    const current = el.style.getPropertyValue(sourceProperty);
    if (saved?.get(p)?.mapped === current) continue;
    const mapped = surfacePaint(current, active, el.style, root, control);
    if (mapped === current && sourceProperty === p) { saved?.delete(p); continue; }
    if (sourceProperty !== p && saved?.get(p)?.mapped === el.style.getPropertyValue(p) && mapped === el.style.getPropertyValue(p)) continue;
    const priority = el.style.getPropertyPriority(p);
    saved ??= new Map(); originals.set(el, saved);
    const original = sourceProperty === p ? current : (saved.get(p)?.original ?? el.style.getPropertyValue(p));
    el.style.setProperty(p, mapped, priority);
    saved.set(p, { original, mapped: el.style.getPropertyValue(p), priority });
  }
}

function restoreInline() {
  for (const [el, properties] of originals) for (const [p, v] of properties) {
    if (el.style.getPropertyValue(p) === v.mapped) el.style.setProperty(p, v.original, v.priority);
  }
  originals.clear();
}

export function applyCustomTheme(theme: CustomTheme | null) {
  observer?.disconnect();
  restoreInline();
  active = theme;
  sheet?.remove(); sheet = undefined;
  if (theme) {
    sheet = document.createElement('style'); sheet.dataset.customThemeSheet = '';
    document.head.append(sheet);
    refreshStyles();
    observer ??= new MutationObserver(records => {
      for (const record of records) {
        if (record.target === sheet || sheet?.contains(record.target)) continue;
        if (record.target instanceof HTMLStyleElement && !scheduled) { scheduled = true; queueMicrotask(refreshStyles); }
        if (record.type === 'attributes' && record.target instanceof HTMLElement) {
          mapInline(record.target);
          if (record.attributeName !== 'style') record.target.querySelectorAll<HTMLElement>('[style]').forEach(mapInline);
        }
        for (const node of record.addedNodes) if (node instanceof Element && node !== sheet) {
          if (node.matches('style, link[rel="stylesheet"]') && !scheduled) { scheduled = true; queueMicrotask(refreshStyles); }
          if (node instanceof HTMLElement) mapInline(node);
          node.querySelectorAll<HTMLElement>('[style]').forEach(mapInline);
        }
        for (const node of record.removedNodes) if (node instanceof Element) {
          for (const [el, properties] of originals) if (!el.isConnected && (el === node || node.contains(el))) {
            for (const [p, v] of properties) if (el.style.getPropertyValue(p) === v.mapped) el.style.setProperty(p, v.original, v.priority);
            originals.delete(el);
          }
        }
      }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'data-theme-backdrop', 'data-custom-theme-exempt'] });
  }
  // Chart canvases observe this atomic value as well as the standard light/dark theme.
  document.documentElement.dataset.customTheme = theme ? encodeCustomTheme(theme) : '';
}
