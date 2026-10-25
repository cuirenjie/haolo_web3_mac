import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { BINANCE_TRADFI_LOGOS, BINANCE_TRADFI_LOGO_ALIASES } from "../src/renderer/trading-tradfi-logo-assets.ts";
import { tradingTradFiAssetLogo, renderTradingMarketAssetLogo } from "../src/renderer/trading-expert-market-identity.ts";

test("bundled Binance originals retain source hashes and valid image bytes", async () => {
  const manifest = JSON.parse(await readFile(new URL("../src/renderer/assets/binance-tradfi/sources.json", import.meta.url), "utf8"));
  assert.ok(Object.keys(manifest.assets).length >= 224);
  for (const [asset, entry] of Object.entries(manifest.assets)) {
    const bundled = BINANCE_TRADFI_LOGOS[asset];
    const bytes = await readFile(new URL(bundled.src));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, asset);
    assert.equal(bundled.original, entry.source);
    assert.ok(["bin.bnbstatic.com", "public.bnbstatic.com"].includes(new URL(entry.source).hostname));
    assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.subarray(0, 3).equals(Buffer.from([255,216,255])), asset);
  }
  for (const [alias, underlying] of Object.entries(BINANCE_TRADFI_LOGO_ALIASES)) {
    assert.equal(tradingTradFiAssetLogo(alias, "stock"), BINANCE_TRADFI_LOGOS[underlying], alias);
  }
});

test("stock and ETF originals match the reference and resolve identically across providers", () => {
  for (const [asset, filename] of Object.entries({ MU: "MU.png", SNDK: "SNDK-3d94.png", SPCX: "SPCX-7c71.png", TSLA: "TSLA-de59.png", KORU: "KORU.png" })) {
    const kind = asset === "KORU" ? "etf" : "stock";
    const logo = tradingTradFiAssetLogo(asset, kind);
    assert.equal(logo.original, `https://bin.bnbstatic.com/static/stock/${filename}`);
    for (const provider of ["binance", "finnhub"]) {
      const html = renderTradingMarketAssetLogo(asset, provider, true, kind);
      assert.ok(html.includes(logo.src));
      assert.match(html, /official-tradfi-logo/);
      assert.match(html, /data-market-logo-primary-stage="bundled"/);
      assert.doesNotMatch(html, /hyperliquid/);
    }
  }
  assert.equal(tradingTradFiAssetLogo("SNDKB", "stock"), tradingTradFiAssetLogo("SNDK", "stock"));
  assert.notEqual(tradingTradFiAssetLogo("RKLB", "stock"), tradingTradFiAssetLogo("RKL", "stock"));
});

test("asset classes prevent commodity, equity, crypto and A-share ticker collisions", () => {
  assert.match(tradingTradFiAssetLogo("CL", "commodity").src, /binance-tradfi\/CL\.png/);
  assert.equal(tradingTradFiAssetLogo("CL", "stock").src, "https://bin.bnbstatic.com/static/stock/CL.png");
  assert.equal(tradingTradFiAssetLogo("META", "crypto"), null);
  assert.equal(tradingTradFiAssetLogo("600519", "a-share"), null);
  assert.equal(tradingTradFiAssetLogo("UNKNOWN", "commodity"), null);
  assert.equal(tradingTradFiAssetLogo("UNKNOWN", "index"), null);
  assert.doesNotMatch(renderTradingMarketAssetLogo("600519", "ifind", false, "a-share", "贵州茅台"), /<img/);
});
