import crypto from "node:crypto";
import { BinanceCredentialError } from "./credential-store.mjs";

const DEFAULT_SPOT_BASE_URL = "https://api.binance.com";
const DEFAULT_FUTURES_BASE_URL = "https://fapi.binance.com";
const DEFAULT_RECV_WINDOW = 5_000;
const REQUEST_TIMEOUT_MS = 12_000;
const POSITION_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const POSITION_HISTORY_TRADE_LIMIT = 1_000;
const POSITION_HISTORY_CONCURRENCY = 4;
const DEFAULT_SNAPSHOT_CACHE_TTL_MS = 60_000;
const DEFAULT_SNAPSHOT_STALE_TTL_MS = 15 * 60_000;
const STALE_SNAPSHOT_WARNING = "Binance 暂时连接不稳定，当前展示上次成功读取的数据";

export class BinanceAccountError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "BinanceAccountError";
    this.code = code;
    this.retryable = options.retryable === true;
  }
}

export class BinanceAccountService {
  constructor({
    credentialStore,
    fetch: networkFetch = globalThis.fetch,
    now = () => new Date(),
    spotBaseUrl = DEFAULT_SPOT_BASE_URL,
    futuresBaseUrl = DEFAULT_FUTURES_BASE_URL,
    recvWindow = DEFAULT_RECV_WINDOW,
    snapshotCacheTtlMs = DEFAULT_SNAPSHOT_CACHE_TTL_MS,
    snapshotStaleTtlMs = DEFAULT_SNAPSHOT_STALE_TTL_MS,
  } = {}) {
    if (!credentialStore) throw new Error("credentialStore is required");
    if (typeof networkFetch !== "function") throw new Error("fetch is required");
    this.credentialStore = credentialStore;
    this.fetch = networkFetch;
    this.now = now;
    this.spotBaseUrl = normalizedBaseUrl(spotBaseUrl, DEFAULT_SPOT_BASE_URL);
    this.futuresBaseUrl = normalizedBaseUrl(futuresBaseUrl, DEFAULT_FUTURES_BASE_URL);
    this.recvWindow = Math.min(60_000, Math.max(1_000, Number(recvWindow) || DEFAULT_RECV_WINDOW));
    this.snapshotCacheTtlMs = normalizedDuration(snapshotCacheTtlMs, DEFAULT_SNAPSHOT_CACHE_TTL_MS);
    this.snapshotStaleTtlMs = Math.max(
      this.snapshotCacheTtlMs,
      normalizedDuration(snapshotStaleTtlMs, DEFAULT_SNAPSHOT_STALE_TTL_MS),
    );
    this.snapshotCache = new Map();
    this.snapshotRequests = new Map();
    this.snapshotCacheVersions = new Map();
  }

  async status(ownerId) {
    const status = await this.credentialStore.status(ownerId);
    if (!status?.bound) this.invalidateSnapshotCache(ownerId);
    return status;
  }

  async bind(ownerId, credentials = {}, { beforeSave } = {}) {
    const normalized = normalizeCredentials(credentials);
    const snapshot = await this.snapshotWithCredentials(normalized);
    if (beforeSave != null && typeof beforeSave !== "function") {
      throw new Error("beforeSave must be a function");
    }
    if (beforeSave) await beforeSave();
    const status = await this.credentialStore.upsert(ownerId, normalized);
    this.invalidateSnapshotCache(ownerId);
    this.storeSnapshotCache(ownerId, snapshot);
    return { status, snapshot };
  }

  async remove(ownerId) {
    const status = await this.credentialStore.remove(ownerId);
    this.invalidateSnapshotCache(ownerId);
    return status;
  }

