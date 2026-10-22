import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const rendererSource = (await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const stylesSource = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const preloadSource = await readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../src/main/youle-api-client.mjs", import.meta.url), "utf8");

function bindReferralEntry(openExternal) {
  const start = rendererSource.indexOf('  root\n    .querySelectorAll<HTMLElement>(\'[data-action="settings-referrals"]\')');
  assert.notEqual(start, -1);
  const end = rendererSource.indexOf("\n  root", start + 1);
  assert.notEqual(end, -1);
  const source = ts.transpileModule(rendererSource.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const callbacks = [];
  const toasts = [];
  const root = {
    querySelectorAll(selector) {
      assert.equal(selector, '[data-action="settings-referrals"]');
      return [{ addEventListener(event, callback) {
        assert.equal(event, "click");
        callbacks.push(callback);
      } }];
    },
  };
  new Function("root", "api", "showToast", "errorMessage", source)(
    root, { openExternal }, (message) => toasts.push(message), (error) => error.message,
  );
  assert.equal(callbacks.length, 1);
  return { click: callbacks[0], toasts };
}

test("settings referral entry opens only the invitation website through the desktop browser bridge", async () => {
  const urls = [];
  const entry = bindReferralEntry(async (url) => { urls.push(url); });
  entry.click();
  await Promise.resolve();
  assert.deepEqual(urls, ["https://invite.haolo.com/"]);
  assert.deepEqual(entry.toasts, []);
});

test("referral browser launch failures are handled and the entry can be retried", async () => {
  const urls = [];
  const entry = bindReferralEntry(async (url) => {
    urls.push(url);
    if (urls.length === 1) throw new Error("Browser unavailable");
  });
  entry.click();
  await Promise.resolve();
  assert.deepEqual(entry.toasts, ["Browser unavailable"]);
  entry.click();
  await Promise.resolve();
  assert.deepEqual(urls, ["https://invite.haolo.com/", "https://invite.haolo.com/"]);
  assert.equal(entry.toasts.length, 1);
});

test("the invitation entry stays a keyboard-accessible button without advertising a dialog", () => {
  const entry = rendererSource.match(/<button\b[^>]*class="settings-referral-entry"[^>]*>/)?.[0];
  assert.ok(entry);
  assert.match(entry, /type="button"/);
  assert.match(entry, /data-action="settings-referrals"/);
  assert.doesNotMatch(entry, /aria-haspopup|disabled|tabindex="-1"/);
});

test("the former referral dialog, data state, styles and dedicated IPC/API are removed", () => {
  assert.doesNotMatch(rendererSource, /Referral(?:Center|Dashboard|Commission|Link)|referralCenter|preservedReferralCenterOverlay|showToastWithoutRender|(?:close|retry|create|copy)-referral-/);
  assert.doesNotMatch(stylesSource, /\.referral-|@keyframes referral-/);
  for (const source of [rendererSource, preloadSource, mainSource, apiSource]) {
    assert.doesNotMatch(source, /getReferralDashboard|listReferralLinks|createReferralLink|listReferralCommissions|referralsPath|DEFAULT_REFERRALS_PATH|YOULE_API_REFERRALS_PATH/);
  }
});

function styleRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...stylesSource.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`, "gm"))];
  assert.ok(matches.length, `missing style rule: ${selector}`);
  return Object.fromEntries(matches.flatMap(([, body]) => body.replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";").filter(part => part.includes(":")).map(part => {
      const colon = part.indexOf(":");
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    })));
}

function colorOver(value, background, tokens) {
  const resolved = value.replace(/var\((--[\w-]+)\)/g, (_, key) => {
    assert.ok(tokens[key], key);
    return tokens[key];
  });
  if (resolved.startsWith("var(")) return colorOver(resolved, background, tokens);
  if (resolved.startsWith("#")) return resolved;
  const rgba = resolved.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  assert.ok(rgba, resolved);
  const hex = background.length === 4 ? [...background.slice(1)].map(c => c + c).join("") : background.slice(1);
  const base = hex.match(/../g).map(part => parseInt(part, 16));
  const alpha = Number(rgba[4]);
  return "#" + base.map((channel, i) => Math.round(Number(rgba[i+1]) * alpha + channel * (1-alpha))
    .toString(16).padStart(2, "0")).join("");
}

function contrast(foreground, background) {
  function luminance(color) {
    assert.match(color, /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i);
    let hex = color.slice(1);
    if (hex.length === 3) hex = [...hex].map((value) => value + value).join("");
    const channels = hex.match(/../g).map((value) => parseInt(value, 16) / 255).map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function rgb(value, background = [255,255,255]) {
  if (value.startsWith('#')) {
    let hex=value.slice(1);if(hex.length===3)hex=[...hex].map(c=>c+c).join('');
    return hex.match(/../g).map(c=>parseInt(c,16));
  }
  const [r,g,b,a=1]=value.match(/[\d.]+/g).map(Number);
  return [r,g,b].map((v,i)=>Math.round(v*a+background[i]*(1-a)));
}
function hex(values) {return '#'+values.map(v=>v.toString(16).padStart(2,'0')).join('');}
for (const theme of ["light", "dark"]) {
  test(`referral entry stays legible in ${theme} mode across default, hover, active and focus states`, () => {
    const selector = ".settings-side-actions > button";
    const tokens = { ...styleRule(":root"), ...(theme === "dark" ? styleRule('html[data-theme="dark"]') : {}) };
    const panel = theme === "dark" ? styleRule('html[data-theme="dark"] .settings-side').background
      : colorOver(styleRule(".settings-dialog").background, "#ffffff", tokens);
    const base = styleRule(selector);
    const hover = { ...base, ...styleRule(selector + ":hover:not(:disabled)") };
    for (const [state, rule] of [["default", base], ["hover", hover],
      ["active", { ...hover, ...styleRule(selector + ":active:not(:disabled)") }]]) {
      const background = colorOver(rule.background, panel, tokens);
      const foreground = colorOver(rule.color, background, tokens);
      assert.ok(contrast(foreground, background) >= 4.5, `${theme}/${state}: label and icon contrast`);
    }
    assert.equal(styleRule(selector + " svg").stroke, "currentColor");
    const focus = styleRule(selector + ":focus-visible");
    assert.match(focus.outline, /^2px solid /);
    assert.equal(focus["outline-offset"], "2px");
    const ring = colorOver(focus.outline.replace(/^2px solid /, ""), panel, tokens);
    assert.ok(contrast(ring, panel) >= 3, `${theme}: keyboard focus contrast`);
  });
}
