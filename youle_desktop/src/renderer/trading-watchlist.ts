import type { TradingFavoriteMarketRecord } from "./trading-expert-market.ts";

export const WATCHLIST_NAME_LIMIT = 5;
export const WATCHLIST_RECOMMENDED_MARKETS: readonly TradingFavoriteMarketRecord[] =
  ["BTC", "ETH", "ZEC", "BNB", "SNDK", "MU", "SKHYNIX", "XAU"].map((baseAsset) => ({
    id: `BINANCE:FUTURES:${baseAsset}USDT`,
    provider: "binance",
    symbol: `${baseAsset}USDT`,
    baseAsset,
    quoteAsset: "USDT",
    displaySymbol: `${baseAsset}/USDT`,
    description: `${baseAsset}/USDT 币安永续合约`,
    venue: "币安",
    assetClass: baseAsset === "XAU" ? "commodity" : ["SNDK", "MU", "SKHYNIX"].includes(baseAsset) ? "stock" : "crypto",
    marketType: "perpetual",
    tag: "永续",
  }));
export const WATCHLIST_DEFAULT_GROUPS = [
  { id: "watchlist", name: "自选" },
  { id: "tradfi", name: "传统金融" },
  { id: "indices", name: "指数" },
] as const;

export interface TradingWatchlistGroup {
  id: string;
  name: string;
  markets: TradingFavoriteMarketRecord[];
}

export function tradingWatchlistStorageKey(accountIdentity = "") {
  const account = accountIdentity.trim().toLowerCase();
  return `haolo.trading-market.watchlists.v1${account ? `.account.${encodeURIComponent(account)}` : ""}`;
}

export function watchlistGroupNameError(
  name: string,
  groups: readonly TradingWatchlistGroup[],
) {
  const trimmed = name.trim();
  if (!trimmed) return "请输入分组名称";
  if (Array.from(trimmed).length > WATCHLIST_NAME_LIMIT)
    return "分组名称最多5个字";
  if (/[\r\n\u0000-\u001f]/u.test(trimmed))
    return "分组名称不能包含换行或控制字符";
  if (
    groups.some((group) => group.name.toLowerCase() === trimmed.toLowerCase())
  )
    return "分组名称已存在";
  return "";
}

export class TradingWatchlistStore {
  groups: TradingWatchlistGroup[] = WATCHLIST_DEFAULT_GROUPS.map((group) => ({
    ...group,
    markets: [],
  }));
  activeGroupId = "watchlist";
  expanded = true;
  private readonly key: string;
  private readonly storage: Pick<Storage, "getItem" | "setItem">;
  private readonly normalizeRecords: (
    value: unknown,
  ) => TradingFavoriteMarketRecord[];

  constructor(
    storage: Pick<Storage, "getItem" | "setItem">,
    accountIdentity: string,
    normalizeRecords: (value: unknown) => TradingFavoriteMarketRecord[],
  ) {
    this.storage = storage;
    this.key = tradingWatchlistStorageKey(accountIdentity);
    this.normalizeRecords = normalizeRecords;
    try {
      const saved = JSON.parse(storage.getItem(this.key) || "null");
      if (!saved || saved.version !== 1 || !Array.isArray(saved.groups)) return;
      for (const raw of saved.groups) {
        if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string")
          continue;
        const builtin = this.groups.find((group) => group.id === raw.id);
        if (builtin) {
          if (builtin.id === "watchlist") builtin.markets = normalizeRecords(raw.markets);
        } else if (raw.id === "contracts" || raw.id === "spot") {
          // Keep the user's old manual lists when replacing the empty categories.
          const markets = normalizeRecords(raw.markets);
          if (markets.length) {
            let id = `custom-legacy-${raw.id}`;
            while (this.groups.some((group) => group.id === id) || saved.groups.some((group: TradingWatchlistGroup | null) => group?.id === id)) id += "-migrated";
            let name = raw.id === "contracts" ? "原合约" : "原现货";
            let suffix = 1;
            while (this.groups.some((group) => group.name === name)
              || saved.groups.some((group: TradingWatchlistGroup | null) => typeof group?.id === "string" && group.id.startsWith("custom-") && group.name === name)) {
              name = `${raw.id === "contracts" ? "原合约" : "原现货"}${suffix++}`;
            }
            this.groups.push({ id, name, markets });
            if (saved.activeGroupId === raw.id) this.activeGroupId = id;
          }
        } else if (
          raw.id.startsWith("custom-") &&
          !this.groups.some((group) => group.id === raw.id) &&
          !watchlistGroupNameError(raw.name, [])
        ) {
          let name = raw.name.trim();
          const base = name;
          let suffix = 1;
          while (watchlistGroupNameError(name, this.groups)) {
            const ending = String(suffix++);
            name = `${Array.from(base).slice(0, WATCHLIST_NAME_LIMIT - ending.length).join("")}${ending}`;
          }
          this.groups.push({
            id: raw.id,
            name,
            markets: normalizeRecords(raw.markets),
          });
        }
      }
      if (this.groups.some((group) => group.id === saved.activeGroupId))
        this.activeGroupId = saved.activeGroupId;
      this.expanded = saved.expanded !== false;
    } catch {
      // Invalid or unavailable local storage starts with empty independent lists.
    }
  }

