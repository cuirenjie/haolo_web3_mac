import assert from "node:assert/strict";
import test from "node:test";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture() {
  const client = new YouleApiClient();
  client.loaded = true;
  client.token = "account-a-token";
  client.profile = { id: "account-a" };
  client.save = async () => {};
  return client;
}

function switchAccount(client) {
  client.authRevision += 1;
  client.token = "account-b-token";
  client.profile = { id: "account-b", total_balance: 7 };
  client.premiumEntitlementCache = null;
}

const balanceResponse = { enabled: true, account: { total_balance: 123, real_balance: 123 } };

for (const outcome of ["success", "invalid", "outage"]) {
  test(`entitlement ${outcome} after account switch cannot return another account's balance or fallback`, async () => {
    const client = fixture();
    const started = deferred();
    const response = deferred();
    client.requestJson = async () => { started.resolve(); return response.promise; };
    let fallbackReads = 0;
    client.validPremiumEntitlementCache = () => { fallbackReads += 1; return null; };
    const pending = client.refreshSub2ApiAccount();
    const rejected = assert.rejects(pending, { code: "ACCOUNT_CHANGED" });
    await started.promise;
    switchAccount(client);
    if (outcome === "outage") response.reject(Object.assign(new Error("connection reset"), { code: "ECONNRESET" }));
    else response.resolve(outcome === "success" ? balanceResponse : {});
    await rejected;
    assert.deepEqual(client.profile, { id: "account-b", total_balance: 7 });
    assert.equal(fallbackReads, 0);
    assert.equal(client.sub2ApiAccountRefreshCache, null);
  });
}

test("entitlement persistence finishing after account switch cannot publish a stale result", async () => {
  const client = fixture();
  const saving = deferred();
  const saved = deferred();
  client.requestJson = async () => balanceResponse;
  client.save = async () => { saving.resolve(); await saved.promise; };
  const pending = client.refreshSub2ApiAccount();
  const rejected = assert.rejects(pending, { code: "ACCOUNT_CHANGED" });
  await saving.promise;
  switchAccount(client);
  saved.resolve();
  await rejected;
  assert.equal(client.sub2ApiAccountRefreshCache, null);
  assert.deepEqual(client.profile, { id: "account-b", total_balance: 7 });
});

test("same-account access-token renewal still updates and caches fresh entitlement", async () => {
  const client = fixture();
  let requests = 0;
  client.requestJson = async () => {
    requests += 1;
    client.token = "account-a-renewed-token";
    return balanceResponse;
  };
  const result = await client.refreshSub2ApiAccount();
  assert.equal(result.session.profile.id, "account-a");
  assert.equal(result.session.profile.total_balance, 123);
  assert.equal(client.profile.total_balance, 123);
  assert.deepEqual(await client.refreshSub2ApiAccount({ maxAgeMs: 5_000 }), result);
  assert.equal(requests, 1);
});
