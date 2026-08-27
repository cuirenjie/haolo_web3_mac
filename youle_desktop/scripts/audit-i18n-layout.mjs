import { app, BrowserWindow } from "electron/main";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectTextClipping, inspectClippedLabelStyles } from "./text-clipping-audit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = path.join(ROOT, "dist", "renderer", "index.html");
const DEV_URL = process.env.HAOLO_I18N_LAYOUT_QA_URL;
const OUTPUT = path.resolve(process.env.HAOLO_I18N_LAYOUT_QA_DIR || path.join(ROOT, ".tmp", "i18n-layout-qa"));
const QUICK_ENGLISH_BUTTON_AUDIT = process.env.HAOLO_I18N_BUTTON_QA_QUICK === "1";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

mkdirSync(path.join(OUTPUT, "profile"), { recursive: true });
app.setPath("userData", path.join(OUTPUT, "profile"));
app.commandLine.appendSwitch("disable-gpu");

async function waitFor(targetWindow, selector, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await targetWindow.webContents.executeJavaScript(
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) >= 0.05 && rect.width > 0 && rect.height > 0;
      })()`,
      true,
    ).catch(() => false);
    if (found) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function waitForGone(targetWindow, selector, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const gone = await targetWindow.webContents.executeJavaScript(
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return true;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05 || rect.width <= 0 || rect.height <= 0;
      })()`,
      true,
    ).catch(() => false);
    if (gone) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for ${selector} to close`);
}

async function nativeClick(targetWindow, selector) {
  const target = await targetWindow.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`, true);
  if (!target) throw new Error(`Cannot click missing element ${selector}`);
  // CDP takes CSS pixels; multiplying by Electron zoom clicks the wrong control.
  const { x, y } = target;
  if (!targetWindow.webContents.debugger.isAttached()) {
    targetWindow.webContents.debugger.attach("1.3");
  }
  await targetWindow.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
  });
  await targetWindow.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await targetWindow.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await delay(100);
}

