import assert from "node:assert/strict";
import test from "node:test";

class FakeStyle {
  setProperty(name, value) {
    this[name] = String(value);
  }
}

class FakeClassList {
  constructor(values = []) {
    this.values = new Set(values);
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor({ marketId = "", sortItem = false, status = false } = {}) {
    this.dataset = { marketId };
    this.sortItem = sortItem;
    this.status = status;
    this.children = [];
    this.parentElement = null;
    this.classList = new FakeClassList(sortItem ? ["trading-market-favorite-ticker"] : []);
    this.style = new FakeStyle();
    this.listeners = new Map();
    this.attributes = new Map();
    this.capturedPointers = new Set();
    this.textContent = "";
    this.disabled = false;
  }

  addEventListener(type, listener, options) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, capture: options === true || Boolean(options?.capture) });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((entry) => entry.listener !== listener),
    );
  }

  append(child) {
    this.insertBefore(child, null);
  }

  insertBefore(child, before) {
    child.parentElement?.removeChild(child);
    const index = before ? this.children.indexOf(before) : -1;
    if (index >= 0) this.children.splice(index, 0, child);
    else this.children.push(child);
    child.parentElement = this;
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentElement = null;
  }

  remove() {
    this.parentElement?.removeChild(this);
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] || null;
  }

  contains(candidate) {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }

  closest(selector) {
    if (selector === "[data-market-favorite-sort-item]" && this.sortItem) return this;
    return this.parentElement?.closest(selector) || null;
  }

  matches(selector) {
    return selector === ":disabled" ? this.disabled : false;
  }

  querySelectorAll(selector) {
    if (selector === "[data-market-favorite-sort-item]") {
      return this.children.filter((child) => child.sortItem);
    }
    if (selector === "*") return [...this.children];
    return [];
  }

  querySelector(selector) {
    if (selector === "[data-market-favorite-sort-status]") {
      return this.children.find((child) => child.status) || null;
    }
    return null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "data-market-id") this.dataset.marketId = "";
    if (name === "data-market-favorite-sort-item") this.sortItem = false;
  }

  getBoundingClientRect() {
    if (!this.sortItem || !this.parentElement) {
      return { left: 0, right: 200, top: 0, bottom: 38, width: 200, height: 38 };
    }
    const items = this.parentElement.children.filter((child) => child.sortItem);
    const left = items.indexOf(this) * 100;
    return { left, right: left + 100, top: 0, bottom: 38, width: 100, height: 38 };
  }

  setPointerCapture(pointerId) {
    this.capturedPointers.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.capturedPointers.delete(pointerId);
  }

  cloneNode() {
    const clone = new FakeElement({ marketId: this.dataset.marketId, sortItem: this.sortItem });
    clone.classList = new FakeClassList(this.classList.values);
    return clone;
  }

  animate() {}

  focus() {}

  dispatch(type, init = {}) {
    let immediateStopped = false;
    const event = {
      type,
      target: init.target || this,
      pointerId: init.pointerId ?? 1,
      pointerType: init.pointerType || "mouse",
      button: init.button ?? 0,
      clientX: init.clientX ?? 10,
      clientY: init.clientY ?? 10,
      key: init.key || "",
      altKey: Boolean(init.altKey),
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
      stopImmediatePropagation() {
        immediateStopped = true;
      },
    };
    const entries = this.listeners.get(type) || [];
    for (const capture of [true, false]) {
      for (const entry of entries) {
        if (entry.capture !== capture || immediateStopped) continue;
        entry.listener(event);
      }
    }
    return event;
  }
}

globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeElement;
const body = new FakeElement();
globalThis.document = { body };
globalThis.window = {
  getComputedStyle: () => ({
    color: "rgb(20, 30, 40)",
    backgroundColor: "rgba(80, 90, 100, 0.2)",
    borderColor: "rgb(90, 100, 110)",
    getPropertyValue: (name) => name === "--trading-market-selected-background" ? "#fff" : "",
  }),
  matchMedia: () => ({ matches: true }),
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  setTimeout,
};

const { TradingFavoriteTickerSortController } = await import(
  "../src/renderer/trading-expert-favorite-ticker-sort.ts"
);

function fixture() {
  const host = new FakeElement();
  host.clientWidth = 200;
  host.scrollWidth = 200;
  host.scrollLeft = 0;
  const btc = new FakeElement({ marketId: "BINANCE:FUTURES:BTCUSDT", sortItem: true });
  const eth = new FakeElement({ marketId: "BINANCE:FUTURES:ETHUSDT", sortItem: true });
  const status = new FakeElement({ status: true });
  host.append(btc);
  host.append(eth);
  host.append(status);
  const commits = [];
  const controller = new TradingFavoriteTickerSortController({
    host,
    onCommit: (ids) => commits.push(ids),
  });
  return { host, btc, eth, commits, controller };
}

test("favorite ticker plain click remains targeted at the market button", () => {
  const { host, eth, commits, controller } = fixture();
  let clicks = 0;
  host.addEventListener("click", () => {
    clicks += 1;
  });

  host.dispatch("pointerdown", { target: eth, pointerId: 7, clientX: 120 });
  assert.equal(host.hasPointerCapture(7), false);
  host.dispatch("pointerup", { target: eth, pointerId: 7, clientX: 120 });
  const click = host.dispatch("click", { target: eth });

  assert.equal(click.defaultPrevented, false);
  assert.equal(clicks, 1);
  assert.deepEqual(commits, []);
  controller.destroy();
});

test("favorite ticker captures only after drag starts and suppresses its release click", () => {
  const { host, btc, commits, controller } = fixture();
  let clicks = 0;
  host.addEventListener("click", () => {
    clicks += 1;
  });

  host.dispatch("pointerdown", { target: btc, pointerId: 9, clientX: 10 });
  assert.equal(host.hasPointerCapture(9), false);
  host.dispatch("pointermove", { target: btc, pointerId: 9, clientX: 180 });
  assert.equal(host.hasPointerCapture(9), true);
  host.dispatch("pointerup", { target: host, pointerId: 9, clientX: 180 });
  const click = host.dispatch("click", { target: btc });

  assert.equal(click.defaultPrevented, true);
  assert.equal(clicks, 0);
  assert.deepEqual(commits, [["BINANCE:FUTURES:ETHUSDT", "BINANCE:FUTURES:BTCUSDT"]]);
  controller.destroy();
});
