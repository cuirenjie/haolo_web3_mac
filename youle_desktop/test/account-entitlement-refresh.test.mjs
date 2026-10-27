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
  await pending;
  assert.equal(client.profile.id, "other-customer");
  assert.equal(client.profile.subscription_balance, 0);
  assert.equal(client.validPremiumEntitlementCache(), null);
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
