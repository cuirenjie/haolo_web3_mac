import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TradingAlertEmailNotifier } from "../src/main/trading-alert-email-notifier.mjs";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";

function trigger(accountId = "3e644748-3631-4766-bc1e-7c29affee00d") {
  return {
    accountId,
    eventId: "evidence-cad7bf38-8478-437a-82a4-91208b66a6a1",
    alertId: "alert-btc-breakout",
    alertTitle: "BTC/USDT Binance Perpetual 1H Alert",
    summary: "BTC reached 79617.228 and triggered the long alert",
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "1h",
    triggeredAt: "2026-08-30T04:05:06.000Z",
    locale: "en",
  };
}

test("persists each trigger before delivery and retries the same event id after restart", async (context) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "haolo-alert-email-"));
  context.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let now = 1_000;
  let attempts = 0;
  const first = new TradingAlertEmailNotifier({
    dataDir,
    autoStart: false,
    now: () => now,
    currentAccountId: () => trigger().accountId,
    deliver: async () => {
      attempts += 1;
      throw Object.assign(new Error("offline"), { retryAfterMs: 5_000 });
    },
  });

  await first.enqueue(trigger());
  await first.enqueue(trigger());
  await first.flush();
  const pending = await first.snapshot();
  assert.equal(attempts, 1);
  assert.equal(pending.deliveries.length, 1);
  assert.equal(pending.deliveries[0].status, "pending");
  assert.equal(pending.deliveries[0].attempts, 1);
  await first.stop();

  now += 5_000;
  const delivered = [];
  const restarted = new TradingAlertEmailNotifier({
    dataDir,
    autoStart: false,
    now: () => now,
    currentAccountId: () => trigger().accountId,
    deliver: async (payload) => {
      delivered.push(payload);
      return { delivered: true, status: "sent" };
    },
  });
  await restarted.flush();

  const complete = await restarted.snapshot();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].event_id, trigger().eventId);
  assert.equal(delivered[0].account_id, trigger().accountId);
  assert.equal(complete.deliveries[0].status, "sent");
  assert.equal(complete.deliveries[0].attempts, 2);
});

test("never delivers a persisted alert under a different signed-in account", async (context) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "haolo-alert-email-account-"));
  context.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let called = false;
  const notifier = new TradingAlertEmailNotifier({
    dataDir,
    autoStart: false,
    currentAccountId: () => "188c6372-494c-487c-989f-cd9097502b3d",
    deliver: async () => { called = true; return { delivered: true }; },
  });

  await notifier.enqueue(trigger());
  await notifier.flush();

  assert.equal(called, false);
  assert.equal((await notifier.snapshot()).deliveries[0].status, "pending");
});

test("two distinct trigger evidence ids produce two email deliveries", async (context) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "haolo-alert-email-every-trigger-"));
  context.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const delivered = [];
  const notifier = new TradingAlertEmailNotifier({
    dataDir,
    autoStart: false,
    currentAccountId: () => trigger().accountId,
    deliver: async (payload) => { delivered.push(payload.event_id); return { delivered: true }; },
  });

  await notifier.enqueue(trigger());
  await notifier.enqueue({ ...trigger(), eventId: "evidence-d92de629-b24a-47de-b96a-41f34b8eed80" });
  await notifier.flush();

  assert.deepEqual(delivered, [
    "evidence-cad7bf38-8478-437a-82a4-91208b66a6a1",
    "evidence-d92de629-b24a-47de-b96a-41f34b8eed80",
  ]);
});

test("YouleApiClient posts alert mail through the authenticated account endpoint", async (context) => {
  const originalFetch = global.fetch;
  let request = null;
  context.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ delivered: true, status: "sent" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new YouleApiClient();
  client.loaded = true;
  client.token = "header.payload.signature";
  client.profile = { id: trigger().accountId, email: "user@example.com" };

  const result = await client.sendTradingAlertEmail({ event_id: trigger().eventId });

  assert.equal(result.delivered, true);
  assert.equal(new URL(request.url).pathname, "/api/trading-alerts/email-notifications");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Authorization, "Bearer header.payload.signature");
  assert.deepEqual(JSON.parse(request.init.body), { event_id: trigger().eventId });
});

test("main process queues the evidence id before keeping the existing desktop notification", async () => {
  const main = await fs.readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const notifySource = main.slice(
    main.indexOf("async function notifyTradingAlertTriggered"),
    main.indexOf("function getTradingAlertEmailNotifier"),
  );

  assert.match(notifySource, /await getTradingAlertEmailNotifier\(\)\.enqueue\(\{/);
  assert.match(notifySource, /eventId: evidence\?\.evidenceId/);
  assert.match(notifySource, /accountId[\s\S]*marketId: anchor\.marketId[\s\S]*locale: appLanguage\(\)/);
  assert.ok(notifySource.indexOf(".enqueue({") < notifySource.indexOf("new Notification"));
});
