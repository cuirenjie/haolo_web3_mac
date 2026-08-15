export type TradingOrderLineKind =
  | "position-long"
  | "position-short"
  | "conditional-long"
  | "conditional-short"
  | "limit-long"
  | "limit-short"
  | "take-profit"
  | "stop-loss"
  | "liquidation";

export interface TradingOrderLine {
  id: string;
  marketId: string;
  price: number;
  kind: TradingOrderLineKind;
  label: string;
  shortLabel: string;
  quantityUsdt?: number | null;
  pnl?: number | null;
  ariaLabel?: string;
  position?: TradingOrderLinePositionDetails;
  order?: TradingOrderLineOrderDetails;
}

export type TradingOrderLineOrderIntent = "OPEN_LONG" | "OPEN_SHORT" | "CLOSE_LONG" | "CLOSE_SHORT";

export interface TradingOrderLineOrderDetails {
  symbol: string;
  source: "ORDER" | "ALGO" | null;
  orderType: string;
  displayLabel: string;
  side: "BUY" | "SELL" | null;
  positionSide: string;
  intent: TradingOrderLineOrderIntent;
  quantityUsdt: number | null;
  estimatedPnl: number | null;
  orderPrice: number | null;
  triggerPrice: number | null;
  workingType: string | null;
  createdAt: number | null;
  reduceOnly: boolean;
  closePosition: boolean;
}

export interface TradingOrderLinePositionDetails {
  symbol: string;
  direction: "LONG" | "SHORT";
  marginType: "cross" | "isolated" | null;
  leverage: number | null;
  notionalValue: number | null;
  margin: number | null;
  unrealizedPnl: number | null;
  roi: number | null;
  marginRatio: number | null;
  entryPrice: number;
  markPrice: number | null;
  liquidationPrice: number | null;
}

interface TradingOrderLinePosition {
  symbol?: unknown;
  direction?: unknown;
  amount?: unknown;
  notionalValue?: unknown;
  margin?: unknown;
  unrealizedPnl?: unknown;
  roi?: unknown;
  marginRatio?: unknown;
  entryPrice?: unknown;
  markPrice?: unknown;
  liquidationPrice?: unknown;
  marginType?: unknown;
  leverage?: unknown;
}

interface TradingOrderLineOrder {
  id?: unknown;
  source?: unknown;
  symbol?: unknown;
  orderType?: unknown;
  side?: unknown;
  positionSide?: unknown;
  quantityUsdt?: unknown;
  price?: unknown;
  triggerPrice?: unknown;
  activationPrice?: unknown;
  workingType?: unknown;
  createdAt?: unknown;
  reduceOnly?: unknown;
  closePosition?: unknown;
}

export interface TradingOrderLineAccountSnapshot {
  positions?: TradingOrderLinePosition[];
  openOrders?: TradingOrderLineOrder[];
}

interface TradingOrderLineRenderEntry {
  line: TradingOrderLine;
  lineY: number;
  labelY: number;
}

interface TradingOrderLineRenderGeometry extends TradingOrderLineRenderEntry {
  labelLeft: number;
  labelTop: number;
  labelWidth: number;
  priceLevelIndex: number;
  priceLevelCount: number;
}

export interface TradingOrderLineCandleObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ORDER_LINE_MIN_LABEL_GAP = 22;
const ORDER_LINE_LABEL_HEIGHT = 13;
const ORDER_LINE_LABEL_TEXT_GAP = 6;
const ORDER_LINE_LABEL_RIGHT_PADDING = 10;
const ORDER_LINE_DEFAULT_KEY_WIDTH = 52;
const ORDER_LINE_PRICE_LEVEL_LABEL_GAP = 12;
const ORDER_LINE_PRICE_AXIS_GUTTER = 72;
const ORDER_POSITION_CARD_GAP = 5;
const ORDER_LINE_CANDLE_GAP = 4;
const ORDER_LINE_RECENT_CANDLE_COUNT = 8;
const ORDER_LINE_HORIZONTAL_SCAN_STEP = 4;
const ORDER_LINE_LABEL_MINIMUM_VIEWPORT_RATIO = 0.42;

function finitePositive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedSymbol(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function marketId(symbol: string) {
  return `BINANCE:FUTURES:${symbol}`;
}

function formatCompactNumber(value: number, maximumFractionDigits = 6) {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
    useGrouping: Math.abs(value) >= 1_000,
  });
}

export function formatTradingOrderLinePrice(value: number) {
  const absolute = Math.abs(value);
  const maximumFractionDigits = absolute >= 1_000 ? 2 : absolute >= 1 ? 4 : 6;
  return formatCompactNumber(value, maximumFractionDigits);
}

