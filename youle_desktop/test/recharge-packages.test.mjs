import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const apiClientSource = readFile(new URL("../src/main/youle-api-client.mjs", import.meta.url), "utf8");
const mainProcessSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const prototypeSource = readFile(new URL("../../haolo-ai-recharge.html", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("recharge catalog remains available without purchase actions", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const products = sourceBlock(
    renderer,
    "const RECHARGE_SUBSCRIPTION_PRODUCTS",
    "const VOICE_INPUT_MAX_DURATION_MS",
  );
  const page = sourceBlock(renderer, "function renderRechargePage", "function consumptionPayload");
  const productCard = sourceBlock(
    renderer,
    "function renderRechargeProductCard",
    "function openRechargePage",
  );

  assert.match(products, /id: "subscription_basic"[\s\S]*?priceYuan: 99/);
  assert.match(products, /id: "subscription_pro"[\s\S]*?priceYuan: 169/);
  assert.match(products, /id: "subscription_flagship"[\s\S]*?priceYuan: 499/);
  assert.match(products, /id: "addon_20"[\s\S]*?amountFen: 2_000/);
  assert.match(products, /id: "addon_50"[\s\S]*?amountFen: 5_000/);
  assert.match(products, /id: "addon_100"[\s\S]*?amountFen: 10_000/);
  assert.match(products, /id: "addon_200"[\s\S]*?amountFen: 20_000/);
  assert.match(page, /RECHARGE_SUBSCRIPTION_PRODUCTS/);
  assert.match(page, /RECHARGE_ADDON_PRODUCTS/);
  assert.ok(
    page.indexOf("RECHARGE_SUBSCRIPTION_PRODUCTS") < page.indexOf("RECHARGE_ADDON_PRODUCTS"),
    "subscription products must remain above addon products",
  );
  assert.doesNotMatch(productCard, /<button|data-action=|product\.cta/);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.recharge-product-card/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-product-card/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-product-help summary:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-product-help summary:focus-visible/);
});

test("legacy WeChat and Alipay payment flow is absent from every desktop layer", async () => {
  const [renderer, styles, apiClient, mainProcess, preload, prototype] = await Promise.all([
    rendererSource,
    stylesSource,
    apiClientSource,
    mainProcessSource,
    preloadSource,
    prototypeSource,
  ]);
  const runtime = [renderer, apiClient, mainProcess, preload].join("\n");

  assert.doesNotMatch(runtime, /online_dual|alipayPaymentUrl|alipay_payment_url/);
  assert.doesNotMatch(runtime, /fetchRechargeQrcode|createRechargeOrder|getRechargeOrder/);
  assert.doesNotMatch(runtime, /createTokenProductOrder|getTokenProductOrder/);
  assert.doesNotMatch(runtime, /youle:(?:fetchRechargeQrcode|createRechargeOrder|getRechargeOrder|createTokenProductOrder|getTokenProductOrder)/);
  assert.doesNotMatch(apiClient, /\/api\/finance\/(?:recharge\/(?:qrcode|orders)|token-products\/orders)/);
  assert.doesNotMatch(renderer, /rechargeQrcode|rechargePaymentPortal|buy-recharge|微信支付|支付宝支付|付款码/);
  assert.doesNotMatch(styles, /recharge-(?:qrcode|payment|alipay)|recharge-product-buy/);
  assert.doesNotMatch(prototype, /paymentModal|openPayment|confirmPayment|buy-plan|buy-boost|微信支付|支付宝支付|付款码/);
});
