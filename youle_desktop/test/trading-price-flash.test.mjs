import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TradingPriceFlash, TRADING_PRICE_FLASH_DURATION_MS } from "../src/renderer/trading-price-flash.ts";

function priceElement() {
  return {
    textContent: "",
    animations: [],
    animate(frames, options) {
      const animation = { frames, options, currentTime: 0, cancelled: false, cancel() { this.cancelled = true; } };
      this.animations.push(animation);
      return animation;
    },
  };
}

test("flash colors retain text contrast on light and dark selected or hovered surfaces", () => {
  const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  for (const direction of ["up", "down"]) {
    const colors = [...css.matchAll(new RegExp(`--trading-price-flash-${direction}:\\s*(#[0-9a-f]{6})`, "g"))].map(match => match[1]);
    assert.equal(colors.length, 2, "each direction has a light and dark theme color");
    ["#e6ebf2", "#303236"].forEach((background, index) => {
      const a = luminance(colors[index]), b = luminance(background);
      assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${direction} theme ${index} contrast`);
    });
  }
});

test("first quote, unchanged displayed numbers and invalid quotes never flash", () => {
  const flash = new TradingPriceFlash(), element = priceElement();
  for (const text of ["--", "1,234.00", "1234.00", "1234.000", "--", "NaN", "Infinity", "", "1,240.00"]) {
    flash.paint(element, "BINANCE:SPOT:BTCUSDT", text);
    assert.equal(element.textContent, text);
    assert.equal(element.animations.length, 0);
  }
});

test("compare to the last displayed price, cancel the old flash and use the newest direction", () => {
  const flash = new TradingPriceFlash(), element = priceElement();
  flash.paint(element, "btc", "1,000.00");
  flash.paint(element, "btc", "1,010.00");
  const up = element.animations.at(-1);
  assert.equal(up.frames[0].color, "var(--trading-price-flash-up)");
  assert.equal(up.options.duration, TRADING_PRICE_FLASH_DURATION_MS);
  assert.equal(up.options.fill, undefined, "normal CSS color takes over after completion");
  flash.paint(element, "btc", "1,005.00");
  assert.equal(up.cancelled, true);
  assert.equal(element.animations.at(-1).frames[0].color, "var(--trading-price-flash-down)");
  flash.paint(element, "btc", "1,005.00");
  assert.equal(element.animations.length, 2, "repainting the same quote does not extend a flash");
  flash.paint(element, "btc", "--");
  assert.equal(element.animations.at(-1).cancelled, true);
});

test("rapid consecutive rises restart the flash and retain decimal precision", () => {
  const flash = new TradingPriceFlash(), element = priceElement();
  for (const text of ["0.000001", "0.000002", "0.000003"]) flash.paint(element, "small", text);
  assert.equal(element.animations.length, 2);
  assert.equal(element.animations[0].cancelled, true);
  assert.equal(element.animations[1].frames[0].color, "var(--trading-price-flash-up)");
  assert.equal(element.animations[1].currentTime, 0);
});

test("rerendering resumes only the remaining flash and never replays an expired one", (t) => {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const flash = new TradingPriceFlash(), original = priceElement(), replacement = priceElement();
  flash.paint(original, "btc", "100");
  flash.paint(original, "btc", "101");
  now += 150;
  flash.paint(replacement, "btc", "101");
  assert.equal(original.animations[0].cancelled, true);
  assert.equal(replacement.animations[0].currentTime, 150);
  now += TRADING_PRICE_FLASH_DURATION_MS - 150 - 1;
  const lastFrame = priceElement();
  flash.paint(lastFrame, "btc", "101");
  assert.equal(lastFrame.animations[0].currentTime, TRADING_PRICE_FLASH_DURATION_MS - 1);
  now += 1;
  const settled = priceElement();
  flash.paint(settled, "btc", "101");
  assert.equal(settled.animations.length, 0);
  flash.paint(settled, "btc", "102");
  assert.equal(settled.animations[0].currentTime, 0);
});

test("market and venue identities stay independent and removed rows release their animations", () => {
  const flash = new TradingPriceFlash(), spot = priceElement(), futures = priceElement();
  flash.paint(spot, "BINANCE:SPOT:BTCUSDT", "100");
  flash.paint(futures, "BINANCE:FUTURES:BTCUSDT", "200");
  flash.paint(spot, "BINANCE:SPOT:BTCUSDT", "101");
  flash.paint(futures, "BINANCE:FUTURES:BTCUSDT", "199");
  assert.equal(spot.animations[0].frames[0].color, "var(--trading-price-flash-up)");
  assert.equal(futures.animations[0].frames[0].color, "var(--trading-price-flash-down)");
  flash.retain(["BINANCE:FUTURES:BTCUSDT"]);
  assert.equal(spot.animations[0].cancelled, true);
  const reopened = priceElement();
  flash.paint(reopened, "BINANCE:SPOT:BTCUSDT", "102");
  assert.equal(reopened.animations.length, 0);
  flash.clear();
  assert.equal(futures.animations[0].cancelled, true);
});