function signedUsdt(value: number | null) {
  if (value === null) return "-- USDT";
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${formatCompactNumber(Math.abs(value), 2)} USDT`;
}

function quantityUsdtLabel(value: number | null) {
  return value === null ? "-- USDT" : `${formatCompactNumber(value, 4)} USDT`;
}

function orderIntent(order: TradingOrderLineOrder): TradingOrderLineOrderIntent {
  const side = String(order.side || "").toUpperCase();
  const positionSide = String(order.positionSide || "BOTH").toUpperCase();
  if (positionSide === "LONG") return side === "SELL" ? "CLOSE_LONG" : "OPEN_LONG";
  if (positionSide === "SHORT") return side === "BUY" ? "CLOSE_SHORT" : "OPEN_SHORT";
  if (order.reduceOnly === true || order.closePosition === true) {
    return side === "BUY" ? "CLOSE_SHORT" : "CLOSE_LONG";
  }
  return side === "SELL" ? "OPEN_SHORT" : "OPEN_LONG";
}

function orderDisplay(order: TradingOrderLineOrder): {
  kind: TradingOrderLineKind;
  label: string;
  shortLabel: string;
  price: number | null;
} | null {
  const orderType = String(order.orderType || "").toUpperCase();
  const intent = orderIntent(order);
  const opening = intent === "OPEN_LONG" || intent === "OPEN_SHORT";
  const long = intent === "OPEN_LONG" || intent === "CLOSE_SHORT";
  const directionLabel: Record<TradingOrderLineOrderIntent, string> = {
    OPEN_LONG: "做多",
    OPEN_SHORT: "做空",
    CLOSE_LONG: "平多",
    CLOSE_SHORT: "平空",
  };
  const executionLabel = orderType.includes("MARKET") ? "市价" : "限价";
  const triggerPrice = finitePositive(order.triggerPrice) ?? finitePositive(order.activationPrice);
  const limitPrice = finitePositive(order.price);
  if (!opening && orderType.startsWith("TAKE_PROFIT")) {
    return { kind: "take-profit", label: `止盈${directionLabel[intent]}`, shortLabel: `${executionLabel}止盈`, price: triggerPrice ?? limitPrice };
  }
  if (!opening && (orderType.startsWith("STOP") || orderType === "TRAILING_STOP_MARKET")) {
    return {
      kind: "stop-loss",
      label: orderType === "TRAILING_STOP_MARKET" ? `跟踪止损${directionLabel[intent]}` : `止损${directionLabel[intent]}`,
      shortLabel: orderType === "TRAILING_STOP_MARKET" ? "跟踪止损" : `${executionLabel}止损`,
      price: triggerPrice ?? limitPrice,
    };
  }
  if (orderType === "LIMIT" || (String(order.source || "").toUpperCase() === "ORDER" && limitPrice !== null)) {
    return { kind: long ? "limit-long" : "limit-short", label: `限价${directionLabel[intent]}`, shortLabel: `限价${directionLabel[intent]}`, price: limitPrice };
  }
  if (triggerPrice !== null) {
    return { kind: long ? "conditional-long" : "conditional-short", label: `条件${directionLabel[intent]}`, shortLabel: `${executionLabel}${directionLabel[intent]}`, price: triggerPrice };
  }
  return null;
}

interface NormalizedPositionLine {
  symbol: string;
  direction: "LONG" | "SHORT";
  amount: number | null;
  notionalValue: number | null;
  details: TradingOrderLinePositionDetails;
}

function normalizedPositionAmount(position: TradingOrderLinePosition) {
  return finitePositive(Math.abs(Number(position.amount)));
}

function normalizedPositionNotional(
  position: TradingOrderLinePosition,
  amount: number | null,
  entryPrice: number,
) {
  const notional = finitePositive(Math.abs(Number(position.notionalValue)));
  if (notional !== null) return notional;
  const referencePrice = finitePositive(position.markPrice) ?? entryPrice;
  return amount === null ? null : amount * referencePrice;
}

function projectedClosePnl(
  position: NormalizedPositionLine,
  targetPrice: number,
  quantityUsdt: number | null,
  closePosition: boolean,
) {
  const amount = closePosition
    ? position.amount
      ?? (position.notionalValue === null ? null : position.notionalValue / position.details.entryPrice)
    : quantityUsdt === null
      ? null
      : quantityUsdt / targetPrice;
  if (amount === null) return null;
  return position.direction === "LONG"
    ? (targetPrice - position.details.entryPrice) * amount
    : (position.details.entryPrice - targetPrice) * amount;
}

export function buildTradingOrderLines(
  snapshot: TradingOrderLineAccountSnapshot | null | undefined,
): TradingOrderLine[] {
  if (!snapshot) return [];
  const lines: TradingOrderLine[] = [];
  const normalizedPositions: NormalizedPositionLine[] = [];
  (Array.isArray(snapshot.positions) ? snapshot.positions : []).forEach((position, index) => {
    const symbol = normalizedSymbol(position.symbol);
    const price = finitePositive(position.entryPrice);
    if (!symbol || price === null) return;
    const short = String(position.direction || "").toUpperCase() === "SHORT";
    const amount = normalizedPositionAmount(position);
    const notionalValue = normalizedPositionNotional(position, amount, price);
    const pnl = finiteNumber(position.unrealizedPnl);
    const liquidationPrice = finitePositive(position.liquidationPrice);
    const direction = short ? "空" : "多";
    const marginTypeValue = String(position.marginType || "").toLowerCase();
    const marginType = marginTypeValue === "cross"
      ? "cross"
      : marginTypeValue === "isolated"
        ? "isolated"
        : null;
    const positionDetails: TradingOrderLinePositionDetails = {
      symbol,
      direction: short ? "SHORT" : "LONG",
      marginType,
      leverage: finiteNumber(position.leverage),
      notionalValue,
      margin: finiteNumber(position.margin),
      unrealizedPnl: pnl,
      roi: finiteNumber(position.roi),
      marginRatio: finiteNumber(position.marginRatio),
      entryPrice: price,
      markPrice: finiteNumber(position.markPrice),
      liquidationPrice,
    };
    normalizedPositions.push({
      symbol,
      direction: positionDetails.direction,
      amount,
      notionalValue,
      details: positionDetails,
    });
    lines.push({
      id: `position:${symbol}:${index}:${price}`,
      marketId: marketId(symbol),
      price,
      kind: short ? "position-short" : "position-long",
      shortLabel: short ? "空头持仓" : "多头持仓",
      quantityUsdt: notionalValue,
      label: `${quantityUsdtLabel(notionalValue)} ${signedUsdt(pnl)}`,
      pnl,
      position: positionDetails,
    });
    if (liquidationPrice !== null) {
      lines.push({
        id: `liquidation:${symbol}:${index}:${liquidationPrice}`,
        marketId: marketId(symbol),
        price: liquidationPrice,
        kind: "liquidation",
        shortLabel: "强平",
        label: formatTradingOrderLinePrice(liquidationPrice),
        pnl: notionalValue === null ? null : -notionalValue,
        ariaLabel: `强平，预计损失 ${signedUsdt(notionalValue === null ? null : -notionalValue)}，强平价 ${formatTradingOrderLinePrice(liquidationPrice)}`,
      });
    }
  });
  (Array.isArray(snapshot.openOrders) ? snapshot.openOrders : []).forEach((order, index) => {
    const symbol = normalizedSymbol(order.symbol);
    const display = orderDisplay(order);
    if (!symbol || !display || display.price === null) return;
    const intent = orderIntent(order);
    const closingDirection = intent === "CLOSE_LONG"
      ? "LONG"
      : intent === "CLOSE_SHORT"
        ? "SHORT"
        : null;
    const matchingPosition = closingDirection === null
      ? null
      : normalizedPositions.find((position) => (
        position.symbol === symbol && position.direction === closingDirection
      )) ?? null;
    const orderNotional = finitePositive(order.quantityUsdt);
    const quantityUsdt = order.closePosition === true
      ? matchingPosition?.notionalValue ?? null
      : orderNotional ?? ((order.reduceOnly === true && matchingPosition)
        ? matchingPosition.notionalValue
        : null);
    const coversFullPosition = order.closePosition === true
      || (order.reduceOnly === true && orderNotional === null);
    const pnl = matchingPosition && closingDirection !== null
      ? projectedClosePnl(matchingPosition, display.price, quantityUsdt, coversFullPosition)
      : null;
    const label = pnl === null
      ? quantityUsdtLabel(quantityUsdt)
      : `${quantityUsdtLabel(quantityUsdt)} ${signedUsdt(pnl)}`;
    const pnlAriaLabel = pnl === null ? "" : `，预计盈亏 ${signedUsdt(pnl)}`;
    lines.push({
      id: `order:${String(order.id || index)}`,
      marketId: marketId(symbol),
      price: display.price,
      kind: display.kind,
      shortLabel: display.shortLabel,
      quantityUsdt,
      label,
      pnl,
      ariaLabel: `${display.label}，仓位 ${quantityUsdtLabel(quantityUsdt)}${pnlAriaLabel}，触发价 ${formatTradingOrderLinePrice(display.price)}`,
      order: {
        symbol,
        source: String(order.source || "").toUpperCase() === "ORDER"
          ? "ORDER"
          : String(order.source || "").toUpperCase() === "ALGO"
            ? "ALGO"
            : null,
        orderType: String(order.orderType || "").toUpperCase(),
        displayLabel: display.label,
        side: String(order.side || "").toUpperCase() === "BUY"
          ? "BUY"
          : String(order.side || "").toUpperCase() === "SELL"
            ? "SELL"
            : null,
        positionSide: String(order.positionSide || "BOTH").toUpperCase(),
        intent,
        quantityUsdt,
        estimatedPnl: pnl,
        orderPrice: finitePositive(order.price),
        triggerPrice: finitePositive(order.triggerPrice) ?? finitePositive(order.activationPrice),
        workingType: String(order.workingType || "").trim().toUpperCase() || null,
        createdAt: finitePositive(order.createdAt),
        reduceOnly: order.reduceOnly === true,
        closePosition: order.closePosition === true,
      },
    });
  });
  return lines;
}

export function layoutTradingOrderLineLabels(
  lines: Array<{ line: TradingOrderLine; lineY: number }>,
  height: number,
  minGap = ORDER_LINE_MIN_LABEL_GAP,
): TradingOrderLineRenderEntry[] {
  const halfHeight = ORDER_LINE_LABEL_HEIGHT / 2;
  const top = halfHeight + 2;
  const bottom = Math.max(top, height - halfHeight - 2);
  const entries = [...lines]
    .sort((first, second) => first.lineY - second.lineY)
    .map((entry) => ({ ...entry, labelY: Math.min(bottom, Math.max(top, entry.lineY)) }));
  for (let index = 1; index < entries.length; index += 1) {
    entries[index].labelY = Math.max(entries[index].labelY, entries[index - 1].labelY + minGap);
  }
  if (entries.length && entries.at(-1)!.labelY > bottom) {
    entries[entries.length - 1].labelY = bottom;
    for (let index = entries.length - 2; index >= 0; index -= 1) {
      entries[index].labelY = Math.min(entries[index].labelY, entries[index + 1].labelY - minGap);
    }
  }
  if (entries.length && entries[0].labelY < top) {
    entries[0].labelY = top;
    for (let index = 1; index < entries.length; index += 1) {
      entries[index].labelY = Math.max(entries[index].labelY, entries[index - 1].labelY + minGap);
    }
  }
  return entries;
}

let orderLineLabelMeasureContext: CanvasRenderingContext2D | null | undefined;

function fallbackOrderLineLabelTextWidth(label: string) {
  let units = 0;
  for (const character of label) units += character.charCodeAt(0) > 255 ? 10.5 : 6.3;
  return units;
}

function measuredOrderLineLabelTextWidth(label: string) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return fallbackOrderLineLabelTextWidth(label);
  }
  if (orderLineLabelMeasureContext === undefined) {
    orderLineLabelMeasureContext = document.createElement("canvas").getContext("2d");
  }
  const context = orderLineLabelMeasureContext;
  if (!context) return fallbackOrderLineLabelTextWidth(label);
  const offset = Number.parseFloat(
    window.getComputedStyle(document.documentElement).getPropertyValue("--app-font-size-offset"),
  ) || 0;
  context.font = `650 ${Math.max(1, 10 + offset)}px Inter, "Segoe UI", "Microsoft YaHei", sans-serif`;
  (context as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0.005em";
  return Math.max(context.measureText(label).width, fallbackOrderLineLabelTextWidth(label));
}

function orderLineLabelKeyWidth(kind: TradingOrderLineKind) {
  return kind === "liquidation" ? 32 : ORDER_LINE_DEFAULT_KEY_WIDTH;
}

export function tradingOrderLineLabelWidth(
  line: Pick<TradingOrderLine, "kind" | "label">,
  measureText: (label: string) => number = measuredOrderLineLabelTextWidth,
) {
  return Math.ceil(
    orderLineLabelKeyWidth(line.kind)
      + ORDER_LINE_LABEL_TEXT_GAP
      + Math.max(0, measureText(line.label))
      + ORDER_LINE_LABEL_RIGHT_PADDING,
  );
}

function orderLineRectOverlapArea(
  label: TradingOrderLineCandleObstacle,
  obstacle: TradingOrderLineCandleObstacle,
  gap = 0,
) {
  const left = Math.max(label.x, obstacle.x - gap);
  const right = Math.min(label.x + label.width, obstacle.x + obstacle.width + gap);
  const top = Math.max(label.y, obstacle.y - gap);
  const bottom = Math.min(label.y + label.height, obstacle.y + obstacle.height + gap);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

export function layoutTradingOrderLineLabelLeft(
  labelWidth: number,
  labelY: number,
  bounds: { width: number; height: number },
  candleObstacles: readonly TradingOrderLineCandleObstacle[] = [],
) {
  const labelRight = Math.max(150, bounds.width - ORDER_LINE_PRICE_AXIS_GUTTER);
  const normalizedWidth = Math.min(Math.max(labelWidth, 1), Math.max(1, labelRight - 12));
  const minimumLeft = Math.min(
    Math.max(8, bounds.width * ORDER_LINE_LABEL_MINIMUM_VIEWPORT_RATIO),
    Math.max(8, labelRight - normalizedWidth),
  );
  const maximumLeft = Math.max(minimumLeft, labelRight - normalizedWidth);
  const labelTop = labelY - ORDER_LINE_LABEL_HEIGHT / 2;
  const relevantObstacles = candleObstacles.flatMap((obstacle) => {
    if (
      !Number.isFinite(obstacle.x)
      || !Number.isFinite(obstacle.y)
      || !Number.isFinite(obstacle.width)
      || !Number.isFinite(obstacle.height)
      || obstacle.width <= 0
      || obstacle.height <= 0
      || obstacle.x >= bounds.width
      || obstacle.x + obstacle.width <= 0
      || obstacle.y - ORDER_LINE_CANDLE_GAP >= labelTop + ORDER_LINE_LABEL_HEIGHT
      || obstacle.y + obstacle.height + ORDER_LINE_CANDLE_GAP <= labelTop
    ) return [];
    return [{
      x: Math.max(0, obstacle.x),
      y: Math.max(0, obstacle.y),
      width: Math.min(bounds.width, obstacle.x + obstacle.width) - Math.max(0, obstacle.x),
      height: Math.min(bounds.height, obstacle.y + obstacle.height) - Math.max(0, obstacle.y),
    }];
  });
  if (!relevantObstacles.length) return maximumLeft;

  const clampLeft = (left: number) => Math.min(maximumLeft, Math.max(minimumLeft, left));
  const candidates = new Set<number>([maximumLeft, minimumLeft]);
  relevantObstacles.forEach((obstacle) => {
    candidates.add(clampLeft(obstacle.x - ORDER_LINE_CANDLE_GAP - normalizedWidth));
    candidates.add(clampLeft(obstacle.x + obstacle.width + ORDER_LINE_CANDLE_GAP));
  });
  for (let left = maximumLeft; left > minimumLeft; left -= ORDER_LINE_HORIZONTAL_SCAN_STEP) {
    candidates.add(clampLeft(left));
  }
  const orderedCandidates = [...candidates].sort((first, second) => second - first);
  const labelRect = (left: number): TradingOrderLineCandleObstacle => ({
    x: left,
    y: labelTop,
    width: normalizedWidth,
    height: ORDER_LINE_LABEL_HEIGHT,
  });
  const collisionFree = orderedCandidates.find((left) => (
    relevantObstacles.every((obstacle) => (
      orderLineRectOverlapArea(labelRect(left), obstacle, ORDER_LINE_CANDLE_GAP) === 0
    ))
  ));
  if (collisionFree !== undefined) return collisionFree;

  const recentObstacles = new Set([...relevantObstacles]
    .sort((first, second) => (
      second.x + second.width - (first.x + first.width)
    ))
    .slice(0, ORDER_LINE_RECENT_CANDLE_COUNT));
  return orderedCandidates.map((left) => {
    const rect = labelRect(left);
    let overlapArea = 0;
    let overlapCount = 0;
    let recentOverlapArea = 0;
    let recentOverlapCount = 0;
    relevantObstacles.forEach((obstacle) => {
      const area = orderLineRectOverlapArea(rect, obstacle, ORDER_LINE_CANDLE_GAP);
      if (area <= 0) return;
      overlapArea += area;
      overlapCount += 1;
      if (recentObstacles.has(obstacle)) {
        recentOverlapArea += area;
        recentOverlapCount += 1;
      }
    });
    return {
      left,
      score: recentOverlapCount * 1_000_000_000_000
        + recentOverlapArea * 100_000_000
        + overlapCount * 1_000_000
        + overlapArea * 100
        + (maximumLeft - left),
    };
  }).sort((first, second) => first.score - second.score)[0]?.left ?? maximumLeft;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function visibleTradingOrderLineGeometry(
  lines: readonly TradingOrderLine[],
  market: string,
  bounds: { width: number; height: number },
  priceToCoordinate: (price: number) => number | null,
  candleObstacles: readonly TradingOrderLineCandleObstacle[],
): TradingOrderLineRenderGeometry[] {
  const visible = lines.flatMap((line) => {
    if (line.marketId !== market) return [];
    const lineY = priceToCoordinate(line.price);
    return lineY !== null && Number.isFinite(lineY) && lineY >= 0 && lineY <= bounds.height
      ? [{ line, lineY }]
      : [];
  });
  const labelRight = Math.max(150, bounds.width - ORDER_LINE_PRICE_AXIS_GUTTER);
  const grouped = new Map<number, Array<{ line: TradingOrderLine; lineY: number; labelWidth: number }>>();
  visible.forEach((entry) => {
    const member = {
      ...entry,
      labelWidth: Math.min(
        tradingOrderLineLabelWidth(entry.line),
        Math.max(1, labelRight - 12),
      ),
    };
    const existing = grouped.get(entry.line.price);
    if (existing) existing.push(member);
    else grouped.set(entry.line.price, [member]);
  });
  const levels = [...grouped.values()];
  const levelByPrice = new Map(levels.map((members) => [members[0].line.price, members]));
  return layoutTradingOrderLineLabels(
    levels.map((members) => ({ line: members[0].line, lineY: members[0].lineY })),
    bounds.height,
  ).flatMap((entry) => {
    const members = levelByPrice.get(entry.line.price) ?? [];
    const combinedWidth = members.reduce((total, member) => total + member.labelWidth, 0)
      + Math.max(0, members.length - 1) * ORDER_LINE_PRICE_LEVEL_LABEL_GAP;
    let nextLeft = layoutTradingOrderLineLabelLeft(
      combinedWidth,
      entry.labelY,
      bounds,
      candleObstacles,
    );
    return members.map((member, priceLevelIndex) => {
      const labelLeft = nextLeft;
      nextLeft += member.labelWidth + ORDER_LINE_PRICE_LEVEL_LABEL_GAP;
      return {
        line: member.line,
        lineY: member.lineY,
        labelY: entry.labelY,
        labelLeft,
        labelTop: entry.labelY - ORDER_LINE_LABEL_HEIGHT / 2,
        labelWidth: member.labelWidth,
        priceLevelIndex,
        priceLevelCount: members.length,
      };
    });
  });
}

function formatPositionCardNumber(
  value: number | null,
  maximumFractionDigits: number,
) {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: maximumFractionDigits === 0 ? 0 : Math.min(2, maximumFractionDigits),
    maximumFractionDigits,
    useGrouping: Math.abs(value) >= 1_000,
  });
}

function positionCardPriceDecimals(value: number | null) {
  const absolute = Math.abs(value ?? 0);
  if (absolute >= 1_000) return 2;
  if (absolute >= 1) return 4;
  return 6;
}

function signedPositionCardValue(value: number | null, maximumFractionDigits: number) {
  if (value === null || !Number.isFinite(value)) return "—";
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${formatPositionCardNumber(Math.abs(value), maximumFractionDigits)}`;
}

