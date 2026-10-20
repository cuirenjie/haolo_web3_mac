import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { resolveCodexChartTarget } from "../src/renderer/codex-chart-target.mjs";
import { CodexBusinessTools, CODEX_BUSINESS_TOOLS } from "../src/main/codex-business-tools.mjs";
import { tradingCapabilityArguments } from "../src/main/codex-trading-capabilities.mjs";

const btc = { marketId: "BINANCE:FUTURES:BTCUSDT", symbol: "BTCUSDT", interval: "240" };
test("chart arguments default to 1h and normalize explicit periods without borrowing BTC's period", () => {
  assert.deepEqual(resolveCodexChartTarget({ symbol: "ETH" }, btc), { marketId: "BINANCE:FUTURES:ETHUSDT", symbol: "ETHUSDT", interval: "60" });
  for (const [input, expected] of [["4h", "240"], ["15m", "15"], ["1d", "1D"], ["1M", "1M"], ["240", "240"]]) {
    assert.equal(resolveCodexChartTarget({ symbol: "ETH/USDT", interval: input }, btc).interval, expected);
  }
  assert.equal(resolveCodexChartTarget({}, btc).interval, "60");
  assert.equal(resolveCodexChartTarget({}, btc, { reuseOpenedInterval: true }).interval, "240");
  assert.equal(resolveCodexChartTarget({ symbol: "ETH" }, btc, { reuseOpenedInterval: true }).interval, "60");
  assert.equal(resolveCodexChartTarget({ marketId: "binance:usdm:ETHUSDT" }).marketId, "BINANCE:FUTURES:ETHUSDT");
  assert.equal(resolveCodexChartTarget({ marketId: "BINANCE:SPOT:ETHUSDT" }).marketId, "BINANCE:SPOT:ETHUSDT");
  assert.throws(() => resolveCodexChartTarget({ symbol: "ETH", marketId: btc.marketId }), /disagree/);
  assert.throws(() => resolveCodexChartTarget({ interval: "invalid" }, btc), /interval/);
  assert.throws(() => resolveCodexChartTarget({}, null), /Specify/);
});

test("Chinese equity/commodity names resolve exact product pairs while preserving native Han tickers", () => {
  for (const [name, symbol] of [
    ["闪迪", "SNDKUSDT"], ["閃迪", "SNDKUSDT"], ["海力士", "SKHYNIXUSDT"], ["SK 海力士", "SKHYNIXUSDT"],
    ["美光", "MUUSDT"], ["黄金", "XAUUSDT"], ["黃金", "XAUUSDT"],
    ["原油", "CLUSDT"], ["wti 原油", "CLUSDT"], ["布伦特原油", "BZUSDT"],
    ["谷歌", "GOOGLUSDT"], ["Google", "GOOGLUSDT"], ["以太坊", "ETHUSDT"],
    ["龙虾", "龙虾USDT"], ["币安人生USDT", "币安人生USDT"],
  ]) {
    const target = resolveCodexChartTarget({ symbol: name, interval: "4h" }, btc);
    assert.equal(target.marketId, `BINANCE:FUTURES:${symbol}`, name);
    assert.equal(target.symbol, symbol, name);
    assert.equal(target.interval, "240", name);
    assert.equal(resolveCodexChartTarget({ symbol: name }, btc).interval, "60", name);
  }
  assert.throws(() => resolveCodexChartTarget({ symbol: "帮我分析行情" }, btc), /Unknown/);
  assert.throws(() => resolveCodexChartTarget({ symbol: "黄金", marketId: "BINANCE:FUTURES:PAXGUSDT" }), /disagree/);
});

test("all 59 remote M1-269/M1-270 aliases retain their 35 exact pairs through chart opening", () => {
  // Independent historical contract, captured from the fetched remote; this
  // fixture must not be regenerated from the implementation under test.
  const baseline = JSON.parse(fs.readFileSync(new URL("./fixtures/trading-market-aliases-remote.json", import.meta.url), "utf8"));
  assert.equal(baseline.aliases.length, 59);
  assert.equal(new Set(baseline.aliases.map(([, symbol]) => symbol)).size, 35);
  for (const [name, symbol] of baseline.aliases) {
    for (const [interval, expected] of [[undefined, "60"], ["4h", "240"]]) {
      const resolved = resolveCodexChartTarget({ symbol: name, ...(interval ? { interval } : {}) }, btc);
      assert.equal(resolved.symbol, symbol, name);
      assert.equal(resolved.marketId, `BINANCE:FUTURES:${symbol}`, name);
      assert.equal(resolved.interval, expected, name);
    }
  }
});