async function click(targetWindow, selector) {
  const clicked = await targetWindow.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`, true);
  if (!clicked) throw new Error(`Cannot click missing element ${selector}`);
  await delay(100);
}

async function settle(targetWindow, theme, fontSize) {
  await targetWindow.webContents.executeJavaScript(`new Promise((resolve) => {
    let style = document.getElementById("i18n-layout-qa-motion");
    if (!style) {
      style = document.createElement("style");
      style.id = "i18n-layout-qa-motion";
      style.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }";
      document.head.append(style);
    }
    document.documentElement.dataset.theme = ${JSON.stringify(theme)};
    document.documentElement.dataset.fontSize = ${JSON.stringify(fontSize)};
    void document.body.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })`, true);
  await delay(30);
}

async function switchLanguage(targetWindow, language) {
  if (!await targetWindow.webContents.executeJavaScript("Boolean(document.querySelector('.settings-dialog'))", true)) {
    await nativeClick(targetWindow, '[data-action="open-settings"]');
    await waitFor(targetWindow, ".settings-dialog");
  }
  await nativeClick(targetWindow, ".settings-language-select [data-haolo-select-trigger]");
  await waitFor(targetWindow, ".settings-language-select [data-haolo-select-menu]");
  await nativeClick(targetWindow, `.settings-language-select [data-haolo-select-value="${language}"]`);
  await waitFor(targetWindow, `.settings-dialog`);
  const applied = await targetWindow.webContents.executeJavaScript(`(() => ({
    language: document.documentElement.dataset.language,
    lang: document.documentElement.lang,
    selectedValue: document.querySelector("[data-settings-language]")?.value,
    selectedLabel: document.querySelector(".settings-language-select [data-haolo-select-label]")?.textContent?.trim(),
    optionLabels: Array.from(document.querySelectorAll(".settings-language-select [data-haolo-select-value]"), (option) => option.textContent.trim()),
    storedValue: localStorage.getItem("haolo.appearance.language"),
  }))()`,
    true,
  );
  const expectedLang = language === "en" ? "en-US" : language;
  const nativeLabels = { en: "English", "zh-CN": "简体中文", "zh-TW": "繁體中文" };
  if (
    applied.selectedLabel !== nativeLabels[language] ||
    JSON.stringify(applied.optionLabels) !== JSON.stringify(Object.values(nativeLabels))
  ) {
    throw new Error(`Language choices lost their native names: ${JSON.stringify(applied)}`);
  }
  if (
    applied.language !== language ||
    applied.lang !== expectedLang ||
    applied.selectedValue !== language ||
    applied.storedValue !== language
  ) {
    throw new Error(`Language did not switch to ${language}: ${JSON.stringify(applied)}`);
  }
  await nativeClick(targetWindow, ".settings-close-button");
  await waitForGone(targetWindow, ".settings-dialog");
  await delay(80);
}

async function verifyLanguageSurvivesReload(targetWindow, language) {
  await switchLanguage(targetWindow, language);
  await targetWindow.reload();
  await waitFor(targetWindow, ".titlebar-profile");
  const restored = await targetWindow.webContents.executeJavaScript(`(() => ({
    language: document.documentElement.dataset.language,
    lang: document.documentElement.lang,
    storedValue: localStorage.getItem("haolo.appearance.language"),
  }))()`, true);
  const expectedLang = language === "en" ? "en-US" : language;
  if (restored.language !== language || restored.lang !== expectedLang || restored.storedValue !== language) {
    throw new Error(`Language did not survive reload: ${JSON.stringify(restored)}`);
  }
}

async function verifyLanguageTransitionMatrix(targetWindow) {
  const languages = ["en", "zh-CN", "zh-TW"];
  for (const source of languages) {
    await switchLanguage(targetWindow, source);
    for (const target of languages) {
      if (target === source) continue;
      await switchLanguage(targetWindow, target);
      await switchLanguage(targetWindow, source);
    }
  }
}

async function returnHome(targetWindow) {
  const hasHomeButton = await targetWindow.webContents.executeJavaScript(
    "Boolean(document.querySelector('.page-home-button'))",
    true,
  );
  if (hasHomeButton) {
    await click(targetWindow, ".page-home-button");
    await waitForGone(targetWindow, ".consumption-page, .trading-alerts-page");
  }
  const profileOpen = await targetWindow.webContents.executeJavaScript(
    "Boolean(document.querySelector('.profile-menu'))",
    true,
  );
  if (profileOpen) {
    await click(targetWindow, ".popover-backdrop");
    await waitForGone(targetWindow, ".profile-menu");
  }
}

async function openSurface(targetWindow, surface) {
  await returnHome(targetWindow);
  if (surface === "home") return "#app";
  if (surface === "auto-task" || surface === "auto-task-frequency") {
    await nativeClick(targetWindow, '[data-action="toggle-external-channel-menu"]');
    await nativeClick(targetWindow, '[data-action="open-auto-task-dialog"]');
    await waitFor(targetWindow, ".auto-task-dialog");
    if (surface === "auto-task-frequency") await nativeClick(targetWindow, '[data-auto-task-picker="frequency"]');
    return ".auto-task-dialog";
  }
  if (surface === "profile") {
    await click(targetWindow, ".titlebar-profile");
    await waitFor(targetWindow, ".profile-menu");
    return ".profile-menu";
  }
  if (surface === "settings" || surface === "settings-profile") {
    await click(targetWindow, '[data-action="open-settings"]');
    await waitFor(targetWindow, ".settings-dialog");
    if (surface === "settings-profile") {
      await click(targetWindow, '[data-settings-tab="profile"]');
      await waitFor(targetWindow, ".settings-profile-panel");
    } else {
      await click(targetWindow, '[data-settings-tab="general"]');
      await waitFor(targetWindow, ".settings-general-list");
    }
    return ".settings-dialog";
  }
  if (surface === "consumption") {
    await click(targetWindow, '[data-action="open-settings"]');
    await waitFor(targetWindow, ".settings-dialog");
    await click(targetWindow, '[data-action="open-consumption"]');
    await waitFor(targetWindow, '.consumption-page[aria-busy="false"]');
    return ".consumption-page";
  }
  await click(targetWindow, '[data-conversation-static-action="plans"]');
  await waitFor(targetWindow, ".planning-primary-tabs");
  await click(targetWindow, '[data-planning-section="alerts"]');
  await waitFor(targetWindow, ".trading-alert-card");
  return ".trading-alerts-page";
}

async function verifyTextClippingDetector(targetWindow) {
  const result = await targetWindow.webContents.executeJavaScript(`(() => {
    const inspect = ${inspectTextClipping.toString()};
    const fixture = document.createElement("div");
    fixture.style.cssText = "position:fixed;inset:0 auto auto 0;width:280px;background:var(--surface-primary);z-index:9999;clip-path:inset(0 round 4px)";
    // The language picker intentionally skips translation. Geometry must not skip it.
    fixture.innerHTML = '<span data-i18n-skip translate="no" style="display:block;width:120px;overflow:hidden;white-space:nowrap;font:16px/1 Microsoft YaHei, sans-serif">English gjpqy</span>';
    document.body.append(fixture);
    const broken = inspect(fixture);
    fixture.firstElementChild.style.lineHeight = "1.5";
    const repaired = inspect(fixture);
    // Horizontal ellipsis and completely scrolled-out lines are intentional.
    fixture.firstElementChild.style.width = "35px";
    fixture.firstElementChild.style.textOverflow = "ellipsis";
    const ellipsis = inspect(fixture);
    fixture.remove();
    return { broken, repaired, ellipsis };
  })()`, true);
  if (!result.broken.some((issue) => issue.bottomLoss > 0.5) || result.repaired.length || result.ellipsis.length) {
    throw new Error(`Glyph clipping detector self-test failed: ${JSON.stringify(result)}`);
  }
}

async function inspectSelectStates(targetWindow, name, capture) {
  const debuggerApi = targetWindow.webContents.debugger;
  if (!debuggerApi.isAttached()) debuggerApi.attach("1.3");
  await debuggerApi.sendCommand("DOM.enable");
  await debuggerApi.sendCommand("CSS.enable");
  const { root } = await debuggerApi.sendCommand("DOM.getDocument");
  const triggerSelector = ".settings-language-select [data-haolo-select-trigger]";
  const optionSelector = '.settings-language-select [aria-selected="true"]';
  const { nodeId: triggerId } = await debuggerApi.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: triggerSelector });
  const { nodeId: optionId } = await debuggerApi.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: optionSelector });
  await debuggerApi.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
  const states = [];
  const inspect = async (state, selector = triggerSelector) => {
    // Let the compositor paint the new pseudo/disabled/menu state before capture.
    await targetWindow.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);
    const result = await targetWindow.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const style = getComputedStyle(element);
      return {
        textClipping: (${inspectTextClipping.toString()})(document.querySelector('.settings-language-select')),
        color: style.color, background: style.backgroundColor, border: style.borderColor,
        outline: style.outline, boxShadow: style.boxShadow, opacity: style.opacity,
        expanded: document.querySelector(${JSON.stringify(triggerSelector)}).getAttribute('aria-expanded'),
      };
    })()`, true);
    states.push({ state, ...result });
    if (capture) await writeFile(path.join(OUTPUT, `${name}-${state}.png`), (await targetWindow.webContents.capturePage()).toPNG());
  };
  try {
    for (const [state, forcedPseudoClasses] of [["default", []], ["hover", ["hover"]], ["active", ["hover", "active"]], ["focus", ["focus", "focus-visible"]]]) {
      await debuggerApi.sendCommand("CSS.forcePseudoState", { nodeId: triggerId, forcedPseudoClasses });
      await inspect(state);
    }
    await debuggerApi.sendCommand("CSS.forcePseudoState", { nodeId: triggerId, forcedPseudoClasses: [] });
    await targetWindow.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(triggerSelector)}).disabled = true`, true);
    await inspect("disabled");
    await targetWindow.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(triggerSelector)}).disabled = false`, true);
    await nativeClick(targetWindow, triggerSelector);
    await inspect("open");
    if (states.at(-1).expanded !== "true") throw new Error(`Language menu did not open at zoom ${targetWindow.webContents.getZoomFactor()}`);
    for (const [state, forcedPseudoClasses] of [["option-selected", []], ["option-hover", ["hover"]], ["option-focus", ["focus", "focus-visible"]]]) {
      await debuggerApi.sendCommand("CSS.forcePseudoState", { nodeId: optionId, forcedPseudoClasses });
      await inspect(state, optionSelector);
    }
    await debuggerApi.sendCommand("CSS.forcePseudoState", { nodeId: optionId, forcedPseudoClasses: [] });
    await targetWindow.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(optionSelector)}).disabled = true`, true);
    await inspect("option-disabled", optionSelector);
  } finally {
    await debuggerApi.sendCommand("CSS.forcePseudoState", { nodeId: triggerId, forcedPseudoClasses: [] });
    await debuggerApi.sendCommand("CSS.forcePseudoState", { nodeId: optionId, forcedPseudoClasses: [] });
    await targetWindow.webContents.executeJavaScript(`(() => {
      const trigger = document.querySelector(${JSON.stringify(triggerSelector)});
      trigger.disabled = false;
      document.querySelector(${JSON.stringify(optionSelector)}).disabled = false;
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      trigger.blur();
    })()`, true);
  }
  return states;
}

async function inspectLayout(targetWindow, scopeSelector) {
  return targetWindow.webContents.executeJavaScript(`(() => {
    const scope = document.querySelector(${JSON.stringify(scopeSelector)});
    if (!scope) return { missing: true, overlaps: [], overflow: [], escapedChildren: [], englishButtonIssues: [], languageResidue: [], textClipping: [] };
    const shown = (element) => {
      let current = element;
      while (current && current !== document.documentElement) {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) return false;
        current = current.parentElement;
      }
      return true;
    };
    if (!shown(scope)) return { missing: false, hidden: true, overlaps: [], overflow: [], escapedChildren: [], englishButtonIssues: [], languageResidue: [], textClipping: [] };
    const compact = (element) => {
      const text = String(element?.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 72);
      const tag = element?.tagName?.toLowerCase?.() || "?";
      const classes = [...(element?.classList || [])].slice(0, 3).join(".");
      return { element: classes ? tag + "." + classes : tag, text };
    };
    const containerSelector = [
      ".profile-menu", ".profile-stats", ".profile-level-row", ".profile-token-row",
      ".profile-token-balance", ".profile-subscription-row", ".profile-subscription-row > strong",
      ".settings-dialog", ".settings-side", ".settings-main", ".settings-nav-item",
      ".consumption-page", ".consumption-header", ".consumption-profile-card", ".consumption-profile-person",
      ".consumption-metric", ".consumption-calendar-card", ".consumption-calendar-grid", ".consumption-day",
      ".consumption-records-card", ".consumption-table-wrap", ".consumption-detail-title",
      ".trading-alerts-page", ".trading-alert-card", ".trading-alert-card-head",
      ".trading-alert-plan-condition"
    ].join(",");
    const containers = [...scope.querySelectorAll(containerSelector)].filter(shown);
    if (scope.matches(containerSelector)) containers.unshift(scope);
    const overflow = containers.flatMap((element) => {
      const style = getComputedStyle(element);
      const handlesX = ["auto", "scroll", "hidden", "clip"].includes(style.overflowX);
      const handlesY = ["auto", "scroll", "hidden", "clip"].includes(style.overflowY);
      const horizontal = !handlesX && element.scrollWidth > element.clientWidth + 1;
      const vertical = !handlesY && element.scrollHeight > element.clientHeight + 1;
      return horizontal || vertical
        ? [{ ...compact(element), horizontal, vertical, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }]
        : [];
    });
    const escapedChildren = containers.flatMap((element) => {
      const parent = element.getBoundingClientRect();
      const parentStyle = getComputedStyle(element);
      const handlesX = ["auto", "scroll", "hidden", "clip"].includes(parentStyle.overflowX);
      const handlesY = ["auto", "scroll", "hidden", "clip"].includes(parentStyle.overflowY);
      return [...element.children].flatMap((child) => {
        if (!shown(child)) return [];
        const style = getComputedStyle(child);
        if (style.position === "fixed" || style.display === "contents") return [];
        if (style.transform !== "none" && style.clipPath !== "none") return [];
        const rect = child.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return [];
        const escapedX = !handlesX && (rect.left < parent.left - 1 || rect.right > parent.right + 1);
        const escapedY = !handlesY && (rect.top < parent.top - 1 || rect.bottom > parent.bottom + 1);
        const escaped = escapedX || escapedY;
        return escaped ? [{ container: compact(element), child: compact(child), parent: { left: parent.left, top: parent.top, right: parent.right, bottom: parent.bottom }, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } }] : [];
      });
    });
    const skipText = ".conversation-row-title, .message-text, .markdown-body, [data-i18n-skip], [aria-hidden='true'], .consumption-skeleton";
    const clipTextRect = (owner, sourceRect) => {
      const clipped = { left: sourceRect.left, top: sourceRect.top, right: sourceRect.right, bottom: sourceRect.bottom };
      let current = owner;
      while (current && current !== document.documentElement) {
        const style = getComputedStyle(current);
        const bounds = current.getBoundingClientRect();
        if (["auto", "scroll", "hidden", "clip"].includes(style.overflowX)) {
          clipped.left = Math.max(clipped.left, bounds.left);
          clipped.right = Math.min(clipped.right, bounds.right);
        }
        if (["auto", "scroll", "hidden", "clip"].includes(style.overflowY)) {
          clipped.top = Math.max(clipped.top, bounds.top);
          clipped.bottom = Math.min(clipped.bottom, bounds.bottom);
        }
        if (clipped.right - clipped.left <= 1 || clipped.bottom - clipped.top <= 1) return null;
        current = current.parentElement;
      }
      return clipped;
    };
    const textRects = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = String(node.nodeValue || "").replace(/\\s+/g, " ").trim();
      const owner = node.parentElement;
      if (value && owner && shown(owner) && !owner.closest(skipText)) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const sourceRect of range.getClientRects()) {
          const rect = clipTextRect(owner, sourceRect);
          if (rect && rect.right - rect.left > 1 && rect.bottom - rect.top > 1) textRects.push({ owner, value: value.slice(0, 72), rect });
        }
      }
      node = walker.nextNode();
    }
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < textRects.length; leftIndex += 1) {
      const left = textRects[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < textRects.length; rightIndex += 1) {
        const right = textRects[rightIndex];
        if (left.owner === right.owner || left.owner.contains(right.owner) || right.owner.contains(left.owner)) continue;
        const width = Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left);
        const height = Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top);
        if (width <= 1 || height <= 2) continue;
        overlaps.push({ left: { ...compact(left.owner), text: left.value }, right: { ...compact(right.owner), text: right.value }, width, height });
        if (overlaps.length >= 30) break;
      }
      if (overlaps.length >= 30) break;
    }
    const englishButtonIssues = [];
    if (document.documentElement.dataset.language === "en") {
      for (const button of scope.querySelectorAll("button")) {
        if (!shown(button)) continue;
        const labelNodes = [];
        const labelWalker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
        let labelNode = labelWalker.nextNode();
        while (labelNode) {
          const owner = labelNode.parentElement;
          const value = String(labelNode.nodeValue || "").replace(/\s+/g, " ").trim();
          if (value && !owner?.closest?.('[aria-hidden="true"]')) labelNodes.push(labelNode);
          if (labelNodes.length > 1) break;
          labelNode = labelWalker.nextNode();
        }
        if (labelNodes.length !== 1 || !/[A-Za-z]/u.test(String(labelNodes[0].nodeValue || ""))) continue;
        const range = document.createRange();
        range.selectNodeContents(labelNodes[0]);
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1);
        const lines = [];
        for (const rect of rects) {
          if (!lines.some((top) => Math.abs(top - rect.top) <= 2)) lines.push(rect.top);
        }
        const bounds = button.getBoundingClientRect();
        const escaped = rects.some((rect) => rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1);
        const horizontalOverflow = button.scrollWidth > button.clientWidth + 1;
        const verticalOverflow = button.scrollHeight > button.clientHeight + 1;
        // Native language names skip the translation marker, but still need geometry checks.
        const tagged = button.hasAttribute("data-i18n-single-line")
          || Boolean(labelNodes[0].parentElement?.closest('[data-i18n-skip][translate="no"]'));
        if (!tagged || lines.length > 1 || escaped || horizontalOverflow || verticalOverflow) {
          englishButtonIssues.push({
            ...compact(button),
            tagged,
            lines: lines.length,
            escaped,
            horizontalOverflow,
            verticalOverflow,
            width: bounds.width,
            height: bounds.height,
          });
        }
      }
    }
    const languageResidue = [];
    if (document.documentElement.dataset.language === "en") {
      const han = /[\u3400-\u9fff]/u;
      const skipLanguageText = [
        "[data-i18n-skip]", "[contenteditable='true']", "textarea", "pre", "code",
        ".message-text", ".markdown-body", ".message-markdown", ".message-content-text",
        ".message-user-content", ".message-assistant-content", ".conversation-row-title",
        ".titlebar-profile-name", ".row-name-text", ".thread-history-entry-text",
        ".thread-history-option-text", ".composer-thread-reference-name", ".library-preview-content",
        ".settings-storage-copy strong"
      ].join(",");
      const skippedLanguageText = (element) => {
        if (element?.closest?.("[data-i18n-owned]")) return false;
        return Boolean(element?.closest?.(skipLanguageText));
      };
      const languageWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let languageNode = languageWalker.nextNode();
      while (languageNode && languageResidue.length < 20) {
        const value = String(languageNode.nodeValue || "").trim();
        if (value && han.test(value) && shown(languageNode.parentElement) && !skippedLanguageText(languageNode.parentElement)) {
          languageResidue.push({ kind: "text", value: value.slice(0, 72), ...compact(languageNode.parentElement) });
        }
        languageNode = languageWalker.nextNode();
      }
      for (const element of document.body.querySelectorAll("[aria-label], [title], [placeholder]")) {
        if (languageResidue.length >= 20 || !shown(element) || skippedLanguageText(element) || element.matches("tr[data-consumption-record-index]")) continue;
        for (const name of ["aria-label", "title", "placeholder"]) {
          const value = element.getAttribute(name) || "";
          if (han.test(value)) languageResidue.push({ kind: name, value: value.slice(0, 72), ...compact(element) });
        }
      }
    }
    return {
      missing: false,
      hidden: false,
      state: {
        language: document.documentElement.dataset.language || "",
        theme: document.documentElement.dataset.theme || "",
        fontSize: document.documentElement.dataset.fontSize || "",
      },
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      overlaps,
      overflow,
      escapedChildren,
      englishButtonIssues,
      languageResidue,
      textClipping: (${inspectTextClipping.toString()})(scope),
    };
  })()`, true);
}

async function main() {
  await mkdir(OUTPUT, { recursive: true });
  await app.whenReady();
  const targetWindow = new BrowserWindow({
    show: true,
    opacity: 0,
    skipTaskbar: true,
    width: 1440,
    height: 960,
    backgroundColor: "#111317",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, partition: `i18n-layout-qa-${Date.now()}` },
  });
  const records = [];
  const failures = [];
  let typography = null;
  let exitCode = 0;
  try {
    if (DEV_URL) {
      const url = new URL(DEV_URL);
      url.searchParams.set("i18n-layout-qa", "1");
      await targetWindow.loadURL(url.href);
    } else {
      await targetWindow.loadFile(INDEX, { query: { "i18n-layout-qa": "1" } });
    }
    targetWindow.webContents.setZoomFactor(1);
    await waitFor(targetWindow, ".titlebar-profile");
    await delay(500);
    await verifyTextClippingDetector(targetWindow);
    typography = await targetWindow.webContents.executeJavaScript(`(${inspectClippedLabelStyles.toString()})(${inspectTextClipping.toString()})`, true);
    process.stdout.write(`Typography: ${typography.checks} samples, ${typography.issues.length} clipped\n`);
    if (typography.issues.length) failures.push({ name: "clipped-label-typography", issues: typography.issues.map((issue) => `glyph clipped: ${issue.selector} ${issue.fontSize} ${issue.text}`), result: { textClipping: typography.issues } });
    for (const language of ["en", "zh-CN", "zh-TW"]) {
      await verifyLanguageSurvivesReload(targetWindow, language);
    }
    await verifyLanguageTransitionMatrix(targetWindow);
    const languages = QUICK_ENGLISH_BUTTON_AUDIT ? ["en"] : ["en", "zh-CN", "zh-TW"];
    const zooms = QUICK_ENGLISH_BUTTON_AUDIT ? [1, 1.5] : [1, 1.25, 1.5];
    const fontSizes = QUICK_ENGLISH_BUTTON_AUDIT ? ["large"] : ["small", "default", "medium", "large"];
    for (const language of languages) {
      await returnHome(targetWindow);
      const transitionSource = language === "en" ? "zh-TW" : language === "zh-CN" ? "en" : "zh-CN";
      await switchLanguage(targetWindow, transitionSource);
      await switchLanguage(targetWindow, language);
      for (const surface of ["home", "profile", "settings-profile", "settings", "auto-task", "auto-task-frequency", "consumption", "alerts"]) {
        process.stdout.write(`Auditing ${language} ${surface}\n`);
        const scopeSelector = await openSurface(targetWindow, surface);
        for (const zoom of zooms) {
          targetWindow.webContents.setZoomFactor(zoom);
          for (const fontSize of fontSizes) {
            for (const theme of ["light", "dark"]) {
              await settle(targetWindow, theme, fontSize);
              const result = await inspectLayout(targetWindow, scopeSelector);
              const name = `${language}-${surface}-${theme}-${fontSize}-${Math.round(zoom * 100)}`;
              const selectStates = surface === "settings" && zoom === 1.5
                ? await inspectSelectStates(targetWindow, name, language === "en" && fontSize === "large") : [];
              const entry = { name, language, surface, theme, fontSize, zoom, result, selectStates };
              records.push(entry);
              const issues = [
                ...(result.missing ? ["surface missing"] : []),
                ...(result.hidden ? ["surface hidden"] : []),
                ...(result.state?.language !== language ? [`language state mismatch: ${result.state?.language || "missing"}`] : []),
                ...(result.state?.theme !== theme ? [`theme state mismatch: ${result.state?.theme || "missing"}`] : []),
                ...(result.state?.fontSize !== fontSize ? [`font size state mismatch: ${result.state?.fontSize || "missing"}`] : []),
                ...(result.documentOverflow ? ["document horizontal overflow"] : []),
                ...result.overlaps.map((issue) => `text overlap: ${issue.left.text} / ${issue.right.text}`),
                ...result.overflow.map((issue) => `container overflow: ${issue.element} ${issue.text}`),
                ...result.escapedChildren.map((issue) => `child escaped: ${issue.container.element} -> ${issue.child.element}`),
                ...result.englishButtonIssues.map((issue) => `English button layout: ${issue.element} ${issue.text}`),
                ...result.languageResidue.map((issue) => `English UI residue: ${issue.kind} ${issue.value}`),
                ...result.textClipping.map((issue) => `glyph clipped: ${issue.element} ${issue.text}`),
                ...selectStates.flatMap((state) => state.textClipping.map((issue) => `glyph clipped (${state.state}): ${issue.element} ${issue.text}`)),
              ];
              if (issues.length) failures.push({ name, issues, result });
              if (language === "en" && fontSize === "large" && zoom === 1.5) {
                const image = await targetWindow.webContents.capturePage();
                await writeFile(path.join(OUTPUT, `${name}.png`), image.toPNG());
              }
            }
          }
        }
        targetWindow.webContents.setZoomFactor(1);
        await delay(100);
        if (surface === "profile") {
          await click(targetWindow, ".popover-backdrop");
          await waitForGone(targetWindow, ".profile-menu");
        } else if (surface.startsWith("settings")) {
          await click(targetWindow, ".settings-close-button");
          await waitForGone(targetWindow, ".settings-dialog");
        } else if (surface.startsWith("auto-task")) {
          await click(targetWindow, '[data-action="close-auto-task-dialog"]');
          await waitForGone(targetWindow, ".auto-task-dialog");
        }
      }
    }
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      index: INDEX,
      output: OUTPUT,
      auditedStates: records.length,
      auditedSelectStates: records.reduce((count, entry) => count + entry.selectStates.length, 0),
      typography,
      records,
      failures,
      status: failures.length ? "failed" : "passed",
    };
    await writeFile(path.join(OUTPUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ status: report.status, auditedStates: records.length, auditedSelectStates: report.auditedSelectStates, typographyChecks: typography.checks, failures: failures.length, output: OUTPUT }, null, 2)}\n`);
    if (failures.length) exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    await writeFile(path.join(OUTPUT, "fatal-error.log"), `${message}\n`, "utf8").catch(() => {});
    console.error(message);
    exitCode = 1;
  } finally {
    targetWindow.destroy();
    app.exit(exitCode);
  }
}

void main().catch(async (error) => {
  await mkdir(OUTPUT, { recursive: true }).catch(() => {});
  const message = error instanceof Error ? error.stack || error.message : String(error);
  await writeFile(path.join(OUTPUT, "fatal-error.log"), `${message}\n`, "utf8").catch(() => {});
  console.error(message);
  app.exit(1);
});