function signedPositionCardPercent(value: number | null, maximumFractionDigits: number) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${signedPositionCardValue(value, maximumFractionDigits)}%`;
}

function positionCardTone(value: number | null) {
  if (value === null || Math.abs(value) < 1e-12) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function renderPositionCardMetric(label: string, value: string) {
  return `<div><span>${escapeXml(label)}</span><strong>${escapeXml(value)}</strong></div>`;
}

function formatOrderCardTimestamp(value: number | null) {
  if (value === null) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const twoDigits = (part: number) => String(part).padStart(2, "0");
  return `${twoDigits(date.getMonth() + 1)}/${twoDigits(date.getDate())}/${date.getFullYear()} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;
}

function orderCardTypeLabel(order: TradingOrderLineOrderDetails) {
  const labels: Record<string, string> = {
    LIMIT: "限价",
    MARKET: "市价",
    STOP: "限价止损",
    STOP_MARKET: "市价止损",
    TAKE_PROFIT: "限价止盈",
    TAKE_PROFIT_MARKET: "市价止盈",
    TRAILING_STOP_MARKET: "跟踪止损",
  };
  return labels[order.orderType] || order.orderType.replaceAll("_", " ") || "—";
}

function orderCardActionLabel(intent: TradingOrderLineOrderIntent) {
  const labels: Record<TradingOrderLineOrderIntent, string> = {
    OPEN_LONG: "做多",
    OPEN_SHORT: "做空",
    CLOSE_LONG: "平多",
    CLOSE_SHORT: "平空",
  };
  return labels[intent];
}

