// Kept self-contained so the same detector can run inside an Electron renderer.
export function inspectTextClipping(scope) {
  const issues = [];
  const context = document.createElement("canvas").getContext("2d");
  const clipped = new Set(["hidden", "clip"]);
  const scrolling = new Set(["auto", "scroll"]);
  const compact = (element) => element.tagName.toLowerCase()
    + (element.id ? `#${element.id}` : [...element.classList].map((name) => `.${name}`).join(""));
  const shown = (element) => {
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) return false;
      // Ignore screen-reader-only labels, but not rounded application/dialog masks.
      const bounds = current.getBoundingClientRect();
      if (style.clip !== "auto" || (style.clipPath !== "none" && bounds.width <= 1 && bounds.height <= 1)
        || current.getAttribute("aria-hidden") === "true") return false;
    }
    return true;
  };
  const measure = (style, text) => {
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return context.measureText(text);
  };
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const owner = node.parentElement;
    const text = node.textContent.trim();
    if (!text || !owner || !shown(owner) || owner.closest("svg, script, style, textarea")) continue;
    const style = getComputedStyle(owner);
    const metrics = measure(style, text);
    const fontHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
    if (!fontHeight) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const scale = rect.height / fontHeight;
      const inkTop = rect.top + (metrics.fontBoundingBoxAscent - metrics.actualBoundingBoxAscent) * scale;
      const inkBottom = rect.bottom - (metrics.fontBoundingBoxDescent - metrics.actualBoundingBoxDescent) * scale;
      for (let ancestor = owner; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const clipStyle = getComputedStyle(ancestor);
        // Content outside a scrollport or a line clamp is not a clipped glyph.
        if (scrolling.has(clipStyle.overflowY) && clipStyle.textOverflow !== "ellipsis") break;
        if (!clipped.has(clipStyle.overflowY) || clipStyle.display === "inline" || clipStyle.display === "contents") continue;
        const bounds = ancestor.getBoundingClientRect();
        const ancestorScale = bounds.height / (ancestor.offsetHeight || bounds.height || 1);
        const top = bounds.top + parseFloat(clipStyle.borderTopWidth) * ancestorScale;
        const bottom = bounds.bottom - parseFloat(clipStyle.borderBottomWidth) * ancestorScale;
        const midpoint = (rect.top + rect.bottom) / 2;
        if (midpoint < top || midpoint > bottom || rect.right <= bounds.left || rect.left >= bounds.right) break;
        const topLoss = Math.max(0, top - inkTop);
        const bottomLoss = Math.max(0, inkBottom - bottom);
        if (topLoss > 0.5 || bottomLoss > 0.5) {
          issues.push({ element: compact(owner), text: text.slice(0, 72), clipElement: compact(ancestor), topLoss, bottomLoss, fontSize: style.fontSize, lineHeight: style.lineHeight });
          break;
        }
      }
    }
  }
  for (const input of scope.querySelectorAll('input:not([type="hidden"]):not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="file"]):not([type="image"])')) {
    if (!shown(input)) continue;
    const text = input.value || input.placeholder;
    if (!text) continue;
    const style = getComputedStyle(input);
    const metrics = measure(style, text);
    const contentHeight = input.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    if (inkHeight > contentHeight + 0.5) issues.push({ element: compact(input), text: text.slice(0, 72), clipElement: compact(input), contentHeight, inkHeight, fontSize: style.fontSize, lineHeight: style.lineHeight });
  }
  return issues;
}

// Exercise declared ellipsis/clamp typography with descenders, accents and CJK
// independently of which optional panels happen to contain those labels today.
export function inspectClippedLabelStyles(inspect) {
  const rules = [];
  const visit = (list) => {
    for (const rule of list) {
      if (rule.cssRules) visit(rule.cssRules);
      if (rule.style && /hidden|clip/.test(rule.style.overflow)
        && rule.style.fontSize && rule.style.lineHeight && !/::/.test(rule.selectorText)
        && (rule.style.textOverflow === "ellipsis" || Number(rule.style.webkitLineClamp) > 0)) rules.push(rule);
    }
  };
  for (const sheet of document.styleSheets) visit(sheet.cssRules);
  const fixture = document.createElement("div");
  fixture.setAttribute("data-i18n-skip", "");
  fixture.style.cssText = "position:fixed;left:0;top:0;width:360px;background:var(--surface-primary);z-index:99999";
  document.body.append(fixture);
  const issues = [];
  let checks = 0;
  const previousTheme = document.documentElement.dataset.theme;
  try {
    for (const theme of ["light", "dark"]) {
      document.documentElement.dataset.theme = theme;
      for (const rule of rules) {
        const label = document.createElement("div");
        label.style.cssText = rule.style.cssText;
        // Only isolate typography, not component positioning or media dimensions.
        Object.assign(label.style, { position: "static", display: "block", width: "300px", height: "auto", minHeight: "0", maxHeight: "none", margin: "0", padding: "0", transform: "none", clipPath: "none", opacity: "1" });
        fixture.replaceChildren(label);
        for (const [fontSize, offset] of [["small", -1], ["default", 0], ["medium", 1], ["large", 2]]) {
          fixture.style.setProperty("--app-font-size-offset", `${offset}px`);
          for (const text of ["English gjpqy", "Ångström café", "简体中文", "繁體中文"]) {
            label.textContent = text;
            checks += 1;
            for (const issue of inspect(fixture)) issues.push({ selector: rule.selectorText, theme, fontPreset: fontSize, ...issue });
          }
        }
      }
    }
  } finally {
    if (previousTheme === undefined) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = previousTheme;
    fixture.remove();
  }
  return { rules: rules.length, checks, issues };
}
