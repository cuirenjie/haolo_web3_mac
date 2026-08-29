import crypto from "node:crypto";
import { BinanceCredentialError } from "./credential-store.mjs";

const DEFAULT_SPOT_BASE_URL = "https://api.binance.com";
const DEFAULT_FUTURES_BASE_URL = "https://fapi.binance.com";
const DEFAULT_RECV_WINDOW = 5_000;
const REQUEST_TIMEOUT_MS = 12_000;
const POSITION_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const POSITION_HISTORY_TRADE_LIMIT = 1_000;
const POSITION_HISTORY_CONCURRENCY = 4;
const PROFIT_CALENDAR_PAGE_LIMIT = 1_000;
const PROFIT_CALENDAR_MAX_PAGES = 100;
const PROFIT_CALENDAR_CHUNK_MS = 14 * 24 * 60 * 60 * 1_000;
const PROFIT_CALENDAR_SPLIT_MAX_DEPTH = 2;
const PROFIT_CALENDAR_CHUNK_CONCURRENCY = 3;
const PROFIT_CALENDAR_REQUEST_TIMEOUT_MS = 28_000;
const DEFAULT_SNAPSHOT_CACHE_TTL_MS = 60_000;
const DEFAULT_SNAPSHOT_STALE_TTL_MS = 15 * 60_000;
const DEFAULT_SERVER_TIME_CACHE_TTL_MS = 5 * 60_000;
const STALE_SNAPSHOT_WARNING = "Binance 暂时连接不稳定，当前展示上次成功读取的数据";
const BINANCE_DIRECT_ROUTE_FAILED = "BINANCE_DIRECT_ROUTE_FAILED";

export class BinanceAccountError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "BinanceAccountError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.retryAfterMs = Number.isFinite(options.retryAfterMs)
      ? Math.max(0, Number(options.retryAfterMs))
      : null;
  }
}

