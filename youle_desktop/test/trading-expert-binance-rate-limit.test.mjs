import assert from "node:assert/strict";
import test from "node:test";

import { parseBinanceMarketRetryAfterMs } from "../src/renderer/trading-expert-market.ts";

test("Binance market Retry-After accepts seconds and HTTP dates", () => {
  assert.equal(parseBinanceMarketRetryAfterMs("2", 1_000), 2_000);
  assert.equal(
    parseBinanceMarketRetryAfterMs("Thu, 01 Jan 1970 00:00:03 GMT", 1_000),
    2_000,
  );
  assert.equal(parseBinanceMarketRetryAfterMs("invalid", 1_000), null);
  assert.equal(parseBinanceMarketRetryAfterMs(null, 1_000), null);
});
