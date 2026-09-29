import type {
  TradingMarket,
  TradingFavoriteMarketRecord,
} from "./trading-expert-market.ts";
import { TradingFavoriteTickerSortController } from "./trading-expert-favorite-ticker-sort.ts";
import { TradingPriceFlash } from "./trading-price-flash.ts";
import { TradingPublicIndices, indexValue, indexChange, indexTime, indexSourceLink, localizedIndexText, openIndexHistory, type PublicMarketIndex } from "./trading-public-indices.ts";
import {
  TradingWatchlistStore,
  WATCHLIST_NAME_LIMIT,
  WATCHLIST_RECOMMENDED_MARKETS,
  watchlistGroupNameError,
} from "./trading-watchlist.ts";
import { getCurrentAppLanguage, translateAppText } from "./app-language.mjs";

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
const chevron =
  '<svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5"/></svg>';
const removeIcon = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6-6 6"/></svg>';
const uiText = (value: string) => translateAppText(value, getCurrentAppLanguage());
const displayGroupName = (group: { id: string; name: string }) =>
  group.id.startsWith("custom-") ? group.name : uiText(group.name);

export function renderTradingWatchlistToggle() {
  return `<button type="button" class="trading-watchlist-toggle" data-watchlist-toggle aria-expanded="true" aria-controls="trading-watchlist-panel">收起自选${chevron}</button>`;
}

export function renderTradingWatchlistHost() {
  return '<section id="trading-watchlist-panel" class="trading-watchlist" data-watchlist-host aria-label="自选列表"></section>';
}

interface WatchlistOptions {
  store: TradingWatchlistStore;
  resolveMarket: (record: TradingFavoriteMarketRecord) => TradingMarket;
  formatPrice: (price: number) => string;
  selectedMarketId: () => string;
  openPicker: () => void;
  selectMarket: (market: TradingMarket) => void;
  onChange: () => void;
  tradFiState: () => "loading" | "ready" | "error";
  retryTradFi: () => void;
}

export class TradingWatchlistPanel {
  private readonly options: WatchlistOptions;
  private host: HTMLElement | null = null;
  private toggle: HTMLButtonElement | null = null;
  private dialog: HTMLDialogElement | null = null;
  private bindings: AbortController | null = null;
  private rowSizeObserver: ResizeObserver | null = null;
  private sorter: TradingFavoriteTickerSortController | null = null;
  private sort: { column: "price" | "change"; direction: 1 | -1 } | null = null;
  private deferredRender = false;
  private menuCloseTimer: number | null = null;
  private readonly indices: TradingPublicIndices;
  private indexDialog: HTMLDialogElement | null = null;
  private renderedLanguage = getCurrentAppLanguage();
  private readonly recommendationSelections = new Map<string, Set<string>>();
  private readonly priceFlash = new TradingPriceFlash();

  constructor(options: WatchlistOptions) {
    this.options = options;
    this.indices = new TradingPublicIndices(() => this.refresh());
  }

