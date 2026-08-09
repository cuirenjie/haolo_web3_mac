(() => {
  if (globalThis.__haoloPageAgentInstalled) return;
  globalThis.__haoloPageAgentInstalled = true;

  const MAX_ELEMENTS = 500;
  const MAX_LINKS = 250;
  const MAX_FORMS = 100;
  const SENSITIVE_PATTERN = /(password|passcode|passwd|otp|one.?time|2fa|mfa|cvv|cvc|card.?number|credit.?card|security.?code|webauthn|secret|token)/i;
  const EXTERNAL_EFFECT_PATTERN = /(?:send|submit|publish|post|delete|remove|purchase|buy|pay|checkout|confirm order|security|password|permission|recovery|2fa|mfa|发送|提交|发布|删除|移除|购买|支付|下单|确认订单|安全|密码|权限|恢复|二步验证)/i;
  const PRIVATE_SELECTOR = "[data-private], [data-sensitive], [data-1password-ignore], [data-lpignore='true']";
  const elementIds = new WeakMap();
  let elementSequence = 0;
  let frameId = 0;
  let lastTrustedUserInputAt = 0;

  for (const eventName of ["pointerdown", "keydown", "beforeinput"]) {
    addEventListener(eventName, (event) => {
      if (event.isTrusted) lastTrustedUserInputAt = Date.now();
    }, { capture: true, passive: true });
  }

  const frameReady = chrome.runtime.sendMessage({ source: "haolo-page-agent", type: "frame.register" })
    .then((response) => { if (Number.isInteger(response?.frameId)) frameId = response.frameId; })
    .catch(() => {});

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.source !== "haolo-extension") return false;
    void handleMessage(message)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({
        ok: false,
        error: {
          code: String(error?.code || "CHROME_PAGE_AGENT_ERROR"),
          message: String(error?.message || "Unable to read the page.").slice(0, 2_000),
          category: String(error?.category || "execution"),
          retryable: Boolean(error?.retryable),
        },
      }));
    return true;
  });

  async function handleMessage(message) {
    await frameReady;
    if (message.type === "read.page") return createSnapshot(message.options || {});
    if (message.type === "read.selection") return readSelection();
    if (message.type === "wait.for") return waitForCondition(message.condition || {}, message.timeoutMs);
    if (message.type === "action.click") return clickTarget(message.target || {});
    if (message.type === "action.type") return typeIntoTarget(message.target || {}, message.text, message.replace);
    if (message.type === "action.select") return selectTargetOption(message.target || {}, message.value);
    if (message.type === "action.scroll") return scrollTarget(message.target || null, message.deltaX, message.deltaY);
    if (message.type === "action.key") return pressAllowedKey(message.key);
    if (message.type === "action.external.prepare") return prepareExternalAction(message.action, message.target || {});
    if (message.type === "action.external.commit") return commitExternalAction(message.action, message.target || {}, message.expectedSignature || null);
    if (message.type === "action.upload.prepare") return prepareUploadTarget(message.target || {});
    if (message.type === "action.upload.complete") return completeUploadTarget(message.marker);
    throw createError("CHROME_PAGE_MESSAGE_UNKNOWN", `Unknown page request: ${String(message.type || "")}`, "protocol", false);
  }

  function createSnapshot(options) {
    const maxChars = clampInteger(options.maxChars, 1_000, 50_000, 24_000);
    const root = document.body || document.documentElement;
    const visibleText = collectVisibleText(root, maxChars);
    const elements = collectInteractiveElements();
    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      .filter(isVisible)
      .slice(0, 100)
      .map((element) => ({ level: Number(element.tagName.slice(1)), text: normalizedText(element.innerText, 500) }))
      .filter((entry) => entry.text);
    return {
      trust: "untrusted_web_content",
      instructionAuthority: "none",
      capturedAt: new Date().toISOString(),
      frameId,
      topFrame: globalThis === globalThis.top,
      title: normalizedText(document.title, 1_000),
      url: sanitizeUrl(location.href),
      origin: location.origin,
      lang: document.documentElement.lang || null,
      viewport: {
        width: Math.max(0, Math.round(globalThis.innerWidth || 0)),
        height: Math.max(0, Math.round(globalThis.innerHeight || 0)),
        scrollX: Math.round(globalThis.scrollX || 0),
        scrollY: Math.round(globalThis.scrollY || 0),
        documentWidth: Math.round(document.documentElement.scrollWidth || 0),
        documentHeight: Math.round(document.documentElement.scrollHeight || 0),
      },
      text: visibleText.text,
      truncated: visibleText.truncated,
      headings,
      elements,
      links: options.includeLinks === false ? [] : collectLinks(),
      forms: options.includeForms === false ? [] : collectForms(),
    };
  }

  function collectVisibleText(root, maxChars) {
    const chunks = [];
    let length = 0;
    let truncated = false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !isVisible(parent) || isPrivate(parent) || isSensitiveControl(parent)) return NodeFilter.FILTER_REJECT;
        const value = normalizedText(node.nodeValue, maxChars);
        return value ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    while (walker.nextNode()) {
      const value = normalizedText(walker.currentNode.nodeValue, maxChars);
      if (!value) continue;
      if (length + value.length + 1 > maxChars) {
        const remaining = Math.max(0, maxChars - length);
        if (remaining) chunks.push(value.slice(0, remaining));
        truncated = true;
        break;
      }
      chunks.push(value);
      length += value.length + 1;
    }
    return { text: chunks.join("\n"), truncated };
  }

  function collectInteractiveElements() {
    const selector = [
      "a[href]", "button", "input", "textarea", "select", "summary",
      "[role='button']", "[role='link']", "[role='checkbox']", "[role='radio']",
      "[role='tab']", "[role='menuitem']", "[contenteditable='true']", "[tabindex]",
    ].join(",");
    const results = [];
    for (const element of document.querySelectorAll(selector)) {
      if (results.length >= MAX_ELEMENTS) break;
      if (!isVisible(element) || isPrivate(element) || isSensitiveControl(element)) continue;
      const rect = element.getBoundingClientRect();
      const role = normalizedRole(element);
      const name = accessibleName(element);
      const entry = {
        element_id: idFor(element),
        role,
        name,
        tag: element.tagName.toLowerCase(),
        type: normalizedText(element.getAttribute("type"), 64) || null,
        disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
        rect: roundedRect(rect),
      };
      if (element instanceof HTMLAnchorElement) entry.href = sanitizeUrl(element.href);
      if (element instanceof HTMLSelectElement) {
        entry.options = [...element.options].slice(0, 100).map((option) => ({
          value: normalizedText(option.value, 500),
          label: normalizedText(option.label || option.text, 500),
          selected: option.selected,
        }));
      }
      results.push(entry);
    }
    return results;
  }

  function collectLinks() {
    return [...document.querySelectorAll("a[href]")]
      .filter((element) => isVisible(element) && !isPrivate(element))
      .slice(0, MAX_LINKS)
      .map((element) => ({ text: accessibleName(element), href: sanitizeUrl(element.href), element_id: idFor(element) }))
      .filter((entry) => entry.href);
  }

  function collectForms() {
    const controls = [...document.querySelectorAll("input, textarea, select")]
      .filter((element) => isVisible(element) && !isPrivate(element) && !isSensitiveControl(element))
      .slice(0, MAX_FORMS)
      .map((element) => ({
        element_id: idFor(element),
        role: normalizedRole(element),
        name: accessibleName(element),
        tag: element.tagName.toLowerCase(),
        type: normalizedText(element.getAttribute("type"), 64) || null,
        required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
        disabled: Boolean(element.disabled),
        value_present: Boolean("value" in element && String(element.value || "").length),
      }));
    return controls;
  }

  function readSelection() {
    const selection = globalThis.getSelection?.();
    return {
      trust: "untrusted_web_content",
      instructionAuthority: "none",
      url: sanitizeUrl(location.href),
      text: normalizedText(selection?.toString(), 10_000),
      collapsed: !selection || selection.isCollapsed,
    };
  }

  async function waitForCondition(condition, timeoutValue) {
    const timeoutMs = clampInteger(timeoutValue, 100, 30_000, 5_000);
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      const result = evaluateCondition(condition);
      if (result.matched) return { ...result, elapsedMs: Date.now() - startedAt };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw createError("CHROME_WAIT_TIMEOUT", "The requested page condition was not met before the timeout.", "timeout", true);
  }

  function evaluateCondition(condition) {
    if (condition.url_matches && !location.href.includes(String(condition.url_matches))) return { matched: false };
    if (condition.text_present && !normalizedText(document.body?.innerText, 100_000).includes(String(condition.text_present))) return { matched: false };
    if (condition.target) {
      const target = findTarget(condition.target);
      if (!target || !isVisible(target)) return { matched: false };
    }
    return { matched: true, url: sanitizeUrl(location.href) };
  }

  function findTarget(target) {
    if (target.element_id) {
      for (const element of document.querySelectorAll("*")) {
        if (elementIds.get(element) === target.element_id) return element;
      }
      if (![target.role, target.name, target.text].some((value) => String(value || "").trim())
        && !(Number.isFinite(target.x) && Number.isFinite(target.y))) return null;
    }
    if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
      const coordinateTarget = document.elementFromPoint(Number(target.x), Number(target.y));
      if (coordinateTarget) return coordinateTarget.closest?.("a[href], button, input, textarea, select, [role], [contenteditable='true']") || coordinateTarget;
    }
    const candidates = document.querySelectorAll("a[href], button, input, textarea, select, [role], [contenteditable='true']");
    const matches = [];
    for (const element of candidates) {
      if (target.role && normalizedRole(element) !== target.role) continue;
      if (target.name && accessibleName(element) !== target.name) continue;
      if (target.text && !normalizedText(element.innerText || element.textContent, 2_000).includes(normalizedText(target.text, 2_000))) continue;
      if (isVisible(element)) matches.push(element);
    }
    if (matches.length > 1) throw createError("CHROME_TARGET_AMBIGUOUS", "More than one visible element matches the requested target.", "execution", true);
    return matches[0] || null;
  }

  async function clickTarget(target) {
    assertNoRecentUserInput();
    const element = requireActionTarget(target);
    if (isExternalEffectControl(element)) {
      throw createError("CHROME_EXTERNAL_ACTION_REQUIRES_PREPARE", "This control may create an external side effect. Use prepare_external_action first.", "policy", false);
    }
    if (element.disabled || element.getAttribute("aria-disabled") === "true") {
      throw createError("CHROME_TARGET_DISABLED", "The requested element is disabled.", "execution", true);
    }
    const before = pageFingerprint();
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    element.focus({ preventScroll: true });
    element.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const after = pageFingerprint();
    return actionResult("click", element, before, after);
  }

  async function typeIntoTarget(target, textValue, replaceValue) {
    assertNoRecentUserInput();
    const element = requireActionTarget(target);
    if (isSensitiveControl(element)) throw createError("CHROME_SENSITIVE_CONTROL_BLOCKED", "Haolo will not type into password, OTP, payment, or secret fields.", "policy", false);
    const text = String(textValue || "");
    if (!text || text.length > 20_000) throw createError("CHROME_TEXT_INVALID", "Text must contain 1 to 20000 characters.", "validation", false);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) {
      throw createError("CHROME_TARGET_NOT_EDITABLE", "The requested target is not an editable control.", "execution", false);
    }
    if (element.disabled || element.readOnly) throw createError("CHROME_TARGET_DISABLED", "The requested control is disabled or read-only.", "execution", true);
    const before = pageFingerprint();
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    element.focus({ preventScroll: true });
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const nextValue = replaceValue === false ? `${element.value}${text}` : text;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, nextValue);
      else element.value = nextValue;
    } else {
      if (replaceValue !== false) element.textContent = "";
      element.textContent = `${element.textContent || ""}${text}`;
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: replaceValue === false ? "insertText" : "insertReplacementText", data: text }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await Promise.resolve();
    const after = pageFingerprint();
    return { ...actionResult("type_text", element, before, after), characters_written: text.length, value_returned: false };
  }

  async function selectTargetOption(target, valueInput) {
    assertNoRecentUserInput();
    const element = requireActionTarget(target);
    if (!(element instanceof HTMLSelectElement)) throw createError("CHROME_TARGET_NOT_SELECT", "The requested target is not a select control.", "execution", false);
    if (element.disabled) throw createError("CHROME_TARGET_DISABLED", "The requested select control is disabled.", "execution", true);
    const value = String(valueInput || "");
    const option = [...element.options].find((candidate) => candidate.value === value || normalizedText(candidate.label || candidate.text, 2_000) === value);
    if (!option) throw createError("CHROME_OPTION_NOT_FOUND", "The requested option is not available.", "execution", true);
    const before = pageFingerprint();
    element.value = option.value;
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await Promise.resolve();
    const after = pageFingerprint();
    return { ...actionResult("select_option", element, before, after), selected_value: normalizedText(option.value, 500), selected_label: normalizedText(option.label || option.text, 500) };
  }

  async function scrollTarget(target, deltaXValue, deltaYValue) {
    assertNoRecentUserInput();
    const deltaX = clampInteger(deltaXValue, -10_000, 10_000, 0);
    const deltaY = clampInteger(deltaYValue, -10_000, 10_000, 0);
    const element = target ? requireActionTarget(target) : document.scrollingElement || document.documentElement;
    const before = pageFingerprint();
    if (element === document.scrollingElement || element === document.documentElement || element === document.body) globalThis.scrollBy({ left: deltaX, top: deltaY, behavior: "instant" });
    else element.scrollBy({ left: deltaX, top: deltaY, behavior: "instant" });
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const after = pageFingerprint();
    return { ...actionResult("scroll", element, before, after), scroll_x: Math.round(globalThis.scrollX), scroll_y: Math.round(globalThis.scrollY) };
  }

  async function pressAllowedKey(keyInput) {
    assertNoRecentUserInput();
    const key = String(keyInput || "");
    const before = pageFingerprint();
    const active = document.activeElement instanceof Element ? document.activeElement : document.body;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"].includes(key)) {
      const distance = key.startsWith("Page") ? Math.round(innerHeight * 0.8) : key === "Home" || key === "End" ? 0 : 80;
      if (key === "Home") scrollTo({ top: 0, behavior: "instant" });
      else if (key === "End") scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
      else scrollBy({
        left: key === "ArrowLeft" ? -distance : key === "ArrowRight" ? distance : 0,
        top: key === "ArrowUp" || key === "PageUp" ? -distance : key === "ArrowDown" || key === "PageDown" ? distance : 0,
        behavior: "instant",
      });
    } else if (key === "Tab" || key === "Shift+Tab") {
      moveFocus(key === "Shift+Tab" ? -1 : 1);
    } else if (key === "Escape") {
      active.blur?.();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    } else if (key === "Enter") {
      if (isExternalEffectControl(active)) throw createError("CHROME_EXTERNAL_ACTION_REQUIRES_PREPARE", "Enter may trigger an external side effect on the focused control.", "policy", false);
      active.click?.();
    } else if (key === "Ctrl+A" && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
      active.select();
    } else {
      throw createError("CHROME_KEY_UNSUPPORTED", "This key requires browser-level input and is not available in the structured page agent.", "execution", false);
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    const after = pageFingerprint();
    return actionResult("press_key", active, before, after);
  }

  function prepareExternalAction(actionValue, target) {
    assertNoRecentUserInput();
    const action = String(actionValue || "");
    if (!["submit", "send", "publish", "delete", "purchase"].includes(action)) {
      throw createError("CHROME_EXTERNAL_ACTION_INVALID", "The external action type is not supported.", "validation", false);
    }
    const element = requireActionTarget(target);
    if (!isExternalEffectControl(element)) {
      throw createError("CHROME_EXTERNAL_TARGET_NOT_RISKY", "The target is not recognized as an external-effect control.", "policy", false);
    }
    if (element.disabled || element.getAttribute("aria-disabled") === "true") {
      throw createError("CHROME_TARGET_DISABLED", "The requested element is disabled.", "execution", true);
    }
    return {
      prepared: true,
      action,
      target: targetDescriptor(element),
      target_signature: targetSignature(element),
      page: pageFingerprint(),
      prepared_at: new Date().toISOString(),
    };
  }

  async function commitExternalAction(actionValue, target, expectedSignature) {
    assertNoRecentUserInput();
    const element = requireActionTarget(target);
    if (!isExternalEffectControl(element)) {
      throw createError("CHROME_EXTERNAL_TARGET_CHANGED", "The target no longer represents the approved external action.", "policy", false);
    }
    const actualSignature = targetSignature(element);
    if (!expectedSignature || JSON.stringify(actualSignature) !== JSON.stringify(expectedSignature)) {
      throw createError("CHROME_EXTERNAL_TARGET_CHANGED", "The target changed after approval. Prepare the action again.", "policy", false);
    }
    if (element.disabled || element.getAttribute("aria-disabled") === "true") {
      throw createError("CHROME_TARGET_DISABLED", "The requested element is disabled.", "execution", true);
    }
    const before = pageFingerprint();
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    element.focus({ preventScroll: true });
    element.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const after = pageFingerprint();
    return { ...actionResult(String(actionValue || "external_write"), element, before, after), committed: true };
  }

  function prepareUploadTarget(target) {
    assertNoRecentUserInput();
    const element = requireActionTarget(target);
    if (!(element instanceof HTMLInputElement) || element.type !== "file") {
      throw createError("CHROME_UPLOAD_TARGET_INVALID", "The requested target is not a file input.", "execution", false);
    }
    if (element.disabled) throw createError("CHROME_TARGET_DISABLED", "The file input is disabled.", "execution", true);
    const marker = `hu_${crypto.randomUUID().replaceAll("-", "")}`;
    element.setAttribute("data-haolo-upload-token", marker);
    return {
      prepared: true,
      marker,
      target: targetDescriptor(element),
      target_signature: targetSignature(element),
      accepts: normalizedText(element.accept, 1_000) || null,
      multiple: Boolean(element.multiple),
      page: pageFingerprint(),
      prepared_at: new Date().toISOString(),
    };
  }

  function completeUploadTarget(markerValue) {
    assertNoRecentUserInput();
    const marker = String(markerValue || "");
    const element = document.querySelector(`[data-haolo-upload-token="${cssEscape(marker)}"]`);
    if (!(element instanceof HTMLInputElement) || element.type !== "file") {
      throw createError("CHROME_UPLOAD_TARGET_CHANGED", "The approved file input is no longer available.", "execution", false);
    }
    element.removeAttribute("data-haolo-upload-token");
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return {
      action: "upload_file",
      target: targetDescriptor(element),
      file_count: element.files?.length || 0,
      file_names_returned: false,
      verified_at: new Date().toISOString(),
    };
  }

  function requireActionTarget(target) {
    const element = findTarget(target || {});
    if (!element || !isVisible(element)) throw createError("CHROME_TARGET_NOT_FOUND", "The target element is missing or no longer visible. Read the page again and retry once.", "execution", true);
    if (isPrivate(element)) throw createError("CHROME_PRIVATE_CONTROL_BLOCKED", "The requested element is marked private.", "policy", false);
    return element;
  }

  function assertNoRecentUserInput() {
    if (Date.now() - lastTrustedUserInputAt < 1_500) {
      throw createError("CHROME_USER_TAKEOVER", "The user just interacted with this page. The automated action was stopped before execution.", "cancelled", true);
    }
  }

  function isExternalEffectControl(element) {
    if (!(element instanceof Element)) return false;
    const type = normalizedText(element.getAttribute("type"), 64).toLowerCase();
    if (element.closest?.("form") && ["submit", "image"].includes(type)) return true;
    return EXTERNAL_EFFECT_PATTERN.test(`${accessibleName(element)} ${normalizedText(element.innerText || element.textContent, 500)}`);
  }

  function moveFocus(direction) {
    const focusable = [...document.querySelectorAll("a[href], button, input, textarea, select, [tabindex], [contenteditable='true']")]
      .filter((element) => isVisible(element) && !element.disabled && Number(element.getAttribute("tabindex") || 0) >= 0);
    if (!focusable.length) return;
    const current = focusable.indexOf(document.activeElement);
    const next = current < 0 ? (direction > 0 ? 0 : focusable.length - 1) : (current + direction + focusable.length) % focusable.length;
    focusable[next].focus({ preventScroll: false });
  }

  function pageFingerprint() {
    return {
      url: sanitizeUrl(location.href),
      title: normalizedText(document.title, 1_000),
      text_sample: normalizedText(document.body?.innerText, 2_000),
      scroll_x: Math.round(globalThis.scrollX || 0),
      scroll_y: Math.round(globalThis.scrollY || 0),
      active_element_id: document.activeElement instanceof Element ? idFor(document.activeElement) : null,
    };
  }

  function actionResult(action, element, before, after) {
    return {
      action,
      target: element instanceof Element ? { element_id: idFor(element), role: normalizedRole(element), name: accessibleName(element) } : null,
      before,
      after,
      changed: JSON.stringify(before) !== JSON.stringify(after),
      verified_at: new Date().toISOString(),
    };
  }

  function targetDescriptor(element) {
    return { element_id: idFor(element), role: normalizedRole(element), name: accessibleName(element) };
  }

  function targetSignature(element) {
    const form = element.closest?.("form");
    return {
      element_id: idFor(element),
      role: normalizedRole(element),
      name: accessibleName(element),
      tag: element.tagName.toLowerCase(),
      type: normalizedText(element.getAttribute("type"), 64).toLowerCase() || null,
      form_action: form ? sanitizeUrl(form.action || location.href) : null,
      form_method: form ? normalizedText(form.method, 16).toLowerCase() : null,
    };
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isPrivate(element) {
    return Boolean(element.closest?.(PRIVATE_SELECTOR));
  }

  function isSensitiveControl(element) {
    const control = element.closest?.("input, textarea, select") || (element.matches?.("input, textarea, select") ? element : null);
    if (!control) return false;
    const descriptor = [
      control.getAttribute("type"), control.getAttribute("name"), control.id,
      control.getAttribute("autocomplete"), control.getAttribute("aria-label"), control.placeholder,
    ].filter(Boolean).join(" ");
    return control.type === "password" || SENSITIVE_PATTERN.test(descriptor);
  }

  function normalizedRole(element) {
    const explicit = normalizedText(element.getAttribute("role"), 64);
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "input") {
      if (["checkbox", "radio", "button", "submit", "reset"].includes(element.type)) return element.type === "submit" || element.type === "reset" ? "button" : element.type;
      return "textbox";
    }
    return tag;
  }

  function accessibleName(element) {
    const labelledBy = normalizedText(element.getAttribute("aria-labelledby"), 500);
    const labelledText = labelledBy
      ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
      : "";
    const explicitLabel = element.id ? document.querySelector(`label[for="${cssEscape(element.id)}"]`)?.innerText : "";
    return normalizedText(
      element.getAttribute("aria-label") || labelledText || explicitLabel || element.alt || element.title || element.innerText || element.placeholder,
      1_000,
    );
  }

  function idFor(element) {
    let value = elementIds.get(element);
    if (!value) {
      elementSequence += 1;
      value = `hf_${frameId}_${elementSequence.toString(36)}`;
      elementIds.set(element, value);
    }
    return value;
  }

  function roundedRect(rect) {
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  }

  function sanitizeUrl(value) {
    try {
      const parsed = new URL(String(value || ""), location.href);
      if (!/^https?:$/.test(parsed.protocol)) return null;
      parsed.username = "";
      parsed.password = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return null;
    }
  }

  function normalizedText(value, maxLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  function cssEscape(value) {
    return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  }

  function createError(code, message, category, retryable) {
    const error = new Error(message);
    error.code = code;
    error.category = category;
    error.retryable = retryable;
    return error;
  }
})();