  async snapshot(ownerId, { force = false } = {}) {
    const cached = this.snapshotCache.get(ownerId);
    const nowMs = this.currentTimeMs();
    if (!force && cached && nowMs - cached.cachedAt < this.snapshotCacheTtlMs) {
      return cached.snapshot;
    }
    const pending = this.snapshotRequests.get(ownerId);
    if (pending) return pending;

    const cacheVersion = this.snapshotCacheVersions.get(ownerId) || 0;
    const request = (async () => {
      try {
        const credentials = await this.credentialStore.resolve(ownerId);
        const snapshot = await this.snapshotWithCredentials(credentials);
        if ((this.snapshotCacheVersions.get(ownerId) || 0) === cacheVersion) {
          this.storeSnapshotCache(ownerId, snapshot);
        }
        return snapshot;
      } catch (error) {
        const fallback = this.snapshotCache.get(ownerId);
        const fallbackAge = fallback ? this.currentTimeMs() - fallback.cachedAt : Number.POSITIVE_INFINITY;
        if (error?.retryable === true && fallback && fallbackAge <= this.snapshotStaleTtlMs) {
          return snapshotWithWarning(fallback.snapshot, STALE_SNAPSHOT_WARNING);
        }
        throw error;
      } finally {
        if (this.snapshotRequests.get(ownerId) === request) this.snapshotRequests.delete(ownerId);
      }
    })();
    this.snapshotRequests.set(ownerId, request);
    return request;
  }

