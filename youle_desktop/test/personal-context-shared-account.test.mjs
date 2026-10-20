import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createSharedBinanceAccountReader } from "../src/main/binance-account/shared-reader.mjs";
import { sharedSnapshotPosition, sharedSnapshotTime } from "../src/main/binance-account/shared-snapshot.mjs";
import { PersonalContextService } from "../src/main/personal-context/service.mjs";
import { CodexBusinessTools } from "../src/main/codex-business-tools.mjs";

// Execute the actual main-process factory and normalizer, not a duplicate wiring.
const source = ts.createSourceFile("main.mjs", readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const functions = ["getPersonalContextService", "normalizeSharedBinanceSnapshot"].map(name =>
  source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source),
).join("\n");

function fixture() {
  const calls = [];
  const state = {
    ownerId: "owner-a",
    binding: { bound: true, localBound: false, remoteBound: true, serverCredentialsBound: true, serverConnectionId: "shared-a" },
    remote: {
      fetchedAt: Date.now(), equity: 68.98999104, available: 60, margin: 8.98999104,
      unrealizedPnl: 1,
      positions: [{ symbol: "ZECUSDT", quantity: -0.1, entryPrice: 1140, unrealizedPnl: 1, leverage: 3 }],
    },
    local: { fetchedAt: new Date().toISOString(), marginBalance: 200, positions: [], warnings: [], sources: { futures: "live" } },
  };
  const deps = {
    PersonalContextService, createSharedBinanceAccountReader, sharedSnapshotPosition, sharedSnapshotTime,
    getPersonalMemoryStore: () => ({ status: async () => ({ available: true, entryCount: 0 }) }),
    requireHaoloAccountOwner: async () => ({ ownerId: state.ownerId }),
    readBinanceAccountStatusWithSharedBinding: async owner => {
      calls.push(["status", owner.ownerId]);
      if (state.statusError) throw state.statusError;
      state.onStatus?.();
      return state.binding;
    },
    getBinanceAccountService: () => ({
      status: async () => ({ bound: false }),
      snapshot: async (owner, options) => { calls.push(["local", owner, options]); return state.local; },
    }),
    getYouleApiClient: () => ({
      getAccountConnectionSnapshot: async id => {
        calls.push(["shared", id]);
        if (state.snapshotError) throw state.snapshotError;
        state.onSnapshot?.();
        return state.remote;
      },
    }),
  };
  const service = new Function(...Object.keys(deps), `let personalContextService;\n${functions}\nreturn getPersonalContextService();`)(...Object.values(deps));
  return { state, calls, service, read: (args = {}) => service.invoke({ tool: "read_binance_account_context", arguments: args }) };
}

test("server-only binding supplies actual summary and positions through both model tool entries", async () => {
  const h = fixture();
  const sources = await h.service.invoke({ tool: "list_user_context_sources" });
  assert.equal(sources.sources.find(source => source.id === "binance.account").available, true);
  const direct = await h.read({ sections: ["summary", "positions"], force: true });
  assert.equal(direct.available, true);
  assert.equal(direct.summary.estimatedTotalAssets, h.state.remote.equity);
  assert.equal(direct.summary.todayPnl, null);
  assert.equal(direct.summary.realizedPnlToday, null);
  assert.equal(direct.positions[0].direction, "SHORT");
  assert.equal(direct.positions[0].amount, 0.1);
  assert.equal(direct.positions[0].markPrice, 1130);
  assert.equal(Object.hasOwn(direct, "openOrders"), false);
  assert.equal(direct.sources.openOrders, "unavailable");
  assert.deepEqual(direct.warnings, ["由 HaoLo 服务器统一读取的账户摘要"]);

  const client = {};
  const tools = new CodexBusinessTools({ owner: () => h.state.ownerId, accountRead: args => h.read(args) });
  const context = tools.bind("thread-a", { client, userText: "查看我的仓位", sender: { id: 1 } });
  const result = await tools.invokeBound({
    tool: "haolo_account_read", callId: "read-a",
    arguments: { context_id: context.token, sections: ["summary", "positions"] },
  });
  assert.deepEqual(result, direct);
  assert.equal(h.calls.some(([type]) => type === "local"), false);
  assert.equal(JSON.stringify(result).includes("shared-a"), false);
});

test("unbound and connection-without-credentials remain unavailable without fabricated empty holdings", async () => {
  for (const binding of [
    { bound: false, localBound: false },
    { bound: true, localBound: false, remoteBound: true, serverCredentialsBound: false },
  ]) {
    const h = fixture();
    h.state.binding = binding;
    const result = await h.read();
    assert.equal(result.available, false);
    assert.equal(Object.hasOwn(result, "positions"), false);
    assert.equal(h.calls.some(([type]) => type === "local" || type === "shared"), false);
  }
});

test("binding lookup and server read failures propagate instead of becoming unbound or local fallback", async () => {
  for (const key of ["statusError", "snapshotError"]) {
    const h = fixture();
    const error = Object.assign(new Error("temporarily unavailable"), { code: "SERVICE_UNAVAILABLE" });
    h.state[key] = error;
    await assert.rejects(h.read(), received => received === error);
    assert.equal(h.calls.some(([type]) => type === "local"), false);
  }
});

test("a local binding retains requested read options and follows replacement account runtimes", async () => {
  const h = fixture();
  h.state.binding = { bound: true, localBound: true, serverCredentialsBound: false };
  const first = await h.read({ sections: ["summary"], force: true });
  assert.equal(first.summary.marginBalance, 200);
  h.state.local = { ...h.state.local, marginBalance: 300 };
  assert.equal((await h.read({ sections: ["summary"] })).summary.marginBalance, 300);
  assert.deepEqual(h.calls.filter(([type]) => type === "local"), [
    ["local", "owner-a", { force: true, live: false }],
    ["local", "owner-a", { force: false, live: false }],
  ]);
});

test("account switches during binding and snapshot reads discard private results", async () => {
  for (const hook of ["onStatus", "onSnapshot"]) {
    const h = fixture();
    h.state[hook] = () => { h.state.ownerId = "owner-b"; };
    await assert.rejects(h.read(), error => error.code === "ACCOUNT_CHANGED");
  }
});

test("revoke or rebind between reads is observed by the existing model service", async () => {
  const h = fixture();
  assert.equal((await h.read()).available, true);
  h.state.binding = { bound: false, localBound: false, serverCredentialsBound: false };
  assert.equal((await h.read()).available, false);
  h.state.binding = { bound: true, localBound: false, serverCredentialsBound: true, serverConnectionId: "shared-b" };
  h.state.remote.equity = 100;
  assert.equal((await h.read()).summary.estimatedTotalAssets, 100);
  assert.deepEqual(h.calls.filter(([type]) => type === "shared"), [["shared", "shared-a"], ["shared", "shared-b"]]);
});
