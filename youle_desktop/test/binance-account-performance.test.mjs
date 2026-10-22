import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { accountProfitTimeline, loadAccountPerformance, renderAccountPerformance } from "../src/renderer/binance-account-performance.ts";
import { createBinanceAccountUiState } from "../src/renderer/binance-account-ui.ts";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";
import { binanceAccountReadErrorResult } from "../src/shared/binance-account-errors.mjs";
import { translateAppText } from "../src/renderer/app-language.mjs";

const DAY = 86400000;
const now = Date.UTC(2026, 9, 22, 12);
const point = (timestamp, amount, rate = null) => ({ timestamp, amount, rate });
const response = (days = 7) => ({ days, asOf: now, stats: { totalAmount: -.51, totalRate: null }, points: [],
  chart: { startAt: now - DAY, endAt: now, points: [point(now - DAY, 0), point(now - DAY / 2, .12), point(now, -.51)] } });
function state() {
  const value = createBinanceAccountUiState();
  value.status = { bound: true, serverCredentialsBound: true, serverConnectionId: "connection-a" };
  value.snapshot = { estimatedTotalAssets: 1000, marginBalance: 68.55 };
  return value;
}
const options = (extra = {}) => ({ isCurrent: () => true, changed() {}, credentialError: () => false, ...extra });

test("uses the same cropped window and observed values as mobile; rate fallback uses opening equity", () => {
  const amount = accountProfitTimeline(response(), 7, "amount", 68.55, now);
  assert.equal(amount.start, now - DAY);
  assert.deepEqual(amount.points.map(p => p.value), [0, .12, -.51]);
  const rate = accountProfitTimeline(response(), 7, "rate", 68.55, now);
  assert.equal(rate.total, -.51 / 69.06 * 100);
  const data = response(); data.chart.points[1].rate = 3.25; data.stats.totalRate = -2;
  const supplied = accountProfitTimeline(data, 7, "rate", 68.55, now);
  assert.equal(supplied.points[1].value, 3.25); assert.equal(supplied.total, -2);
  assert.equal(accountProfitTimeline(response(), 7, "rate", null, now).segments.length, 0);
});

test("null, missing and non-finite buckets break the curve, without inventing zero returns", () => {
  const data = response(); data.chart.startAt = now - 6 * DAY;
  data.chart.points = [point(now - 6 * DAY, 1), point(now - 5 * DAY, null), point(now - 4 * DAY, 2), point(now - DAY, 3), point(now, Infinity)];
  const timeline = accountProfitTimeline(data, 7, "amount", 100, now);
  assert.deepEqual(timeline.segments.map(s => s.map(p => p.value)), [[1], [2], [3]]);
  assert.equal(timeline.points.at(-1).value, null);
});

test("legacy daily totals use bucket close, reject future points, and do not advance cached data", () => {
  const data = { days: 7, asOf: now, stats: { totalAmount: 2, totalRate: null }, points: [point(Math.floor(now / DAY) * DAY, 2), point(now + DAY, 99)] };
  const timeline = accountProfitTimeline(data, 7, "amount", 100, now + 60000);
  assert.deepEqual(timeline.points, [{ timestamp: now, value: 2 }]);
  assert.equal(timeline.end, now + 60000);
});

test("simultaneous loads coalesce; switching ranges cannot overwrite the selected period", async () => {
  const value = state(); let calls = 0, finish;
  const first = loadAccountPerformance(value, () => { calls++; return new Promise(resolve => { finish = resolve; }); }, options());
  await loadAccountPerformance(value, async () => { calls++; return response(); }, options());
  assert.equal(calls, 1);
  value.performance.days = 30;
  await loadAccountPerformance(value, async ({ days }) => response(days), options());
  finish(response()); await first;
  assert.equal(value.performance.days, 30);
  assert.equal(value.performance.entries[30].data.days, 30);
  assert.equal(value.performance.entries[7].data.days, 7);
});

test("account switches discard old results, including their visible cached values", async () => {
  const value = state(); let finish;
  const first = loadAccountPerformance(value, () => new Promise(resolve => { finish = resolve; }), options());
  value.status.serverConnectionId = "connection-b";
  assert.doesNotMatch(renderAccountPerformance(value), /curve-chart/);
  await loadAccountPerformance(value, async () => response(), options());
  const current = value.performance;
  finish({ ...response(), stats: { totalAmount: 999, totalRate: 999 } }); await first;
  assert.equal(value.performance, current); assert.equal(current.entries[7].data.stats.totalAmount, -.51);
});

test("rate limits preserve successful data and cannot be bypassed by refresh", async () => {
  const value = state(); await loadAccountPerformance(value, async () => response(), options());
  let calls = 0;
  const read = async () => { calls++; throw Object.assign(new Error("429"), { retryAfterMs: 90000 }); };
  await loadAccountPerformance(value, read, options({ force: true }));
  await loadAccountPerformance(value, read, options({ force: true }));
  assert.equal(calls, 1); assert.equal(value.performance.entries[7].data.stats.totalAmount, -.51);
  assert.ok(value.performance.entries[7].retryAfter > Date.now() + 85000);
});

