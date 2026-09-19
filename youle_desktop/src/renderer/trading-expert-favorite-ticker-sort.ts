const DEFAULT_ITEM_SELECTOR = "[data-market-favorite-sort-item]";
const DEFAULT_STATUS_SELECTOR = "[data-market-favorite-sort-status]";
const DRAG_START_DISTANCE_PX = 5;
const AUTO_SCROLL_EDGE_PX = 36;
const AUTO_SCROLL_MAX_STEP_PX = 13;

export interface TradingFavoriteTickerSortOptions {
  host: HTMLElement;
  onCommit: (orderedMarketIds: string[]) => void;
  itemSelector?: string;
  statusSelector?: string;
  axis?: "x" | "y";
  ghostClassName?: string;
  onSettled?: () => void;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function itemMarketId(item: HTMLElement) {
  return String(item.dataset.marketId || "")
    .trim()
    .toUpperCase();
}

export class TradingFavoriteTickerSortController {
  private readonly host: HTMLElement;
  private readonly onCommit: (orderedMarketIds: string[]) => void;
  private readonly itemSelector: string;
  private readonly statusSelector: string;
  private readonly axis: "x" | "y";
  private readonly ghostClassName: string;
  private readonly onSettled?: () => void;
  private pointerId: number | null = null;
  private sourceItem: HTMLElement | null = null;
  private ghost: HTMLElement | null = null;
  private originalOrder: string[] = [];
  private startClientX = 0;
  private startClientY = 0;
  private pointerOffsetX = 0;
  private pointerOffsetY = 0;
  private lastClientX = 0;
  private lastClientY = 0;
  private dragging = false;
  private suppressNextClick = false;
  private autoScrollFrame: number | null = null;

  constructor(options: TradingFavoriteTickerSortOptions) {
    this.host = options.host;
    this.onCommit = options.onCommit;
    this.itemSelector = options.itemSelector || DEFAULT_ITEM_SELECTOR;
    this.statusSelector = options.statusSelector || DEFAULT_STATUS_SELECTOR;
    this.axis = options.axis || "x";
    this.ghostClassName = options.ghostClassName || "trading-market-favorite-ticker-drag-ghost";
    this.onSettled = options.onSettled;
    this.host.addEventListener("pointerdown", this.handlePointerDown);
    this.host.addEventListener("pointermove", this.handlePointerMove);
    this.host.addEventListener("pointerup", this.handlePointerUp);
    this.host.addEventListener("pointercancel", this.handlePointerCancel);
    this.host.addEventListener(
      "lostpointercapture",
      this.handleLostPointerCapture,
    );
    this.host.addEventListener("click", this.handleClickCapture, true);
    this.host.addEventListener("keydown", this.handleKeyDown);
    this.host.ownerDocument?.addEventListener("keydown", this.handleGlobalKeyDown);
    this.host.ownerDocument?.addEventListener("pointerup", this.handlePointerUp);
    this.host.ownerDocument?.addEventListener("pointercancel", this.handlePointerCancel);
  }

  cancel() {
    if (this.pointerId === null) return;
    this.finish(false);
  }

  get isInteracting() {
    return this.pointerId !== null;
  }

  destroy() {
    this.cancel();
    this.stopAutoScroll();
    this.host.removeEventListener("pointerdown", this.handlePointerDown);
    this.host.removeEventListener("pointermove", this.handlePointerMove);
    this.host.removeEventListener("pointerup", this.handlePointerUp);
    this.host.removeEventListener("pointercancel", this.handlePointerCancel);
    this.host.removeEventListener(
      "lostpointercapture",
      this.handleLostPointerCapture,
    );
    this.host.removeEventListener("click", this.handleClickCapture, true);
    this.host.removeEventListener("keydown", this.handleKeyDown);
    this.host.ownerDocument?.removeEventListener("keydown", this.handleGlobalKeyDown);
    this.host.ownerDocument?.removeEventListener("pointerup", this.handlePointerUp);
    this.host.ownerDocument?.removeEventListener("pointercancel", this.handlePointerCancel);
  }

  private items() {
    return Array.from(
      this.host.querySelectorAll<HTMLElement>(this.itemSelector),
    );
  }

  private orderedMarketIds() {
    return this.items().map(itemMarketId).filter(Boolean);
  }

