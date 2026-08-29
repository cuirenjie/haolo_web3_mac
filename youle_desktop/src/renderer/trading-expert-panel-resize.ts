export const TRADING_EXPERT_LEFT_PANEL_MIN_WIDTH = 192;
export const TRADING_EXPERT_RIGHT_PANEL_MIN_WIDTH = 300;
export const TRADING_EXPERT_MARKET_MIN_WIDTH = 560;

const TRADING_EXPERT_PANEL_RESIZE_STEP = 16;
const TRADING_EXPERT_PANEL_RESIZE_LARGE_STEP = 40;
const TRADING_EXPERT_PANEL_WIDTHS_STORAGE_KEY = "haolo.trading-expert.panel-widths.v1";

export type TradingExpertPanelSide = "left" | "right";

export type TradingExpertPanelWidths = {
  left: number;
  right: number;
};

type WidthStorageReader = Pick<Storage, "getItem">;
type WidthStorageWriter = Pick<Storage, "setItem">;

const DEFAULT_PANEL_WIDTHS: TradingExpertPanelWidths = {
  left: TRADING_EXPERT_LEFT_PANEL_MIN_WIDTH,
  right: TRADING_EXPERT_RIGHT_PANEL_MIN_WIDTH,
};

function roundedFiniteWidth(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function normalizedPanelWidths(value: Partial<TradingExpertPanelWidths> | null | undefined) {
  return {
    left: Math.max(
      TRADING_EXPERT_LEFT_PANEL_MIN_WIDTH,
      roundedFiniteWidth(value?.left, TRADING_EXPERT_LEFT_PANEL_MIN_WIDTH),
    ),
    right: Math.max(
      TRADING_EXPERT_RIGHT_PANEL_MIN_WIDTH,
      roundedFiniteWidth(value?.right, TRADING_EXPERT_RIGHT_PANEL_MIN_WIDTH),
    ),
  };
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadTradingExpertPanelWidths(
  storage: WidthStorageReader | null = browserStorage(),
): TradingExpertPanelWidths {
  if (!storage) return { ...DEFAULT_PANEL_WIDTHS };
  try {
    const raw = storage.getItem(TRADING_EXPERT_PANEL_WIDTHS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PANEL_WIDTHS };
    return normalizedPanelWidths(JSON.parse(raw) as Partial<TradingExpertPanelWidths>);
  } catch {
    return { ...DEFAULT_PANEL_WIDTHS };
  }
}

export function clampTradingExpertPanelWidths(
  requested: TradingExpertPanelWidths,
  availableWidth: number,
): TradingExpertPanelWidths {
  const widths = normalizedPanelWidths(requested);
  const availablePanelWidth = Math.max(
    TRADING_EXPERT_LEFT_PANEL_MIN_WIDTH + TRADING_EXPERT_RIGHT_PANEL_MIN_WIDTH,
    Math.floor(availableWidth) - TRADING_EXPERT_MARKET_MIN_WIDTH,
  );
  const requestedExtraLeft = widths.left - TRADING_EXPERT_LEFT_PANEL_MIN_WIDTH;
  const requestedExtraRight = widths.right - TRADING_EXPERT_RIGHT_PANEL_MIN_WIDTH;
  const requestedExtraTotal = requestedExtraLeft + requestedExtraRight;
  const availableExtra = Math.max(
    0,
    availablePanelWidth
      - TRADING_EXPERT_LEFT_PANEL_MIN_WIDTH
      - TRADING_EXPERT_RIGHT_PANEL_MIN_WIDTH,
  );
  if (requestedExtraTotal <= availableExtra) return widths;
  if (requestedExtraTotal <= 0 || availableExtra <= 0) return { ...DEFAULT_PANEL_WIDTHS };

  const leftExtra = Math.round(
    availableExtra * (requestedExtraLeft / requestedExtraTotal),
  );
  return {
    left: TRADING_EXPERT_LEFT_PANEL_MIN_WIDTH + leftExtra,
    right: TRADING_EXPERT_RIGHT_PANEL_MIN_WIDTH + availableExtra - leftExtra,
  };
}

export function resizeTradingExpertPanelWidth(
  current: TradingExpertPanelWidths,
  side: TradingExpertPanelSide,
  requestedWidth: number,
  availableWidth: number,
): TradingExpertPanelWidths {
  const widths = normalizedPanelWidths(current);
  const oppositeWidth = side === "left" ? widths.right : widths.left;
  const minimumWidth = side === "left"
    ? TRADING_EXPERT_LEFT_PANEL_MIN_WIDTH
    : TRADING_EXPERT_RIGHT_PANEL_MIN_WIDTH;
  const maximumWidth = Math.max(
    minimumWidth,
    Math.floor(availableWidth) - TRADING_EXPERT_MARKET_MIN_WIDTH - oppositeWidth,
  );
  return {
    ...widths,
    [side]: Math.min(
      maximumWidth,
      Math.max(minimumWidth, roundedFiniteWidth(requestedWidth, minimumWidth)),
    ),
  };
}

let panelWidths = loadTradingExpertPanelWidths();
let activeBindingAbortController: AbortController | null = null;

function persistPanelWidths(storage: WidthStorageWriter | null = browserStorage()) {
  if (!storage) return;
  try {
    storage.setItem(
      TRADING_EXPERT_PANEL_WIDTHS_STORAGE_KEY,
      JSON.stringify(panelWidths),
    );
  } catch {
    // The current layout still works when renderer storage is unavailable.
  }
}

function panelWidthForSide(widths: TradingExpertPanelWidths, side: TradingExpertPanelSide) {
  return side === "left" ? widths.left : widths.right;
}

function panelMinimumForSide(side: TradingExpertPanelSide) {
  return side === "left"
    ? TRADING_EXPERT_LEFT_PANEL_MIN_WIDTH
    : TRADING_EXPERT_RIGHT_PANEL_MIN_WIDTH;
}

function panelLabelForSide(side: TradingExpertPanelSide) {
  return side === "left" ? "左侧栏" : "右侧任务会话";
}

export function renderTradingExpertPanelResizeHandles() {
  return (["left", "right"] as const)
    .map((side) => {
      const label = `调整${panelLabelForSide(side)}宽度`;
      const width = panelWidthForSide(panelWidths, side);
      return `
        <div
          class="trading-expert-resize-handle ${side}"
          data-trading-expert-resize="${side}"
          role="separator"
          aria-orientation="vertical"
          aria-label="${label}"
          aria-valuemin="${panelMinimumForSide(side)}"
          aria-valuenow="${width}"
          aria-valuetext="${panelLabelForSide(side)} ${width} 像素"
          tabindex="0"
        ></div>
      `;
    })
    .join("");
}

export function bindTradingExpertPanelResize(container: ParentNode = document) {
  activeBindingAbortController?.abort();
  activeBindingAbortController = null;

  const body = container.querySelector<HTMLElement>(
    ".desktop-body.trading-expert-layout",
  );
  if (!body) return;
  const handles = [...body.querySelectorAll<HTMLElement>(
    ":scope > [data-trading-expert-resize]",
  )];
  if (!handles.length) return;

  const abortController = new AbortController();
  const { signal } = abortController;
  activeBindingAbortController = abortController;
  const shell = body.closest<HTMLElement>(".desktop-shell");

  const availableWidth = () => body.getBoundingClientRect().width;
  const maximumForSide = (side: TradingExpertPanelSide) => {
    const oppositeWidth = panelWidthForSide(
      panelWidths,
      side === "left" ? "right" : "left",
    );
    return Math.max(
      panelMinimumForSide(side),
      Math.floor(availableWidth()) - TRADING_EXPERT_MARKET_MIN_WIDTH - oppositeWidth,
    );
  };
  const syncHandleAccessibility = () => {
    handles.forEach((handle) => {
      const side = handle.dataset.tradingExpertResize as TradingExpertPanelSide;
      const width = panelWidthForSide(panelWidths, side);
      handle.setAttribute("aria-valuemin", String(panelMinimumForSide(side)));
      handle.setAttribute("aria-valuemax", String(maximumForSide(side)));
      handle.setAttribute("aria-valuenow", String(width));
      handle.setAttribute(
        "aria-valuetext",
        `${panelLabelForSide(side)} ${width} 像素`,
      );
    });
  };
  const applyWidths = (
    requested: TradingExpertPanelWidths,
    options: { persist?: boolean } = {},
  ) => {
    panelWidths = clampTradingExpertPanelWidths(requested, availableWidth());
    body.style.setProperty("--conversation-list-width", `${panelWidths.left}px`);
    shell?.style.setProperty("--conversation-list-width", `${panelWidths.left}px`);
    body.style.setProperty("--trading-expert-panel-width", `${panelWidths.right}px`);
    syncHandleAccessibility();
    if (options.persist !== false) persistPanelWidths();
  };
  const applyPanelWidth = (
    side: TradingExpertPanelSide,
    requestedWidth: number,
    options: { persist?: boolean } = {},
  ) => {
    panelWidths = resizeTradingExpertPanelWidth(
      panelWidths,
      side,
      requestedWidth,
      availableWidth(),
    );
    body.style.setProperty("--conversation-list-width", `${panelWidths.left}px`);
    shell?.style.setProperty("--conversation-list-width", `${panelWidths.left}px`);
    body.style.setProperty("--trading-expert-panel-width", `${panelWidths.right}px`);
    syncHandleAccessibility();
    if (options.persist !== false) persistPanelWidths();
  };

  applyWidths(panelWidths, { persist: false });

  handles.forEach((handle) => {
    const side = handle.dataset.tradingExpertResize as TradingExpertPanelSide;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = panelWidthForSide(panelWidths, side);
      body.classList.add("trading-expert-panel-resizing");
      handle.classList.add("active");
      handle.setPointerCapture(pointerId);

      const finishResize = () => {
        body.classList.remove("trading-expert-panel-resizing");
        handle.classList.remove("active");
        handle.removeEventListener("pointermove", moveResize);
        handle.removeEventListener("pointerup", finishResize);
        handle.removeEventListener("pointercancel", finishResize);
        handle.removeEventListener("lostpointercapture", finishResize);
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
        persistPanelWidths();
      };
      const moveResize = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const delta = moveEvent.clientX - startX;
        applyPanelWidth(
          side,
          startWidth + (side === "left" ? delta : -delta),
          { persist: false },
        );
      };

      handle.addEventListener("pointermove", moveResize);
      handle.addEventListener("pointerup", finishResize);
      handle.addEventListener("pointercancel", finishResize);
      handle.addEventListener("lostpointercapture", finishResize);
    }, { signal });

    handle.addEventListener("keydown", (event) => {
      const currentWidth = panelWidthForSide(panelWidths, side);
      const step = event.shiftKey
        ? TRADING_EXPERT_PANEL_RESIZE_LARGE_STEP
        : TRADING_EXPERT_PANEL_RESIZE_STEP;
      let nextWidth: number | null = null;
      if (event.key === "ArrowLeft") {
        nextWidth = currentWidth + (side === "left" ? -step : step);
      }
      if (event.key === "ArrowRight") {
        nextWidth = currentWidth + (side === "left" ? step : -step);
      }
      if (event.key === "Home") nextWidth = panelMinimumForSide(side);
      if (event.key === "End") nextWidth = maximumForSide(side);
      if (nextWidth === null) return;
      event.preventDefault();
      applyPanelWidth(side, nextWidth);
    }, { signal });
  });

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => applyWidths(panelWidths));
    observer.observe(body);
    signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  }
}
