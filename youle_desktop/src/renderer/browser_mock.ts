import type { MessageAttachment } from "./domain";

type Listener<T> = (payload: T) => void;

type MockMessage = {
  id?: string;
  type?: string;
  text?: string;
  attachments?: MessageAttachment[];
  content?: Array<{ text?: string; attachments?: MessageAttachment[] }>;
};

type DesktopApiLike = Window["codexDesktop"];

function createMockTradingAlertsSnapshot(dense = false) {
  const now = Date.now();
  const rule = (id: string, title: string, summary: string, marketId = "BINANCE:FUTURES:BTCUSDT", interval = "1h", clock = "bar_close", mode = "repeat") => ({
    schemaVersion: 1, ruleId: id, revision: 2, title, normalizedSummary: summary,
    contexts: [{ contextId: "primary", marketSelector: { kind: "fixed", marketIds: [marketId] }, intervals: [interval] }],
    evaluationPolicy: { clock, anchorContextId: "primary", joinMode: "latest_closed", maxDataAgeMs: 300_000, unknownPolicy: "do_not_trigger" },
    triggerPolicy: { mode, edge: "false_to_true", rearm: "must_become_false", resumePolicy: "baseline_only_no_catch_up" },
    dataRequirements: [],
  });
  const alerts = [
    { alertId: "qa-monitoring", rule: rule("qa-rule-monitoring", "MA5/MA20 死叉且 MACD 下穿零轴", "BTC 永续 1小时收盘时，MA5 下穿 MA20 且 MACD DIF 下穿零轴后提醒。"), ruleHash: "sha256:qa-monitoring", status: "monitoring", enabled: true, triggerCount: 0, createdAt: now - 86_400_000, updatedAt: now - 60_000 },
    { alertId: "qa-triggered", rule: rule("qa-rule-triggered", "价格触碰上升趋势线", "ETH 永续 15分钟盘中触碰已绑定趋势线时提醒。", "BINANCE:FUTURES:ETHUSDT", "15m", "bar_update", "once"), ruleHash: "sha256:qa-triggered", status: "triggered", enabled: true, triggerCount: 1, lastTriggeredAt: now - 180_000, createdAt: now - 172_800_000, updatedAt: now - 180_000 },
    { alertId: "qa-paused", rule: rule("qa-rule-paused", "SOL 放量突破前高", "SOL 永续 4小时收盘突破前高且成交量超过均量 2 倍。", "HYPERLIQUID:PERPETUAL:SOL", "4h"), ruleHash: "sha256:qa-paused", status: "paused", enabled: false, triggerCount: 0, failure: "用户暂停", createdAt: now - 259_200_000, updatedAt: now - 3_600_000 },
    { alertId: "qa-gap", rule: rule("qa-rule-gap", "BTC 多周期趋势共振", "BTC 1小时趋势向上，同时 15分钟 RSI 从超卖区回升。"), ruleHash: "sha256:qa-gap", status: "reconnecting", enabled: true, triggerCount: 0, failure: "数据提供方正在重新连接", createdAt: now - 345_600_000, updatedAt: now - 30_000 },
  ];
  if (dense) {
    const seeds = alerts.map((alert) => structuredClone(alert));
    for (let index = 0; index < 24; index += 1) {
      const seed = structuredClone(seeds[index % seeds.length]);
      seed.alertId = `qa-overflow-${index + 1}`;
      seed.rule.ruleId = `qa-rule-overflow-${index + 1}`;
      seed.rule.title = `${seed.rule.title} ${index + 2}`;
      seed.ruleHash = `sha256:qa-overflow-${index + 1}`;
      alerts.push(seed);
    }
  }
  alerts.forEach((alert) => Object.assign(alert, {
    originThreadId: "mock-thread-1",
    simulationId: `qa-simulation-${alert.alertId}`,
  }));
  Object.assign(alerts.find((alert) => alert.alertId === "qa-triggered") || {}, { latestEvidenceId: "qa-evidence" });
  return {
    enabled: true,
    engine: { running: true, alerts: alerts.length, subscriptions: 3 },
    alerts,
    drafts: [{ draftId: "qa-draft", status: "awaiting_authorization", sourceText: "当链上大额净流入且价格突破时提醒", questions: ["需要接入哪个链上数据提供方？"], rule: { title: "链上流入与价格突破", normalizedSummary: "已保留草稿，等待只读链上数据能力。" } }],
    gaps: [{ gapId: "qa-gap-record", alertId: "qa-gap", startedAt: now - 7_200_000, endedAt: now - 3_600_000, resumedAt: now - 3_600_000, reason: "app_stopped", catchUpEvaluated: false }],
    evidence: [{ evidenceId: "qa-evidence", alertId: "qa-triggered", triggerEventId: "ETHUSDT:15m:qa", triggeredAt: now - 180_000, contexts: [{ marketId: "BINANCE:FUTURES:ETHUSDT", interval: "15m", candle: { close: 3128.42 } }], conditionResults: [{ conditionId: "touch-line", result: true }] }],
    providers: [
      { providerId: "binance-public", displayName: "Binance Public Market Data", connectionState: "connected", fields: ["OHLCV", "last"], permission: "public", docsUrl: "https://developers.binance.com/" },
      { providerId: "hyperliquid-public", displayName: "Hyperliquid Public Market Data", connectionState: "connected", fields: ["OHLCV", "mark", "index"], permission: "public", docsUrl: "https://hyperliquid.gitbook.io/hyperliquid-docs/" },
      { providerId: "chain-provider", displayName: "链上数据提供方", connectionState: "disconnected", fields: ["exchange_netflow", "whale_transfer"], permission: "read_only" },
    ],
  };
}

