import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const drawingSource = readFile(new URL("../src/renderer/trading-expert-drawing.ts", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const marketSource = readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const orderLinesSource = readFile(new URL("../src/renderer/trading-expert-order-lines.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const orderCreatedAt = new Date(2026, 7, 14, 19, 10, 11).getTime();

function order(overrides) {
  return {
    id: "order",
    source: "ORDER",
    symbol: "BTCUSDT",
    orderType: "LIMIT",
    side: "BUY",
    positionSide: "BOTH",
    quantityUsdt: 120,
    price: 62_000,
    triggerPrice: null,
    activationPrice: null,
    workingType: "CONTRACT_PRICE",
    createdAt: orderCreatedAt,
    reduceOnly: false,
    closePosition: false,
    ...overrides,
  };
}

test("read-only account positions and orders map to mainstream trading line semantics", async () => {
  const {
    buildTradingOrderLines,
    formatTradingOrderLinePrice,
    renderTradingOrderLineSvg,
    renderTradingOrderPositionCards,
    tradingOrderLineLabelWidth,
  } = await import("../src/renderer/trading-expert-order-lines.ts");
  assert.equal(formatTradingOrderLinePrice(3_257.56), "3,257.56");
  assert.equal(tradingOrderLineLabelWidth(
    { kind: "position-short", label: "5.627 USDT +0.04 USDT" },
    () => 96,
  ), 164);
  assert.equal(tradingOrderLineLabelWidth(
    { kind: "liquidation", label: "61,250" },
    () => 48,
  ), 96);
  const lines = buildTradingOrderLines({
    positions: [{
      symbol: "BTCUSDT",
      direction: "LONG",
      amount: 0.02,
      notionalValue: 1_260,
      margin: 63,
      unrealizedPnl: 18.4,
      roi: 29.21,
      marginRatio: 1.35,
      entryPrice: 63_000,
      markPrice: 63_920,
      liquidationPrice: 61_250,
      marginType: "cross",
      leverage: 20,
    }],
    openOrders: [
      order({ id: "limit-long", price: 62_000 }),
      order({ id: "limit-short", side: "SELL", price: 66_000 }),
      order({ id: "condition-long", source: "ALGO", orderType: "STOP_MARKET", price: null, triggerPrice: 64_000 }),
      order({ id: "condition-short", source: "ALGO", orderType: "STOP_MARKET", side: "SELL", price: null, triggerPrice: 61_000 }),
      order({ id: "take-profit", source: "ALGO", orderType: "TAKE_PROFIT_MARKET", side: "SELL", positionSide: "LONG", price: null, triggerPrice: 67_000, reduceOnly: true }),
      order({ id: "stop-loss", source: "ALGO", orderType: "STOP_MARKET", side: "SELL", positionSide: "LONG", price: null, triggerPrice: 60_000, reduceOnly: true }),
    ],
  });

  assert.deepEqual(lines.map((line) => line.kind), [
    "position-long",
    "liquidation",
    "limit-long",
    "limit-short",
    "conditional-long",
    "conditional-short",
    "take-profit",
    "stop-loss",
  ]);
  assert.ok(lines.every((line) => line.marketId === "BINANCE:FUTURES:BTCUSDT"));
  assert.equal(lines[0].shortLabel, "多头持仓");
  assert.equal(lines[0].quantityUsdt, 1_260);
  assert.equal(lines[0].label, "1,260 USDT +18.4 USDT");
  assert.equal(lines[0].pnl, 18.4);
  assert.deepEqual(lines[1], {
    id: "liquidation:BTCUSDT:0:61250",
    marketId: "BINANCE:FUTURES:BTCUSDT",
    price: 61_250,
    kind: "liquidation",
    shortLabel: "强平",
    label: "61,250",
    pnl: -1_260,
    ariaLabel: "强平，预计损失 -1,260 USDT，强平价 61,250",
  });
  assert.deepEqual(lines[0].position, {
    symbol: "BTCUSDT",
    direction: "LONG",
    marginType: "cross",
    leverage: 20,
    notionalValue: 1_260,
    margin: 63,
    unrealizedPnl: 18.4,
    roi: 29.21,
    marginRatio: 1.35,
    entryPrice: 63_000,
    markPrice: 63_920,
    liquidationPrice: 61_250,
  });
  assert.equal(lines[2].label, "120 USDT");
  assert.equal(lines[2].shortLabel, "限价做多");
  assert.equal(lines[2].pnl, null);
  assert.equal(lines[3].label, "120 USDT");
  assert.equal(lines[3].shortLabel, "限价做空");
  assert.equal(lines[4].label, "120 USDT");
  assert.equal(lines[4].shortLabel, "市价做多");
  assert.equal(lines[5].label, "120 USDT");
  assert.equal(lines[5].shortLabel, "市价做空");
  assert.equal(lines.at(-2).label, "120 USDT +7.16 USDT");
  assert.equal(lines.at(-2).shortLabel, "市价止盈");
  assert.ok(Math.abs(lines.at(-2).pnl - 7.164179104477612) < 1e-12);
  assert.equal(lines.at(-1).label, "120 USDT -6 USDT");
  assert.equal(lines.at(-1).shortLabel, "市价止损");
  assert.equal(lines.at(-1).pnl, -6);
  assert.doesNotMatch(lines.at(-2).label, /止盈|平多|67,000/);
  assert.doesNotMatch(lines.at(-1).label, /止损|平多|60,000/);
  assert.deepEqual(lines.at(-2).order, {
    symbol: "BTCUSDT",
    source: "ALGO",
    orderType: "TAKE_PROFIT_MARKET",
    displayLabel: "止盈平多",
    side: "SELL",
    positionSide: "LONG",
    intent: "CLOSE_LONG",
    quantityUsdt: 120,
    estimatedPnl: lines.at(-2).pnl,
    orderPrice: null,
    triggerPrice: 67_000,
    workingType: "CONTRACT_PRICE",
    createdAt: orderCreatedAt,
    reduceOnly: true,
    closePosition: false,
  });

  const limitExitLines = buildTradingOrderLines({
    openOrders: [
      order({ id: "take-profit-limit", source: "ALGO", orderType: "TAKE_PROFIT", side: "SELL", positionSide: "LONG", price: 67_000, reduceOnly: true }),
      order({ id: "stop-loss-limit", source: "ALGO", orderType: "STOP", side: "SELL", positionSide: "LONG", price: 60_000, reduceOnly: true }),
    ],
  });
  assert.deepEqual(limitExitLines.map((line) => line.shortLabel), ["限价止盈", "限价止损"]);

  const priceToCoordinate = (price) => (68_000 - price) / 25 + 80;
  const interactiveSvg = renderTradingOrderLineSvg(
    lines,
    "BINANCE:FUTURES:BTCUSDT",
    { width: 1_000, height: 600 },
    priceToCoordinate,
  );
  assert.match(interactiveSvg, /data-trading-order-line="order:take-profit"[^>]*data-trading-order-card-trigger="order:take-profit"[^>]*tabindex="0"/);
  assert.doesNotMatch(interactiveSvg, /data-trading-order-line="liquidation:[^"]+"[^>]*data-trading-order-card-trigger/);
  assert.doesNotMatch(interactiveSvg, /-- USDT/);
  const cards = renderTradingOrderPositionCards(
    lines,
    "BINANCE:FUTURES:BTCUSDT",
    { width: 1_000, height: 600 },
    priceToCoordinate,
  );
  assert.equal((cards.match(/data-trading-order-card=/g) || []).length, 7);
  assert.match(cards, /trading-order-commission-card short[^>]*data-trading-order-card="order:take-profit"[^>]*data-placement="pending"/);
  assert.match(cards, /BTCUSDT[\s\S]*永续[\s\S]*市价止盈 \/ 平多[\s\S]*08\/14\/2026 19:10:11/);
  assert.match(cards, /data-trading-order-card="order:take-profit"[\s\S]*数量 \(USDT\)[\s\S]*120\.00000[\s\S]*触发价[\s\S]*≥67,000\.00/);
  assert.match(cards, /data-trading-order-card="order:stop-loss"[\s\S]*触发价[\s\S]*≤60,000\.00/);
  assert.match(cards, /data-trading-order-card="order:condition-long"[\s\S]*触发价[\s\S]*≥64,000\.00/);
  assert.match(cards, /data-trading-order-card="order:condition-short"[\s\S]*触发价[\s\S]*≤61,000\.00/);
  assert.match(cards, /data-trading-order-card="order:limit-long"[\s\S]*价格[\s\S]*62,000\.00/);
  assert.doesNotMatch(cards, /触发类型|最新价格[≤≥]|标记价格[≤≥]|激活于|<strong>市价<\/strong>/);
  assert.match(cards, /data-trading-order-card="order:condition-long"[\s\S]*条件委托 \/ 市价做多/);
  assert.doesNotMatch(cards, /委托仓位|预计盈亏|委托方向|仓位方向|订单属性|width:250px/);
  assert.doesNotMatch(cards, /data-trading-order-card="liquidation:/);

  const shortTakeProfitLines = buildTradingOrderLines({
    openOrders: [order({
      id: "take-profit-short-market",
      source: "ALGO",
      orderType: "TAKE_PROFIT_MARKET",
      side: "BUY",
      positionSide: "SHORT",
      triggerPrice: 1_850,
      price: null,
      reduceOnly: true,
    })],
  });
  const shortTakeProfitCards = renderTradingOrderPositionCards(
    shortTakeProfitLines,
    "BINANCE:FUTURES:BTCUSDT",
    { width: 1_000, height: 600 },
    () => 200,
  );
  assert.match(shortTakeProfitCards, /市价止盈 \/ 平空[\s\S]*触发价[\s\S]*≤1,850\.00/);

  const invalidLiquidation = buildTradingOrderLines({
    positions: [{ symbol: "ETHUSDT", direction: "SHORT", entryPrice: 1_887.2, liquidationPrice: 0 }],
  });
  assert.deepEqual(invalidLiquidation.map((line) => line.kind), ["position-short"]);
});

test("order labels follow price coordinates, filter by market, and avoid collisions", async () => {
  const {
    layoutTradingOrderLineLabelLeft,
    layoutTradingOrderLineLabels,
    renderTradingOrderLineSvg,
    renderTradingOrderPositionCards,
  } = await import("../src/renderer/trading-expert-order-lines.ts");
  const base = {
    marketId: "BINANCE:FUTURES:BTCUSDT",
    shortLabel: "限价做多",
    kind: "limit-long",
  };
  const lines = [
    { ...base, id: "one", price: 100, label: "限价做多 · 100" },
    { ...base, id: "two", shortLabel: "限价做空", kind: "limit-short", price: 101, label: "限价做空 · 101" },
    { ...base, id: "other", marketId: "BINANCE:FUTURES:ETHUSDT", price: 102, label: "不应显示" },
  ];
  const placements = layoutTradingOrderLineLabels([
    { line: lines[0], lineY: 40 },
    { line: lines[1], lineY: 44 },
  ], 200);
  assert.ok(placements[1].labelY - placements[0].labelY >= 22);

  const rightmostLeft = layoutTradingOrderLineLabelLeft(
    160,
    40,
    { width: 900, height: 400 },
    [{ x: 120, y: 20, width: 18, height: 40 }],
  );
  assert.equal(rightmostLeft, 668);
  const clearLeftOfCurrentCandles = layoutTradingOrderLineLabelLeft(
    160,
    40,
    { width: 900, height: 400 },
    [{ x: 650, y: 20, width: 80, height: 40 }],
  );
  assert.ok(clearLeftOfCurrentCandles + 160 <= 646);

  const denseCandles = Array.from({ length: 21 }, (_, index) => ({
    x: index * 40,
    y: 20,
    width: 34,
    height: 40,
  }));
  const denseFallbackLeft = layoutTradingOrderLineLabelLeft(
    160,
    40,
    { width: 900, height: 400 },
    denseCandles,
  );
  assert.equal(denseFallbackLeft, 378);

  const svg = renderTradingOrderLineSvg(
    lines,
    "BINANCE:FUTURES:BTCUSDT",
    { width: 900, height: 400 },
    (price) => price - 60,
    [{ x: 650, y: 20, width: 80, height: 40 }],
  );
  assert.match(svg, /data-trading-order-line="one"/);
  assert.match(svg, /trading-order-line-limit-long/);
  assert.doesNotMatch(svg, /不应显示/);
  assert.match(svg, /trading-order-line-label-bg/);
  assert.match(svg, /x1="0"[^>]*x2="900"/);
  assert.match(svg, /data-order-label-left="498"/);
  assert.match(svg, /trading-order-line-label-bg[^>]*height="13"/);
  assert.doesNotMatch(svg, /trading-order-line-label-(?:bg|key|key-square)[^>]*height="15"/);
  assert.doesNotMatch(svg, /trading-order-line-label-(?:bg|key|key-square)[^>]*height="18"/);
  assert.equal((svg.match(/<g class="trading-order-price-level /g) || []).length, 2);
  assert.equal((svg.match(/<line class="trading-order-line-stroke"/g) || []).length, 2);
  assert.match(svg, /trading-order-price-level-dashed trading-order-line-limit-long/);
  assert.match(svg, /trading-order-price-level-dashed trading-order-line-limit-short/);

  const sharedDashedSvg = renderTradingOrderLineSvg(
    [
      { ...base, id: "shared-long", price: 120, quantityUsdt: 50, label: "50 USDT", pnl: null },
      { ...base, id: "shared-short", shortLabel: "限价做空", kind: "limit-short", price: 120, quantityUsdt: 40, label: "40 USDT", pnl: null },
    ],
    "BINANCE:FUTURES:BTCUSDT",
    { width: 900, height: 400 },
    (price) => price,
  );
  assert.equal((sharedDashedSvg.match(/<line class="trading-order-line-stroke"/g) || []).length, 1);
  assert.equal((sharedDashedSvg.match(/data-trading-order-line="/g) || []).length, 2);
  assert.match(sharedDashedSvg, /trading-order-price-level-dashed trading-order-line-limit-long[^>]*data-trading-order-line-count="2"/);
  assert.doesNotMatch(sharedDashedSvg, /trading-order-line-pnl-value|-- USDT/);
  const sharedLongGeometry = sharedDashedSvg.match(/data-trading-order-line="shared-long"[^>]*data-order-price-level-index="0"[^>]*>[\s\S]*?<rect class="trading-order-line-label-bg[^>]*x="([^"]+)" y="([^"]+)" width="([^"]+)"/);
  const sharedShortGeometry = sharedDashedSvg.match(/data-trading-order-line="shared-short"[^>]*data-order-price-level-index="1"[^>]*>[\s\S]*?<rect class="trading-order-line-label-bg[^>]*x="([^"]+)" y="([^"]+)" width="([^"]+)"/);
  assert.ok(sharedLongGeometry && sharedShortGeometry);
  assert.equal(Number(sharedShortGeometry[1]), Number(sharedLongGeometry[1]) + Number(sharedLongGeometry[3]) + 12);
  assert.equal(sharedShortGeometry[2], sharedLongGeometry[2]);
  assert.doesNotMatch(sharedDashedSvg, /trading-order-line-connector/);

  const sharedSolidSvg = renderTradingOrderLineSvg(
    [
      { ...base, id: "shared-order", price: 130, quantityUsdt: 50, label: "50 USDT", pnl: null },
      { ...base, id: "shared-position", shortLabel: "多头持仓", kind: "position-long", price: 130, quantityUsdt: 80, label: "80 USDT +2 USDT", pnl: 2 },
      { ...base, id: "shared-liquidation", shortLabel: "强平", kind: "liquidation", price: 130, label: "130", pnl: -80 },
    ],
    "BINANCE:FUTURES:BTCUSDT",
    { width: 900, height: 400 },
    (price) => price,
  );
  assert.equal((sharedSolidSvg.match(/<line class="trading-order-line-stroke"/g) || []).length, 1);
  assert.equal((sharedSolidSvg.match(/data-trading-order-line="/g) || []).length, 3);
  assert.match(sharedSolidSvg, /trading-order-price-level-solid trading-order-line-liquidation[^>]*data-trading-order-line-count="3"/);

  const positionLines = [
    {
      ...base,
      id: "long-position",
      shortLabel: "多头持仓",
      kind: "position-long",
      price: 100,
      quantityUsdt: 1_260,
      label: "1,260 USDT +8.2 USDT",
      pnl: 8.2,
      position: {
        symbol: "BTCUSDT",
        direction: "LONG",
        marginType: "cross",
        leverage: 20,
        notionalValue: 1_260,
        margin: 63,
        unrealizedPnl: 8.2,
        roi: 13.02,
        marginRatio: 1.35,
        entryPrice: 100,
        markPrice: 104,
        liquidationPrice: 82,
      },
    },
    {
      ...base,
      id: "short-position",
      shortLabel: "空头持仓",
      kind: "position-short",
      price: 101,
      quantityUsdt: 505,
      label: "505 USDT -3.1 USDT",
      pnl: -3.1,
      position: {
        symbol: "BTCUSDT",
        direction: "SHORT",
        marginType: "isolated",
        leverage: 50,
        notionalValue: 505,
        margin: 10.1,
        unrealizedPnl: -3.1,
        roi: -30.69,
        marginRatio: 2.4,
        entryPrice: 101,
        markPrice: 102,
        liquidationPrice: 119,
      },
    },
    {
      ...base,
      id: "liquidation",
      shortLabel: "强平",
      kind: "liquidation",
      price: 130,
      label: "130",
      pnl: -505,
    },
  ];
  const positionSvg = renderTradingOrderLineSvg(
    positionLines,
    "BINANCE:FUTURES:BTCUSDT",
    { width: 900, height: 400 },
    (price) => price - 60,
  );
  assert.match(positionSvg, /trading-order-line-quantity[^>]*>1,260 USDT<\/tspan><tspan> <\/tspan><tspan class="trading-order-line-pnl-value profit"[^>]*>\+8\.2 USDT/);
  assert.match(positionSvg, /trading-order-line-pnl-value profit[^>]*>\+8\.2 USDT/);
  assert.match(positionSvg, /trading-order-line-pnl-value loss[^>]*>-3\.1 USDT/);
  assert.doesNotMatch(positionSvg, /trading-order-line-position-price|trading-order-line-position-pnl-unit/);
  assert.match(positionSvg, /data-trading-order-position-trigger="long-position"[^>]*tabindex="0"/);
  assert.match(positionSvg, /trading-order-line-liquidation/);
  assert.match(positionSvg, /aria-label="强平 130"/);
  assert.match(positionSvg, /trading-order-line-label-key[^>]*width="32"/);
  assert.match(positionSvg, /data-trading-order-line="long-position"[\s\S]*?trading-order-line-label-key[^>]*width="52"/);
  assert.match(positionSvg, /trading-order-line-key-text[^>]*x="[^"]+"[^>]*>强平<\/text>/);
  assert.match(positionSvg, /trading-order-line-label-text[^>]*><tspan class="trading-order-line-liquidation-price">130<\/tspan><\/text>/);
  assert.doesNotMatch(positionSvg, /<g class="trading-order-line trading-order-line-liquidation"[^>]*>[\s\S]*?trading-order-line-pnl-value/);
  assert.doesNotMatch(positionSvg, /<g class="trading-order-line trading-order-line-liquidation"[^>]*>[\s\S]*?trading-order-line-quantity/);
  assert.doesNotMatch(positionSvg, /data-trading-order-price=|trading-order-price-marker/);

  const positionCards = renderTradingOrderPositionCards(
    positionLines,
    "BINANCE:FUTURES:BTCUSDT",
    { width: 900, height: 600 },
    (price) => price + 200,
  );
  assert.match(positionCards, /data-trading-order-position-card="long-position"[^>]*data-placement="pending"/);
  assert.doesNotMatch(positionCards, /style="[^"]*width:250px/);
  assert.match(positionCards, /持仓数量 \(USDT\)[\s\S]*1,260/);
  assert.match(positionCards, /保证金 \(USDT\)[\s\S]*63\.00/);
  assert.match(positionCards, /开仓价格 \(USDT\)[\s\S]*100\.00/);
  assert.match(positionCards, /标记价格 \(USDT\)[\s\S]*104\.00/);
  assert.match(positionCards, /强平价格 \(USDT\)[\s\S]*82\.00/);
  assert.match(positionCards, /投资回报率[\s\S]*\+13\.02%/);
  assert.match(positionCards, /trading-order-position-card short/);
  assert.doesNotMatch(positionCards, /trading-order-price-marker|data-trading-order-price=/);
});

test("K-line order overlay stays isolated from manual and AI drawing layers and uses paired themes", async () => {
  const [drawing, main, market, orderLines, styles] = await Promise.all([
    drawingSource,
    mainSource,
    marketSource,
    orderLinesSource,
    stylesSource,
  ]);
  assert.match(drawing, /data-trading-order-lines[\s\S]*data-drawing-content[\s\S]*data-ai-drawing-content/);
  assert.match(drawing, /data-trading-order-position-cards/);
  assert.match(drawing, /setOrderLines\(lines: readonly TradingOrderLine\[\]\)/);
  assert.match(drawing, /const candleObstacles = this\.drawingScope === "main"\s*\? this\.visibleCandleObstacles\(bounds\)\s*: \[\]/);
  assert.match(drawing, /renderTradingOrderLineSvg\([\s\S]*?priceToCoordinate,[\s\S]*?candleObstacles/);
  assert.match(drawing, /renderTradingOrderPositionCards\(/);
  assert.match(drawing, /fitTradingOrderLineLabels\(this\.orderLineContent, this\.orderPositionCardLayer, bounds\)/);
  assert.match(drawing, /closest<SVGGElement>\("\[data-trading-order-card-trigger\]"\)/);
  assert.match(drawing, /pointerover[\s\S]*handleOrderPositionPointerOver/);
  assert.match(drawing, /focusin[\s\S]*handleOrderPositionFocusIn/);
  assert.match(drawing, /handleWheel = \(event: WheelEvent\) => \{\s*this\.setOpenOrderPositionCard\(null\);\s*const chartSurface/s);
  assert.doesNotMatch(drawing, /renderTradingOrderPriceMarkers\(|data-trading-order-price-markers/);
  assert.match(market, /buildTradingOrderLines\(snapshot\)/);
  assert.match(market, /syncTradingExpertOrderLineSnapshot/);
  assert.match(main, /syncTradingExpertOrderLineSnapshot\(state\.binanceAccount\.snapshot\)/);
  assert.match(main, /binanceAccountReadOnlyDataVisible/);
  assert.doesNotMatch(main, /binanceAccount:(?:order|trade|cancel|closePosition)/i);

  assert.match(styles, /--trading-order-position-long: #078c53;/);
  assert.match(styles, /--trading-order-pnl-profit: #078c53;/);
  assert.match(styles, /--trading-order-pnl-loss: #d63857;/);
  assert.match(styles, /--trading-order-stop-loss: #d63857;/);
  assert.match(styles, /--trading-order-liquidation: #ff6739;[\s\S]*--trading-order-liquidation-key-bg: #ff6739;[\s\S]*--trading-order-liquidation-key-text: #ffffff;[\s\S]*--trading-order-liquidation-text-outline: rgba\(96, 25, 5, 0\.72\);/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market \{[\s\S]*--trading-order-position-long: #52dc88;[\s\S]*--trading-order-pnl-profit: #52dc88;[\s\S]*--trading-order-pnl-loss: #ff718e;[\s\S]*--trading-order-stop-loss: #ff718e;[\s\S]*--trading-order-liquidation: #ff6739;[\s\S]*--trading-order-liquidation-key-bg: #ff6739;[\s\S]*--trading-order-liquidation-key-text: #ffffff;[\s\S]*--trading-order-liquidation-text-outline: rgba\(96, 25, 5, 0\.72\);/);
  assert.match(styles, /--trading-order-card-bg: #ffffff;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market \{[\s\S]*--trading-order-card-bg: #15191f;[\s\S]*--trading-order-card-text: #f3f5f7;/);
  assert.match(styles, /\.trading-order-line-card-hitbox,[\s\S]*\.trading-order-line-position-hitbox\s*\{[^}]*pointer-events: all;/s);
  assert.match(styles, /\[data-trading-order-position-trigger\]:hover[\s\S]*\[data-trading-order-position-trigger\]:focus-visible/);
  assert.match(styles, /\.trading-order-line-stroke,\s*\.trading-order-line-connector\s*\{[^}]*stroke-width: 0\.8;/s);
  assert.doesNotMatch(styles, /\.trading-order-line-(?:position-long|position-short|conditional-long|conditional-short|limit-long|limit-short|take-profit|stop-loss|liquidation)\s+\.trading-order-line-(?:stroke|connector)[^{]*\{[^}]*stroke-width:/s);
  assert.match(styles, /\.trading-order-line-liquidation\s*\{[^}]*color: var\(--trading-order-liquidation\);/s);
  assert.match(styles, /\.trading-order-line-liquidation \.trading-order-line-label-bg,[\s\S]*\.trading-order-line-liquidation \.trading-order-line-label-key,[\s\S]*fill: var\(--trading-order-liquidation-key-bg\);/);
  assert.match(styles, /\.trading-order-line-liquidation \.trading-order-line-label-bg\s*\{[^}]*stroke: var\(--trading-order-liquidation-key-bg\);[^}]*stroke-opacity: 1;/s);
  assert.match(styles, /\.trading-order-line-liquidation \.trading-order-line-label-text,[\s\S]*\.trading-order-line-liquidation \.trading-order-line-liquidation-price\s*\{[^}]*fill: var\(--trading-order-liquidation-key-text\);[^}]*stroke: var\(--trading-order-liquidation-text-outline\);[^}]*stroke-width: 0\.45px;[^}]*paint-order: stroke fill;/);
  assert.match(styles, /\.trading-order-line-liquidation \.trading-order-line-key-text\s*\{[^}]*fill: var\(--trading-order-liquidation-key-text\);[^}]*stroke: none;[^}]*paint-order: normal;/);
  assert.match(styles, /\.trading-order-line-pnl-value\.profit\s*\{[^}]*fill: var\(--trading-order-pnl-profit\);/s);
  assert.match(styles, /\.trading-order-line-pnl-value\.loss\s*\{[^}]*fill: var\(--trading-order-pnl-loss\);/s);
  assert.match(styles, /\.trading-order-position-card\s*\{[^}]*width: max-content;[^}]*min-width: 250px;[^}]*height: auto;[^}]*background: var\(--trading-order-card-bg\);/s);
  assert.match(styles, /\.trading-order-position-card\s*\{[^}]*padding: 7px 10px;/s);
  assert.match(styles, /\.trading-order-commission-card\s*\{[^}]*min-width: 300px;[^}]*padding: 14px 16px;/s);
  assert.match(styles, /\.trading-order-position-card-featured\s*\{[^}]*margin-top: 6px;/s);
  assert.match(styles, /\.trading-order-commission-card-intro\s*\{[^}]*gap: 14px;[^}]*margin-top: 8px;/s);
  assert.match(styles, /\.trading-order-commission-card-details\s*\{[^}]*gap: 8px;[^}]*margin-top: 14px;/s);
  assert.match(styles, /\.trading-order-position-card-featured strong\s*\{[^}]*font-size: calc\(16px \+ var\(--app-font-size-offset\)\);/s);
  assert.match(styles, /\.trading-order-position-card-featured > div:last-child\s*\{[^}]*transform: translateX\(7px\);/s);
  assert.match(styles, /\.trading-order-position-card-featured > div:last-child > span\s*\{[^}]*margin-left: 4px;/s);
  assert.match(styles, /\.trading-order-position-card-metrics\s*\{[^}]*margin-top: 6px;[^}]*gap: 4px;/s);
  assert.match(styles, /\.trading-order-position-card-metrics > div:nth-child\(3n\) strong\s*\{[^}]*margin-left: 10px;/s);
  assert.match(styles, /\.trading-order-position-card-metrics > div:nth-child\(3n\) > span\s*\{[^}]*margin-left: 10px;/s);
  assert.doesNotMatch(styles, /\.trading-order-price-marker(?:-long|-short)?\b/);
  assert.match(styles, /\.trading-order-price-level-dashed \.trading-order-line-stroke\s*\{[^}]*stroke-dasharray: 2 2;/s);
  assert.match(styles, /\.trading-order-price-level-solid \.trading-order-line-stroke\s*\{[^}]*stroke-dasharray: none;/s);
  assert.doesNotMatch(styles, /\.trading-order-line-(?:position-long|position-short|conditional-long|conditional-short|limit-long|limit-short|take-profit|stop-loss|liquidation) \.trading-order-line-stroke\s*\{[^}]*stroke-dasharray:/s);
  assert.match(market, /createPriceLine\(\{[\s\S]*?lineWidth: 1,[\s\S]*?lineStyle: LineStyle\.Dashed,/);
  assert.match(orderLines, /const cardBounds = card\.getBoundingClientRect\(\);/);
  assert.match(orderLines, /const ORDER_LINE_PRICE_LEVEL_LABEL_GAP = 12;/);
  assert.match(orderLines, /card\.dataset\.placement = placement;/);
});