  currentTimeMs() {
    const value = this.now();
    const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  storeSnapshotCache(ownerId, snapshot) {
    this.snapshotCache.set(ownerId, { snapshot, cachedAt: this.currentTimeMs() });
  }

  invalidateSnapshotCache(ownerId) {
    this.snapshotCache.delete(ownerId);
    this.snapshotCacheVersions.set(ownerId, (this.snapshotCacheVersions.get(ownerId) || 0) + 1);
  }

  async validateCredentials(credentials) {
    const serverTime = await this.serverTime(this.futuresBaseUrl, "/fapi/v1/time");
    const account = await this.signedGet({
      baseUrl: this.futuresBaseUrl,
      pathname: "/fapi/v3/account",
      credentials,
      serverTime,
    });
    if (!account || typeof account !== "object" || Array.isArray(account)) {
      throw new BinanceAccountError("INVALID_ACCOUNT_RESPONSE", "Binance 返回了无法识别的合约账户数据。", { retryable: true });
    }
    return true;
  }

  async snapshotWithCredentials(credentials) {
    const fetchedAt = this.now();
    const nowMs = fetchedAt instanceof Date ? fetchedAt.getTime() : new Date(fetchedAt).getTime();
    const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const historyStartTime = Math.max(0, safeNowMs - POSITION_HISTORY_WINDOW_MS);
    const todayStartTime = startOfLocalDayMs(safeNowMs);
    const warnings = [];
    const futuresTime = await this.serverTime(this.futuresBaseUrl, "/fapi/v1/time");
    const shared = { credentials, serverTime: futuresTime, baseUrl: this.futuresBaseUrl };
    const [account, positions, incomeResult, walletResult] = await Promise.all([
      this.signedGet({ ...shared, pathname: "/fapi/v3/account" }),
      this.signedGet({ ...shared, pathname: "/fapi/v2/positionRisk" }),
      this.signedGet({
        ...shared,
        pathname: "/fapi/v1/income",
        params: {
          incomeType: "REALIZED_PNL",
          startTime: historyStartTime,
          endTime: safeNowMs,
          page: 1,
          limit: 1_000,
        },
      }).then((value) => ({ value })).catch((error) => ({ error })),
      this.walletBalances(credentials).then((value) => ({ value })).catch((error) => ({ error })),
    ]);
    if (incomeResult.error) warnings.push("今日已实现盈亏暂时无法读取");
    if (walletResult.error) warnings.push("总资产暂以 USDⓈ-M 合约保证金余额展示");
    const accountTradesResult = incomeResult.error
      ? { trades: [], failedSymbols: [], truncatedSymbols: [] }
      : await this.recentAccountTrades({
          credentials,
          income: incomeResult.value,
          startTime: historyStartTime,
          endTime: safeNowMs,
        });
    if (incomeResult.error || accountTradesResult.failedSymbols.length) {
      warnings.push("部分仓位历史暂时无法读取");
    }
    if (accountTradesResult.truncatedSymbols.length) {
      warnings.push("成交频繁的合约仅展示 Binance 本次返回范围内的仓位历史");
    }
    return normalizeBinanceAccountSnapshot({
      account,
      positions,
      income: incomeResult.value ?? null,
      accountTrades: accountTradesResult.trades,
      walletBalances: walletResult.value ?? null,
      fetchedAt: new Date(safeNowMs).toISOString(),
      todayStartTime,
      historyStartTime,
      warnings,
    });
  }

  async recentAccountTrades({ credentials, income, startTime, endTime }) {
    const symbols = [...new Set(
      (Array.isArray(income) ? income : [])
        .map((item) => String(item?.symbol || "").trim().toUpperCase())
        .filter(Boolean),
    )];
    if (!symbols.length) return { trades: [], failedSymbols: [], truncatedSymbols: [] };
    let freshServerTime;
    try {
      freshServerTime = await this.serverTime(this.futuresBaseUrl, "/fapi/v1/time");
    } catch {
      return { trades: [], failedSymbols: symbols, truncatedSymbols: [] };
    }
    const synchronizedAt = Date.now();
    const results = await mapWithConcurrency(symbols, POSITION_HISTORY_CONCURRENCY, async (symbol) => {
      const trades = [];
      const seenTradeIds = new Set();
      let fromId = null;
      let failed = false;
      let truncated = false;
      while (true) {
        let value;
        try {
          value = await this.signedGet({
            baseUrl: this.futuresBaseUrl,
            pathname: "/fapi/v1/userTrades",
            credentials,
            serverTime: freshServerTime + (Date.now() - synchronizedAt),
            params: fromId == null
              ? { symbol, startTime, endTime, limit: POSITION_HISTORY_TRADE_LIMIT }
              : { symbol, fromId, limit: POSITION_HISTORY_TRADE_LIMIT },
          });
        } catch {
          failed = true;
          break;
        }
        const page = Array.isArray(value) ? value : [];
        for (const trade of page) {
          const time = finiteNumber(trade?.time);
          const id = finiteNumber(trade?.id ?? trade?.tradeId);
          if (time == null || time < startTime || time > endTime) continue;
          const dedupeKey = id == null
            ? `${trade?.orderId ?? ""}:${time}:${trade?.side ?? ""}:${tradeQuantity(trade)}:${trade?.price ?? ""}`
            : String(id);
          if (seenTradeIds.has(dedupeKey)) continue;
          seenTradeIds.add(dedupeKey);
          trades.push(trade);
        }
        if (page.length < POSITION_HISTORY_TRADE_LIMIT) break;
        const lastTradeId = page.reduce((maximum, trade) => Math.max(maximum, finiteNumber(trade?.id ?? trade?.tradeId) ?? -1), -1);
        if (lastTradeId < 0 || (fromId != null && lastTradeId < fromId)) {
          truncated = true;
          break;
        }
        fromId = lastTradeId + 1;
      }
      return { symbol, trades, failed, truncated };
    });
    return {
      trades: results.flatMap((result) => result.trades),
      failedSymbols: results.filter((result) => result.failed).map((result) => result.symbol),
      truncatedSymbols: results.filter((result) => result.truncated).map((result) => result.symbol),
    };
  }

  async walletBalances(credentials) {
    const serverTime = await this.serverTime(this.spotBaseUrl, "/api/v3/time");
    return this.signedGet({
      baseUrl: this.spotBaseUrl,
      pathname: "/sapi/v1/asset/wallet/balance",
      credentials,
      serverTime,
      params: { quoteAsset: "USDT" },
    });
  }

  async serverTime(baseUrl, pathname) {
    const payload = await requestJson(this.fetch, new URL(pathname, `${baseUrl}/`).toString());
    const serverTime = finiteNumber(payload?.serverTime);
    if (serverTime == null || serverTime <= 0) {
      throw new BinanceAccountError("INVALID_SERVER_TIME", "Binance 时间服务返回异常，请稍后重试。", { retryable: true });
    }
    return serverTime;
  }

  async signedGet({ baseUrl, pathname, credentials, serverTime, params = {} }) {
    const url = buildSignedBinanceUrl({
      baseUrl,
      pathname,
      params: { ...params, recvWindow: this.recvWindow, timestamp: Math.trunc(serverTime) },
      apiSecret: credentials.apiSecret,
    });
    return requestJson(this.fetch, url, {
      headers: { "X-MBX-APIKEY": credentials.apiKey },
    });
  }
}

export function buildSignedBinanceUrl({ baseUrl, pathname, params = {}, apiSecret } = {}) {
  if (typeof apiSecret !== "string" || !apiSecret) {
    throw new BinanceAccountError("INVALID_API_SECRET", "请输入正确的 Binance Secret Key。");
  }
  const url = new URL(pathname, `${normalizedBaseUrl(baseUrl, DEFAULT_FUTURES_BASE_URL)}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  const query = url.searchParams.toString();
  const signature = crypto.createHmac("sha256", apiSecret).update(query, "utf8").digest("hex");
  url.searchParams.set("signature", signature);
  return url.toString();
}

export function startOfLocalDayMs(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function normalizeBinanceAccountSnapshot({
  account,
  positions,
  income,
  accountTrades,
  walletBalances,
  fetchedAt,
  todayStartTime,
  historyStartTime,
  warnings = [],
} = {}) {
  const totalMarginBalance = finiteNumber(account?.totalMarginBalance) ?? 0;
  const totalWalletBalance = finiteNumber(account?.totalWalletBalance) ?? 0;
  const totalUnrealizedPnl = finiteNumber(account?.totalUnrealizedProfit) ?? 0;
  const totalInitialMargin = finiteNumber(account?.totalInitialMargin) ?? 0;
  const availableBalance = finiteNumber(account?.availableBalance) ?? 0;
  const activatedWallets = Array.isArray(walletBalances)
    ? walletBalances.filter((item) => item?.activate !== false && finiteNumber(item?.balance) != null)
    : [];
  const walletEstimatedAssets = activatedWallets.length
    ? activatedWallets.reduce((sum, item) => sum + (finiteNumber(item?.balance) ?? 0), 0)
    : null;
  const realizedIncomeAvailable = Array.isArray(income);
  const realizedPnlToday = realizedIncomeAvailable
    ? income
      .filter((item) => (finiteNumber(item?.time) ?? Number.POSITIVE_INFINITY) >= (finiteNumber(todayStartTime) ?? 0))
      .reduce((sum, item) => sum + (finiteNumber(item?.income) ?? 0), 0)
    : null;
  const estimatedTotalAssets = walletEstimatedAssets ?? totalMarginBalance;
  const todayPnl = realizedPnlToday == null ? null : realizedPnlToday + totalUnrealizedPnl;
  const dayOpeningAssets = todayPnl == null ? null : estimatedTotalAssets - todayPnl;
  const todayPnlPercent = dayOpeningAssets != null && Math.abs(dayOpeningAssets) > 1e-12
    ? (todayPnl / Math.abs(dayOpeningAssets)) * 100
    : null;
  const accountPositions = new Map(
    (Array.isArray(account?.positions) ? account.positions : []).map((position) => [
      positionIdentity(position),
      position,
    ]),
  );
  const normalizedPositions = (Array.isArray(positions) ? positions : [])
    .filter((position) => Math.abs(finiteNumber(position?.positionAmt) ?? 0) > 1e-12)
    .map((position) => normalizePosition(position, accountPositions.get(positionIdentity(position))))
    .sort((left, right) => right.notionalValue - left.notionalValue);
  const positionHistory = normalizeBinancePositionHistory({
    trades: accountTrades,
    positions,
    fetchedAt,
    historyStartTime,
  });
  return {
    schemaVersion: 1,
    currency: "USDT",
    estimatedTotalAssets: normalNumber(estimatedTotalAssets),
    todayPnl: nullableNumber(todayPnl),
    todayPnlPercent: nullableNumber(todayPnlPercent),
    marginBalance: normalNumber(totalMarginBalance),
    walletBalance: normalNumber(totalWalletBalance),
    unrealizedPnl: normalNumber(totalUnrealizedPnl),
    realizedPnlToday: nullableNumber(realizedPnlToday),
    initialMargin: normalNumber(totalInitialMargin),
    availableBalance: normalNumber(availableBalance),
    positions: normalizedPositions,
    positionHistory,
    walletBreakdown: activatedWallets.map((item) => ({
      walletName: String(item?.walletName || "Binance"),
      balance: normalNumber(finiteNumber(item?.balance) ?? 0),
    })),
    sources: {
      totalAssets: walletEstimatedAssets == null ? "USD_M_FUTURES_MARGIN" : "BINANCE_WALLETS_USDT",
      futures: "USD_M_FUTURES",
      realizedPnl: realizedIncomeAvailable ? "USD_M_INCOME" : "UNAVAILABLE",
      positionHistory: Array.isArray(accountTrades) ? "USD_M_ACCOUNT_TRADES" : "UNAVAILABLE",
    },
    warnings: [...new Set(warnings.map((item) => String(item || "").trim()).filter(Boolean))],
    fetchedAt: Number.isFinite(Date.parse(String(fetchedAt || "")))
      ? new Date(fetchedAt).toISOString()
      : new Date().toISOString(),
  };
}

export function normalizeBinancePositionHistory({ trades, positions, fetchedAt, historyStartTime } = {}) {
  if (!Array.isArray(trades) || !trades.length) return [];
  const riskByIdentity = new Map(
    (Array.isArray(positions) ? positions : []).map((position) => [positionIdentity(position), position]),
  );
  const tradesByIdentity = new Map();
  for (const trade of trades) {
    const symbol = String(trade?.symbol || trade?.pair || "").trim().toUpperCase();
    const quantity = tradeQuantity(trade);
    const price = finiteNumber(trade?.price);
    const time = finiteNumber(trade?.time);
    const side = String(trade?.side || "").toUpperCase();
    if (!symbol || quantity <= 1e-12 || price == null || price < 0 || time == null || !["BUY", "SELL"].includes(side)) continue;
    const normalizedTrade = {
      ...trade,
      symbol,
      side,
      positionSide: String(trade?.positionSide || "BOTH").toUpperCase(),
      quantity,
      price,
      time,
      realizedPnl: finiteNumber(trade?.realizedPnl) ?? 0,
    };
    const identity = positionIdentity(normalizedTrade);
    const bucket = tradesByIdentity.get(identity) || [];
    bucket.push(normalizedTrade);
    tradesByIdentity.set(identity, bucket);
  }

  const result = [];
  for (const [identity, identityTrades] of tradesByIdentity) {
    identityTrades.sort((left, right) => left.time - right.time || tradeSequence(left) - tradeSequence(right));
    const risk = riskByIdentity.get(identity);
    const currentExposure = signedRiskExposure(risk, identityTrades[0]?.positionSide);
    const netTradeExposure = identityTrades.reduce((sum, trade) => sum + signedTradeExposure(trade), 0);
    let exposure = currentExposure - netTradeExposure;
    if (Math.abs(exposure) < 1e-12) exposure = 0;
    let session = exposure === 0 ? null : createHistorySession(identityTrades[0], exposure, null);

    for (const trade of identityTrades) {
      let delta = signedTradeExposure(trade);
      if (Math.abs(delta) < 1e-12) continue;
      if (exposure === 0) {
        exposure = delta;
        session = createHistorySession(trade, exposure, trade.time);
        continue;
      }
      if (Math.sign(exposure) === Math.sign(delta)) {
        exposure += delta;
        if (!session) session = createHistorySession(trade, exposure, trade.time);
        continue;
      }

      const closingQuantity = Math.min(Math.abs(exposure), Math.abs(delta));
      if (!session) session = createHistorySession(trade, exposure, null);
      addHistoryClose(session, trade, closingQuantity);
      const previousDirection = Math.sign(exposure);
      exposure += delta;
      if (Math.abs(exposure) < 1e-12) exposure = 0;
      if (exposure === 0 || Math.sign(exposure) !== previousDirection) {
        result.push(finalizeHistorySession(session, risk, exposure === 0 ? trade.time : trade.time, true));
        session = null;
      }
      if (exposure !== 0 && Math.sign(exposure) !== previousDirection) {
        session = createHistorySession(trade, exposure, trade.time);
      }
    }

    if (session?.closedAmount > 1e-12) {
      result.push(finalizeHistorySession(session, risk, null, false));
    }
  }

  const minimumCloseTime = finiteNumber(historyStartTime) ?? 0;
  return result
    .filter((record) => record.lastCloseTime >= minimumCloseTime)
    .map((record) => ({
      ...record,
      unrealizedPnl: record.closeType === "PARTIAL"
        ? normalNumber(finiteNumber(riskByIdentity.get(record.identity)?.unRealizedProfit ?? riskByIdentity.get(record.identity)?.unrealizedProfit) ?? 0)
        : null,
    }))
    .map(({ identity, lastCloseTime, ...record }) => record)
    .sort((left, right) => (right.closeTime ?? right.updatedAt) - (left.closeTime ?? left.updatedAt));
}

function createHistorySession(trade, exposure, openTime) {
  return {
    identity: positionIdentity(trade),
    symbol: trade.symbol,
    positionSide: trade.positionSide,
    direction: exposure < 0 ? "SHORT" : "LONG",
    openTime,
    closedAmount: 0,
    closeNotional: 0,
    inferredEntryNotional: 0,
    realizedPnl: 0,
    lastCloseTime: 0,
    lastTradeId: tradeSequence(trade),
  };
}

function addHistoryClose(session, trade, quantity) {
  if (quantity <= 1e-12) return;
  const closePrice = trade.price;
  const realizedPnl = trade.realizedPnl;
  const inferredEntryPrice = session.direction === "SHORT"
    ? closePrice + realizedPnl / quantity
    : closePrice - realizedPnl / quantity;
  session.closedAmount += quantity;
  session.closeNotional += closePrice * quantity;
  session.inferredEntryNotional += Math.max(0, inferredEntryPrice) * quantity;
  session.realizedPnl += realizedPnl;
  session.lastCloseTime = Math.max(session.lastCloseTime, trade.time);
  session.lastTradeId = Math.max(session.lastTradeId, tradeSequence(trade));
}

function finalizeHistorySession(session, risk, closeTime, fullyClosed) {
  const closedAmount = normalNumber(session.closedAmount);
  const entryPrice = closedAmount > 1e-12 ? session.inferredEntryNotional / closedAmount : 0;
  const averageClosePrice = closedAmount > 1e-12 ? session.closeNotional / closedAmount : 0;
  const rawLeverage = finiteNumber(risk?.leverage);
  const leverage = rawLeverage == null ? null : Math.max(1, rawLeverage);
  const initialMargin = leverage == null ? null : entryPrice * closedAmount / leverage;
  const realizedPnl = normalNumber(session.realizedPnl);
  return {
    id: `${session.identity}:${session.openTime ?? "before-window"}:${session.lastCloseTime}:${session.lastTradeId}`,
    identity: session.identity,
    symbol: session.symbol,
    contractType: "PERPETUAL",
    direction: session.direction,
    positionSide: session.positionSide,
    marginType: risk == null ? null : String(risk?.marginType || "cross").toLowerCase() === "isolated" ? "isolated" : "cross",
    leverage: leverage == null ? null : normalNumber(leverage),
    closeType: fullyClosed ? "FULL" : "PARTIAL",
    realizedPnl,
    unrealizedPnl: null,
    roi: initialMargin != null && initialMargin > 1e-12 ? normalNumber(realizedPnl / initialMargin * 100) : null,
    closedAmount,
    baseAsset: baseAssetForTrade(session.symbol, risk?.marginAsset),
    openTime: session.openTime,
    closeTime: fullyClosed ? closeTime : null,
    entryPrice: normalNumber(entryPrice),
    averageClosePrice: normalNumber(averageClosePrice),
    lastCloseTime: session.lastCloseTime,
    updatedAt: session.lastCloseTime,
  };
}

function signedRiskExposure(position, positionSide) {
  const amount = finiteNumber(position?.positionAmt) ?? 0;
  if (String(positionSide || "BOTH").toUpperCase() === "SHORT") return -Math.abs(amount);
  if (String(positionSide || "BOTH").toUpperCase() === "LONG") return Math.abs(amount);
  return amount;
}

function signedTradeExposure(trade) {
  const direction = trade.side === "BUY" ? 1 : -1;
  return direction * trade.quantity;
}

function tradeQuantity(trade) {
  for (const value of [trade?.qty, trade?.baseQty]) {
    const quantity = Math.abs(finiteNumber(value) ?? 0);
    if (quantity > 1e-12) return quantity;
  }
  return 0;
}

function tradeSequence(trade) {
  return finiteNumber(trade?.id ?? trade?.tradeId ?? trade?.orderId) ?? 0;
}

function baseAssetForTrade(symbol, marginAsset) {
  const quote = String(marginAsset || "USDT").trim().toUpperCase();
  return quote && symbol.endsWith(quote) ? symbol.slice(0, -quote.length) || symbol : symbol;
}

async function mapWithConcurrency(values, concurrency, mapper) {
  if (!values.length) return [];
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizePosition(position, accountPosition) {
  const rawAmount = finiteNumber(position?.positionAmt) ?? 0;
  const positionSide = String(position?.positionSide || "BOTH").toUpperCase();
  const direction = positionSide === "LONG" || positionSide === "SHORT"
    ? positionSide
    : rawAmount >= 0 ? "LONG" : "SHORT";
  const leverage = Math.max(1, finiteNumber(position?.leverage) ?? 1);
  const notionalValue = Math.abs(finiteNumber(position?.notional) ?? 0);
  const isolatedMargin = finiteNumber(position?.isolatedMargin) ?? 0;
  const initialMargin = finiteNumber(accountPosition?.initialMargin);
  const margin = Math.max(0, isolatedMargin > 0 ? isolatedMargin : initialMargin ?? notionalValue / leverage);
  const unrealizedPnl = finiteNumber(position?.unRealizedProfit ?? position?.unrealizedProfit) ?? 0;
  const maintenanceMargin = Math.max(0, finiteNumber(accountPosition?.maintMargin) ?? 0);
  const roi = margin > 1e-12 ? (unrealizedPnl / margin) * 100 : 0;
  const marginRatio = margin > 1e-12 ? (maintenanceMargin / margin) * 100 : 0;
  return {
    symbol: String(position?.symbol || "").toUpperCase(),
    direction,
    positionSide,
    marginType: String(position?.marginType || "cross").toLowerCase() === "isolated" ? "isolated" : "cross",
    leverage: normalNumber(leverage),
    amount: normalNumber(Math.abs(rawAmount)),
    notionalValue: normalNumber(notionalValue),
    margin: normalNumber(margin),
    unrealizedPnl: normalNumber(unrealizedPnl),
    roi: normalNumber(roi),
    marginRatio: normalNumber(marginRatio),
    entryPrice: normalNumber(finiteNumber(position?.entryPrice) ?? 0),
    markPrice: normalNumber(finiteNumber(position?.markPrice) ?? 0),
    liquidationPrice: normalNumber(finiteNumber(position?.liquidationPrice) ?? 0),
    breakEvenPrice: normalNumber(finiteNumber(position?.breakEvenPrice) ?? 0),
    marginAsset: String(position?.marginAsset || "USDT").toUpperCase(),
    updatedAt: finiteNumber(position?.updateTime) ?? 0,
  };
}

async function requestJson(networkFetch, url, init = {}) {
  const signal = typeof AbortSignal?.timeout === "function"
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
  let response;
  try {
    response = await networkFetch(url, { method: "GET", ...init, signal });
  } catch (error) {
    if (error instanceof BinanceAccountError || error instanceof BinanceCredentialError) throw error;
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new BinanceAccountError(
      timedOut ? "BINANCE_TIMEOUT" : "BINANCE_NETWORK_ERROR",
      timedOut ? "连接 Binance 超时，请检查网络后重试。" : "无法连接 Binance，请检查网络后重试。",
      { retryable: true },
    );
  }
  const text = await response.text().catch(() => "");
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (response.ok) {
        throw new BinanceAccountError("INVALID_RESPONSE", "Binance 返回了无法识别的数据。", { retryable: true });
      }
    }
  }
  if (!response.ok) throw binanceHttpError(response.status, payload);
  return payload;
}

function binanceHttpError(status, payload) {
  const code = Number(payload?.code);
  if (code === -2015 || status === 401) {
    return new BinanceAccountError(
      "BINANCE_AUTH_FAILED",
      "API Key 无效、IP 白名单不匹配，或未开通 Binance 合约读取权限。",
    );
  }
  if (code === -1022) {
    return new BinanceAccountError("BINANCE_SIGNATURE_INVALID", "API Key 与 Secret Key 不匹配，请重新检查。");
  }
  if (code === -1021) {
    return new BinanceAccountError("BINANCE_TIME_INVALID", "设备时间与 Binance 不一致，请稍后重试。", { retryable: true });
  }
  if (status === 418 || status === 429) {
    return new BinanceAccountError("BINANCE_RATE_LIMITED", "Binance 请求频率受限，请稍后再试。", { retryable: true });
  }
  if (status >= 500) {
    return new BinanceAccountError("BINANCE_UNAVAILABLE", "Binance 服务暂时不可用，请稍后重试。", { retryable: true });
  }
  return new BinanceAccountError("BINANCE_REQUEST_FAILED", "Binance 拒绝了本次请求，请检查 API 权限后重试。");
}

function normalizeCredentials(value) {
  const apiKey = typeof value?.apiKey === "string" ? value.apiKey.trim() : "";
  const apiSecret = typeof value?.apiSecret === "string" ? value.apiSecret.trim() : "";
  if (!apiKey || apiKey.length > 512 || /[\s\0]/.test(apiKey)) {
    throw new BinanceAccountError("INVALID_API_KEY", "请输入正确的 Binance API Key。");
  }
  if (!apiSecret || apiSecret.length > 2_048 || /[\r\n\0]/.test(apiSecret)) {
    throw new BinanceAccountError("INVALID_API_SECRET", "请输入正确的 Binance Secret Key。");
  }
  return { apiKey, apiSecret };
}

function normalizedBaseUrl(value, fallback) {
  const text = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  return /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(text) ? text : fallback;
}

function normalizedDuration(value, fallback) {
  const duration = Number(value);
  return Number.isFinite(duration) ? Math.max(0, Math.min(24 * 60 * 60 * 1_000, duration)) : fallback;
}

function snapshotWithWarning(snapshot, warning) {
  return {
    ...snapshot,
    warnings: [...new Set([...(Array.isArray(snapshot?.warnings) ? snapshot.warnings : []), warning])],
  };
}

function positionIdentity(position) {
  return `${String(position?.symbol || "").toUpperCase()}:${String(position?.positionSide || "BOTH").toUpperCase()}`;
}

function finiteNumber(value) {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}

function nullableNumber(value) {
  return value == null ? null : normalNumber(value);
}

function normalNumber(value) {
  if (!Number.isFinite(value) || Object.is(value, -0)) return 0;
  return value;
}