function createMockBinanceAccountSnapshot() {
  return {
    schemaVersion: 1 as const,
    currency: "USDT",
    estimatedTotalAssets: 3938.95088,
    todayPnl: -14.32,
    todayPnlPercent: -0.36,
    marginBalance: 2842.7,
    walletBalance: 2854.8,
    unrealizedPnl: -12.1,
    realizedPnlToday: -2.22,
    initialMargin: 143.27,
    availableBalance: 2699.43,
    positions: [
      {
        symbol: "ETHUSDT",
        direction: "SHORT" as const,
        positionSide: "BOTH",
        marginType: "cross" as const,
        leverage: 50,
        amount: 0.038,
        notionalValue: 71.61,
        margin: 1.43,
        unrealizedPnl: -0.01,
        roi: -0.98,
        marginRatio: 3.5,
        entryPrice: 1883.91,
        markPrice: 1884.21,
        liquidationPrice: 1951.3,
        breakEvenPrice: 1883.65,
        marginAsset: "USDT",
        updatedAt: Date.now(),
      },
      {
        symbol: "BTCUSDT",
        direction: "LONG" as const,
        positionSide: "BOTH",
        marginType: "isolated" as const,
        leverage: 20,
        amount: 0.002,
        notionalValue: 237.56,
        margin: 11.88,
        unrealizedPnl: 3.42,
        roi: 28.79,
        marginRatio: 6.38,
        entryPrice: 117_068.4,
        markPrice: 118_778.1,
        liquidationPrice: 112_461.7,
        breakEvenPrice: 117_102.8,
        marginAsset: "USDT",
        updatedAt: Date.now(),
      },
    ],
    positionHistory: [
      {
        id: "mock-tutusdt-history",
        symbol: "TUTUSDT",
        contractType: "PERPETUAL" as const,
        direction: "SHORT" as const,
        positionSide: "BOTH",
        marginType: "cross" as const,
        leverage: 10,
        closeType: "FULL" as const,
        realizedPnl: 0.01,
        unrealizedPnl: null,
        roi: 1.34,
        closedAmount: 169,
        baseAsset: "TUT",
        openTime: Date.now() - 58_000,
        closeTime: Date.now() - 20_000,
        entryPrice: 0.05562,
        averageClosePrice: 0.05549,
        updatedAt: Date.now() - 20_000,
      },
      {
        id: "mock-promusdt-history",
        symbol: "PROMUSDT",
        contractType: "PERPETUAL" as const,
        direction: "SHORT" as const,
        positionSide: "BOTH",
        marginType: "cross" as const,
        leverage: 20,
        closeType: "FULL" as const,
        realizedPnl: 0.003,
        unrealizedPnl: null,
        roi: 0.48,
        closedAmount: 5.2,
        baseAsset: "PROM",
        openTime: Date.now() - 101_000,
        closeTime: Date.now() - 44_000,
        entryPrice: 2.417,
        averageClosePrice: 2.414,
        updatedAt: Date.now() - 44_000,
      },
      {
        id: "mock-ethusdt-partial-history",
        symbol: "ETHUSDT",
        contractType: "PERPETUAL" as const,
        direction: "SHORT" as const,
        positionSide: "BOTH",
        marginType: "cross" as const,
        leverage: 50,
        closeType: "PARTIAL" as const,
        realizedPnl: -0.13,
        unrealizedPnl: -0.02,
        roi: -10.65,
        closedAmount: 0.029,
        baseAsset: "ETH",
        openTime: Date.now() - 3_720_000,
        closeTime: null,
        entryPrice: 1887.2,
        averageClosePrice: 1889.5,
        updatedAt: Date.now() - 42_000,
      },
    ],
    openOrders: [
      {
        id: "mock-limit-buy",
        source: "ORDER" as const,
        symbol: "EDENUSDT",
        contractType: "PERPETUAL" as const,
        orderType: "LIMIT",
        side: "BUY" as const,
        positionSide: "BOTH",
        status: "NEW",
        timeInForce: "GTC",
        quantityUsdt: 13.37,
        executedQuantityUsdt: 0,
        progressPercent: 0,
        price: 0.07,
        averagePrice: null,
        triggerPrice: null,
        activationPrice: null,
        callbackRate: null,
        workingType: null,
        reduceOnly: false,
        closePosition: false,
        priceProtect: false,
        priceMatch: null,
        createdAt: Date.now() - 12 * 60_000,
        updatedAt: Date.now() - 12 * 60_000,
      },
      {
        id: "mock-stop-market-sell",
        source: "ALGO" as const,
        symbol: "EDENUSDT",
        contractType: "PERPETUAL" as const,
        orderType: "STOP_MARKET",
        side: "SELL" as const,
        positionSide: "BOTH",
        status: "NEW",
        timeInForce: null,
        quantityUsdt: 19.197,
        executedQuantityUsdt: null,
        progressPercent: null,
        price: null,
        averagePrice: null,
        triggerPrice: 0.079,
        activationPrice: null,
        callbackRate: null,
        workingType: "CONTRACT_PRICE",
        reduceOnly: true,
        closePosition: false,
        priceProtect: false,
        priceMatch: null,
        createdAt: Date.now() - 18 * 60_000,
        updatedAt: Date.now() - 18 * 60_000,
      },
      {
        id: "mock-take-profit-limit-buy",
        source: "ALGO" as const,
        symbol: "EDENUSDT",
        contractType: "PERPETUAL" as const,
        orderType: "TAKE_PROFIT",
        side: "BUY" as const,
        positionSide: "SHORT",
        status: "NEW",
        timeInForce: "GTC",
        quantityUsdt: 10.92,
        executedQuantityUsdt: null,
        progressPercent: null,
        price: 0.091,
        averagePrice: null,
        triggerPrice: 0.09,
        activationPrice: null,
        callbackRate: null,
        workingType: "CONTRACT_PRICE",
        reduceOnly: true,
        closePosition: false,
        priceProtect: true,
        priceMatch: null,
        createdAt: Date.now() - 22 * 60_000,
        updatedAt: Date.now() - 22 * 60_000,
      },
    ],
    walletBreakdown: [
      { walletName: "Spot", balance: 1096.25088 },
      { walletName: "USDⓈ-M Futures", balance: 2842.7 },
    ],
    sources: {
      totalAssets: "BINANCE_WALLETS_USDT",
      futures: "BINANCE_USDM_ACCOUNT_V3",
      realizedPnl: "BINANCE_USDM_INCOME",
      positionHistory: "BINANCE_USDM_ACCOUNT_TRADES",
      openOrders: "USD_M_OPEN_ORDERS+USD_M_OPEN_ALGO_ORDERS",
    },
    warnings: [],
    fetchedAt: new Date().toISOString(),
  };
}

function createMockBinanceAccountProfitCalendar(month: string) {
  const normalizedMonth = /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)
    ? month
    : new Date().toISOString().slice(0, 7);
  return {
    schemaVersion: 1 as const,
    month: normalizedMonth,
    currency: "USDT",
    days: [
      { date: `${normalizedMonth}-01`, pnl: 500.3 },
      { date: `${normalizedMonth}-03`, pnl: -256.23 },
      { date: `${normalizedMonth}-05`, pnl: 86.42 },
      { date: `${normalizedMonth}-08`, pnl: -38.7 },
      { date: `${normalizedMonth}-11`, pnl: 0 },
      { date: `${normalizedMonth}-14`, pnl: 127.58 },
      { date: `${normalizedMonth}-18`, pnl: -72.15 },
      { date: `${normalizedMonth}-22`, pnl: 316.8 },
      { date: `${normalizedMonth}-27`, pnl: -19.06 },
    ],
    source: "USD_M_INCOME_REALIZED_PNL+COMMISSION_ACTIVITY",
    warnings: [],
    fetchedAt: new Date().toISOString(),
  };
}