test("invalid responses and empty history stay honest; hiding assets removes all chart coordinates and values", async () => {
  const value = state(); await loadAccountPerformance(value, async () => response(30), options());
  assert.match(renderAccountPerformance(value), /暂时不可用/);
  value.performance.entries[7].retryAfter = 0;
  await loadAccountPerformance(value, async () => response(), options());
  const html = renderAccountPerformance(value);
  assert.match(html, /value="7" selected/); assert.match(html, /data-binance-performance-mode="amount" aria-pressed="true"/);
  assert.doesNotMatch(html, /\$/);
  value.balancesVisible = false;
  const hidden = renderAccountPerformance(value);
  assert.doesNotMatch(hidden, /-0\.51|0\.12|curve-chart|<path class/);
  assert.match(hidden, /••••/);
});

test("new labels translate to English and traditional Chinese", () => {
  assert.equal(translateAppText("收益额", "en"), "Profit");
  assert.equal(translateAppText("收益额", "zh-TW"), "收益額");
  assert.equal(translateAppText("{days}日", "en"), "{days}D");
});

test("curve colors follow each value across zero, including markers, gaps and both modes", async () => {
  for (const mode of ["amount", "rate"]) {
    for (const values of [[2, -2, 2, -2], [2, 1, 3], [-2, -1, -3], [0, 0], [2, null, -2]]) {
      const value = state();
      const data = response();
      const end = Date.now() - 1000;
      data.asOf = end; data.chart.startAt = end - DAY; data.chart.endAt = end;
      // Deliberately disagree with the last point: totals must not set line colors.
      data.stats = { totalAmount: 99, totalRate: 99 };
      data.chart.points = values.map((v, i) => point(end - DAY + i * DAY / (values.length - 1), v, v));
      await loadAccountPerformance(value, async () => data, options());
      value.performance.mode = mode;
      const html = renderAccountPerformance(value);
      assert.equal(html.includes('class="binance-account-curve-segment positive"'), values.some(v => v !== null && v >= 0));
      assert.equal(html.includes('class="binance-account-curve-segment negative"'), values.some(v => v !== null && v < 0));
      const markers = [...html.matchAll(/<g class="binance-account-curve-marker (positive|negative)">.*?<text[^>]*>([^<]+)<\/text>/g)];
      assert.ok(markers.length);
      for (const [, tone, label] of markers) assert.equal(tone, label.startsWith("-") ? "negative" : "positive");
      if (values.length === 4 && values[0] !== 0) {
        assert.match(html, /clip-path="url\(#account-profit-positive\)"/);
        assert.match(html, /clip-path="url\(#account-profit-negative\)"/);
        const lines = [...html.matchAll(/class="binance-account-curve-line" d="([^"]+)"/g)];
        assert.equal(lines[0][1], lines[1][1], "both clips use exactly the same crossing geometry");
      }
    }
  }
});

test("rendered fallback returns use futures equity, matching mobile even with spot-wallet assets", async () => {
  const value = state();
  const data = response();
  data.asOf -= DAY; data.chart.startAt -= DAY; data.chart.endAt -= DAY;
  data.chart.points.forEach(point => { point.timestamp -= DAY; });
  await loadAccountPerformance(value, async () => data, options());
  value.performance.mode = "rate";
  assert.match(renderAccountPerformance(value), /-0\.74%/);
  assert.doesNotMatch(renderAccountPerformance(value), /-0\.05%/);
});

test("actual API, main IPC and preload preserve read-only scope and cooldown errors", async () => {
  const client = new YouleApiClient(); client.loaded = true; client.baseUrl = "https://offline.invalid"; client.token = "test";
  let url, method;
  client.serviceFetch = async (input, init) => { url = String(input); method = init.method; return Response.json(response()); };
  await client.getAccountConnectionPerformance("connection-a", { days: 7 });
  assert.match(url, /account-connections\/connection-a\/performance\?days=7$/); assert.equal(method, "GET");
  await assert.rejects(client.getAccountConnectionPerformance("a", { days: 8 }));
  const source = ts.createSourceFile("main.mjs", readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  let handler;
  function visit(node) { if (ts.isCallExpression(node) && node.expression.getText(source) === "ipcMain.handle" && node.arguments[0]?.text === "binanceAccount:getPerformance") handler = node.arguments[1]; ts.forEachChild(node, visit); } visit(source);
  const deps = { assertExternalModelsIpcSender() {}, requireBinanceAccountOwner: async () => ({ ownerId: "a" }),
    readBinanceAccountStatusWithSharedBinding: async () => ({ serverCredentialsBound: true, serverConnectionId: "trusted-binding" }),
    getYouleApiClient: () => ({ getAccountConnectionPerformance: async (id, params) => { assert.equal(id, "trusted-binding"); assert.equal(params.days, 7); throw Object.assign(new Error("429"), { status: 429, retryAfterMs: 13000 }); } }),
    sameBinanceBindingOwner: () => true, binanceAccountReadErrorResult };
  const handle = new Function(...Object.keys(deps), `return (${handler.getText(source)})`)(...Object.values(deps));
  const envelope = await handle({}, { days: 7, connectionId: "untrusted-binding" });
  assert.equal(envelope.error.retryAfterMs, 13000);
  const preload = ts.createSourceFile("preload.mjs", readFileSync(new URL("../src/main/preload.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  let property;
  function find(node) { if (ts.isPropertyAssignment(node) && node.name.getText(preload) === "getBinanceAccountPerformance") property = node.initializer; ts.forEachChild(node, find); } find(preload);
  const invoke = new Function("ipcRenderer", `return (${property.getText(preload)})`)({ invoke: async () => envelope });
  await assert.rejects(invoke({ days: 7 }), error => error.status === 429 && error.retryAfterMs === 13000);
});