function orderCardIntro(order: TradingOrderLineOrderDetails) {
  const opening = order.intent === "OPEN_LONG" || order.intent === "OPEN_SHORT";
  const action = orderCardActionLabel(order.intent);
  if (order.source === "ALGO" && opening) {
    return {
      type: "条件委托",
      action: `${order.orderType.includes("MARKET") ? "市价" : "限价"}${action}`,
    };
  }
  return { type: orderCardTypeLabel(order), action };
}

function orderCardQuantity(value: number | null) {
  if (value === null) return "—";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 5,
    maximumFractionDigits: 5,
  });
}

function orderCardPrice(order: TradingOrderLineOrderDetails) {
  return order.orderType.includes("MARKET") || order.orderPrice === null
    ? "市价"
    : formatPositionCardNumber(order.orderPrice, positionCardPriceDecimals(order.orderPrice));
}

function orderCardTriggerComparator(order: TradingOrderLineOrderDetails) {
  const buy = order.side === "BUY";
  if (order.orderType.startsWith("TAKE_PROFIT")) return buy ? "≤" : "≥";
  return buy ? "≥" : "≤";
}

function orderCardPriceMetric(order: TradingOrderLineOrderDetails) {
  if (!order.orderType.includes("MARKET")) {
    return { label: "价格", value: orderCardPrice(order) };
  }
  const triggerPrice = order.triggerPrice;
  return {
    label: "触发价",
    value: triggerPrice === null
      ? "—"
      : `${orderCardTriggerComparator(order)}${formatPositionCardNumber(
        triggerPrice,
        positionCardPriceDecimals(triggerPrice),
      )}`,
  };
}

