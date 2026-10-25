import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAttribution, trafficAttributionReport } from "../scripts/report-traffic-attribution.mjs";

test("old tier=free is unknown; unknown stays in denominator and savings never include trades", () => {
  const row = (metric, bytes) => ({ metric, value: [0, String(bytes)] });
  const result = summarizeAttribution([
    row({ tier: "free" }, 40),
    row({ classification: "paid_or_gift_v1", payer: "paid", activity: "foreground", entitlement: "inactive" }, 30),
    row({ classification: "paid_or_gift_v1", payer: "free", activity: "background", transport: "ws", family: "kline", candle: "open" }, 10),
    row({ classification: "paid_or_gift_v1", payer: "free", activity: "background", transport: "ws", family: "aggTrade" }, 20),
  ]);
  assert.equal(result.total_bytes, 100);
  assert.deepEqual(result.free_share_bounds, [0.3, 0.7]);
  assert.equal(result.free_share_known_payers, 0.5);
  assert.equal(result.payer_coverage, 0.6);
  assert.equal(result.free_open_kline_bytes, 10);
  assert.equal(result.free_background_quote_bytes, 0);
  assert.equal(result.entitlement_bytes.inactive, 30);
  assert.equal(summarizeAttribution([]).free_share_all_bytes, null);
});

test("report queries each counter independently, uses increase before sum, and rejects partial results", async () => {
  const queries = [];
  const options = { origin: "http://127.0.0.1:9090", start: "2026-10-25T00:00:00Z", end: "2026-10-26T00:00:00Z",
    fetchImpl: async url => { queries.push(url.searchParams.get("query"));
      return Response.json({ status: "success", data: { resultType: "vector", result: [] } }); } };
  const report = await trafficAttributionReport(options);
  assert.equal(report.application.total_bytes, 0);
  assert.equal(report.scrape_targets_seen, 0);
  assert.equal(queries.length, 3);
  assert.match(queries[0], /sum by .*increase\(.*\[86400s\]/);
  assert.doesNotMatch(queries[0], /payer="free"|classification="paid_or_gift_v1"/);
  await assert.rejects(trafficAttributionReport({ ...options, fetchImpl: async () => Response.json({ status: "success",
    warnings: ["partial data"], data: { resultType: "vector", result: [] } }) }), /partial/);
});