  get activeGroup() {
    return (
      this.groups.find((group) => group.id === this.activeGroupId) ||
      this.groups[0]
    );
  }

  get fixedGroup() {
    return this.activeGroupId === "tradfi" || this.activeGroupId === "indices";
  }

  updateTradFiMarkets(records: TradingFavoriteMarketRecord[]) {
    this.groups.find((group) => group.id === "tradfi")!.markets = records.filter(
      (market) => market.provider === "binance" && market.marketType === "perpetual" && market.assetClass !== "crypto",
    );
  }

  save() {
    try {
      this.storage.setItem(
        this.key,
        JSON.stringify({
          version: 1,
          groups: this.groups.map((group) => group.id === "tradfi" || group.id === "indices"
            ? { ...group, markets: [] } : group),
          activeGroupId: this.activeGroupId,
          expanded: this.expanded,
        }),
      );
    } catch {
      // Keep the current session usable when local storage is disabled or full.
    }
  }

  selectGroup(id: string) {
    if (!this.groups.some((group) => group.id === id)) return false;
    this.activeGroupId = id;
    this.save();
    return true;
  }

  addGroup(name: string) {
    const error = watchlistGroupNameError(name, this.groups);
    if (error) return { error };
    const group = {
      id: `custom-${crypto.randomUUID()}`,
      name: name.trim(),
      markets: [],
    };
    this.groups.push(group);
    this.activeGroupId = group.id;
    this.save();
    return { group, error: "" };
  }

  has(marketId: string) {
    return this.activeGroup.markets.some((market) => market.id === marketId);
  }

  removeGroup(id: string) {
    if (!id.startsWith("custom-") || !this.groups.some((group) => group.id === id))
      return false;
    this.groups = this.groups.filter((group) => group.id !== id);
    if (this.activeGroupId === id) this.activeGroupId = "watchlist";
    this.save();
    return true;
  }

  addMarkets(records: readonly TradingFavoriteMarketRecord[]) {
    if (this.fixedGroup) return;
    const existing = new Set(this.activeGroup.markets.map((market) => market.id));
    for (const record of this.normalizeRecords(records)) {
      if (existing.has(record.id)) continue;
      this.activeGroup.markets.push(record);
      existing.add(record.id);
    }
    this.save();
  }

  setMembership(record: TradingFavoriteMarketRecord, checked: boolean) {
    if (this.fixedGroup) return;
    const group = this.activeGroup;
    if (checked) {
      const normalized = this.normalizeRecords([record])[0];
      if (!normalized || this.has(normalized.id)) return;
      group.markets.push(normalized);
    } else {
      group.markets = group.markets.filter((market) => market.id !== record.id);
    }
    this.save();
  }

  move(marketId: string, targetId: string, after: boolean) {
    if (this.fixedGroup) return false;
    const markets = this.activeGroup.markets;
    const source = markets.find((market) => market.id === marketId);
    if (
      !source ||
      marketId === targetId ||
      !markets.some((market) => market.id === targetId)
    )
      return false;
    const next = markets.filter((market) => market.id !== marketId);
    const index = next.findIndex((market) => market.id === targetId);
    next.splice(index + Number(after), 0, source);
    this.activeGroup.markets = next;
    this.save();
    return true;
  }

  reorder(ids: string[]) {
    if (this.fixedGroup) return;
    const records = new Map(this.activeGroup.markets.map((market) => [market.id, market]));
    const ordered = [...new Set(ids)].flatMap((id) => records.has(id) ? [records.get(id)!] : []);
    const seen = new Set(ordered.map((market) => market.id));
    this.activeGroup.markets = [...ordered, ...this.activeGroup.markets.filter((market) => !seen.has(market.id))];
    this.save();
  }
}