function renderOrderCardMetric(label: string, value: string) {
  return `<div><span>${escapeXml(label)}</span><strong>${escapeXml(value)}</strong></div>`;
}

function positionCardAriaLabel(position: TradingOrderLinePositionDetails) {
  const marginMode = position.marginType === "cross"
    ? "全仓"
    : position.marginType === "isolated"
      ? "逐仓"
      : "保证金模式未知";
  const leverage = position.leverage === null
    ? "杠杆未知"
    : `${formatPositionCardNumber(position.leverage, 0)}倍杠杆`;
  return [
    position.direction === "SHORT" ? "空头持仓" : "多头持仓",
    position.symbol,
    `${marginMode}${leverage}`,
    `未实现盈亏 ${signedPositionCardValue(position.unrealizedPnl, 4)} USDT`,
    `投资回报率 ${signedPositionCardPercent(position.roi, 2)}`,
    `开仓价格 ${formatPositionCardNumber(position.entryPrice, positionCardPriceDecimals(position.entryPrice))}`,
  ].join("，");
}

function tradingOrderLineLevelPriority(kind: TradingOrderLineKind) {
  if (kind === "liquidation") return 2;
  if (kind === "position-long" || kind === "position-short") return 1;
  return 0;
}

function groupTradingOrderLinePriceLevels(entries: readonly TradingOrderLineRenderGeometry[]) {
  const grouped = new Map<number, TradingOrderLineRenderGeometry[]>();
  entries.forEach((entry) => {
    const existing = grouped.get(entry.line.price);
    if (existing) existing.push(entry);
    else grouped.set(entry.line.price, [entry]);
  });
  return [...grouped.values()].map((members) => {
    const dominant = members.reduce((current, candidate) => (
      tradingOrderLineLevelPriority(candidate.line.kind) > tradingOrderLineLevelPriority(current.line.kind)
        ? candidate
        : current
    ));
    return {
      dominant,
      lineY: members[0].lineY,
      members,
      style: members.some((entry) => tradingOrderLineLevelPriority(entry.line.kind) > 0)
        ? "solid"
        : "dashed",
    } as const;
  });
}

