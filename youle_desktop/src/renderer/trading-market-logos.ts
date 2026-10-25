// Retain decoded images and fallback decisions across innerHTML renders.
// Temporary markup has no src, so it cannot restart a request before reuse.
const selector = "[data-market-logo-key]";
const retryAfterMs = 60_000;
const mounted = new WeakSet<HTMLElement>();
const boundImages = new WeakSet<HTMLImageElement>();
const pooled = new WeakSet<HTMLElement>();
const detached = new Map<string, HTMLElement[]>();
const sources = new Map<string, { stage: string; failedAt?: number }>();
let detachedCount = 0;
let observer: MutationObserver | null = null;

function logosIn(node: Node): HTMLElement[] {
  if (!(node instanceof Element)) return [];
  return [...(node.matches(selector) ? [node as HTMLElement] : []), ...node.querySelectorAll<HTMLElement>(selector)];
}

function sourceKey(image: HTMLImageElement) {
  return JSON.stringify([image.dataset.marketLogoSrc, image.dataset.marketLogoBackupSrc]);
}

function rememberSource(image: HTMLImageElement, failed = false) {
  const asset = sourceKey(image);
  sources.delete(asset);
  sources.set(asset, { stage: image.dataset.marketLogoStage!, ...(failed ? { failedAt: Date.now() } : {}) });
  if (sources.size > 512) sources.delete(sources.keys().next().value!);
}

function loaded(image: HTMLImageElement) {
  if (!image.complete || !image.naturalWidth) return;
  const shell = image.closest<HTMLElement>(selector);
  if (!shell) return;
  image.hidden = false;
  shell.dataset.marketLogoState = "loaded";
  shell.classList.remove("loading", "fallback");
  shell.classList.add("loaded");
  rememberSource(image);
}

function failed(image: HTMLImageElement) {
  const shell = image.closest<HTMLElement>(selector);
  if (!shell) return;
  shell.classList.remove("loading", "loaded");
  if (image.dataset.marketLogoStage === (image.dataset.marketLogoPrimaryStage || "binance") && image.dataset.marketLogoBackupSrc) {
    image.dataset.marketLogoStage = image.dataset.marketLogoBackupStage || "hyperliquid";
    shell.dataset.marketLogoState = "pending";
    rememberSource(image);
    image.src = image.dataset.marketLogoBackupSrc!;
  } else {
    image.hidden = true;
    shell.dataset.marketLogoState = "fallback";
    shell.classList.add("fallback");
    rememberSource(image, true);
  }
}

function hydrateImage(image: HTMLImageElement) {
  const shell = image.closest<HTMLElement>(selector)!;
  const previous = sources.get(sourceKey(image));
  if (boundImages.has(image)) {
    // Preserve pending/loaded images when their containing UI refreshes.
    if (!image.hidden || (previous?.failedAt && Date.now() - previous.failedAt < retryAfterMs)) return;
  } else {
    boundImages.add(image);
    image.addEventListener("load", () => loaded(image));
    image.addEventListener("error", () => failed(image));
  }
  shell.classList.remove("loading", "loaded", "fallback");
  if (previous?.failedAt && Date.now() - previous.failedAt < retryAfterMs) {
    image.hidden = true;
    shell.dataset.marketLogoState = "fallback";
    shell.classList.add("fallback");
    return;
  }
  image.hidden = false;
  shell.dataset.marketLogoState = "pending";
  const primaryStage = image.dataset.marketLogoPrimaryStage || "binance";
  image.dataset.marketLogoStage = previous?.failedAt ? primaryStage : previous?.stage || primaryStage;
  image.src = image.dataset.marketLogoStage === primaryStage
    ? image.dataset.marketLogoSrc! : image.dataset.marketLogoBackupSrc!;
  loaded(image);
}

function retain(shell: HTMLElement) {
  if (shell.isConnected || !mounted.has(shell) || pooled.has(shell)) return;
  // Do not retain the removed row/panel (and its conversation DOM) via parentNode.
  shell.remove();
  const key = shell.dataset.marketLogoKey!;
  const entries = detached.get(key) || [];
  entries.push(shell);
  detached.set(key, entries);
  pooled.add(shell);
  detachedCount++;
  while (detachedCount > 256) {
    const firstKey = detached.keys().next().value!;
    const first = detached.get(firstKey)!;
    pooled.delete(first.shift()!);
    detachedCount--;
    if (!first.length) detached.delete(firstKey);
  }
}

function mount(shell: HTMLElement) {
  if (!shell.isConnected) return;
  if (!mounted.has(shell)) {
    const key = shell.dataset.marketLogoKey!;
    const entries = detached.get(key);
    const retained = entries?.shift();
    if (retained) {
      pooled.delete(retained);
      detachedCount--;
      if (!entries!.length) detached.delete(key);
      shell.replaceWith(retained);
      shell = retained;
    }
    mounted.add(shell);
  }
  const image = shell.querySelector<HTMLImageElement>("[data-market-logo]");
  if (image) hydrateImage(image);
}

function reconcile(records: MutationRecord[]) {
  // Gather removals before insertions, including whole-panel replacements.
  for (const record of records) for (const node of record.removedNodes) logosIn(node).forEach(retain);
  for (const record of records) for (const node of record.addedNodes) logosIn(node).forEach(mount);
}

export function hydrateTradingMarketLogos(scope: ParentNode = document) {
  if (observer) reconcile(observer.takeRecords());
  scope.querySelectorAll<HTMLElement>(selector).forEach(mount);
}

export function ensureTradingMarketLogos() {
  if (observer || typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  observer = new MutationObserver(reconcile);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("online", () => {
    for (const [asset, state] of sources) if (state.failedAt) sources.delete(asset);
    hydrateTradingMarketLogos();
  });
}
