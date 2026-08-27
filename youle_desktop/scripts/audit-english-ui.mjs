import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow } from "electron";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rendererEntry = path.join(packageRoot, "dist", "renderer", "index.html");
const auditResultPath = path.join(app.getPath("temp"), "haolo-english-ui-audit-result.json");

app.commandLine.appendSwitch("disable-gpu");
await app.whenReady();

const window = new BrowserWindow({
  show: false,
  width: 1440,
  height: 960,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    partition: `english-ui-audit-${process.pid}`,
  },
});

let exitCode = 0;
let auditResult = { ok: false, error: "Audit did not finish" };
try {
  console.log(`Loading English renderer audit: ${rendererEntry}`);
  await Promise.race([
    window.loadFile(rendererEntry),
    timeoutAfter(20_000, "Timed out loading the built renderer"),
  ]);
  console.log("Built renderer loaded; waiting for application content.");
  await waitForRenderer(window);
  const scenarios = [];
  scenarios.push(await collectEnglishUiAudit(window, "initial"));

  await clickAndWait(window, '[data-action="toggle-new-thread-group-picker"]', '.chat-title-group-menu');
  scenarios.push(await collectEnglishUiAudit(window, "composer-group-picker"));
  const noGroupLabel = await window.webContents.executeJavaScript(`document.querySelector('.chat-title-group-menu [data-new-thread-group-option]')?.textContent?.trim()`);
  if (noGroupLabel !== "No group") throw new Error(`Unexpected default group option: ${noGroupLabel}`);
  await clickAndWait(window, '[data-action="toggle-new-thread-group-picker"]', '#app', { waitForMissing: '.chat-title-group-menu' });

  await clickAndWait(window, '[data-action="open-auto-task-dialog"]', ".auto-task-dialog");
  scenarios.push(await collectEnglishUiAudit(window, "auto-task-dialog"));
  await clickAndWait(window, '[data-auto-task-picker="group"]', '[data-auto-task-group]');
  scenarios.push(await collectEnglishUiAudit(window, "automation-group-picker"));
  await clickAndWait(window, '[data-action="close-auto-task-dialog"]', "#app", { waitForMissing: ".auto-task-dialog" });

  await clickAndWait(window, '[data-conversation-static-action="skills"]', '[data-skills-plaza-tab="mySkills"]');
  scenarios.push(await collectEnglishUiAudit(window, "strategy-library"));
  await clickAndWait(window, '[data-skills-plaza-tab="indicators"]', '[data-skills-plaza-tab="indicators"][aria-pressed="true"]');
  scenarios.push(await collectEnglishUiAudit(window, "indicator-library"));

  const rechargeAvailable = await window.webContents.executeJavaScript(`Boolean(document.querySelector('[data-action="toggle-profile"]'))`);
  if (rechargeAvailable) {
    await clickAndWait(window, '[data-action="toggle-profile"]', '[data-action="profile-quota"]');
    await clickAndWait(window, '[data-action="profile-quota"]', ".recharge-page");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    scenarios.push(await collectEnglishUiAudit(window, "recharge"));
    const paymentNetworkIds = await window.webContents.executeJavaScript(`Array.from(
      document.querySelectorAll('input[name="recharge-payment-network"]'),
      (input) => input.value,
    )`);
    for (const networkId of paymentNetworkIds) {
      const selected = await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector(
          'input[name="recharge-payment-network"][value="' + CSS.escape(${JSON.stringify(networkId)}) + '"]',
        );
        if (!input) return false;
        input.click();
        return true;
      })()`);
      if (!selected) throw new Error(`Audit could not select recharge payment network: ${networkId}`);
      await new Promise((resolve) => setTimeout(resolve, 750));
      scenarios.push(await collectEnglishUiAudit(window, `recharge-${networkId}`));
    }
  }

  const result = {
    language: scenarios[0]?.language,
    locale: scenarios[0]?.locale,
    violations: scenarios.flatMap((scenario) => scenario.violations.map((violation) => ({
      scenario: scenario.name,
      ...violation,
    }))),
    scenarios: scenarios.map((scenario) => ({
      name: scenario.name,
      cardCount: scenario.cardCount,
      violations: scenario.violations.length,
    })),
  };
  if (result.language !== "en" || result.locale !== "en-US") {
    throw new Error(`English locale did not initialize: ${JSON.stringify(result)}`);
  }
  if (result.violations.length) {
    throw new Error(`Chinese text remains in the English UI:\n${JSON.stringify(result.violations, null, 2)}`);
  }
  const strategyScenario = scenarios.find((scenario) => scenario.name === "strategy-library");
  const indicatorScenario = scenarios.find((scenario) => scenario.name === "indicator-library");
  if (!strategyScenario?.cardCount || !indicatorScenario?.cardCount) {
    throw new Error(`Strategy or indicator cards did not render during audit: ${JSON.stringify(result.scenarios)}`);
  }
  auditResult = { ok: true, ...result };
  console.log("English UI audit passed across default, automation, strategy, indicator, and recharge surfaces.");
} catch (error) {
  exitCode = 1;
  auditResult = {
    ok: false,
    error: error instanceof Error ? error.stack || error.message : String(error),
  };
} finally {
  fs.writeFileSync(auditResultPath, `${JSON.stringify(auditResult, null, 2)}\n`, "utf8");
  window.destroy();
  app.exit(exitCode);
}

async function collectEnglishUiAudit(targetWindow, name) {
  return targetWindow.webContents.executeJavaScript(`(() => {
    const han = /[\\u3400-\\u9fff]/u;
    const skipSelector = [
      "[data-i18n-skip]",
      "[contenteditable='true']",
      "textarea",
      "pre",
      "code",
      ".message-text",
      ".markdown-body",
      ".message-markdown",
      ".message-content-text",
      ".message-user-content",
      ".message-assistant-content",
      ".conversation-row-title",
      ".titlebar-profile-name",
      ".row-name-text",
      ".thread-history-entry-text",
      ".thread-history-option-text",
      ".composer-thread-reference-name",
      ".library-preview-content",
      ".settings-storage-copy strong"
    ].join(",");
    const skipped = (element) => {
      if (element?.closest?.("[data-i18n-owned]")) return false;
      return Boolean(element?.closest?.(skipSelector));
    };
    const skippedAttribute = (element) => {
      if (element?.closest?.("[data-i18n-owned]")) return false;
      if (element?.matches?.("textarea")) return Boolean(element.closest?.("[data-i18n-skip]"));
      return skipped(element);
    };
    const violations = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = String(node.nodeValue || "").trim();
      if (value && han.test(value) && !skipped(node.parentElement)) {
        violations.push({ kind: "text", value, element: node.parentElement?.outerHTML?.slice(0, 240) || "" });
      }
      node = walker.nextNode();
    }
    for (const element of document.body.querySelectorAll("[aria-label], [title], [placeholder]")) {
      if (skippedAttribute(element)) continue;
      for (const name of ["aria-label", "title", "placeholder"]) {
        const value = element.getAttribute(name) || "";
        if (han.test(value)) violations.push({ kind: name, value, element: element.outerHTML.slice(0, 240) });
      }
    }
    for (const element of document.body.querySelectorAll("*")) {
      if (skipped(element)) continue;
      for (const pseudo of ["::before", "::after"]) {
        const value = getComputedStyle(element, pseudo).content || "";
        if (han.test(value)) violations.push({ kind: pseudo, value, element: element.outerHTML.slice(0, 240) });
      }
    }
    return {
      name: ${JSON.stringify(name)},
      language: document.documentElement.dataset.language,
      locale: document.documentElement.lang,
      cardCount: document.querySelectorAll(".my-skill-card").length,
      violations,
    };
  })()`);
}

async function clickAndWait(targetWindow, selector, waitForSelector, options = {}) {
  const clicked = await targetWindow.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Audit could not find element to click: ${selector}`);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const ready = await targetWindow.webContents.executeJavaScript(`(() => {
      const required = Boolean(document.querySelector(${JSON.stringify(waitForSelector)}));
      const missing = ${JSON.stringify(options.waitForMissing || "")};
      return required && (!missing || !document.querySelector(missing));
    })()`).catch(() => false);
    if (ready) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Audit timed out after clicking ${selector}; expected ${waitForSelector}`);
}

async function waitForRenderer(targetWindow) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const ready = await targetWindow.webContents.executeJavaScript(`Boolean(
      document.documentElement.dataset.language === "en"
      && document.querySelector("#app")?.textContent?.trim().length > 80
    )`).catch(() => false);
    if (ready) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the renderer to initialize");
}

function timeoutAfter(milliseconds, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref?.();
  });
}