export function renderTradingOrderLineSvg(
  lines: readonly TradingOrderLine[],
  market: string,
  bounds: { width: number; height: number },
  priceToCoordinate: (price: number) => number | null,
  candleObstacles: readonly TradingOrderLineCandleObstacle[] = [],
) {
  if (bounds.width <= 0 || bounds.height <= 0) return "";
  const entries = visibleTradingOrderLineGeometry(
    lines,
    market,
    bounds,
    priceToCoordinate,
    candleObstacles,
  );
  const priceLevelSvg = groupTradingOrderLinePriceLevels(entries).map((level) => {
    const dominantKind = level.dominant.line.kind;
    const kinds = [...new Set(level.members.map((entry) => entry.line.kind))].join(" ");
    return `<g class="trading-order-price-level trading-order-price-level-${level.style} trading-order-line-${dominantKind}" data-trading-order-price-level="${escapeXml(String(level.dominant.line.price))}" data-trading-order-line-count="${level.members.length}" data-trading-order-line-kinds="${escapeXml(kinds)}" aria-hidden="true">`
      + `<line class="trading-order-line-stroke" x1="0" y1="${level.lineY}" x2="${bounds.width}" y2="${level.lineY}" />`
      + `</g>`;
  }).join("");
  const labelSvg = entries.map(({
    line,
    lineY,
    labelY,
    labelLeft: left,
    labelTop: top,
    labelWidth: width,
    priceLevelIndex,
    priceLevelCount,
  }) => {
    const position = line.kind === "position-long" || line.kind === "position-short";
    const liquidation = line.kind === "liquidation";
    const keyWidth = orderLineLabelKeyWidth(line.kind);
    const labelTextX = left + keyWidth + ORDER_LINE_LABEL_TEXT_GAP;
    const lineEnd = Math.max(0, left - 6);
    const connector = priceLevelIndex === 0 && Math.abs(lineY - labelY) > 0.5
      ? `<path class="trading-order-line-connector" d="M ${lineEnd} ${lineY} L ${left - 2} ${labelY}" />`
      : "";
    const title = escapeXml(position && line.position
      ? positionCardAriaLabel(line.position)
      : line.ariaLabel ?? `${line.shortLabel} ${line.label}`);
    const shortLabel = escapeXml(line.shortLabel);
    const pnlClass = line.pnl === null || line.pnl === undefined
      ? "unknown"
      : line.pnl > 0
        ? "profit"
        : line.pnl < 0
          ? "loss"
          : "flat";
    const quantityText = quantityUsdtLabel(line.quantityUsdt ?? null);
    const pnlText = line.pnl === null || line.pnl === undefined ? "" : signedUsdt(line.pnl);
    const labelText = `<text class="trading-order-line-label-text" x="${labelTextX}" y="${labelY + 0.5}">`
      + (liquidation
        ? `<tspan class="trading-order-line-liquidation-price">${escapeXml(line.label)}</tspan>`
        : `<tspan class="trading-order-line-quantity">${escapeXml(quantityText)}</tspan>`
          + (pnlText
            ? `<tspan> </tspan><tspan class="trading-order-line-pnl-value ${pnlClass}">${escapeXml(pnlText)}</tspan>`
            : ""))
      + `</text>`;
    const cardTrigger = !liquidation && (line.position || line.order)
      ? ` data-trading-order-card-trigger="${escapeXml(line.id)}" data-trading-order-position-trigger="${escapeXml(line.id)}" tabindex="0" role="group"`
      : "";
    const hitboxClass = !liquidation && (line.position || line.order)
      ? " trading-order-line-card-hitbox trading-order-line-position-hitbox"
      : "";
    return `<g class="trading-order-line trading-order-line-${line.kind}" data-trading-order-line="${escapeXml(line.id)}" data-order-label-left="${left}" data-order-price-level="${escapeXml(String(line.price))}" data-order-price-level-index="${priceLevelIndex}" data-order-price-level-count="${priceLevelCount}" aria-label="${title}"${cardTrigger}>`
      + `<title>${title}</title>`
      + connector
      + `<rect class="trading-order-line-label-bg${hitboxClass}" x="${left}" y="${top}" width="${width}" height="${ORDER_LINE_LABEL_HEIGHT}" rx="3" />`
      + `<rect class="trading-order-line-label-key" x="${left}" y="${top}" width="${keyWidth}" height="${ORDER_LINE_LABEL_HEIGHT}" rx="3" />`
      + `<rect class="trading-order-line-label-key-square" x="${left + keyWidth - 3}" y="${top}" width="3" height="${ORDER_LINE_LABEL_HEIGHT}" />`
      + `<text class="trading-order-line-key-text" x="${left + keyWidth / 2}" y="${labelY + 0.5}">${shortLabel}</text>`
      + labelText
      + `</g>`;
  }).join("");
  return priceLevelSvg + labelSvg;
}