export class BinanceAccountService {
  constructor({
    credentialStore,
    fetch: networkFetch = globalThis.fetch,
    profitCalendarFetch = networkFetch,
    now = () => new Date(),
    spotBaseUrl = DEFAULT_SPOT_BASE_URL,
    futuresBaseUrl = DEFAULT_FUTURES_BASE_URL,
    recvWindow = DEFAULT_RECV_WINDOW,
    snapshotCacheTtlMs = DEFAULT_SNAPSHOT_CACHE_TTL_MS,
    snapshotStaleTtlMs = DEFAULT_SNAPSHOT_STALE_TTL_MS,
    serverTimeCacheTtlMs = DEFAULT_SERVER_TIME_CACHE_TTL_MS,
  } = {}) {
    if (!credentialStore) throw new Error("credentialStore is required");
    if (typeof networkFetch !== "function") throw new Error("fetch is required");
    if (typeof profitCalendarFetch !== "function") throw new Error("profitCalendarFetch is required");
    this.credentialStore = credentialStore;
    this.fetch = networkFetch;
    this.profitCalendarFetch = profitCalendarFetch;
    this.now = now;
    this.spotBaseUrl = normalizedBaseUrl(spotBaseUrl, DEFAULT_SPOT_BASE_URL);
    this.futuresBaseUrl = normalizedBaseUrl(futuresBaseUrl, DEFAULT_FUTURES_BASE_URL);
    this.recvWindow = Math.min(60_000, Math.max(1_000, Number(recvWindow) || DEFAULT_RECV_WINDOW));
    this.snapshotCacheTtlMs = normalizedDuration(snapshotCacheTtlMs, DEFAULT_SNAPSHOT_CACHE_TTL_MS);
    this.snapshotStaleTtlMs = Math.max(
      this.snapshotCacheTtlMs,
      normalizedDuration(snapshotStaleTtlMs, DEFAULT_SNAPSHOT_STALE_TTL_MS),
    );
    this.serverTimeCacheTtlMs = normalizedDuration(
      serverTimeCacheTtlMs,
      DEFAULT_SERVER_TIME_CACHE_TTL_MS,
    );
    this.snapshotCache = new Map();
    this.snapshotRequests = new Map();
    this.snapshotCacheVersions = new Map();
    this.snapshotRequestSequences = new Map();
    this.serverTimeCache = new Map();
    this.serverTimeRequests = new Map();
    this.profitCalendarCache = new Map();
    this.profitCalendarRequests = new Map();
    this.profitCalendarOwnerRequests = new Map();
    this.rateLimitedUntil = 0;
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

  async snapshot(ownerId, { force = false, live = false, summary = false } = {}) {
    const cached = this.snapshotCache.get(ownerId);
    const nowMs = this.currentTimeMs();
    if (nowMs < this.rateLimitedUntil) {
      const fallbackAge = cached ? nowMs - cached.cachedAt : Number.POSITIVE_INFINITY;
      if (cached && fallbackAge <= this.snapshotStaleTtlMs) {
        return snapshotWithWarning(cached.snapshot, STALE_SNAPSHOT_WARNING);
      }
      throw new BinanceAccountError(
        "BINANCE_RATE_LIMITED",
        "Binance 请求频率受限，客户端正在自动降频，请稍后再试。",
        { retryable: true, retryAfterMs: this.rateLimitedUntil - nowMs },
      );
    }
    if (!force && cached && nowMs - cached.cachedAt < this.snapshotCacheTtlMs) {
      return cached.snapshot;
    }
    const summaryOnly = summary === true && Boolean(cached?.snapshot);
    const liveOnly = !summaryOnly && live === true && Boolean(cached?.snapshot);
    const requestMode = summaryOnly ? "summary" : liveOnly ? "live" : "full";
    const requestKey = `${ownerId}\0${requestMode}`;
    const pending = this.snapshotRequests.get(requestKey);
    if (pending) return pending;

    const cacheVersion = this.snapshotCacheVersions.get(ownerId) || 0;
    const requestSequence = (this.snapshotRequestSequences.get(ownerId) || 0) + 1;
    this.snapshotRequestSequences.set(ownerId, requestSequence);
    const request = (async () => {
      try {
        const credentials = await this.credentialStore.resolve(ownerId);
        const snapshot = await this.snapshotWithCredentials(credentials, {
          previousSnapshot: cached?.snapshot ?? null,
          live: liveOnly,
          summary: summaryOnly,
        });
        if (
          (this.snapshotCacheVersions.get(ownerId) || 0) === cacheVersion
          && this.snapshotRequestSequences.get(ownerId) === requestSequence
        ) {
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
        if (this.snapshotRequests.get(requestKey) === request) this.snapshotRequests.delete(requestKey);
      }
    })();
    this.snapshotRequests.set(requestKey, request);
    return request;
  }

  async profitCalendar(ownerId, { month, force = false } = {}) {
    const nowMs = this.currentTimeMs();
    const normalizedMonth = normalizeProfitCalendarMonth(month, nowMs);
    const { startTime, endTime } = localMonthRange(normalizedMonth);
    if (startTime > nowMs) {
      throw new BinanceAccountError("INVALID_PROFIT_CALENDAR_MONTH", "不能读取未来月份的收益日历。");
    }
    const cacheKey = `${ownerId}\0${normalizedMonth}`;
    const cached = this.profitCalendarCache.get(cacheKey);
    const closedMonth = endTime <= nowMs;
    if (nowMs < this.rateLimitedUntil) {
      const fallbackAge = cached ? nowMs - cached.cachedAt : Number.POSITIVE_INFINITY;
      if (cached && (closedMonth || fallbackAge <= this.snapshotStaleTtlMs)) {
        return profitCalendarWithWarning(cached.calendar, STALE_SNAPSHOT_WARNING);
      }
      throw new BinanceAccountError(
        "BINANCE_RATE_LIMITED",
        "Binance 请求频率受限，客户端正在自动降频，请稍后再试。",
        { retryable: true, retryAfterMs: this.rateLimitedUntil - nowMs },
      );
    }
    if (!force && cached && (closedMonth || nowMs - cached.cachedAt < this.snapshotCacheTtlMs)) {
      return cached.calendar;
    }
    const pending = this.profitCalendarRequests.get(cacheKey);
    if (pending) return pending;
    const previousOwnerRequest = this.profitCalendarOwnerRequests.get(ownerId);
    if (previousOwnerRequest?.cacheKey !== cacheKey) {
      previousOwnerRequest?.controller.abort(new DOMException(
        "A newer Binance profit-calendar month was requested",
        "AbortError",
      ));
    }

    const cacheVersion = this.snapshotCacheVersions.get(ownerId) || 0;
    const controller = new AbortController();
    const request = (async () => {
      try {
        const credentials = await this.credentialStore.resolve(ownerId);
        const serverTime = await this.serverTime(this.futuresBaseUrl, "/fapi/v1/time");
        const result = await this.monthlyProfitCalendarIncome({
          credentials,
          serverTime,
          startTime,
          endTime: Math.min(endTime - 1, nowMs),
          signal: controller.signal,
        });
        const calendar = normalizeBinanceProfitCalendar({
          month: normalizedMonth,
          income: result.income,
          fetchedAt: new Date(nowMs).toISOString(),
          warnings: result.truncated
            ? ["本月成交记录过多，收益日历仅展示 Binance 本次可读取的范围"]
            : [],
        });
        if ((this.snapshotCacheVersions.get(ownerId) || 0) === cacheVersion) {
          this.profitCalendarCache.set(cacheKey, { calendar, cachedAt: this.currentTimeMs() });
        }
        return calendar;
      } catch (error) {
        const fallback = this.profitCalendarCache.get(cacheKey);
        const fallbackAge = fallback ? this.currentTimeMs() - fallback.cachedAt : Number.POSITIVE_INFINITY;
        if (error?.retryable === true && fallback && (closedMonth || fallbackAge <= this.snapshotStaleTtlMs)) {
          return profitCalendarWithWarning(fallback.calendar, STALE_SNAPSHOT_WARNING);
        }
        throw error;
      } finally {
        if (this.profitCalendarRequests.get(cacheKey) === request) this.profitCalendarRequests.delete(cacheKey);
        if (this.profitCalendarOwnerRequests.get(ownerId)?.request === request) {
          this.profitCalendarOwnerRequests.delete(ownerId);
        }
      }
    })();
    this.profitCalendarRequests.set(cacheKey, request);
    this.profitCalendarOwnerRequests.set(ownerId, { cacheKey, request, controller });
    return request;
  }

  async monthlyProfitCalendarIncome({ credentials, serverTime, startTime, endTime, signal }) {
    const synchronizedAt = Date.now();
    const ranges = [];
    for (let chunkStart = startTime; chunkStart <= endTime; chunkStart += PROFIT_CALENDAR_CHUNK_MS) {
      const chunkEnd = Math.min(endTime, chunkStart + PROFIT_CALENDAR_CHUNK_MS - 1);
      ranges.push({ startTime: chunkStart, endTime: chunkEnd });
    }
    const results = await mapWithConcurrency(
      ranges,
      PROFIT_CALENDAR_CHUNK_CONCURRENCY,
      ({ startTime: rangeStartTime, endTime: rangeEndTime }) => this.profitCalendarIncomeRange({
        credentials,
        serverTime,
        synchronizedAt,
        startTime: rangeStartTime,
        endTime: rangeEndTime,
        signal,
      }),
    );
    return {
      income: results.flatMap((result) => result.income),
      truncated: results.some((result) => result.truncated),
    };
  }

  async profitCalendarIncomeRange({
    credentials,
    serverTime,
    synchronizedAt,
    startTime,
    endTime,
    splitDepth = 0,
    signal,
  }) {
    try {
      return await this.pagedProfitCalendarIncome({
        credentials,
        serverTime,
        synchronizedAt,
        startTime,
        endTime,
        signal,
      });
    } catch (error) {
      const canSplit = !signal?.aborted
        && profitCalendarRangeRetryable(error)
        && splitDepth < PROFIT_CALENDAR_SPLIT_MAX_DEPTH
        && endTime - startTime >= 2 * 24 * 60 * 60 * 1_000;
      if (!canSplit) throw error;
      const midpoint = Math.floor((startTime + endTime) / 2);
      const left = await this.profitCalendarIncomeRange({
        credentials,
        serverTime,
        synchronizedAt,
        startTime,
        endTime: midpoint,
        splitDepth: splitDepth + 1,
        signal,
      });
      const right = await this.profitCalendarIncomeRange({
        credentials,
        serverTime,
        synchronizedAt,
        startTime: midpoint + 1,
        endTime,
        splitDepth: splitDepth + 1,
        signal,
      });
      return {
        income: [...left.income, ...right.income],
        truncated: left.truncated || right.truncated,
      };
    }
  }

  async pagedProfitCalendarIncome({
    credentials,
    serverTime,
    synchronizedAt,
    startTime,
    endTime,
    signal,
  }) {
    const income = [];
    let page = 1;
    for (; page <= PROFIT_CALENDAR_MAX_PAGES; page += 1) {
      const value = await this.signedGet({
        baseUrl: this.futuresBaseUrl,
        pathname: "/fapi/v1/income",
        credentials,
        serverTime: serverTime + (Date.now() - synchronizedAt),
        networkFetch: this.profitCalendarFetch,
        signal,
        timeoutMs: PROFIT_CALENDAR_REQUEST_TIMEOUT_MS,
        params: {
          incomeType: "REALIZED_PNL",
          startTime,
          endTime,
          page,
          limit: PROFIT_CALENDAR_PAGE_LIMIT,
        },
      });
      if (!Array.isArray(value)) {
        throw new BinanceAccountError(
          "INVALID_PROFIT_CALENDAR_RESPONSE",
          "Binance 返回了无法识别的收益日历数据。",
          { retryable: true },
        );
      }
      income.push(...value);
      if (value.length < PROFIT_CALENDAR_PAGE_LIMIT) return { income, truncated: false };
    }
    return { income, truncated: true };
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
    const pendingCalendar = this.profitCalendarOwnerRequests.get(ownerId);
    pendingCalendar?.controller.abort(new DOMException(
      "Binance account calendar cache was invalidated",
      "AbortError",
    ));
    this.profitCalendarOwnerRequests.delete(ownerId);
    const prefix = `${ownerId}\0`;
    for (const key of this.profitCalendarCache.keys()) {
      if (key.startsWith(prefix)) this.profitCalendarCache.delete(key);
    }
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

  async snapshotWithCredentials(credentials, {
    previousSnapshot = null,
    live = false,
    summary = false,
  } = {}) {
    const fetchedAt = this.now();
    const nowMs = fetchedAt instanceof Date ? fetchedAt.getTime() : new Date(fetchedAt).getTime();
    const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const historyStartTime = Math.max(0, safeNowMs - POSITION_HISTORY_WINDOW_MS);
    const todayStartTime = startOfLocalDayMs(safeNowMs);
    const warnings = [];
    const futuresTime = await this.serverTime(this.futuresBaseUrl, "/fapi/v1/time");
    const shared = { credentials, serverTime: futuresTime, baseUrl: this.futuresBaseUrl };
    if (summary && previousSnapshot) {
      const account = await this.signedGet({ ...shared, pathname: "/fapi/v3/account" });
      return mergeAccountSummarySnapshot({
        account,
        previousSnapshot,
        fetchedAt: new Date(safeNowMs).toISOString(),
        todayStartTime,
        historyStartTime,
      });
    }
    const [account, positions, incomeResult, walletResult] = await Promise.all([
      this.signedGet({ ...shared, pathname: "/fapi/v3/account" }),
      // Full snapshots need V2's zero-position rows to retain leverage and
      // margin metadata for recently closed symbols. Live snapshots reuse the
      // completed history and can keep V3's smaller active-symbol payload.
      this.signedGet({
        ...shared,
        pathname: live ? "/fapi/v3/positionRisk" : "/fapi/v2/positionRisk",
      }),
      live
        ? Promise.resolve({ skipped: true })
        : this.signedGet({
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
      live
        ? Promise.resolve({ skipped: true })
        : this.walletBalances(credentials).then((value) => ({ value })).catch((error) => ({ error })),
    ]);
    const previousOpenOrders = Array.isArray(previousSnapshot?.openOrders)
      ? previousSnapshot.openOrders
      : [];
    const orderSymbols = live
      ? liveOpenOrderSymbols({ account, positions, previousOpenOrders })
      : null;
    const [initialOpenOrdersResult, initialAlgoOpenOrdersResult] = await Promise.all([
      this.readOpenOrdersCollection({
        ...shared,
        pathname: "/fapi/v1/openOrders",
        symbols: orderSymbols,
      }),
      this.readOpenOrdersCollection({
        ...shared,
        pathname: "/fapi/v1/openAlgoOrders",
        symbols: orderSymbols,
      }),
    ]);
    const [openOrdersResult, algoOpenOrdersResult] = await Promise.all([
      this.confirmEmptyOpenOrdersTransition({
        result: initialOpenOrdersResult,
        source: "ORDER",
        pathname: "/fapi/v1/openOrders",
        symbols: orderSymbols,
        previousOpenOrders,
        shared,
      }),
      this.confirmEmptyOpenOrdersTransition({
        result: initialAlgoOpenOrdersResult,
        source: "ALGO",
        pathname: "/fapi/v1/openAlgoOrders",
        symbols: orderSymbols,
        previousOpenOrders,
        shared,
      }),
    ]);
    if (incomeResult.error) warnings.push("今日已实现盈亏暂时无法读取");
    if (walletResult.error) warnings.push("总资产暂以 USDⓈ-M 合约保证金余额展示");
    const rateLimitError = [
      incomeResult.error,
      walletResult.error,
      openOrdersResult.error,
      algoOpenOrdersResult.error,
    ].find((error) => error?.code === "BINANCE_RATE_LIMITED");
    if (rateLimitError) throw rateLimitError;
    const accountTradesResult = live
      ? { trades: [], failedSymbols: [], truncatedSymbols: [], skipped: true }
      : incomeResult.error
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
    if (openOrdersResult.error && algoOpenOrdersResult.error) {
      warnings.push("当前委托暂时无法读取");
    } else if (openOrdersResult.error || algoOpenOrdersResult.error) {
      warnings.push("部分当前委托暂时无法读取");
    }
    let snapshot = normalizeBinanceAccountSnapshot({
      account,
      positions,
      income: incomeResult.value ?? null,
      accountTrades: accountTradesResult.trades,
      openOrders: openOrdersResult.value ?? null,
      algoOpenOrders: algoOpenOrdersResult.value ?? null,
      walletBalances: walletResult.value ?? null,
      fetchedAt: new Date(safeNowMs).toISOString(),
      todayStartTime,
      historyStartTime,
      warnings,
    });
    if (live && previousSnapshot) {
      snapshot = mergeLiveAccountSnapshot(snapshot, previousSnapshot);
    }
    snapshot.openOrders = reconcileOpenOrderSources({
      freshOpenOrders: snapshot.openOrders,
      previousOpenOrders,
      regularAvailable: !openOrdersResult.error,
      algoAvailable: !algoOpenOrdersResult.error,
    });
    return snapshot;
  }

  async readOpenOrdersCollection({ symbols, pathname, ...shared }) {
    if (!Array.isArray(symbols)) return this.readOpenOrders({ ...shared, pathname });
    if (!symbols.length) return { value: [] };
    const results = await mapWithConcurrency(symbols, 4, (symbol) => this.readOpenOrders({
      ...shared,
      pathname,
      params: { symbol },
    }));
    const failed = results.find((result) => result?.error);
    return failed
      ? { error: failed.error }
      : { value: results.flatMap((result) => result.value) };
  }

  async readOpenOrders({ pathname, ...shared }) {
    try {
      const value = await this.signedGet({ ...shared, pathname });
      if (!Array.isArray(value)) {
        throw new BinanceAccountError(
          "INVALID_OPEN_ORDERS_RESPONSE",
          "Binance 返回了无法识别的当前委托数据。",
          { retryable: true },
        );
      }
      return { value };
    } catch (error) {
      return { error };
    }
  }

  async confirmEmptyOpenOrdersTransition({
    result,
    source,
    pathname,
    symbols,
    previousOpenOrders,
    shared,
  }) {
    const hadOrders = previousOpenOrders.some((order) => order?.source === source);
    if (result?.error || !hadOrders || result.value.length > 0) return result;
    return this.readOpenOrdersCollection({ ...shared, pathname, symbols });
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

  async serverTime(baseUrl, pathname, { force = false } = {}) {
    const cacheKey = `${normalizedBaseUrl(baseUrl, DEFAULT_FUTURES_BASE_URL)}\0${pathname}`;
    const nowMs = Date.now();
    const cached = this.serverTimeCache.get(cacheKey);
    if (!force && cached && nowMs - cached.synchronizedAt < this.serverTimeCacheTtlMs) {
      return cached.serverTime + (nowMs - cached.synchronizedAt);
    }
    if (!force) {
      const pending = this.serverTimeRequests.get(cacheKey);
      if (pending) return pending;
    }
    const request = (async () => {
      let payload;
      try {
        payload = await requestJson(this.fetch, new URL(pathname, `${baseUrl}/`).toString());
      } catch (error) {
        if (error?.code === BINANCE_DIRECT_ROUTE_FAILED) {
          try {
            payload = await requestJson(this.fetch, new URL(pathname, `${baseUrl}/`).toString());
          } catch (retryError) {
            this.applyRateLimit(retryError);
            throw retryError;
          }
        } else {
          this.applyRateLimit(error);
          throw error;
        }
      }
      const serverTime = finiteNumber(payload?.serverTime);
      if (serverTime == null || serverTime <= 0) {
        throw new BinanceAccountError("INVALID_SERVER_TIME", "Binance 时间服务返回异常，请稍后重试。", { retryable: true });
      }
      const synchronizedAt = Date.now();
      this.serverTimeCache.set(cacheKey, { serverTime, synchronizedAt });
      return serverTime;
    })();
    if (!force) this.serverTimeRequests.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (this.serverTimeRequests.get(cacheKey) === request) this.serverTimeRequests.delete(cacheKey);
    }
  }

  async signedGet({
    baseUrl,
    pathname,
    credentials,
    serverTime,
    params = {},
    networkFetch = this.fetch,
    signal,
    timeoutMs = REQUEST_TIMEOUT_MS,
  }) {
    const requestAt = (timestamp) => {
      const url = buildSignedBinanceUrl({
        baseUrl,
        pathname,
        params: { ...params, recvWindow: this.recvWindow, timestamp: Math.trunc(timestamp) },
        apiSecret: credentials.apiSecret,
      });
      return requestJson(networkFetch, url, {
        headers: { "X-MBX-APIKEY": credentials.apiKey },
        signal,
      }, timeoutMs);
    };
    try {
      return await requestAt(serverTime);
    } catch (error) {
      if (error?.code === BINANCE_DIRECT_ROUTE_FAILED || error?.code === "BINANCE_TIME_INVALID") {
        const timePath = String(baseUrl).startsWith(DEFAULT_FUTURES_BASE_URL)
          ? "/fapi/v1/time"
          : "/api/v3/time";
        const freshServerTime = await this.serverTime(baseUrl, timePath, { force: true });
        try {
          return await requestAt(freshServerTime);
        } catch (retryError) {
          this.applyRateLimit(retryError);
          throw retryError;
        }
      }
      this.applyRateLimit(error);
      throw error;
    }
  }

  applyRateLimit(error) {
    if (error?.code !== "BINANCE_RATE_LIMITED") return;
    const retryAfterMs = Number.isFinite(error?.retryAfterMs)
      ? Math.max(1_000, Number(error.retryAfterMs))
      : 60_000;
    this.rateLimitedUntil = Math.max(this.rateLimitedUntil, this.currentTimeMs() + retryAfterMs);
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

export function normalizeBinanceProfitCalendar({ month, income, fetchedAt, warnings = [] } = {}) {
  const normalizedMonth = normalizeProfitCalendarMonth(month, Date.now());
  const { startTime, endTime } = localMonthRange(normalizedMonth);
  const pnlByDate = new Map();
  for (const item of Array.isArray(income) ? income : []) {
    const timestamp = finiteNumber(item?.time);
    const value = finiteNumber(item?.income);
    if (timestamp == null || value == null || timestamp < startTime || timestamp >= endTime) continue;
    const incomeType = String(item?.incomeType || "REALIZED_PNL").trim().toUpperCase();
    if (incomeType !== "REALIZED_PNL" && incomeType !== "COMMISSION") continue;
    const date = localDateKey(timestamp);
    if (!pnlByDate.has(date)) pnlByDate.set(date, 0);
    if (incomeType === "REALIZED_PNL") pnlByDate.set(date, (pnlByDate.get(date) || 0) + value);
  }
  return {
    schemaVersion: 1,
    month: normalizedMonth,
    currency: "USDT",
    days: [...pnlByDate.entries()]
      .map(([date, pnl]) => ({ date, pnl: normalNumber(pnl) }))
      .sort((left, right) => left.date.localeCompare(right.date)),
    source: "USD_M_INCOME_REALIZED_PNL+COMMISSION_ACTIVITY",
    warnings: [...new Set(warnings.map((item) => String(item || "").trim()).filter(Boolean))],
    fetchedAt: Number.isFinite(Date.parse(String(fetchedAt || "")))
      ? new Date(fetchedAt).toISOString()
      : new Date().toISOString(),
  };
}

function normalizeProfitCalendarMonth(value, nowMs) {
  const text = String(value || "").trim();
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(text)) return text;
  if (text) {
    throw new BinanceAccountError("INVALID_PROFIT_CALENDAR_MONTH", "收益日历月份格式无效。");
  }
  const now = new Date(nowMs);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function localMonthRange(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    startTime: new Date(year, monthNumber - 1, 1).getTime(),
    endTime: new Date(year, monthNumber, 1).getTime(),
  };
}

function localDateKey(timestamp) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function normalizeBinanceAccountSnapshot({
  account,
  positions,
  income,
  accountTrades,
  openOrders,
  algoOpenOrders,
  walletBalances,
  fetchedAt,
  todayStartTime,
  historyStartTime,
  warnings = [],
} = {}) {
  const totalMarginBalance = finiteNumber(account?.totalMarginBalance) ?? 0;
  const totalMaintenanceMargin = finiteNumber(account?.totalMaintMargin) ?? 0;
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
  const crossMarginRatio = marginRatioPercentage(totalMaintenanceMargin, totalMarginBalance);
  const normalizedPositions = (Array.isArray(positions) ? positions : [])
    .filter((position) => Math.abs(finiteNumber(position?.positionAmt) ?? 0) > 1e-12)
    .map((position) => normalizePosition(
      position,
      accountPositions.get(positionIdentity(position)),
      crossMarginRatio,
    ))
    .sort((left, right) => right.notionalValue - left.notionalValue);
  const positionHistory = normalizeBinancePositionHistory({
    trades: accountTrades,
    positions,
    fetchedAt,
    historyStartTime,
  });
  const normalizedOpenOrders = normalizeBinanceOpenOrders({
    openOrders,
    algoOpenOrders,
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
    openOrders: normalizedOpenOrders,
    walletBreakdown: activatedWallets.map((item) => ({
      walletName: String(item?.walletName || "Binance"),
      balance: normalNumber(finiteNumber(item?.balance) ?? 0),
    })),
    sources: {
      totalAssets: walletEstimatedAssets == null ? "USD_M_FUTURES_MARGIN" : "BINANCE_WALLETS_USDT",
      futures: "USD_M_FUTURES",
      realizedPnl: realizedIncomeAvailable ? "USD_M_INCOME" : "UNAVAILABLE",
      positionHistory: Array.isArray(accountTrades) ? "USD_M_ACCOUNT_TRADES" : "UNAVAILABLE",
      openOrders: [
        Array.isArray(openOrders) ? "USD_M_OPEN_ORDERS" : null,
        Array.isArray(algoOpenOrders) ? "USD_M_OPEN_ALGO_ORDERS" : null,
      ].filter(Boolean).join("+") || "UNAVAILABLE",
    },
    warnings: [...new Set(warnings.map((item) => String(item || "").trim()).filter(Boolean))],
    fetchedAt: Number.isFinite(Date.parse(String(fetchedAt || "")))
      ? new Date(fetchedAt).toISOString()
      : new Date().toISOString(),
  };
}

export function normalizeBinanceOpenOrders({ openOrders, algoOpenOrders } = {}) {
  const regular = (Array.isArray(openOrders) ? openOrders : [])
    .map(normalizeRegularOpenOrder)
    .filter(Boolean);
  const conditional = (Array.isArray(algoOpenOrders) ? algoOpenOrders : [])
    .map(normalizeAlgoOpenOrder)
    .filter(Boolean);
  return sortOpenOrders([...regular, ...conditional]);
}

function liveOpenOrderSymbols({ account, positions, previousOpenOrders }) {
  const symbols = new Set();
  // Account V3 only returns symbols that currently have a position or an open
  // order. Position Risk V2, however, may return every listed contract with a
  // zero position. Never fan those zero rows out into two signed order reads per
  // symbol; doing so can turn one refresh into hundreds of Binance requests.
  const relevantItems = [
    ...(Array.isArray(account?.positions) ? account.positions : []),
    ...(Array.isArray(positions)
      ? positions.filter((position) => Math.abs(finiteNumber(position?.positionAmt) ?? 0) > 1e-12)
      : []),
    ...(Array.isArray(previousOpenOrders) ? previousOpenOrders : []),
  ];
  for (const item of relevantItems) {
    const symbol = normalizedOrderSymbol(item?.symbol);
    if (symbol) symbols.add(symbol);
  }
  return [...symbols].sort();
}

function mergeAccountSummarySnapshot({
  account,
  previousSnapshot,
  fetchedAt,
  todayStartTime,
  historyStartTime,
}) {
  const freshSnapshot = normalizeBinanceAccountSnapshot({
    account,
    positions: [],
    income: null,
    accountTrades: null,
    openOrders: null,
    algoOpenOrders: null,
    walletBalances: null,
    fetchedAt,
    todayStartTime,
    historyStartTime,
  });
  const merged = mergeLiveAccountSnapshot(freshSnapshot, previousSnapshot);
  return {
    ...merged,
    positions: Array.isArray(previousSnapshot?.positions) ? previousSnapshot.positions : [],
    openOrders: Array.isArray(previousSnapshot?.openOrders) ? previousSnapshot.openOrders : [],
    warnings: Array.isArray(previousSnapshot?.warnings) ? previousSnapshot.warnings : [],
    sources: {
      ...merged.sources,
      openOrders: previousSnapshot?.sources?.openOrders || merged.sources.openOrders,
    },
  };
}

function mergeLiveAccountSnapshot(freshSnapshot, previousSnapshot) {
  const freshMarginBalance = finiteNumber(freshSnapshot?.marginBalance);
  const previousMarginBalance = finiteNumber(previousSnapshot?.marginBalance);
  const previousEstimatedAssets = finiteNumber(previousSnapshot?.estimatedTotalAssets);
  const estimatedTotalAssets = previousEstimatedAssets != null
    && previousMarginBalance != null
    && freshMarginBalance != null
    ? previousEstimatedAssets + (freshMarginBalance - previousMarginBalance)
    : finiteNumber(freshSnapshot?.estimatedTotalAssets) ?? 0;
  const realizedPnlToday = finiteNumber(previousSnapshot?.realizedPnlToday);
  const unrealizedPnl = finiteNumber(freshSnapshot?.unrealizedPnl) ?? 0;
  const todayPnl = realizedPnlToday == null ? null : realizedPnlToday + unrealizedPnl;
  const dayOpeningAssets = todayPnl == null ? null : estimatedTotalAssets - todayPnl;
  const todayPnlPercent = dayOpeningAssets != null && Math.abs(dayOpeningAssets) > 1e-12
    ? (todayPnl / Math.abs(dayOpeningAssets)) * 100
    : null;
  return {
    ...freshSnapshot,
    estimatedTotalAssets: normalNumber(estimatedTotalAssets),
    todayPnl: nullableNumber(todayPnl),
    todayPnlPercent: nullableNumber(todayPnlPercent),
    realizedPnlToday: nullableNumber(realizedPnlToday),
    positionHistory: Array.isArray(previousSnapshot?.positionHistory)
      ? previousSnapshot.positionHistory
      : [],
    walletBreakdown: Array.isArray(previousSnapshot?.walletBreakdown)
      ? previousSnapshot.walletBreakdown
      : [],
    sources: {
      ...freshSnapshot.sources,
      totalAssets: previousSnapshot?.sources?.totalAssets || freshSnapshot.sources.totalAssets,
      realizedPnl: previousSnapshot?.sources?.realizedPnl || freshSnapshot.sources.realizedPnl,
      positionHistory: previousSnapshot?.sources?.positionHistory || freshSnapshot.sources.positionHistory,
    },
  };
}

function reconcileOpenOrderSources({
  freshOpenOrders,
  previousOpenOrders,
  regularAvailable,
  algoAvailable,
}) {
  const fresh = Array.isArray(freshOpenOrders) ? freshOpenOrders : [];
  const previous = Array.isArray(previousOpenOrders) ? previousOpenOrders : [];
  const sourceOrders = (source, available) => (available ? fresh : previous)
    .filter((order) => order?.source === source);
  return sortOpenOrders([
    ...sourceOrders("ORDER", regularAvailable),
    ...sourceOrders("ALGO", algoAvailable),
  ]);
}

function sortOpenOrders(orders) {
  return [...orders]
    .sort((left, right) => right.createdAt - left.createdAt || right.updatedAt - left.updatedAt);
}

function normalizeRegularOpenOrder(order) {
  const symbol = normalizedOrderSymbol(order?.symbol);
  const side = normalizedOrderSide(order?.side);
  if (!symbol || !side) return null;
  const orderId = finiteNumber(order?.orderId);
  const orderType = normalizedOrderType(order?.origType || order?.type);
  const price = positiveOrderNumber(order?.price);
  const averagePrice = positiveOrderNumber(order?.avgPrice);
  const originalQuantity = nonNegativeOrderNumber(order?.origQty);
  const executedQuantity = nonNegativeOrderNumber(order?.executedQty);
  const cumulativeQuote = nonNegativeOrderNumber(order?.cumQuote);
  const totalQuantityUsdt = originalQuantity == null || price == null
    ? null
    : originalQuantity * price;
  const executedQuantityUsdt = cumulativeQuote != null && (cumulativeQuote > 0 || executedQuantity === 0)
    ? cumulativeQuote
    : executedQuantity == null || averagePrice == null
      ? null
      : executedQuantity * averagePrice;
  const progressPercent = originalQuantity != null && originalQuantity > 0 && executedQuantity != null
    ? Math.min(100, Math.max(0, executedQuantity / originalQuantity * 100))
    : 0;
  const createdAt = validOrderTime(order?.time ?? order?.updateTime);
  const updatedAt = validOrderTime(order?.updateTime ?? order?.time);
  return {
    id: `order:${orderId ?? String(order?.clientOrderId || `${symbol}:${createdAt}`)}`,
    source: "ORDER",
    symbol,
    contractType: "PERPETUAL",
    orderType,
    side,
    positionSide: normalizedPositionSide(order?.positionSide),
    status: normalizedOrderText(order?.status, "NEW"),
    timeInForce: nullableOrderText(order?.timeInForce),
    quantityUsdt: nullableNormalNumber(totalQuantityUsdt),
    executedQuantityUsdt: nullableNormalNumber(executedQuantityUsdt),
    progressPercent: normalNumber(progressPercent),
    price: nullableNormalNumber(price),
    averagePrice: nullableNormalNumber(averagePrice),
    triggerPrice: nullableNormalNumber(positiveOrderNumber(order?.stopPrice)),
    activationPrice: nullableNormalNumber(positiveOrderNumber(order?.activatePrice)),
    callbackRate: nullableNormalNumber(nonNegativeOrderNumber(order?.priceRate)),
    workingType: nullableOrderText(order?.workingType),
    reduceOnly: order?.reduceOnly === true,
    closePosition: order?.closePosition === true,
    priceProtect: order?.priceProtect === true,
    priceMatch: nullableOrderText(order?.priceMatch),
    createdAt,
    updatedAt,
  };
}

function normalizeAlgoOpenOrder(order) {
  const symbol = normalizedOrderSymbol(order?.symbol);
  const side = normalizedOrderSide(order?.side);
  if (!symbol || !side) return null;
  const algoId = finiteNumber(order?.algoId);
  const orderType = normalizedOrderType(order?.orderType || order?.type);
  const price = positiveOrderNumber(order?.price ?? order?.actualPrice);
  const triggerPrice = positiveOrderNumber(
    order?.triggerPrice ?? order?.tpTriggerPrice ?? order?.slTriggerPrice,
  );
  const activationPrice = positiveOrderNumber(order?.activatePrice ?? order?.activationPrice);
  const callbackRate = nonNegativeOrderNumber(order?.callbackRate ?? order?.priceRate);
  const quantity = nonNegativeOrderNumber(order?.quantity);
  const referencePrice = isMarketOrderType(orderType)
    ? triggerPrice ?? activationPrice
    : price;
  const quantityUsdt = quantity == null || referencePrice == null
    ? null
    : quantity * referencePrice;
  const createdAt = validOrderTime(order?.createTime ?? order?.time ?? order?.updateTime);
  const updatedAt = validOrderTime(order?.updateTime ?? order?.createTime ?? order?.time);
  return {
    id: `algo:${algoId ?? String(order?.clientAlgoId || `${symbol}:${createdAt}`)}`,
    source: "ALGO",
    symbol,
    contractType: "PERPETUAL",
    orderType,
    side,
    positionSide: normalizedPositionSide(order?.positionSide),
    status: normalizedOrderText(order?.algoStatus || order?.status, "NEW"),
    timeInForce: nullableOrderText(order?.timeInForce),
    quantityUsdt: nullableNormalNumber(quantityUsdt),
    executedQuantityUsdt: null,
    progressPercent: null,
    price: nullableNormalNumber(price),
    averagePrice: nullableNormalNumber(positiveOrderNumber(order?.actualPrice)),
    triggerPrice: nullableNormalNumber(triggerPrice),
    activationPrice: nullableNormalNumber(activationPrice),
    callbackRate: nullableNormalNumber(callbackRate),
    workingType: nullableOrderText(order?.workingType),
    reduceOnly: order?.reduceOnly === true,
    closePosition: order?.closePosition === true,
    priceProtect: order?.priceProtect === true,
    priceMatch: nullableOrderText(order?.priceMatch),
    createdAt,
    updatedAt,
  };
}

function normalizedOrderSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9_:-]{2,40}$/.test(symbol) ? symbol : "";
}

function normalizedOrderSide(value) {
  const side = String(value || "").trim().toUpperCase();
  return side === "BUY" || side === "SELL" ? side : "";
}

function normalizedOrderType(value) {
  const type = String(value || "").trim().toUpperCase();
  return type || "UNKNOWN";
}

function normalizedPositionSide(value) {
  const side = String(value || "BOTH").trim().toUpperCase();
  return ["BOTH", "LONG", "SHORT"].includes(side) ? side : "BOTH";
}

function normalizedOrderText(value, fallback) {
  return String(value || fallback || "").trim().toUpperCase();
}

function nullableOrderText(value) {
  const text = String(value || "").trim().toUpperCase();
  return text || null;
}

function isMarketOrderType(type) {
  return type === "MARKET" || type.endsWith("_MARKET");
}

function positiveOrderNumber(value) {
  const number = finiteNumber(value);
  return number != null && number > 0 ? number : null;
}

function nonNegativeOrderNumber(value) {
  const number = finiteNumber(value);
  return number != null && number >= 0 ? number : null;
}

function validOrderTime(value) {
  const timestamp = finiteNumber(value);
  return timestamp != null && timestamp > 0 ? Math.trunc(timestamp) : 0;
}

function nullableNormalNumber(value) {
  return value == null ? null : normalNumber(value);
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

function normalizePosition(position, accountPosition, crossMarginRatio) {
  const rawAmount = finiteNumber(position?.positionAmt) ?? 0;
  const positionSide = String(position?.positionSide || "BOTH").toUpperCase();
  const direction = positionSide === "LONG" || positionSide === "SHORT"
    ? positionSide
    : rawAmount >= 0 ? "LONG" : "SHORT";
  const marginType = String(position?.marginType || "cross").toLowerCase() === "isolated"
    ? "isolated"
    : "cross";
  const leverage = Math.max(1, finiteNumber(position?.leverage) ?? 1);
  const notionalValue = Math.abs(finiteNumber(position?.notional) ?? 0);
  const isolatedMargin = finiteNumber(position?.isolatedMargin) ?? 0;
  const initialMargin = finiteNumber(accountPosition?.initialMargin);
  const margin = Math.max(0, isolatedMargin > 0 ? isolatedMargin : initialMargin ?? notionalValue / leverage);
  const unrealizedPnl = finiteNumber(position?.unRealizedProfit ?? position?.unrealizedProfit) ?? 0;
  const maintenanceMargin = Math.max(0, finiteNumber(accountPosition?.maintMargin) ?? 0);
  const roi = margin > 1e-12 ? (unrealizedPnl / margin) * 100 : 0;
  const marginRatio = marginType === "isolated"
    ? marginRatioPercentage(maintenanceMargin, margin)
    : crossMarginRatio;
  return {
    symbol: String(position?.symbol || "").toUpperCase(),
    direction,
    positionSide,
    marginType,
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

function marginRatioPercentage(maintenanceMargin, marginBalance) {
  const maintenance = finiteNumber(maintenanceMargin);
  const balance = finiteNumber(marginBalance);
  if (maintenance == null || maintenance < 0 || balance == null || balance <= 1e-12) return 0;
  return normalNumber((maintenance / balance) * 100);
}

async function requestJson(networkFetch, url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const timeoutSignal = typeof AbortSignal?.timeout === "function"
    ? AbortSignal.timeout(Math.max(1_000, Number(timeoutMs) || REQUEST_TIMEOUT_MS))
    : undefined;
  const signals = [init?.signal, timeoutSignal].filter(Boolean);
  const signal = signals.length > 1 && typeof AbortSignal?.any === "function"
    ? AbortSignal.any(signals)
    : signals[0];
  let response;
  try {
    response = await networkFetch(url, { method: "GET", ...init, signal });
  } catch (error) {
    if (
      error instanceof BinanceAccountError
      || error instanceof BinanceCredentialError
      || error?.code === BINANCE_DIRECT_ROUTE_FAILED
    ) throw error;
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
  if (!response.ok) {
    throw binanceHttpError(response.status, payload, {
      retryAfterMs: parseRetryAfterMs(response.headers?.get?.("retry-after")),
    });
  }
  return payload;
}

function binanceHttpError(status, payload, { retryAfterMs = null } = {}) {
  const code = Number(payload?.code);
  if (code === -2015 || status === 401) {
    return new BinanceAccountError(
      "BINANCE_AUTH_FAILED",
      "API Key 无效，或未开通 Binance 合约读取权限。",
    );
  }
  if (code === -1022) {
    return new BinanceAccountError("BINANCE_SIGNATURE_INVALID", "API Key 与 Secret Key 不匹配，请重新检查。");
  }
  if (code === -1021) {
    return new BinanceAccountError("BINANCE_TIME_INVALID", "设备时间与 Binance 不一致，请稍后重试。", { retryable: true });
  }
  if (status === 418 || status === 429) {
    return new BinanceAccountError(
      "BINANCE_RATE_LIMITED",
      "Binance 请求频率受限，客户端正在自动降频，请稍后再试。",
      { retryable: true, retryAfterMs: retryAfterMs ?? 60_000 },
    );
  }
  if (status >= 500) {
    return new BinanceAccountError("BINANCE_UNAVAILABLE", "Binance 服务暂时不可用，请稍后重试。", { retryable: true });
  }
  return new BinanceAccountError("BINANCE_REQUEST_FAILED", "Binance 拒绝了本次请求，请检查 API 权限后重试。");
}

function parseRetryAfterMs(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const dateMs = Date.parse(text);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
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

function profitCalendarRangeRetryable(error) {
  return [
    "BINANCE_TIMEOUT",
    "BINANCE_NETWORK_ERROR",
    "BINANCE_UNAVAILABLE",
    BINANCE_DIRECT_ROUTE_FAILED,
  ].includes(String(error?.code || ""));
}

function snapshotWithWarning(snapshot, warning) {
  return {
    ...snapshot,
    warnings: [...new Set([...(Array.isArray(snapshot?.warnings) ? snapshot.warnings : []), warning])],
  };
}

function profitCalendarWithWarning(calendar, warning) {
  return {
    ...calendar,
    warnings: [...new Set([...(Array.isArray(calendar?.warnings) ? calendar.warnings : []), warning])],
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