test("chart opening is exposed, owned, serialized and re-executed after intervening navigation", async () => {
  assert.ok(CODEX_BUSINESS_TOOLS.some(t => t.name === "haolo_chart_open"));
  assert.equal(tradingCapabilityArguments("haolo_chart_open", { symbol: "ETH" }).action, "chart_open");
  assert.throws(() => tradingCapabilityArguments("haolo_chart_open", { threadId: "other" }), /Unexpected/);
  const calls = [], sender = { id: 7, isDestroyed: () => false }, client = {};
  const broker = new CodexBusinessTools({ owner: () => "owner", dispatch: (sender, request) => {
    if (!request.arguments) return;
    calls.push(request);
    queueMicrotask(() => broker.resolve(sender, { requestId: request.requestId, result: { ready: true } }));
  } });
  const context = broker.bind("root", { sender, client, contextId: "captured" });
  for (const symbol of ["ETH", "BTC", "ETH"]) {
    assert.equal((await broker.invokeBound({ tool: "haolo_chart_open", arguments: { context_id: context.token, symbol, interval: "4h" } })).ready, true);
  }
  assert.equal(calls.length, 3);
  assert.equal(calls[0].contextId, "captured");
  assert.equal(calls[0].threadId, "root");
  broker.cancel("root");
  await assert.rejects(broker.invokeBound({ tool: "haolo_chart_open", arguments: { context_id: context.token, symbol: "ETH" } }), /expired/);
});

test("analysis idempotence is scoped to the opened pair/period and headless jobs cannot claim navigation", async () => {
  let current;
  let analyses = 0;
  const sender = { isDestroyed: () => false }, client = {};
  const broker = new CodexBusinessTools({ owner: () => "owner", accountRead: async () => ({}), dispatch: (sender, request) => {
    if (!request.arguments) return;
    const args = request.arguments;
    let result;
    if (args.action === "chart_open") {
      current = resolveCodexChartTarget(args, current);
      result = { ready: true, chart: current };
    } else if (args.action === "analyze_only") {
      analyses++;
      result = { result: { ...current, report: `verified ${current.symbol}`, drawingArtifacts: [] } };
    }
    queueMicrotask(() => broker.resolve(sender, { requestId: request.requestId, result }));
  } });
  const context = broker.bind("root", { sender, client, contextId: "chart" });
  const call = (tool, args = {}) => broker.invokeBound({ tool, arguments: { context_id: context.token, ...args } });
  await call("haolo_account_read");
  await call("haolo_chart_open", { symbol: "ETH", interval: "4h" });
  const eth = await call("haolo_analysis");
  assert.equal((await call("haolo_analysis")).analysisRef, eth.analysisRef);
  await call("haolo_chart_open", { symbol: "BTC", interval: "1h" });
  const btcResult = await call("haolo_analysis");
  assert.equal(btcResult.result.symbol, "BTCUSDT");
  assert.notEqual(btcResult.analysisRef, eth.analysisRef);
  assert.equal(analyses, 2);
  broker.cancel("root");
  const headless = broker.bind("scheduled", { client, executeTrading: async () => { throw new Error("must not navigate"); } });
  await assert.rejects(broker.invokeBound({ tool: "haolo_chart_open", arguments: { context_id: headless.token, symbol: "ETH" } }), /No desktop chart/);
});