export function fitTradingOrderLineLabels(
  orderLineRoot: ParentNode,
  positionCardRoot: ParentNode | null,
  bounds: { width: number; height: number },
) {
  const cards = new Map<string, HTMLElement>();
  positionCardRoot?.querySelectorAll<HTMLElement>("[data-trading-order-card]").forEach((card) => {
    const id = card.getAttribute("data-trading-order-card");
    if (id) cards.set(id, card);
  });
  orderLineRoot.querySelectorAll<SVGGElement>(".trading-order-line").forEach((group) => {
    const background = group.querySelector<SVGRectElement>(".trading-order-line-label-bg");
    const text = group.querySelector<SVGTextElement>(".trading-order-line-label-text");
    if (!background || !text) return;
    const left = Number(background.getAttribute("x"));
    if (!Number.isFinite(left)) return;
    let textBounds: DOMRect;
    try {
      textBounds = text.getBBox();
    } catch {
      return;
    }
    const availableWidth = Math.max(1, bounds.width - ORDER_LINE_PRICE_AXIS_GUTTER - left);
    const fittedWidth = Math.min(
      availableWidth,
      Math.max(1, textBounds.x + textBounds.width - left + ORDER_LINE_LABEL_RIGHT_PADDING),
    );
    const priceLevelCount = Number(group.getAttribute("data-order-price-level-count"));
    const renderedWidth = Number(background.getAttribute("width"));
    const preservedWidth = Number.isFinite(renderedWidth) ? renderedWidth : fittedWidth;
    const finalWidth = priceLevelCount > 1 ? preservedWidth : fittedWidth;
    background.setAttribute("width", String(Math.round(finalWidth * 1_000) / 1_000));

    const id = group.getAttribute("data-trading-order-line");
    const card = id ? cards.get(id) : null;
    if (!card) return;
    const wasHidden = card.hidden;
    if (wasHidden) {
      card.style.visibility = "hidden";
      card.hidden = false;
    }
    const cardBounds = card.getBoundingClientRect();
    if (wasHidden) {
      card.hidden = true;
      card.style.removeProperty("visibility");
    }
    const cardWidth = cardBounds.width;
    const cardHeight = cardBounds.height;
    if (!Number.isFinite(cardWidth) || cardWidth <= 0 || !Number.isFinite(cardHeight) || cardHeight <= 0) return;
    const maximumLeft = Math.max(8, bounds.width - cardWidth - 8);
    const cardLeft = Math.min(maximumLeft, Math.max(8, left + finalWidth - cardWidth));
    card.style.left = `${Math.round(cardLeft * 1_000) / 1_000}px`;

    const labelTop = Number(background.getAttribute("y"));
    const labelHeight = Number(background.getAttribute("height"));
    if (!Number.isFinite(labelTop) || !Number.isFinite(labelHeight)) return;
    const aboveTop = labelTop - ORDER_POSITION_CARD_GAP - cardHeight;
    const belowTop = labelTop + labelHeight + ORDER_POSITION_CARD_GAP;
    const placement = aboveTop >= 8 ? "above" : "below";
    const maximumTop = Math.max(8, bounds.height - cardHeight - 8);
    const cardTop = placement === "above"
      ? aboveTop
      : Math.min(maximumTop, Math.max(8, belowTop));
    card.dataset.placement = placement;
    card.style.top = `${Math.round(cardTop * 1_000) / 1_000}px`;
  });
}