  private itemFromEvent(event: Event) {
    if (
      event.target instanceof Element
      && event.target.closest("[data-market-favorite-sort-ignore]")
    ) return null;
    const item =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(this.itemSelector)
        : null;
    return item && this.host.contains(item) ? item : null;
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.pointerId !== null) return;
    const item = this.itemFromEvent(event);
    if (!item || item.matches(":disabled")) return;
    const rect = item.getBoundingClientRect();
    this.pointerId = event.pointerId;
    this.sourceItem = item;
    this.originalOrder = this.orderedMarketIds();
    this.startClientX = event.clientX;
    this.startClientY = event.clientY;
    this.lastClientX = event.clientX;
    this.lastClientY = event.clientY;
    this.pointerOffsetX = event.clientX - rect.left;
    this.pointerOffsetY = event.clientY - rect.top;
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId || !this.sourceItem) return;
    this.lastClientX = event.clientX;
    this.lastClientY = event.clientY;
    if (!this.dragging) {
      const distance = Math.hypot(
        event.clientX - this.startClientX,
        event.clientY - this.startClientY,
      );
      if (distance < DRAG_START_DISTANCE_PX) return;
      this.beginDrag();
    }
    event.preventDefault();
    this.positionGhost(event.clientX, event.clientY);
    this.reorderAt(this.axis === "y" ? event.clientY : event.clientX);
    this.startAutoScroll();
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.finish(this.dragging);
  };

  private readonly handlePointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.finish(false);
  };

  private readonly handleLostPointerCapture = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.finish(false);
  };

  private readonly handleClickCapture = (event: MouseEvent) => {
    if (!this.suppressNextClick) return;
    this.suppressNextClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.isInteracting) {
      event.preventDefault();
      this.cancel();
      return;
    }
    const previousKey = this.axis === "y" ? "ArrowUp" : "ArrowLeft";
    const nextKey = this.axis === "y" ? "ArrowDown" : "ArrowRight";
    if (
      !event.altKey ||
      (event.key !== previousKey && event.key !== nextKey)
    )
      return;
    const item = this.itemFromEvent(event);
    if (!item || item.matches(":disabled")) return;
    const items = this.items();
    const currentIndex = items.indexOf(item);
    const targetIndex = currentIndex + (event.key === previousKey ? -1 : 1);
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length)
      return;
    event.preventDefault();
    const previousRects = this.itemRects(items);
    const target = items[targetIndex];
    this.host.insertBefore(
      item,
      targetIndex < currentIndex ? target : target.nextElementSibling,
    );
    this.animateReorder(previousRects);
    this.syncItemPositions();
    this.onCommit(this.orderedMarketIds());
    const focusTarget = this.axis === "y" ? item.querySelector<HTMLElement>("button") || item : item;
    focusTarget.focus({ preventScroll: true });
    this.announce(`${this.itemName(item)}已移动到第${targetIndex + 1}位`);
  };

  private readonly handleGlobalKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.isInteracting) {
      event.preventDefault();
      this.cancel();
    }
  };

  private beginDrag() {
    if (!this.sourceItem) return;
    const rect = this.sourceItem.getBoundingClientRect();
    this.dragging = true;
    if (this.pointerId !== null) {
      this.host.setPointerCapture?.(this.pointerId);
    }
    this.host.classList.add("sorting");
    this.sourceItem.setAttribute("aria-grabbed", "true");
    this.ghost = this.createGhost(this.sourceItem, rect);
    this.sourceItem.classList.add("sorting");
    this.positionGhost(this.lastClientX, this.lastClientY);
    this.announce(`正在移动${this.itemName(this.sourceItem)}`);
  }

  private createGhost(item: HTMLElement, rect: DOMRect) {
    const ghost = item.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("id");
    ghost.removeAttribute("data-market-action");
    ghost.removeAttribute("data-market-id");
    ghost.removeAttribute("data-market-favorite-sort-item");
    ghost.removeAttribute("data-watchlist-sort-item");
    ghost.removeAttribute("data-watchlist-row");
    ghost.removeAttribute("aria-current");
    ghost.removeAttribute("aria-busy");
    ghost.removeAttribute("aria-grabbed");
    ghost.classList.remove("sorting", "selected");
    ghost.classList.add(this.ghostClassName);
    if (this.axis === "y") ghost.classList.add("trading-watchlist");
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("tabindex", "-1");
    const sourceElements = [item, ...item.querySelectorAll<HTMLElement>("*")];
    const ghostElements = [ghost, ...ghost.querySelectorAll<HTMLElement>("*")];
    sourceElements.forEach((source, index) => {
      const target = ghostElements[index];
      if (!target) return;
      const computed = window.getComputedStyle(source);
      target.style.color = computed.color;
      if (index === 0) {
        const solidBackground = computed
          .getPropertyValue(this.axis === "y" ? "--surface-primary" : "--trading-market-selected-background")
          .trim() || "#fff";
        target.style.setProperty("background-color", solidBackground, "important");
        target.style.setProperty("opacity", "1", "important");
        target.style.borderColor = computed.borderColor;
      }
    });
    Object.assign(ghost.style, {
      width: `${rect.width}px`,
      minWidth: `${rect.width}px`,
      maxWidth: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    document.body.append(ghost);
    return ghost;
  }

  private positionGhost(clientX: number, clientY: number) {
    if (!this.ghost) return;
    this.ghost.style.left = `${clientX - this.pointerOffsetX}px`;
    this.ghost.style.top = `${clientY - this.pointerOffsetY}px`;
  }

  private reorderAt(clientPosition: number) {
    if (!this.sourceItem) return;
    const items = this.items();
    const previousRects = this.itemRects(items);
    const before =
      items.find(
        (item) =>
          item !== this.sourceItem &&
          clientPosition < (this.axis === "y"
            ? item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2
            : item.getBoundingClientRect().left + item.getBoundingClientRect().width / 2),
      ) ?? null;
    if (before === this.sourceItem.nextElementSibling) return;
    if (!before && this.sourceItem === items.at(-1)) return;
    this.host.insertBefore(this.sourceItem, before);
    this.animateReorder(previousRects);
    this.syncItemPositions();
  }

  private itemRects(items = this.items()) {
    return new Map(items.map((item) => [item, item.getBoundingClientRect()]));
  }

  private animateReorder(previousRects: Map<HTMLElement, DOMRect>) {
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) return;
    previousRects.forEach((previousRect, item) => {
      if (item === this.sourceItem) return;
      const currentRect = item.getBoundingClientRect();
      const offset = this.axis === "y" ? previousRect.top - currentRect.top : previousRect.left - currentRect.left;
      if (!offset) return;
      item.animate(
        [
          { transform: `translate${this.axis.toUpperCase()}(${offset}px)` },
          { transform: `translate${this.axis.toUpperCase()}(0)` },
        ],
        { duration: 150, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    });
  }

  private autoScrollStep() {
    if (!this.dragging) {
      this.stopAutoScroll();
      return;
    }
    const rect = this.host.getBoundingClientRect();
    const vertical = this.axis === "y";
    const start = vertical ? rect.top : rect.left;
    const end = vertical ? rect.bottom : rect.right;
    const position = vertical ? this.lastClientY : this.lastClientX;
    const edge = Math.min(AUTO_SCROLL_EDGE_PX, (vertical ? rect.height : rect.width) / 4);
    let step = 0;
    if (position < start + edge) {
      step =
        -AUTO_SCROLL_MAX_STEP_PX *
        clamp((start + edge - position) / edge, 0, 1);
    } else if (position > end - edge) {
      step =
        AUTO_SCROLL_MAX_STEP_PX *
        clamp((position - (end - edge)) / edge, 0, 1);
    }
    const maxScrollLeft = Math.max(
      0,
      vertical ? this.host.scrollHeight - this.host.clientHeight : this.host.scrollWidth - this.host.clientWidth,
    );
    const scrollPosition = vertical ? this.host.scrollTop : this.host.scrollLeft;
    const nextScrollLeft = clamp(scrollPosition + step, 0, maxScrollLeft);
    if (step && nextScrollLeft !== scrollPosition) {
      if (vertical) this.host.scrollTop = nextScrollLeft;
      else this.host.scrollLeft = nextScrollLeft;
      this.reorderAt(position);
    }
    this.autoScrollFrame = window.requestAnimationFrame(() =>
      this.autoScrollStep(),
    );
  }

  private startAutoScroll() {
    if (this.autoScrollFrame !== null) return;
    this.autoScrollFrame = window.requestAnimationFrame(() =>
      this.autoScrollStep(),
    );
  }

  private stopAutoScroll() {
    if (this.autoScrollFrame === null) return;
    window.cancelAnimationFrame(this.autoScrollFrame);
    this.autoScrollFrame = null;
  }

  private restoreOriginalOrder() {
    const items = new Map(
      this.items().map((item) => [itemMarketId(item), item]),
    );
    const status = this.host.querySelector(this.statusSelector);
    this.originalOrder.forEach((marketId) => {
      const item = items.get(marketId);
      if (item) this.host.insertBefore(item, status);
    });
  }

  private finish(commit: boolean) {
    const source = this.sourceItem;
    const pointerId = this.pointerId;
    const wasDragging = this.dragging;
    const name = source ? this.itemName(source) : "交易对";
    this.pointerId = null;
    this.dragging = false;
    this.stopAutoScroll();
    if (!commit && wasDragging) this.restoreOriginalOrder();
    this.ghost?.remove();
    this.ghost = null;
    this.host.classList.remove("sorting");
    source?.classList.remove("sorting");
    source?.removeAttribute("aria-grabbed");
    if (pointerId !== null && this.host.hasPointerCapture?.(pointerId)) {
      this.host.releasePointerCapture(pointerId);
    }
    this.sourceItem = null;
    this.originalOrder = [];
    this.syncItemPositions();
    if (commit && wasDragging) {
      const orderedIds = this.orderedMarketIds();
      this.onCommit(orderedIds);
      const position = source ? this.items().indexOf(source) + 1 : 0;
      this.announce(`${name}已移动到第${position}位`);
    } else if (wasDragging) {
      this.announce(`已取消移动${name}`);
    }
    if (wasDragging) {
      this.suppressNextClick = true;
      window.setTimeout(() => {
        this.suppressNextClick = false;
      }, 0);
    }
    this.onSettled?.();
  }

  private syncItemPositions() {
    const items = this.items();
    items.forEach((item, index) => {
      item.setAttribute("aria-posinset", String(index + 1));
      item.setAttribute("aria-setsize", String(items.length));
    });
  }

  private itemName(item: HTMLElement) {
    return item.querySelector("strong, .trading-watchlist-pair > span")?.textContent?.trim() || "交易对";
  }

  private announce(message: string) {
    const status = this.host.querySelector<HTMLElement>(this.statusSelector);
    if (status) status.textContent = message;
  }
}