const source = fs.readFileSync(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("market.ts", source, ts.ScriptTarget.Latest, true);
function loadPreparation() {
  const cls = ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === "TradingExpertMarketWorkspace");
  const method = cls.members.find(n => n.name?.getText(ast) === "prepareAlertContext").getText(ast);
  const code = ts.transpileModule(`class Chart { ${method} }\nthis.Chart = Chart;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = {
    tradingMarketAvailable: market => market.available !== false, tradingMarketUnavailableMessage: () => "Unavailable",
    activeTradingAnalysisLanguage: () => "zh-CN", tradingResolutionFromAlertInterval: s => s,
    tradingAlertIntervalFromResolution: s => s, tradingViewResolutionDurationMs: s => ["60", "240"].includes(s) ? Number(s) * 60000 : 0,
  };
  vm.runInNewContext(code, context);
  const chart = new context.Chart(), changes = [];
  Object.assign(chart, {
    markets: [{ id: btc.marketId, symbol: btc.symbol }, { id: "BINANCE:FUTURES:ETHUSDT", symbol: "ETHUSDT" }],
    selectedMarketId: btc.marketId, loadedMarketId: btc.marketId, activeInterval: "60", loadedInterval: "60",
    candles: [{ close: 1 }, { close: 2 }], marketLoading: false,
    favoriteMarketFromId: () => null, clearAlertSimulation() {},
    selectMarket(market) { this.selectedMarketId = market.id; changes.push(market.id); },
    updateSymbolUi() {}, updateIntervalPressedButtons() {}, renderMarkets() {}, redrawDrawingControllers() {}, setPickerOpen() {},
    async restartMarketData() { this.loadedMarketId = this.selectedMarketId; this.loadedInterval = this.activeInterval; },
    alertContextSnapshot() { return { marketId: this.selectedMarketId, interval: this.activeInterval }; },
  });
  return { chart, changes };
}

test("real chart preparation reuses matching candles, changes pair/period and rejects spot fallback or failed load", async () => {
  const { chart, changes } = loadPreparation();
  const eth = "BINANCE:FUTURES:ETHUSDT";
  await chart.prepareAlertContext(btc.marketId, "60", { strictMarketId: true });
  assert.equal(changes.length, 0);
  await chart.prepareAlertContext(eth, "240", { strictMarketId: true });
  assert.equal(chart.loadedMarketId, eth);
  assert.equal(chart.loadedInterval, "240");
  await chart.prepareAlertContext(eth, "60", { strictMarketId: true });
  assert.equal(chart.loadedInterval, "60");
  await assert.rejects(chart.prepareAlertContext("BINANCE:SPOT:ETHUSDT", "60", { strictMarketId: true }), /未找到/);
  chart.restartMarketData = async () => {};
  await assert.rejects(chart.prepareAlertContext(eth, "240", { strictMarketId: true }), /加载失败/);
  assert.equal(changes.length, 3);
});

test("bound chart opening rejects foreign conversations and a conversation switch during loading", async () => {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "openTradingExpertAnalysisChart").getText(ast);
  const code = ts.transpileModule(fn.replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let finish;
  const requested = { marketId: "BINANCE:FUTURES:ETHUSDT", symbol: "ETHUSDT", interval: "240" };
  const workspace = { drawingStorageSessionMatches: id => id === "origin",
    prepareAlertContext: async (_market, _interval, options) => { options.assertActive(); await new Promise(resolve => { finish = resolve; }); options.assertActive(); },
    captureAnalysisTaskTarget: () => ({ ...requested, targetId: "next", candles: [{}, {}] }),
  };
  const context = { activeWorkspace: workspace, tradingAnalysisTargetWorkspaces: new Map([["captured", workspace]]) };
  vm.runInNewContext(`${code}\nthis.open = openTradingExpertAnalysisChart;`, context);
  const target = { targetId: "captured" }, signal = new AbortController().signal;
  await assert.rejects(context.open(target, requested, "foreign", signal), /originating/);
  const pending = context.open(target, requested, "origin", signal);
  context.activeWorkspace = {};
  finish();
  await assert.rejects(pending, /originating/);
  assert.equal(context.tradingAnalysisTargetWorkspaces.has("next"), false);
  context.activeWorkspace = workspace;
  const ready = context.open(target, requested, "origin", signal);
  finish();
  assert.equal((await ready).interval, "240");
  assert.equal(context.tradingAnalysisTargetWorkspaces.get("next"), workspace);
});