export function ensureBrowserDesktopApi() {
  if (typeof window.codexDesktop !== "undefined") return;
  document.documentElement.dataset.mockDesktop = "true";
  const previewParams = new URLSearchParams(window.location.search);
  const i18nLayoutQa = previewParams.get("i18n-layout-qa") === "1";
  const tradingAlertVisualQa = previewParams.get("trading-alert-visual-qa") === "1" || i18nLayoutQa;
  let binanceAccountBound = new URLSearchParams(window.location.search).get("binance-account-bound") === "1";

  let notificationListeners: Array<Listener<any>> = [];
  let statusListeners: Array<Listener<any>> = [];
  let serverRequestListeners: Array<Listener<any>> = [];
  let errorListeners: Array<Listener<any>> = [];
  let windowsUpdateDownloadProgressListeners: Array<Listener<any>> = [];
  let tradingAlertsChangedListeners: Array<Listener<any>> = [];
  let tradingAlertTriggeredListeners: Array<Listener<any>> = [];
  let tradingAlertOpenListeners: Array<Listener<any>> = [];
  const binanceMarketStreamSockets = new Map<string, WebSocket>();
  let binanceMarketStreamSequence = 0;
  let tradingAlertQaMode: "normal" | "loading" | "error" = "normal";
  const tradingAlertSnapshot = createMockTradingAlertsSnapshot(tradingAlertVisualQa);

  const session = {
    authenticated: true,
    baseUrl: "https://haolo.com",
    profile: {
      id: "mock-user-001",
      nickname: i18nLayoutQa ? "Alexandria Montgomery" : "浏览器预览用户",
      email: "mock@example.com",
      avatar_url: "",
      avatar_style: "nft-rose",
      level: {
        level: 1,
        icons: [{ type: "egg", count: 1 }],
        current_progress: 0,
        required_progress: 300,
      },
      balance_points: i18nLayoutQa ? 930.89 : undefined,
      membership_plan: i18nLayoutQa ? "basic" : undefined,
      trial_eligible: !i18nLayoutQa,
      subscription_balance: i18nLayoutQa ? 11_988.56 : undefined,
      subscription_balance_refresh_at: i18nLayoutQa ? "2026-08-20T00:00:00Z" : undefined,
    },
  };

  function mockLevelIcons(level: number) {
    const cappedLevel = Math.max(1, Math.floor(level));
    const weights = [
      { type: "cat_king", value: 8 },
      { type: "cat", value: 4 },
      { type: "egg_cat", value: 2 },
      { type: "egg", value: 1 },
    ];
    const icons: Array<{ type: string; count: number }> = [];
    let remaining = cappedLevel;
    for (const { type, value } of weights) {
      const count = Math.floor(remaining / value);
      if (count > 0) icons.push({ type, count });
      remaining %= value;
    }
    return icons.length ? icons : [{ type: "egg", count: 1 }];
  }

  function advanceMockLevel(delta = 1) {
    const current = typeof session.profile.level?.level === "number" ? session.profile.level.level : 1;
    const next = Math.max(1, current + delta);
    session.profile.level = {
      ...session.profile.level,
      level: next,
      icons: mockLevelIcons(next),
      current_progress: next,
    };
  }

  const threadId = "mock-thread-1";
  let activeThreadModel = "gpt-5.6-sol";
  let activeThreadReasoningEffort = "high";
  const mockConsumptionTurn = {
    id: "mock-turn-1",
    status: "completed",
    items: [
      {
        id: "mock-user-1",
        type: "userMessage",
        createdAt: new Date().toISOString(),
        text: "帮我梳理产品需求",
        content: [{ text: "帮我梳理产品需求" }],
      },
      {
        id: "mock-agent-1",
        type: "agentMessage",
        createdAt: new Date().toISOString(),
        text: "已经完成需求梳理。",
      },
    ],
  };
  let appTheme: "light" | "dark" = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  let appLanguage: "en" | "zh-CN" | "zh-TW" = document.documentElement.dataset.language === "zh-CN"
    ? "zh-CN"
    : document.documentElement.dataset.language === "zh-TW"
      ? "zh-TW"
      : document.documentElement.dataset.language === "en"
        ? "en"
        : "zh-CN";
  const systemIntegration = {
    taskbar: false,
    startMenu: false,
    startup: false,
    available: {
      taskbar: true,
      startMenu: true,
      startup: true,
    },
  };
  let taskCompletionPopupEnabled = true;
  let promptFavorites: Array<{ id: string; content: string; created_at: string; updated_at: string }> = [];
  let tradingPreferenceProfile: any = {
    schemaVersion: 1,
    onboardingCompleted: false,
    entries: [],
  };
  const mockWeb3PaymentOrders = new Map<string, any>();

  const api: DesktopApiLike = {
    async start() {
      queueMicrotask(() => {
        statusListeners.forEach((listener) => listener({ state: "ready", command: "mock-browser", pid: 1, port: 5177 }));
      });
      return { command: "mock-browser", port: 5177, init: {} };
    },
    async getStatus() {
      return { state: "ready" };
    },
    async getDefaults() {
      return {
        cwd: "/mock/workspace",
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        youleApiBaseUrl: "https://haolo.com",
        theme: appTheme,
        language: appLanguage,
        languagePreferenceStored: true,
        taskCompletionPopupEnabled,
      };
    },
    async resolveThreadGroupWorkspace(params: any) {
      const cwd = params?.externalPath || params?.cwd || `/mock/workspace/${params?.workspaceSlug || params?.groupId || "default"}`;
      return { ...params, cwd, path: cwd };
    },
    async listThreadGroupWorkspaces(params: any) {
      const groups = Array.isArray(params?.groups) ? params.groups : [];
      const data = groups.map((group: any) => {
        const cwd = group?.externalPath || group?.cwd || `/mock/workspace/${group?.workspaceSlug || group?.groupId || "default"}`;
        return { ...group, cwd, path: cwd };
      });
      return { data, items: data };
    },
    async openThreadGroupFolder(params: any) {
      return { ok: true, path: params?.externalPath || params?.cwd || "/mock/workspace/default" };
    },
    async pickThreadGroupFolder() {
      return { canceled: false, path: "/mock/imported-folder", name: "imported-folder" };
    },
    async createThreadGroupFolder(params: any) {
      const name = String(params?.name || "new-folder").trim() || "new-folder";
      return { ok: true, path: `/mock/workspace/default/${name}`, name };
    },
    async exportUserData() {
      return { ok: true, operation: "export", exportPath: "/mock/Haolo-user-data.zip" };
    },
    async importUserData() {
      return { ok: true, operation: "import", backupPath: "/mock/backup-before-import" };
    },
    async getUserDataTransferStatus() {
      return null;
    },
    async getSystemIntegrationState() {
      return { ...systemIntegration, available: { ...systemIntegration.available } };
    },
    async setSystemIntegration(params: any) {
      const key = params?.key as "taskbar" | "startMenu" | "startup" | undefined;
      if (key === "taskbar" || key === "startMenu" || key === "startup") {
        systemIntegration[key] = Boolean(params?.enabled);
      }
      return { ...systemIntegration, available: { ...systemIntegration.available } };
    },
    async setTaskCompletionPopupEnabled(params: any) {
      taskCompletionPopupEnabled = params?.enabled !== false;
      return { taskCompletionPopupEnabled };
    },
    async notifyExecutionPlanStatusChanged() {
      return { ok: true, shown: false };
    },
    async confirmTaskCompletionRendered() {
      return { ok: true, shown: taskCompletionPopupEnabled };
    },
    async setAppTheme(params: any) {
      appTheme = params?.theme === "dark" ? "dark" : "light";
      return { theme: appTheme };
    },
    async setAppLanguage(params: any) {
      appLanguage = params?.language === "en" || params?.language === "zh-TW" ? params.language : "zh-CN";
      return { language: appLanguage };
    },
    async checkWindowsUpdate() {
      return {
        current_version: "0.1.103",
        update_available: !tradingAlertVisualQa,
        force_update: !tradingAlertVisualQa,
        latest: { version: "0.1.105", release_notes: "暂无更新说明。" },
        download: {
          url: "https://haolo.com/mock-update.exe",
          file_name: "haolo_desktop-0.1.105-Setup.exe",
          size_bytes: 167_600_000,
          sha256: "",
        },
      };
    },
    async downloadWindowsUpdate(params: any) {
      const totalBytes = Number(params?.download?.size_bytes) || 167_600_000;
      for (const percent of [0, 7, 18, 31, 48, 63, 79, 92, 100]) {
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        windowsUpdateDownloadProgressListeners.forEach((listener) =>
          listener({
            fileName: params?.download?.file_name || "haolo_desktop-0.1.105-Setup.exe",
            downloadedBytes: Math.round((totalBytes * percent) / 100),
            totalBytes,
            percent,
          }),
        );
      }
      return { ok: true };
    },
    async getYouleSession() {
      return session;
    },
    async openWebsiteSupport() {
      window.open("https://haolo.com/#support=open", "_blank", "noopener,noreferrer");
      return { ok: true, authenticated: Boolean(session?.authenticated) };
    },
    async refreshProfile() {
      return session;
    },
    async createWeb3PaymentOrder(params: any) {
      const productId = String(params?.productId || "subscription_basic");
      const network = String(params?.network || "bsc");
      const selectionKey = `${productId}:${network}:web3`;
      const existingOrder = mockWeb3PaymentOrders.get(selectionKey);
      if (
        existingOrder?.status === "confirming"
        || (existingOrder?.status === "pending" && Date.parse(existingOrder.expires_at) > Date.now())
      ) return existingOrder;
      if (existingOrder?.status === "pending") existingOrder.status = "expired";
      const products: Record<string, { name: string; price: string; internalPrice: string; tokens: string; months: number; days: number; plan: string; billingCycle?: string; kind?: string }> = {
        subscription_trial: { name: "体验版订阅", price: "4.900", internalPrice: "4.873", tokens: "100", months: 0, days: 3, plan: "trial" },
        subscription_basic: { name: "基础版订阅", price: "39.000", internalPrice: "38.973", tokens: "300", months: 1, days: 0, plan: "basic" },
        subscription_pro: { name: "专业版订阅", price: "69.000", internalPrice: "68.952", tokens: "600", months: 1, days: 0, plan: "pro" },
        subscription_flagship: { name: "旗舰版订阅", price: "99.000", internalPrice: "98.931", tokens: "1000", months: 1, days: 0, plan: "flagship" },
        subscription_basic_annual: { name: "基础版年付订阅", price: "348.000", internalPrice: "347.756", tokens: "300", months: 12, days: 0, plan: "basic", billingCycle: "annual" },
        subscription_pro_annual: { name: "专业版年付订阅", price: "588.000", internalPrice: "587.588", tokens: "600", months: 12, days: 0, plan: "pro", billingCycle: "annual" },
        subscription_flagship_annual: { name: "旗舰版年付订阅", price: "708.000", internalPrice: "707.505", tokens: "1000", months: 12, days: 0, plan: "flagship", billingCycle: "annual" },
        points_pack_30: { name: "30积分包", price: "10.000", internalPrice: "9.993", tokens: "30", months: 0, days: 0, plan: "permanent", kind: "addon" },
      };
      const product = products[productId] || products.subscription_basic;
      const addresses: Record<string, string> = {
        binance_internal: "1261385376",
        okx_internal: "694504753333973132",
        bsc: "0xd69a98907565b8ACb49E84644842535c86A78457",
        tron: "TVXvodFriEMNjsVkuRWtiAmo1qVQauv635",
        arbitrum: "0xd69a98907565b8ACb49E84644842535c86A78457",
      };
      const now = Date.now();
      const order = {
        order_no: `W3${now}${mockWeb3PaymentOrders.size}`,
        product_id: productId,
        plan_id: product.plan,
        product_name: product.name,
        list_amount: String(Math.ceil(Number(product.price))),
        payable_amount: network === "binance_internal" || network === "okx_internal"
          ? product.internalPrice
          : product.price,
        currency: "USDT",
        token_amount: product.tokens,
        membership_months: product.months,
        membership_days: product.days,
        network,
        recipient_address: addresses[network] || addresses.bsc,
        token_contract: "mock-usdt-contract",
        token_decimals: network === "bsc" ? 18 : 6,
        status: "pending",
        fulfillment_status: "pending",
        expires_at: new Date(now + 30 * 60_000).toISOString(),
        created_at: new Date(now).toISOString(),
      };
      mockWeb3PaymentOrders.set(selectionKey, order);
      return order;
    },
    async getWeb3PaymentOrder(params: any) {
      for (const order of mockWeb3PaymentOrders.values()) {
        if (order.order_no === params?.orderNo) return order;
      }
      throw new Error("Web3 payment order not found");
    },
    async listWeb3RechargeHistory() {
      return {
        items: [
          {
            order_no: "W320260821140739",
            recharged_at: "2026-08-21T06:07:39+00:00",
            amount: "98.969",
            currency: "USDT",
            payment_method: "web3_arbitrum",
            network: "arbitrum",
            credited_points: "1000",
            transaction_hash: "0x8e9d4d1b66e7e7598ccde0d23a49ce52872a0fa2637c36b47bb7d68b20f637a1",
          },
          {
            order_no: "W320260820183023",
            recharged_at: "2026-08-20T10:30:23+00:00",
            amount: "98.956",
            currency: "USDT",
            payment_method: "web3_binance_internal",
            network: "binance_internal",
            credited_points: "1000",
            transaction_hash: "1261385376000042",
          },
        ],
      };
    },
    async refreshMemberLevel() {
      return { level: session.profile.level, session };
    },
    async sendActivityHeartbeat(params: any) {
      const delta = Number(params?.onlineSecondsDelta ?? params?.online_seconds_delta ?? 60);
      if (Number.isFinite(delta) && delta > 0) {
        advanceMockLevel(1);
      }
      return { level: session.profile.level, session };
    },
    async reportTaskCompleted() {
      advanceMockLevel(1);
      return { level: session.profile.level, session };
    },
    async reportConsumptionAppEntry() {
      return { ok: true };
    },
    async reportConsumptionEvent() {
      return { ok: true };
    },
    async getConsumptionOverview() {
      return {
        profile: session.profile,
        level: session.profile.level,
        cumulative_tokens: 85_000_000_000,
        cumulative_points: 128.64,
        peak_daily_tokens: 1_040_000_000,
        peak_daily_points: 18.42,
        longest_task_ms: 27_540_000,
        login_days: 15,
      };
    },
    async getConsumptionCalendar(params: any) {
      const month = String(params?.month || new Date().toISOString().slice(0, 7));
      const days = Array.from({ length: 31 }, (_, index) => ({
        date: `${month}-${String(index + 1).padStart(2, "0")}`,
        tokens: (index * 9_100_000) % 130_000_000,
        points: ((index * 91) % 1300) / 100,
        color_level: index % 6,
      }));
      return { month, days };
    },
    async getConsumptionRecords(params: any) {
      const page = Number(params?.page || 1);
      return {
        page,
        page_size: Number(params?.pageSize || 6),
        pages: 2,
        total: 24,
        items: [
          {
            interaction_id: "mock-turn-1",
            conversation_id: threadId,
            started_at: new Date().toISOString(),
            duration_ms: 126000,
            duration_display: "2分6秒",
            duration_label: "任务用时",
            duration_note: "来自客户端上报的任务开始与完成时间",
            usage_event_count: 3,
            tokens: 733000000,
            points: 2.31,
            display_unit: params?.unit || "token",
            models: ["gpt-5.6-sol", "gpt-5.6-terra"],
            type: "Haolo会话",
            task_kind: "task",
            task_kind_label: "主任务",
            status: "complete",
            question: "帮我梳理产品需求",
            answer_excerpt: "已经完成需求梳理。...",
            billing_explanation: "本行汇总 3 次实际模型调用，按输入、输出及缓存 Token 计费。",
          },
        ],
      };
    },
    async exportConsumptionReport(params: any) {
      const unit = params?.unit === "points" ? "积分" : "Token";
      return { ok: true, path: `/mock/HaoLo使用数据_${unit}.xlsx`, unit: params?.unit || "token" };
    },
    async login() {
      return session;
    },
    async lookupIdentity() {
      return { mode: "login", exists: true };
    },
    async sendOtp() {
      return { challenge_id: "mock-challenge", resend_after: 60, mode: "login" };
    },
    async verifyOtp() {
      return session;
    },
    async getBinancePublicMarketData(params: any) {
      const marketType = params?.marketType === "spot" ? "spot" : "futures";
      const base = marketType === "spot" ? "https://data-api.binance.vision" : "https://fapi.binance.com";
      const url = new URL(String(params?.path || "/"), base);
      Object.entries(params?.parameters || {}).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.set(key, String(value));
      });
      const response = await fetch(url, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      return {
        ok: response.ok,
        status: response.status,
        data,
        cached: false,
        retryAfterMs: Number(response.headers.get("retry-after")) * 1_000 || null,
        error: response.ok ? undefined : String((data as any)?.msg || `Binance market request failed: ${response.status}`),
      };
    },
    async cancelBinancePublicMarketData() {
      return { cancelled: false };
    },
    async getHyperliquidPublicCandles(params: any) {
      const response = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "candleSnapshot", req: params }),
      });
      const data = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, data, cached: false, retryAfterMs: Number(response.headers.get("retry-after")) * 1_000 || null, error: response.ok ? undefined : `Hyperliquid market request failed: ${response.status}` };
    },
    async getBinanceAccountStatus() {
      return {
        bound: binanceAccountBound,
        apiKeyMasked: binanceAccountBound ? "ABCD••••WXYZ" : null,
        boundAt: binanceAccountBound ? new Date().toISOString() : null,
        updatedAt: binanceAccountBound ? new Date().toISOString() : null,
        secureStorageAvailable: true,
        emailMasked: "jo****ec@qq.com",
      };
    },
    async sendBinanceAccountOtp() {
      return { challengeId: "mock-binance-challenge", emailMasked: "jo****ec@qq.com", resendAfter: 60 };
    },
    async bindBinanceAccount() {
      binanceAccountBound = true;
      return {
        status: {
          bound: true,
          apiKeyMasked: "ABCD••••WXYZ",
          boundAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          secureStorageAvailable: true,
        },
        snapshot: createMockBinanceAccountSnapshot(),
      };
    },
    async getBinanceAccountSnapshot() {
      if (!binanceAccountBound) throw new Error("尚未绑定 Binance API。");
      return createMockBinanceAccountSnapshot();
    },
    async getBinanceAccountProfitCalendar(params: { month: string }) {
      if (!binanceAccountBound) throw new Error("尚未绑定 Binance API。");
      return createMockBinanceAccountProfitCalendar(params?.month);
    },
    async removeBinanceAccount(params: any) {
      if (!params?.challengeId || !/^\d{6}$/.test(String(params?.code || ""))) {
        throw new Error("请输入 6 位邮箱验证码。");
      }
      binanceAccountBound = false;
      return {
        bound: false,
        apiKeyMasked: null,
        boundAt: null,
        updatedAt: null,
        secureStorageAvailable: true,
        emailMasked: "jo****ec@qq.com",
      };
    },
    async completeRegistration() {
      return session;
    },
    async getWechatAuthConfig() {
      return { enabled: false, flow_expires_in: 300, poll_interval_ms: 1500 };
    },
    async startWechatAuthFlow() {
      throw new Error("微信登录在浏览器预览中不可用");
    },
    async getWechatAuthFlowStatus() {
      return { status: "waiting_scan" };
    },
    async exchangeWechatAuthFlow() {
      return { mode: "needs_email", status: "needs_email" };
    },
    async listBusinessModelPools() {
      return {
        configured: false,
        catalogVersion: 0,
        updatedAt: null,
        pools: [],
        source: "browser-mock",
      };
    },
    async listVideoExpertModels() {
      return {
        object: "list",
        catalog_version: 1,
        default_model: "grok-imagine-video-1.5",
        models: [
          {
            id: "grok-imagine-video-1.5",
            display_name: "Grok Imagine Video 1.5",
            input_mode: "text-or-image-to-video",
            required_image_count: 0,
            max_image_count: 1,
            required_video_count: 0,
            max_video_count: 0,
            screen_sizes: [
              { value: "16:9", label: "横屏 16:9", resolution: "720p" },
              { value: "9:16", label: "竖屏 9:16", resolution: "720p" },
              { value: "1:1", label: "方形 1:1", resolution: "720p" },
              { value: "4:3", label: "横向 4:3", resolution: "720p" },
              { value: "3:4", label: "竖向 3:4", resolution: "720p" },
              { value: "2:3", label: "竖向 2:3", resolution: "720p" },
              { value: "3:2", label: "横向 3:2", resolution: "720p" },
            ],
            durations: Array.from({ length: 15 }, (_, index) => ({
              value: String(index + 1),
              label: `${index + 1}秒`,
            })),
            default_screen_size: "16:9",
            default_duration: "6",
            default_resolution: "720p",
          },
        ],
      };
    },
    async logout() {
      return { authenticated: false, baseUrl: "https://haolo.com", profile: null };
    },
    async patchProfile(params: any) {
      if (params?.nickname) {
        session.profile.nickname = params.nickname;
      }
      return session;
    },
    async listPromptFavorites(params: any = {}) {
      const offset = Math.max(0, Number(params?.offset) || 0);
      const limit = Math.max(1, Number(params?.limit) || 100);
      return { items: promptFavorites.slice(offset, offset + limit), total: promptFavorites.length, limit, offset };
    },
    async createPromptFavorite(params: any) {
      const content = String(params?.content || "").trim();
      if (promptFavorites.some((item) => item.content === content)) throw new Error("该提示词已收藏");
      const now = new Date().toISOString();
      const item = { id: `favorite-${Date.now()}`, content, created_at: now, updated_at: now };
      promptFavorites = [item, ...promptFavorites];
      return item;
    },
    async updatePromptFavorite(params: any) {
      const id = String(params?.promptFavoriteId || "");
      const content = String(params?.content || "").trim();
      if (promptFavorites.some((item) => item.id !== id && item.content === content)) throw new Error("该提示词已收藏");
      const current = promptFavorites.find((item) => item.id === id);
      if (!current) throw new Error("收藏的提示词不存在");
      const item = { ...current, content, updated_at: new Date().toISOString() };
      promptFavorites = [item, ...promptFavorites.filter((candidate) => candidate.id !== id)];
      return item;
    },
    async deletePromptFavorite(params: any) {
      const id = String(params?.promptFavoriteId || "");
      promptFavorites = promptFavorites.filter((item) => item.id !== id);
      return null;
    },
    async listMaterials() {
      return { data: [] };
    },
    async listArtifacts() {
      return { data: [] };
    },
    async uploadMaterialFile(params: any) {
      return {
        attachment: {
          name: params?.name || "mock-file",
          mime: params?.mime || "application/octet-stream",
          size: params?.size || 0,
          object_key: `mock-${Date.now()}`,
          url: params?.mime?.startsWith("image/") ? URL.createObjectURL(new Blob([params.bytes], { type: params.mime })) : "",
          material_id: `material-${Date.now()}`,
        },
        material: {
          id: `material-${Date.now()}`,
          name: params?.name || "mock-file",
          mime: params?.mime || "application/octet-stream",
          url: "",
          size_bytes: params?.size || 0,
        },
      };
    },
    async listAutoTasks() {
      return [];
    },
    async saveAutoTasks(params: any) {
      return params?.tasks || [];
    },
    async tradingAlertsSnapshot() {
      if (tradingAlertQaMode === "loading") await new Promise((resolve) => window.setTimeout(resolve, 4_000));
      if (tradingAlertQaMode === "error") return { ok: false, error: { code: "TRADING_ALERT_QA_ERROR", message: "行情连接暂时不可用，请检查网络或数据提供方。" } };
      return structuredClone(tradingAlertSnapshot);
    },
    async tradingAlertsGetSimulation(params: any) {
      const simulationId = String(params?.simulationId || "");
      return {
        ok: true,
        data: {
          simulationId,
          draftId: "qa-draft-triggered",
          ruleHash: "sha256:qa-triggered",
          generated: { primary: [] },
          proof: { triggered: true, trace: [] },
        },
      };
    },
    async tradingAlertsPause(params: any) {
      const alert = tradingAlertSnapshot.alerts.find((entry) => entry.alertId === params?.alertId);
      if (alert) Object.assign(alert, { status: "paused", enabled: false, failure: "用户暂停" });
      tradingAlertsChangedListeners.forEach((listener) => listener(structuredClone(tradingAlertSnapshot)));
      return structuredClone(alert || null);
    },
    async tradingAlertsResume(params: any) {
      const alert = tradingAlertSnapshot.alerts.find((entry) => entry.alertId === params?.alertId);
      if (alert) Object.assign(alert, { status: "monitoring", enabled: true, failure: null });
      tradingAlertsChangedListeners.forEach((listener) => listener(structuredClone(tradingAlertSnapshot)));
      return structuredClone(alert || null);
    },
    async tradingAlertsDelete(params: any) {
      const index = tradingAlertSnapshot.alerts.findIndex((entry) => entry.alertId === params?.alertId);
      const [removed] = index >= 0 ? tradingAlertSnapshot.alerts.splice(index, 1) : [];
      tradingAlertsChangedListeners.forEach((listener) => listener(structuredClone(tradingAlertSnapshot)));
      return structuredClone(removed || null);
    },
    async previewFile() {
      return null;
    },
    async previewImageFile() {
      return { cancelled: true };
    },
    async localFileInfo() {
      return { path: "", name: "", mime: "application/octet-stream", size: 0 };
    },
    async readLocalFile() {
      return { path: "", name: "", mime: "image/png", size: 0, base64: "" };
    },
    async listThreads() {
      return {
        data: [
          {
            id: threadId,
            name: "浏览器预览会话",
            kind: "main_session",
            preview: "可以直接在这里测试主界面",
            last_message_at: new Date().toISOString(),
          },
        ],
      };
    },
    async modelList() {
      return { data: [{ id: "mock-model" }] };
    },
    async configRead() {
      return { model: "mock-model", cwd: "/mock/workspace" };
    },
    async skillsList() {
      return { cwd: "/mock/workspace", skills: [] };
    },
    async pluginsList() {
      return {
        directory: "/mock/haolo-ai-home/plugins",
        data: [
          {
            id: "mock-documents",
            name: "documents",
            title: "Documents",
            description: "Create and edit document artifacts",
            enabled: true,
            installed: true,
          },
        ],
      };
    },
    async setPluginEnabled(params: any) {
      return { ok: true, ...params };
    },
    async deletePlugin(params: any) {
      return { ok: true, ...params };
    },
    async startThread(params: any = {}) {
      activeThreadModel = String(params.model || activeThreadModel);
      activeThreadReasoningEffort = String(params.reasoningEffort || params.effort || activeThreadReasoningEffort);
      return {
        thread: {
          id: threadId,
          model: activeThreadModel,
          reasoningEffort: activeThreadReasoningEffort,
          serviceTier: null,
        },
        model: activeThreadModel,
        reasoningEffort: activeThreadReasoningEffort,
        serviceTier: null,
      };
    },
    async getTradingPreferenceProfile() {
      return {
        ok: true,
        completed: tradingPreferenceProfile.onboardingCompleted === true,
        profile: tradingPreferenceProfile,
      };
    },
    async saveTradingPreferenceProfile(params: any = {}) {
      const entries = Array.isArray(params.entries) ? params.entries : [];
      const byKey = new Map(entries.map((entry: any) => [entry.key, entry.value]));
      tradingPreferenceProfile = {
        schemaVersion: 1,
        maxLossPerTradePercent: Number(byKey.get("max_loss_per_trade_percent")) || 2,
        minimumRiskRewardRatio: (() => {
          const value = Number(byKey.get("minimum_risk_reward_ratio"));
          return Number.isFinite(value) && value > 0 ? value : 0.4;
        })(),
        moveStopToBreakEven: byKey.get("move_stop_to_break_even") !== false,
        breakEvenTriggerR: Number(byKey.get("break_even_trigger_r")) || 1,
        analysisStyle: String(byKey.get("trading_analysis_style") || "concise"),
        requiredAnalysisSections: String(byKey.get("required_analysis_sections") || ""),
        conflictHandling: String(byKey.get("risk_conflict_handling") || ""),
        onboardingCompleted: byKey.get("onboarding_completed") === true,
        entries,
      };
      return { ok: true, completed: tradingPreferenceProfile.onboardingCompleted, profile: tradingPreferenceProfile };
    },
    async stageContinuationPrompt(params: any = {}) {
      return { ok: true, transaction: { ...params, status: "ready", targetThreadId: null } };
    },
    async discardSupersededContinuations() {
      return { ok: true, removedCount: 0 };
    },
    async createContinuationThread(params: any = {}) {
      const result = await this.startThread({ ...params, activate: false });
      if (result?.thread && params.name) result.thread.name = params.name;
      return result;
    },
    async listContinuationTransactions() {
      return { data: [] };
    },
    async readThreadForBackgroundHydration() {
      return {
        thread: {
          id: threadId,
          model: activeThreadModel,
          reasoningEffort: activeThreadReasoningEffort,
          serviceTier: null,
          turns: [mockConsumptionTurn],
        },
      };
    },
    async resumeThread() {
      return {
        thread: {
          id: threadId,
          model: activeThreadModel,
          reasoningEffort: activeThreadReasoningEffort,
          serviceTier: null,
          turns: [mockConsumptionTurn],
        },
        model: activeThreadModel,
        reasoningEffort: activeThreadReasoningEffort,
        serviceTier: null,
      };
    },
    async updateThreadSettings(params: any = {}) {
      activeThreadModel = String(params.model || activeThreadModel);
      activeThreadReasoningEffort = String(params.reasoningEffort || params.effort || activeThreadReasoningEffort);
      const threadSettings = {
        model: activeThreadModel,
        effort: activeThreadReasoningEffort,
        serviceTier: null,
      };
      queueMicrotask(() => emitNotification("thread/settings/updated", { threadId, threadSettings }));
      return { changed: true, threadSettings };
    },
    async compactThread() {
      const turnId = `compact-${Date.now()}`;
      queueMicrotask(() => {
        emitNotification("turn/started", { threadId, turn: { id: turnId } });
        emitNotification("item/completed", {
          threadId,
          turnId,
          item: { id: `${turnId}-item`, type: "contextCompaction" },
        });
        emitNotification("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
      });
      return { ok: true };
    },
    async sendMessage(params: any) {
      const text = String(params?.text || "");
      emitNotification("turn/started", { threadId, turn: { id: `turn-${Date.now()}` } });
      if (text.includes("附件")) {
        emitNotification("item/started", { threadId, item: mockItem("userMessage", text) });
      }
      window.setTimeout(() => {
        emitNotification("item/reasoning/textDelta", { threadId, itemId: "reasoning-1", delta: "正在整理思路..." });
      }, 150);
      window.setTimeout(() => {
        emitNotification("item/commandExecution/outputDelta", { threadId, itemId: "tool-1", delta: btoa("tool invoked") });
      }, 300);
      window.setTimeout(() => {
        emitNotification("item/agentMessage/delta", { threadId, itemId: "agent-1", delta: `已收到：${text.slice(0, 20) || "你好"}` });
      }, 450);
      window.setTimeout(() => {
        emitNotification("turn/completed", { threadId, turn: { id: `turn-${Date.now()}` } });
      }, 900);
      return { ok: true };
    },
    async steerTurn() {
      return { ok: true, turnId: `turn-${Date.now()}` };
    },
    async interruptTurn() {
      emitNotification("turn/completed", { threadId, turn: { id: `turn-${Date.now()}` } });
      return { ok: true };
    },
    async respondServerRequest() {
      return { ok: true };
    },
    async openExternal(url: string) {
      window.open(url, "_blank", "noopener,noreferrer");
      return { ok: true };
    },
    async subscribeBinanceMarketStreams(params: any, callback: Listener<any>) {
      const marketType = String(params?.marketType || "futures").toLowerCase();
      const base = marketType === "spot"
        ? "wss://data-stream.binance.vision:443/stream"
        : "wss://fstream.binance.com/market/stream";
      const url = new URL(base);
      url.searchParams.set("streams", [...new Set(params?.streams || [])].join("/"));
      const subscriptionId = `browser-market-${Date.now()}-${++binanceMarketStreamSequence}`;
      const socket = new WebSocket(url.href);
      binanceMarketStreamSockets.set(subscriptionId, socket);
      socket.onopen = () => callback({ type: "health", status: "connected", at: Date.now() });
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          callback({ type: "data", stream: message.stream, data: message.data, receivedAt: Date.now() });
        } catch {}
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => callback({ type: "health", status: "reconnecting", at: Date.now() });
      return { subscriptionId };
    },
    async unsubscribeBinanceMarketStreams(params: any) {
      const subscriptionId = String(params?.subscriptionId || "");
      const socket = binanceMarketStreamSockets.get(subscriptionId);
      binanceMarketStreamSockets.delete(subscriptionId);
      if (!socket) return { removed: false };
      socket.onclose = null;
      socket.close();
      return { removed: true };
    },
    async openBlockchainTransaction(params) {
      const network = String(params?.network || "");
      const transactionHash = String(params?.transactionHash || "");
      const explorerBaseUrls: Record<string, string> = {
        bsc: "https://bscscan.com/tx/",
        tron: "https://tronscan.org/#/transaction/",
        arbitrum: "https://arbiscan.io/tx/",
      };
      const pattern = network === "tron" ? /^[0-9a-fA-F]{64}$/ : /^0x[0-9a-fA-F]{64}$/;
      const baseUrl = explorerBaseUrls[network];
      if (!baseUrl || !pattern.test(transactionHash)) throw new Error("交易哈希格式无效");
      window.open(`${baseUrl}${transactionHash}`, "_blank", "noopener,noreferrer");
      return { ok: true };
    },
    async windowControl() {
      return { ok: true, maximized: false, pinned: false };
    },
    async windowResize() {
      return { ok: true };
    },
    onStatus(callback) {
      statusListeners.push(callback);
      return () => {
        statusListeners = statusListeners.filter((listener) => listener !== callback);
      };
    },
    onLog() {
      return () => {};
    },
    onNotification(callback) {
      notificationListeners.push(callback);
      return () => {
        notificationListeners = notificationListeners.filter((listener) => listener !== callback);
      };
    },
    onSkills() {
      return () => {};
    },
    onAutoTasksChanged() {
      return () => {};
    },
    onTradingAlertsChanged(callback) {
      tradingAlertsChangedListeners.push(callback);
      return () => { tradingAlertsChangedListeners = tradingAlertsChangedListeners.filter((listener) => listener !== callback); };
    },
    onTradingAlertTriggered(callback) {
      tradingAlertTriggeredListeners.push(callback);
      return () => { tradingAlertTriggeredListeners = tradingAlertTriggeredListeners.filter((listener) => listener !== callback); };
    },
    onTradingAlertOpen(callback) {
      tradingAlertOpenListeners.push(callback);
      return () => { tradingAlertOpenListeners = tradingAlertOpenListeners.filter((listener) => listener !== callback); };
    },
    onTradingAlertMarketData() {
      return () => {};
    },
    onServerRequest(callback) {
      serverRequestListeners.push(callback);
      return () => {
        serverRequestListeners = serverRequestListeners.filter((listener) => listener !== callback);
      };
    },
    onError(callback) {
      errorListeners.push(callback);
      return () => {
        errorListeners = errorListeners.filter((listener) => listener !== callback);
      };
    },
    onWindowsUpdateDownloadProgress(callback) {
      windowsUpdateDownloadProgressListeners.push(callback);
      return () => {
        windowsUpdateDownloadProgressListeners = windowsUpdateDownloadProgressListeners.filter((listener) => listener !== callback);
      };
    },
    onWindowState() {
      return () => {};
    },
    onOpenSettings() {
      return () => {};
    },
  };

  window.codexDesktop = api;
  (window as any).__haoloTradingAlertsQa = {
    setMode(mode: "normal" | "loading" | "error") {
      tradingAlertQaMode = ["normal", "loading", "error"].includes(mode) ? mode : "normal";
      if (tradingAlertQaMode === "normal") tradingAlertsChangedListeners.forEach((listener) => listener(structuredClone(tradingAlertSnapshot)));
      if (tradingAlertQaMode === "error") tradingAlertsChangedListeners.forEach((listener) => listener({ ok: false, error: { code: "TRADING_ALERT_QA_ERROR", message: "行情连接暂时不可用，请检查网络或数据提供方。" } }));
    },
    trigger() {
      const evidence = tradingAlertSnapshot.evidence[0];
      tradingAlertTriggeredListeners.forEach((listener) => listener({ threadId, alertId: evidence.alertId, evidenceId: evidence.evidenceId, title: "价格触碰上升趋势线", summary: "QA 触发", marketId: evidence.contexts[0].marketId, interval: evidence.contexts[0].interval, triggeredAt: evidence.triggeredAt }));
    },
    open() {
      const evidence = tradingAlertSnapshot.evidence[0];
      tradingAlertOpenListeners.forEach((listener) => listener({ alertId: evidence.alertId, evidenceId: evidence.evidenceId, marketId: evidence.contexts[0].marketId, interval: evidence.contexts[0].interval, triggeredAt: evidence.triggeredAt }));
    },
  };

  function emitNotification(method: string, params: any) {
    notificationListeners.forEach((listener) => listener({ method, params }));
  }
}

function mockItem(type: string, text: string): MockMessage {
  return {
    id: `${type}-${Date.now()}`,
    type,
    text,
    content: [{ text }],
  };
}

