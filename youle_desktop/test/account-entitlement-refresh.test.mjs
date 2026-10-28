import assert from "node:assert/strict";
import test from "node:test";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";
import { premiumAccessState } from "../src/main/premium-entitlement.mjs";

const emptyAccount = { real_balance: 0, total_balance: 0, subscription_balance: 0, active_membership: null };
const paidAccount = { ...emptyAccount, total_balance: 100, subscription_balance: 100,
  active_membership: { status: "active", plan_id: "trial", expires_at: "2099-01-01T00:00:00Z" } };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const client = new YouleApiClient();
  client.loaded = true;
  client.baseUrl = "https://haolo.example";
  client.token = "test-session";
  client.profile = { id: "customer", ...emptyAccount };
  client.save = async () => {};
  client.saveModelAuth = async () => {};
  const reads = [];
  client.requestJson = async (url) => {
    if (url.endsWith("/api/sub2api/me")) {
      const read = deferred();
      reads.push(read);
      return read.promise;
    }
    if (url.endsWith("/keys")) return { keys: [] };
    return { id: "customer" };
  };
  return { client, reads };
}

for (const olderMethod of ["refreshProfile", "refreshSub2ApiAccount"]) {
  for (const newerMethod of ["refreshProfile", "refreshSub2ApiAccount"]) {
    // Mac shares concurrent balance-only reads; payment reconciliation uses
    // refreshProfile and still needs all three distinct-response orderings.
    if (olderMethod === newerMethod && olderMethod === "refreshSub2ApiAccount") continue;
    test(`paid balance survives delayed ${olderMethod} after ${newerMethod}`, async () => {
      const { client, reads } = fixture();
      const older = client[olderMethod]();
      await new Promise(setImmediate);
      const newer = client[newerMethod]();
      await new Promise(setImmediate);
      assert.equal(reads.length, 2);
      reads[1].resolve({ enabled: true, account: paidAccount });
      await newer;
      assert.equal(premiumAccessState(client.profile), "available");
      reads[0].resolve({ enabled: true, account: emptyAccount });
      const result = await older;
      assert.equal(client.profile.subscription_balance, 100);
      assert.equal(premiumAccessState(client.profile), "available");
      assert.equal(premiumAccessState((result.session || result).profile), "available");
      assert.equal(client.validPremiumEntitlementCache()?.profile.subscription_balance, 100);
    });
  }
}

test("a balance read from the previous login cannot overwrite another account", async () => {
  const { client, reads } = fixture();
  const pending = client.refreshSub2ApiAccount();
  await new Promise(setImmediate);
  client.authRevision += 1;
  client.token = "other-session";
  client.profile = { id: "other-customer", ...emptyAccount };
  reads[0].resolve({ enabled: true, account: paidAccount });
  await assert.rejects(pending, { code: "ACCOUNT_CHANGED" });
  assert.equal(client.profile.id, "other-customer");
  assert.equal(client.profile.subscription_balance, 0);
  assert.equal(client.validPremiumEntitlementCache(), null);
});

test("Mac concurrent balance readers share one fresh result", async () => {
  const { client, reads } = fixture();
  const first = client.refreshSub2ApiAccount();
  const second = client.refreshSub2ApiAccount();
  await new Promise(setImmediate);
  assert.equal(reads.length, 1);
  reads[0].resolve({ enabled: true, account: paidAccount });
  const results = await Promise.all([first, second]);
  assert.ok(results.every(result => result.session.profile.subscription_balance === 100));
});

test("payment reconciliation invalidates a previously cached balance-only read", async () => {
  const { client, reads } = fixture();
  const old = client.refreshSub2ApiAccount();
  await new Promise(setImmediate);
  reads[0].resolve({ enabled: true, account: emptyAccount });
  await old;
  const paid = client.refreshProfile();
  await new Promise(setImmediate);
  reads[1].resolve({ enabled: true, account: paidAccount });
  await paid;
  const fresh = client.refreshSub2ApiAccount({ maxAgeMs: 5000 });
  await new Promise(setImmediate);
  assert.equal(reads.length, 3);
  reads[2].resolve({ enabled: true, account: paidAccount });
  assert.equal((await fresh).session.profile.subscription_balance, 100);
});

test("a read after payment does not join the still-pending pre-payment read", async () => {
  const { client, reads } = fixture();
  const old = client.refreshSub2ApiAccount();
  await new Promise(setImmediate);
  const paid = client.refreshProfile();
  await new Promise(setImmediate);
  reads[1].resolve({ enabled: true, account: paidAccount });
  await paid;
  const fresh = client.refreshSub2ApiAccount();
  await new Promise(setImmediate);
  assert.equal(reads.length, 3);
  reads[2].resolve({ enabled: true, account: paidAccount });
  await fresh;
  reads[0].resolve({ enabled: true, account: emptyAccount });
  assert.equal((await old).session.profile.subscription_balance, 100);
});

test("a later authoritative empty balance still revokes the cached entitlement", async () => {
  const { client, reads } = fixture();
  const paid = client.refreshProfile();
  await new Promise(setImmediate);
  reads[0].resolve({ enabled: true, account: paidAccount });
  await paid;
  const exhausted = client.refreshSub2ApiAccount();
  await new Promise(setImmediate);
  reads[1].resolve({ enabled: true, account: emptyAccount });
  await exhausted;
  assert.equal(client.profile.subscription_balance, 0);
  assert.equal(client.validPremiumEntitlementCache(), null);
  assert.notEqual(premiumAccessState(client.profile), "available");
});

test("a newer balance snapshot cannot discard the concurrently refreshed model credentials", async () => {
  const { client, reads } = fixture();
  const keys = [{ provider: "deepseek", apiKey: "fixture-only-new-key" }];
  client.fetchSub2ApiKeys = async () => keys;
  const profile = client.refreshProfile();
  await new Promise(setImmediate);
  const balance = client.refreshSub2ApiAccount();
  await new Promise(setImmediate);
  reads[1].resolve({ enabled: true, account: paidAccount });
  await balance;
  reads[0].resolve({ enabled: true, account: emptyAccount });
  await profile;
  assert.equal(client.profile.subscription_balance, 100);
  assert.deepEqual(client.modelKeys, keys);
});

test("older profile keys do not overwrite a newer profile key refresh", async () => {
  const { client, reads } = fixture();
  let calls = 0;
  client.fetchSub2ApiKeys = async () => [{ provider: "deepseek", apiKey: `fixture-only-${++calls}` }];
  const older = client.refreshProfile();
  await new Promise(setImmediate);
  const newer = client.refreshProfile();
  await new Promise(setImmediate);
  reads[1].resolve({ enabled: true, account: paidAccount });
  await newer;
  reads[0].resolve({ enabled: true, account: emptyAccount });
  await older;
  assert.equal(client.modelKeys[0].apiKey, "fixture-only-2");
  assert.equal(client.profile.subscription_balance, 100);
});
