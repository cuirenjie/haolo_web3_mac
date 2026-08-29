import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  confirmProfileAvailableBalanceStateBeforeSend,
  profileAvailableBalanceState,
} from "../src/renderer/quota-balance.ts";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("a positive subscription balance allows sending when the token balance is zero", () => {
  assert.equal(
    profileAvailableBalanceState({
      balance_cny_fen: 0,
      real_balance: 0,
      token_balance: 0,
      subscription_balance: 150,
      total_balance: 150,
    }),
    "available",
  );
});

test("a positive current bucket wins over an inconsistent cached total", () => {
  assert.equal(
    profileAvailableBalanceState({
      real_balance: 0,
      subscription_balance: 150,
      total_balance: 0,
    }),
    "available",
  );
  assert.equal(
    profileAvailableBalanceState({
      real_balance: 5,
      subscription_balance: 0,
      total_balance: 0,
    }),
    "available",
  );
});

test("known exhaustion blocks only when no current balance bucket is positive", () => {
  assert.equal(
    profileAvailableBalanceState({
      real_balance: 0,
      subscription_balance: 0,
      total_balance: 0,
    }),
    "insufficient",
  );
  assert.equal(
    profileAvailableBalanceState({
      tokenBalance: "0",
      subscriptionBalance: "0",
    }),
    "insufficient",
  );
});

test("pending subscription quota is not treated as currently available", () => {
  assert.equal(
    profileAvailableBalanceState({
      real_balance: 0,
      subscription_balance: 0,
      subscription_total_balance: 600,
      subscription_pending_balance: 600,
      total_balance: 0,
    }),
    "insufficient",
  );
});

test("an incomplete balance snapshot remains unknown instead of falsely blocking", () => {
  assert.equal(profileAvailableBalanceState({ balance_cny_fen: 0 }), "unknown");
  assert.equal(profileAvailableBalanceState({ subscription_balance: 0 }), "unknown");
  assert.equal(profileAvailableBalanceState(null), "unknown");
});

test("send confirmation refreshes a stale insufficient snapshot before blocking", async () => {
  let refreshCalls = 0;
  const confirmed = await confirmProfileAvailableBalanceStateBeforeSend(
    {
      real_balance: 0,
      subscription_balance: 0,
      total_balance: 0,
    },
    async () => {
      refreshCalls += 1;
      return {
        real_balance: 0,
        subscription_balance: 150,
        total_balance: 150,
      };
    },
  );

  assert.equal(confirmed, "available");
  assert.equal(refreshCalls, 1);
});

test("send confirmation blocks only after a successful refresh still reports exhaustion", async () => {
  const confirmed = await confirmProfileAvailableBalanceStateBeforeSend(
    {
      real_balance: 0,
      subscription_balance: 0,
      total_balance: 0,
    },
    async () => ({
      real_balance: 0,
      subscription_balance: 0,
      total_balance: 0,
    }),
  );

  assert.equal(confirmed, "insufficient");
});

test("send confirmation defers to the gateway when the balance refresh fails", async () => {
  const confirmed = await confirmProfileAvailableBalanceStateBeforeSend(
    {
      real_balance: 0,
      subscription_balance: 0,
      total_balance: 0,
    },
    async () => {
      throw new Error("refresh unavailable");
    },
  );

  assert.equal(confirmed, "unknown");
});

test("an already available snapshot does not perform a pre-send refresh", async () => {
  let refreshCalls = 0;
  const confirmed = await confirmProfileAvailableBalanceStateBeforeSend(
    {
      real_balance: 0,
      subscription_balance: 150,
      total_balance: 150,
    },
    async () => {
      refreshCalls += 1;
      return null;
    },
  );

  assert.equal(confirmed, "available");
  assert.equal(refreshCalls, 0);
});

test("chat dispatch refreshes a locally insufficient balance before deciding to block", async () => {
  const renderer = await rendererSource;
  const dispatch = sourceBlock(renderer, "async function sendAgentText", "async function flushQueuedSend");
  const balanceRefresh = sourceBlock(
    renderer,
    "async function confirmInsufficientAvailableBalanceBeforeSend",
    "function isInsufficientQuotaError",
  );

  assert.doesNotMatch(renderer, /hasKnownInsufficientTokenBalance|currentProfileTokenBalanceValue/);
  assert.doesNotMatch(renderer, /hasKnownInsufficientAvailableBalance/);
  assert.match(dispatch, /await confirmInsufficientAvailableBalanceBeforeSend\("codex-chat-send"\)/);
  assert.ok(
    dispatch.indexOf("confirmInsufficientAvailableBalanceBeforeSend") < dispatch.indexOf("api.sendMessage"),
    "the refreshed client guard must run before dispatch",
  );
  for (const reason of [
    "wechat-channel-send",
    "feishu-channel-send",
    "telegram-channel-send",
    "local-agent-channel-send",
    "desktop-agent-channel-send",
    "provider-chat-send",
    "codex-chat-send",
  ]) {
    assert.match(
      renderer,
      new RegExp(
        `await confirmInsufficientAvailableBalanceBeforeSend\\(\\s*"${reason}"\\s*,?\\s*\\)`,
      ),
      `missing refreshed balance guard for ${reason}`,
    );
  }
  assert.match(balanceRefresh, /confirmProfileAvailableBalanceStateBeforeSend/);
  assert.match(balanceRefresh, /await refreshAvailableBalanceProfile\(reason\)/);
  assert.match(balanceRefresh, /return confirmedBalanceState === "insufficient"/);
  assert.match(balanceRefresh, /availableBalanceProfileRefreshPromise/);
  assert.match(balanceRefresh, /const balanceStateBefore = currentProfileAvailableBalanceState\(\)/);
  assert.match(balanceRefresh, /const balanceStateAfter = currentProfileAvailableBalanceState\(\)/);
});