export function renderTradingOrderPositionCards(
  lines: readonly TradingOrderLine[],
  market: string,
  bounds: { width: number; height: number },
  priceToCoordinate: (price: number) => number | null,
  candleObstacles: readonly TradingOrderLineCandleObstacle[] = [],
) {
  if (bounds.width <= 0 || bounds.height <= 0) return "";
  return visibleTradingOrderLineGeometry(
    lines,
    market,
    bounds,
    priceToCoordinate,
    candleObstacles,
  ).flatMap(({ line, labelLeft, labelTop, labelWidth }) => {
    const position = line.position;
    const order = line.order;
    if (!position && !order) return [];
    const initialLeft = Math.max(8, labelLeft + labelWidth);
    const initialTop = Math.max(8, labelTop);
    if (order) {
      const tone = order.side === "SELL" ? "short" : "long";
      const intro = orderCardIntro(order);
      const priceMetric = orderCardPriceMetric(order);
      const metrics = [
        renderOrderCardMetric("数量 (USDT)", orderCardQuantity(order.quantityUsdt)),
        renderOrderCardMetric(priceMetric.label, priceMetric.value),
      ].join("");
      const timestamp = formatOrderCardTimestamp(order.createdAt);
      return [`<section class="trading-order-position-card trading-order-commission-card ${tone}" data-trading-order-card="${escapeXml(line.id)}" data-trading-order-position-card="${escapeXml(line.id)}" data-placement="pending" role="tooltip" aria-hidden="true" hidden style="left:${initialLeft}px;top:${initialTop}px">`
        + `<header><div class="trading-order-position-card-symbol">`
        + `<strong>${escapeXml(order.symbol)}</strong>`
        + `<span>永续</span>`
        + `</div></header>`
        + `<div class="trading-order-commission-card-intro">`
        + `<strong>${escapeXml(intro.type)} / ${escapeXml(intro.action)}</strong>`
        + `<time${order.createdAt === null ? "" : ` datetime="${escapeXml(new Date(order.createdAt).toISOString())}"`}>${escapeXml(timestamp)}</time>`
        + `</div>`
        + `<div class="trading-order-commission-card-details">${metrics}</div>`
        + `</section>`];
    }
    if (!position) return [];
    const side = position.direction === "SHORT" ? "short" : "long";
    const marginMode = position.marginType === "cross"
      ? "全仓"
      : position.marginType === "isolated"
        ? "逐仓"
        : "保证金";
    const leverage = position.leverage === null
      ? ""
      : ` ${formatPositionCardNumber(position.leverage, 0)}X`;
    const pnlTone = positionCardTone(position.unrealizedPnl);
    const roiTone = positionCardTone(position.roi);
    const metrics = [
      renderPositionCardMetric("持仓数量 (USDT)", formatPositionCardNumber(position.notionalValue, 4)),
      renderPositionCardMetric("保证金 (USDT)", formatPositionCardNumber(position.margin, 6)),
      renderPositionCardMetric("保证金比率", position.marginRatio === null
        ? "—"
        : `${formatPositionCardNumber(position.marginRatio, 2)}%`),
      renderPositionCardMetric("开仓价格 (USDT)", formatPositionCardNumber(
        position.entryPrice,
        positionCardPriceDecimals(position.entryPrice),
      )),
      renderPositionCardMetric("标记价格 (USDT)", formatPositionCardNumber(
        position.markPrice,
        positionCardPriceDecimals(position.markPrice),
      )),
      renderPositionCardMetric("强平价格 (USDT)", formatPositionCardNumber(
        position.liquidationPrice,
        positionCardPriceDecimals(position.liquidationPrice),
      )),
    ].join("");
    return [`<section class="trading-order-position-card ${side}" data-trading-order-card="${escapeXml(line.id)}" data-trading-order-position-card="${escapeXml(line.id)}" data-placement="pending" role="tooltip" aria-hidden="true" hidden style="left:${initialLeft}px;top:${initialTop}px">`
      + `<header><div class="trading-order-position-card-symbol">`
      + `<span class="trading-order-position-card-side">${side === "short" ? "空" : "多"}</span>`
      + `<strong>${escapeXml(position.symbol)}</strong>`
      + `<span>永续</span><span>${marginMode}${leverage}</span>`
      + `</div></header>`
      + `<div class="trading-order-position-card-featured">`
      + `<div class="${pnlTone}"><span>未实现盈亏 (USDT)</span><strong>${escapeXml(signedPositionCardValue(position.unrealizedPnl, 4))}</strong></div>`
      + `<div class="${roiTone}"><span>投资回报率</span><strong>${escapeXml(signedPositionCardPercent(position.roi, 2))}</strong></div>`
      + `</div>`
      + `<div class="trading-order-position-card-metrics">${metrics}</div>`
      + `</section>`];
  }).join("");
}
