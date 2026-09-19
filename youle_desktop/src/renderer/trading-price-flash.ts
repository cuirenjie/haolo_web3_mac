export const TRADING_PRICE_FLASH_DURATION_MS = 800;

interface PriceState {
  value: number | null;
  element: HTMLElement;
  direction: "up" | "down" | null;
  changedAt: number;
  animation: Animation | null;
}

function displayedPrice(text: string): number | null {
  const normalized = text.replaceAll(",", "").trim();
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** One controller per price surface; keys include the market/provider identity. */
export class TradingPriceFlash {
  private readonly prices = new Map<string, PriceState>();

  paint(element: HTMLElement, key: string, text: string) {
    const value = displayedPrice(text);
    const previous = this.prices.get(key);
    const now = performance.now();
    const changed = previous != null && previous.value != null && value != null
      && previous.value !== value;
    const replaced = previous?.element !== element;
    if (element.textContent !== text) element.textContent = text;

    if (!previous) {
      this.prices.set(key, { value, element, direction: null, changedAt: 0, animation: null });
      return;
    }
    if (changed || replaced || value === null) {
      previous.animation?.cancel();
      previous.animation = null;
    }
    if (changed) {
      previous.direction = value! > previous.value! ? "up" : "down";
      previous.changedAt = now;
    } else if (value === null || previous.value === null) {
      previous.direction = null;
    }
    previous.value = value;
    previous.element = element;

    const elapsed = now - previous.changedAt;
    if ((changed || replaced) && previous.direction && elapsed < TRADING_PRICE_FLASH_DURATION_MS) {
      // Hold the full direction color for the entire configured interval. An early keyframe
      // followed by an implicit endpoint fades toward the normal color too soon.
      // With no fill, normal theme CSS takes over immediately on completion.
      // Replacing a row resumes, rather than replays, a flash.
      const color = `var(--trading-price-flash-${previous.direction})`;
      previous.animation = element.animate([
        { color, offset: 0 },
        { color, offset: 1 },
      ], { duration: TRADING_PRICE_FLASH_DURATION_MS, easing: "linear" });
      previous.animation.currentTime = elapsed;
    }
  }

  retain(keys: Iterable<string>) {
    const visible = new Set(keys);
    for (const [key, state] of this.prices) {
      if (visible.has(key)) continue;
      state.animation?.cancel();
      this.prices.delete(key);
    }
  }

  clear() {
    this.retain([]);
  }
}