  attach(root: ParentNode = document) {
    const host = root.querySelector<HTMLElement>("[data-watchlist-host]");
    const toggle = root.querySelector<HTMLButtonElement>(
      "[data-watchlist-toggle]",
    );
    if (host === this.host && toggle === this.toggle) return;
    this.rowSizeObserver?.disconnect();
    this.closeMenu();
    this.bindings?.abort();
    this.sorter?.destroy();
    this.sorter = null;
    // The conversation renderer replaces this panel during ordinary updates.
    // Preserve each quote's remaining flash when attaching the replacement DOM.
    // Leaving the workspace entirely still releases the retained elements.
    if (!host) this.priceFlash.clear();
    this.host = host;
    if (host) this.indices.start();
    this.toggle = toggle;
    this.bindings = new AbortController();
    const { signal } = this.bindings;
    toggle?.addEventListener(
      "click",
      () => {
        this.setExpanded(!this.options.store.expanded);
      },
      { signal },
    );
    host?.addEventListener("click", this.handleClick, { signal });
    host?.addEventListener("keydown", this.handleKeyDown, { signal });
    document.addEventListener("pointerover", this.handleGroupPointerOver, { signal });
    host?.addEventListener("pointerout", this.handleGroupPointerOut, { signal });
    host?.addEventListener("change", this.handleRecommendationChange, { signal });
    window.addEventListener("resize", () => this.closeMenu(), { signal });
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (
          event.target instanceof Node &&
          !this.host
            ?.querySelector("[data-watchlist-groups]")
            ?.contains(event.target)
        )
          this.closeMenu();
      },
      { signal, capture: true },
    );
    this.refresh();
  }

  setExpanded(expanded: boolean) {
    if (this.options.store.expanded === expanded) return;
    this.options.store.expanded = expanded;
    this.options.store.save();
    this.refresh();
    this.options.onChange();
  }

  refresh() {
    const { store } = this.options;
    const language = getCurrentAppLanguage();
    if (this.renderedLanguage !== language) {
      // The dialog is rendered with localized dynamic index data. Close it on
      // a language switch so it cannot retain the previous language's copy.
      this.indexDialog?.close();
      this.indexDialog = null;
      this.renderedLanguage = language;
    }
    const showingIndices = store.activeGroupId === "indices";
    this.indices.setActive(Boolean(this.host && store.expanded && showingIndices));
    if (this.toggle) {
      this.toggle.innerHTML = `${store.expanded ? "收起自选" : "展开自选"}${chevron}`;
      this.toggle.setAttribute("aria-expanded", String(store.expanded));
    }
    if (!this.host) return;
    const menuOpen = Boolean(this.host.querySelector("[data-watchlist-menu]:popover-open"));
    const menuClosing = this.menuCloseTimer !== null;
    this.closeMenu();
    this.host.hidden = !store.expanded;
    if (!store.expanded) {
      this.priceFlash.clear();
      return;
    }
    if (this.sorter?.isInteracting) {
      this.deferredRender = true;
      return;
    }
    const scrollTop =
      this.host.querySelector("[data-watchlist-rows]")?.scrollTop || 0;
    const active = store.activeGroup;
    const personalGroups = store.groups.filter((group) => group.id === "watchlist" || group.id.startsWith("custom-"));
    const dropdownGroup = store.fixedGroup ? store.groups[0] : active;
    const activeGroupName = displayGroupName(active);
    const dropdownGroupName = displayGroupName(dropdownGroup);
    this.sorter?.destroy();
    this.sorter = null;
    this.deferredRender = false;
    this.host.innerHTML = `
      <nav class="trading-watchlist-tabs" aria-label="自选分组">
        <div class="trading-watchlist-groups" data-watchlist-groups>
          <button type="button" data-watchlist-action="group" data-group-id="${escape(dropdownGroup.id)}" aria-pressed="${active.id === dropdownGroup.id}">${escape(dropdownGroupName)}</button>
          ${
            personalGroups.length > 1
              ? `<button type="button" data-watchlist-action="menu" aria-label="选择自选分组" aria-haspopup="menu" aria-expanded="false">${chevron}</button>
            <div class="trading-watchlist-menu" data-watchlist-menu role="menu" aria-label="自选分组" popover="manual" hidden>${personalGroups
              .map(
                (group) =>
                  `<div class="trading-watchlist-menu-row" role="none"><button type="button" role="menuitemradio" aria-checked="${active.id === group.id}" data-watchlist-action="group" data-group-id="${escape(group.id)}">${escape(displayGroupName(group))}</button>${group.id.startsWith("custom-") ? `<button type="button" class="trading-watchlist-remove-group" role="menuitem" data-watchlist-action="remove-group" data-group-id="${escape(group.id)}" aria-label="${escape(`${uiText("删除分组")} ${group.name}`)}" title="${escape(uiText("删除分组"))}">${removeIcon}</button>` : ""}</div>`,
              )
              .join("")}</div>`
              : ""
          }
        </div>
        ${store.groups.slice(1, 3).map((group) => `<button type="button" data-watchlist-action="group" data-group-id="${escape(group.id)}" aria-pressed="${active.id === group.id}">${escape(displayGroupName(group))}</button>`).join("")}
        ${store.fixedGroup ? "" : '<button type="button" class="trading-watchlist-add-group" data-watchlist-action="new-group" aria-label="新建分组" title="新建分组">＋</button>'}
        ${store.fixedGroup ? "" : '<button type="button" class="trading-watchlist-add" data-watchlist-action="add">添加</button>'}
      </nav>
      <div class="trading-watchlist-head">
        <span>名称</span>
        <button type="button" data-watchlist-action="sort-price" aria-label="按${showingIndices ? "最新指数" : "最新价"}排序" title="按${showingIndices ? "最新指数" : "最新价"}排序">${showingIndices ? "最新指数" : "最新价"}<span aria-hidden="true">${this.sort?.column === "price" ? (this.sort.direction === 1 ? "↑" : "↓") : "↕"}</span></button>
        <button type="button" data-watchlist-action="sort-change" aria-label="按24H涨幅排序" title="按24H涨幅排序">24H涨幅<span aria-hidden="true">${this.sort?.column === "change" ? (this.sort.direction === 1 ? "↑" : "↓") : "↕"}</span></button>
      </div>
      <div class="trading-watchlist-rows" data-watchlist-rows role="list" aria-label="${escape(`${activeGroupName}${uiText("交易对")}`)}">
        ${
          (showingIndices ? this.renderIndices() : this.sortedMarkets()
            .map((market) => this.renderRow(market))
            .join("")) ||
          this.renderEmpty()
        }
        <span class="trading-watchlist-sort-status" data-watchlist-sort-status role="status" aria-live="polite"></span>
      </div>`;
    const rows = this.host.querySelector<HTMLElement>("[data-watchlist-rows]");
    this.measureRowLayout();
    this.paintQuotes();
    if (rows) rows.scrollTop = scrollTop;
    if (menuOpen) {
      this.openMenu(false);
      if (menuClosing) this.scheduleMenuClose();
    }
    if (rows && !store.fixedGroup) {
      this.sorter = new TradingFavoriteTickerSortController({
        host: rows,
        axis: "y",
        itemSelector: "[data-watchlist-sort-item]",
        statusSelector: "[data-watchlist-sort-status]",
        ghostClassName: "trading-watchlist-drag-ghost",
        onCommit: (ids) => {
          store.reorder(ids);
          this.sort = null;
          this.host?.querySelectorAll(".trading-watchlist-head button span").forEach((span) => { span.textContent = "↕"; });
        },
        onSettled: () => {
          // Let the controller consume the click generated by pointerup before replacing rows.
          window.setTimeout(() => {
            if (this.deferredRender) this.refresh();
          }, 0);
        },
      });
    }
  }

  private measureRowLayout() {
    this.rowSizeObserver?.disconnect();
    this.rowSizeObserver = null;
    const host = this.host;
    const row = host?.querySelector<HTMLElement>(".trading-watchlist-row");
    const tabs = host?.querySelector<HTMLElement>(".trading-watchlist-tabs");
    const head = host?.querySelector<HTMLElement>(".trading-watchlist-head");
    if (!host || !row || !tabs || !head) return;
    const measure = () => {
      const rowHeight = row.getBoundingClientRect().height;
      if (rowHeight <= 0) return;
      const headingHeight = tabs.getBoundingClientRect().height + head.getBoundingClientRect().height;
      host.style.setProperty("--watchlist-row-height", `${rowHeight}px`);
      host.style.setProperty("--watchlist-heading-height", `${headingHeight}px`);
    };
    measure();
    this.rowSizeObserver = new ResizeObserver(measure);
    for (const element of [row, tabs, head]) this.rowSizeObserver.observe(element);
  }

  private renderEmpty() {
    const { store } = this.options;
    if (store.activeGroupId === "indices")
      return this.indices.failed ? '<div class="trading-watchlist-empty" role="status">指数暂不可用，稍后自动重试</div>' : "";
    if (store.activeGroupId === "tradfi") {
      const state = this.options.tradFiState();
      return state === "loading" ? "" : `<div class="trading-watchlist-empty" role="status">${state === "error" ? '传统金融合约加载失败<button type="button" data-watchlist-action="retry">重试</button>' : "暂无可交易的传统金融合约"}</div>`;
    }
    if (store.activeGroupId.startsWith("custom-"))
      return '<div class="trading-watchlist-empty trading-watchlist-empty-custom" role="status">点击右上角"添加"增加</div>';
    const selected = this.selectedRecommendations();
    return `<div class="trading-watchlist-recommendations" aria-label="推荐交易对">
      <div class="trading-watchlist-recommendation-grid">${WATCHLIST_RECOMMENDED_MARKETS.map((market) => `<label class="trading-watchlist-recommendation" title="${escape(`${market.displaySymbol} ${market.venue} ${market.tag}`)}">
        <input type="checkbox" data-watchlist-recommendation="${escape(market.id)}" aria-label="添加 ${escape(market.displaySymbol)}" ${selected.has(market.id) ? "checked" : ""}>
        <span><strong>${escape(market.displaySymbol)}</strong><small>${escape(`${market.venue} USDT永续`)}</small></span>
      </label>`).join("")}</div>
      <button type="button" class="trading-watchlist-add-recommended" data-watchlist-action="add-recommended" ${selected.size ? "" : "disabled"}>一键添加到${escape(store.activeGroup.name)}</button>
    </div>`;
  }

  private selectedRecommendations() {
    const id = this.options.store.activeGroupId;
    if (!this.recommendationSelections.has(id))
      this.recommendationSelections.set(id, new Set(WATCHLIST_RECOMMENDED_MARKETS.map((market) => market.id)));
    return this.recommendationSelections.get(id)!;
  }

  private readonly handleRecommendationChange = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.watchlistRecommendation) return;
    const selected = this.selectedRecommendations();
    if (input.checked) selected.add(input.dataset.watchlistRecommendation);
    else selected.delete(input.dataset.watchlistRecommendation);
    const add = this.host?.querySelector<HTMLButtonElement>('[data-watchlist-action="add-recommended"]');
    if (add) add.disabled = !selected.size;
  };

  private renderIndices() {
    const indices = [...this.indices.indices];
    if (this.sort) {
      const { column, direction } = this.sort;
      const value = (index: PublicMarketIndex) => column === "price" ? index.value : index.changePercent;
      indices.sort((a, b) => Number(value(a) === null) - Number(value(b) === null) || direction * ((value(a) || 0) - (value(b) || 0)));
    }
    return indices.map(index => {
      const name = localizedIndexText(index.name);
      const description = localizedIndexText(index.description);
      const history = localizedIndexText("历史走势");
      const view = localizedIndexText("查看");
      const dataTime = localizedIndexText("数据时间");
      const freshness = index.status === "stale"
        ? localizedIndexText("更新延迟")
        : index.status === "error"
          ? localizedIndexText("暂不可用")
          : index.id === "alternative:fng"
            ? localizedIndexText("每日更新")
            : localizedIndexText("每小时采样");
      return `<div class="trading-watchlist-row trading-index-row" data-watchlist-index="${escape(index.id)}" role="listitem">
      <button type="button" class="trading-watchlist-select" data-watchlist-action="index-detail" data-index-id="${escape(index.id)}" aria-label="${escape(`${view}${name}${history}`)}" title="${escape(`${description} ${dataTime}: ${indexTime(index.updatedAt)}`)}"></button>
      <span class="trading-watchlist-pair"><span>${escape(name)}</span><small>${indexSourceLink(index)}<span>${escape(freshness)}</span></small></span>
      <span class="trading-watchlist-price" data-watchlist-price>${indexValue(index)}</span>
      <span class="trading-watchlist-change ${index.changePercent === null ? "" : index.changePercent >= 0 ? "positive" : "negative"}">${indexChange(index)}</span>
    </div>`;
    }).join("");
  }

  private sortedMarkets() {
    const markets = this.options.store.activeGroup.markets.map(
      this.options.resolveMarket,
    );
    if (this.sort) {
      const { column, direction } = this.sort;
      markets.sort(
        (a, b) =>
          Number(b.quoteAvailable) - Number(a.quoteAvailable) ||
          direction *
            (column === "price"
              ? a.markPrice - b.markPrice
              : a.changePercent - b.changePercent),
      );
    }
    return markets;
  }

  private renderRow(market: TradingMarket) {
    const id = escape(market.id);
    const editable = !this.options.store.fixedGroup;
    return `<div class="trading-watchlist-row" data-watchlist-row="${id}" data-market-id="${id}" ${editable ? 'data-watchlist-sort-item' : ''} role="listitem">
      ${editable ? `<button type="button" class="trading-watchlist-drag" data-watchlist-drag aria-label="拖动调整 ${escape(market.displaySymbol)} 顺序，Alt+上下键可移动" title="拖动调整顺序，Alt+上下键可移动">⠿</button>` : ""}
      <button type="button" class="trading-watchlist-select" data-watchlist-action="select" data-market-id="${id}" aria-current="${market.id === this.options.selectedMarketId()}" aria-label="切换至 ${escape(`${market.displaySymbol} ${market.venue} ${market.tag}`)}" title="${escape(`${market.displaySymbol} ${market.venue} ${market.tag}`)}"></button>
      <span class="trading-watchlist-pair"><span>${escape(market.displaySymbol)}</span><small>${escape(`${market.venue} ${market.tag}`)}</small></span>
      <span class="trading-watchlist-price" data-watchlist-price>${market.quoteAvailable ? escape(this.options.formatPrice(market.markPrice)) : "--"}</span>
      <span class="trading-watchlist-change ${market.quoteAvailable ? (market.changePercent >= 0 ? "positive" : "negative") : ""}" data-watchlist-change>${market.quoteAvailable ? `${market.changePercent.toFixed(2)}%` : "--"}</span>
      ${editable ? `<button type="button" class="trading-watchlist-remove" data-market-favorite-sort-ignore data-watchlist-action="remove" data-market-id="${id}" aria-label="${escape(`${uiText("从").trim()} ${displayGroupName(this.options.store.activeGroup)} ${uiText("移除")} ${market.displaySymbol}`)}" title="${escape(uiText("从当前分组移除"))}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6-6 6"/></svg></button>` : ""}
    </div>`;
  }

  paintQuotes() {
    if (!this.host || this.host.hidden) return;
    if (this.options.store.activeGroupId === "indices") {
      const indices = new Map(this.indices.indices.map(index => [index.id, index]));
      this.host.querySelectorAll<HTMLElement>("[data-watchlist-index]").forEach(row => {
        const index = indices.get(row.dataset.watchlistIndex || "");
        const price = row.querySelector<HTMLElement>("[data-watchlist-price]");
        if (index && price) this.priceFlash.paint(price, index.id, indexValue(index));
      });
      this.priceFlash.retain(indices.keys());
      return;
    }
    const markets = new Map(
      this.sortedMarkets().map((market) => [market.id, market]),
    );
    this.host
      .querySelectorAll<HTMLElement>("[data-watchlist-row]")
      .forEach((row) => {
        const market = markets.get(row.dataset.watchlistRow || "");
        if (!market) return;
        const price = row.querySelector<HTMLElement>("[data-watchlist-price]")!;
        const change = row.querySelector<HTMLElement>(
          "[data-watchlist-change]",
        )!;
        this.priceFlash.paint(price, market.id, market.quoteAvailable
          ? this.options.formatPrice(market.markPrice)
          : "--");
        change.textContent = market.quoteAvailable
          ? `${market.changePercent.toFixed(2)}%`
          : "--";
        change.classList.toggle(
          "positive",
          market.quoteAvailable && market.changePercent >= 0,
        );
        change.classList.toggle(
          "negative",
          market.quoteAvailable && market.changePercent < 0,
        );
        row
          .querySelector("[data-watchlist-action=select]")
          ?.setAttribute(
            "aria-current",
            String(market.id === this.options.selectedMarketId()),
          );
      });
    this.priceFlash.retain(markets.keys());
  }

  private cancelMenuClose() {
    if (this.menuCloseTimer !== null) window.clearTimeout(this.menuCloseTimer);
    this.menuCloseTimer = null;
  }

  private scheduleMenuClose() {
    this.cancelMenuClose();
    // Allow the pointer to cross the gap between the trigger and the popover.
    this.menuCloseTimer = window.setTimeout(() => {
      this.menuCloseTimer = null;
      const menu = this.host?.querySelector("[data-watchlist-menu]");
      if (!menu?.contains(document.activeElement)) this.closeMenu();
    }, 200);
  }

  private readonly handleGroupPointerOver = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
    const groups = event.target.closest("[data-watchlist-groups]");
    if (!groups || !this.host?.contains(groups)) {
      // A refresh can detach the previous hover target before pointerout bubbles.
      if (this.menuCloseTimer === null && this.host?.querySelector("[data-watchlist-menu]:popover-open")) {
        this.scheduleMenuClose();
      }
      return;
    }
    this.cancelMenuClose();
    if (!(event.relatedTarget instanceof Node && groups.contains(event.relatedTarget))) {
      this.openMenu(false);
    }
  };

  private readonly handleGroupPointerOut = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
    const groups = event.target.closest("[data-watchlist-groups]");
    if (!groups || (event.relatedTarget instanceof Node && groups.contains(event.relatedTarget))) return;
    this.scheduleMenuClose();
  };

  private closeMenu() {
    this.cancelMenuClose();
    const menu = this.host?.querySelector<HTMLElement>("[data-watchlist-menu]");
    if (menu) {
      if (menu.matches(":popover-open")) menu.hidePopover();
      menu.hidden = true;
    }
    this.host
      ?.querySelector("[data-watchlist-action=menu]")
      ?.setAttribute("aria-expanded", "false");
  }

  private openMenu(focus = true) {
    this.cancelMenuClose();
    const menu = this.host?.querySelector<HTMLElement>("[data-watchlist-menu]");
    const anchor = this.host?.querySelector<HTMLElement>("[data-watchlist-groups]");
    if (!menu || !anchor) return;
    const bounds = anchor.getBoundingClientRect();
    menu.hidden = false;
    menu.showPopover();
    // The top layer escapes the chart/panel clipping and stacking contexts.
    const height = menu.getBoundingClientRect().height;
    const width = menu.getBoundingClientRect().width;
    menu.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(bounds.bottom + 5, innerHeight - height - 8))}px`;
    this.host?.querySelector('[data-watchlist-action="menu"]')?.setAttribute("aria-expanded", "true");
    if (focus) menu.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitemradio"]')?.focus();
  }

  private readonly handleClick = (event: MouseEvent) => {
    const source = (event.target as Element).closest<HTMLAnchorElement>("[data-index-source]");
    if (source) {
      event.preventDefault();
      void window.codexDesktop?.openExternal(source.dataset.indexSource!).catch(() => {});
      return;
    }
    const button = (event.target as Element).closest<HTMLElement>(
      "[data-watchlist-action]",
    );
    if (!button) return;
    const action = button.dataset.watchlistAction;
    const { store } = this.options;
    if (action === "index-detail") {
      const index = this.indices.indices.find(item => item.id === button.dataset.indexId);
      if (index && !this.indexDialog) this.indexDialog = openIndexHistory(index, () => {
        this.indexDialog = null;
        this.host?.querySelector<HTMLElement>(`[data-index-id="${CSS.escape(index.id)}"]`)?.focus();
      });
    } else if (action === "menu") {
      const menu = this.host!.querySelector<HTMLElement>(
        "[data-watchlist-menu]",
      )!;
      if (menu.hidden || event.detail > 0) this.openMenu();
      else this.closeMenu();
    } else if (action === "group") {
      this.closeMenu();
      store.selectGroup(button.dataset.groupId || "");
      this.sort = null;
      this.refresh();
      this.options.onChange();
    } else if (action === "remove-group") {
      const id = button.dataset.groupId || "";
      if (!store.removeGroup(id)) return;
      this.recommendationSelections.delete(id);
      this.sort = null;
      this.refresh();
      this.options.onChange();
      (this.host?.querySelector<HTMLElement>('[data-watchlist-menu]:popover-open [aria-checked="true"]')
        || this.host?.querySelector<HTMLElement>('[data-watchlist-groups] > [data-group-id]'))?.focus();
    } else if (action === "add-recommended" && !store.fixedGroup) {
      store.addMarkets(WATCHLIST_RECOMMENDED_MARKETS.filter((market) => this.selectedRecommendations().has(market.id)));
      this.refresh();
      this.options.onChange();
      this.host?.querySelector<HTMLElement>('[data-watchlist-action="add"]')?.focus();
    } else if (action === "retry") this.options.retryTradFi();
    else if (action === "new-group" && !store.fixedGroup) this.openGroupDialog();
    else if (action === "add") this.options.openPicker();
    else if (action === "sort-price" || action === "sort-change") {
      const column = action === "sort-price" ? "price" : "change";
      this.sort =
        this.sort?.column === column
          ? this.sort.direction === 1
            ? { column, direction: -1 }
            : null
          : { column, direction: 1 };
      this.refresh();
    } else {
      const record = store.activeGroup.markets.find(
        (market) => market.id === button.dataset.marketId,
      );
      if (!record) return;
      if (action === "remove") {
        store.setMembership(record, false);
        this.refresh();
        this.options.onChange();
      } else if (action === "select")
        this.options.selectMarket(this.options.resolveMarket(record));
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      this.closeMenu();
      this.host
        ?.querySelector<HTMLElement>("[data-watchlist-action=menu]")
        ?.focus();
    }
    const target = event.target as HTMLElement;
    const menu = target.closest("[data-watchlist-menu]");
    if (menu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const buttons = Array.from(
        menu.querySelectorAll<HTMLButtonElement>("button"),
      );
      const index = buttons.indexOf(target as HTMLButtonElement);
      buttons[
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length
      ]?.focus();
    }
  };

  private openGroupDialog() {
    if (this.dialog) return;
    this.closeMenu();
    const dialog = document.createElement("dialog");
    dialog.className = "trading-watchlist-dialog";
    dialog.setAttribute("aria-labelledby", "trading-watchlist-dialog-title");
    dialog.innerHTML = `<form novalidate>
      <header><h2 id="trading-watchlist-dialog-title">新建分组</h2><button type="button" data-watchlist-close aria-label="关闭">×</button></header>
      <div class="trading-watchlist-dialog-body"><label class="trading-watchlist-name"><input data-watchlist-name aria-label="分组名称" aria-describedby="trading-watchlist-name-error" placeholder="请输入分组名称" autocomplete="off" autofocus><span data-watchlist-count>0/${WATCHLIST_NAME_LIMIT}</span></label><p id="trading-watchlist-name-error" role="alert"></p></div>
      <footer><button type="button" data-watchlist-close>取消</button><button type="submit" class="primary" disabled>确定</button></footer>
    </form>`;
    this.dialog = dialog;
    document.body.append(dialog);
    const input = dialog.querySelector<HTMLInputElement>("input")!;
    const submit = dialog.querySelector<HTMLButtonElement>("[type=submit]")!;
    const error = dialog.querySelector<HTMLElement>("[role=alert]")!;
    const validate = () => {
      if (!input.matches(":focus")) input.focus();
      if (Array.from(input.value).length > WATCHLIST_NAME_LIMIT)
        input.value = Array.from(input.value)
          .slice(0, WATCHLIST_NAME_LIMIT)
          .join("");
      dialog.querySelector("[data-watchlist-count]")!.textContent =
        `${Array.from(input.value).length}/${WATCHLIST_NAME_LIMIT}`;
      const message = watchlistGroupNameError(
        input.value,
        this.options.store.groups,
      );
      error.textContent = input.value ? message : "";
      input.setAttribute(
        "aria-invalid",
        String(Boolean(input.value && message)),
      );
      submit.disabled = Boolean(message);
    };
    input.addEventListener("input", (event) => {
      if (!(event as InputEvent).isComposing) validate();
    });
    input.addEventListener("compositionend", validate);
    dialog
      .querySelectorAll("[data-watchlist-close]")
      .forEach((button) =>
        button.addEventListener("click", () => dialog.close()),
      );
    dialog.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = this.options.store.addGroup(input.value);
      if (result.error) {
        error.textContent = result.error;
        return;
      }
      this.sort = null;
      this.refresh();
      this.options.onChange();
      dialog.close();
    });
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        this.dialog = null;
        this.host
          ?.querySelector<HTMLElement>("[data-watchlist-action=new-group]")
          ?.focus();
      },
      { once: true },
    );
    dialog.showModal();
  }

  destroy() {
    this.rowSizeObserver?.disconnect();
    this.rowSizeObserver = null;
    this.priceFlash.clear();
    this.closeMenu();
    this.indices.destroy();
    this.indexDialog?.remove();
    this.indexDialog = null;
    this.sorter?.destroy();
    this.sorter = null;
    this.deferredRender = false;
    this.bindings?.abort();
    this.dialog?.remove();
    this.dialog = null;
    this.host = null;
    this.toggle = null;
  }
}
