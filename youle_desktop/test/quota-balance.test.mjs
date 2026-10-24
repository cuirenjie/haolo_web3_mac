import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  confirmProfileAvailableBalanceStateBeforeSend,
  profileAvailableBalanceState,
  insufficientCreditsNotice,
  isInsufficientCreditsNotice,
  INSUFFICIENT_CREDITS_NOTICE,
  ACTIVE_MEMBERSHIP_CREDITS_NOTICE,
} from "../src/renderer/quota-balance.ts";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

test("exhaustion explanation requires both a known empty wallet and an active membership", () => {
  const now = Date.parse("2026-10-25T00:24:00+08:00");
  const profile = { real_balance: 0, subscription_balance: 0, total_balance: 0,
    active_membership: { plan_id: "basic", status: "active", expires_at: "2026-11-24T02:25:31+08:00" } };
  assert.equal(insufficientCreditsNotice(profile, now), ACTIVE_MEMBERSHIP_CREDITS_NOTICE);
  for (const uncertain of [null, { active_membership: profile.active_membership },
    { ...profile, real_balance: 2 }, { ...profile, subscription_balance: 1 },
    { ...profile, active_membership: { ...profile.active_membership, expires_at: "2026-10-24T00:00:00Z" } },
    { ...profile, active_membership: { ...profile.active_membership, status: "expired" } }]) {
    assert.equal(insufficientCreditsNotice(uncertain, now), INSUFFICIENT_CREDITS_NOTICE);
  }
  for (const notice of [INSUFFICIENT_CREDITS_NOTICE, ACTIVE_MEMBERSHIP_CREDITS_NOTICE, "您的积分不足，请充值或开通会员"]) {
    assert.equal(isInsufficientCreditsNotice(notice), true);
  }
  assert.equal(isInsufficientCreditsNotice("会员等级不足"), false);
});

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
  const channels = sourceBlock(renderer, "async function runIsolatedChannelAgent", "async function waitForWechatThreadIdle");
  assert.match(channels, /await confirmInsufficientAvailableBalanceBeforeSend\(channel \+ "-channel-send"\)/);
  assert.ok(channels.indexOf("confirmInsufficientAvailableBalanceBeforeSend") < channels.indexOf("api.sendChannelCodexMessage"));
  for (const channel of ["wechat", "feishu", "telegram"]) {
    assert.match(channels, new RegExp(`return runIsolatedChannelAgent\\("${channel}"`));
  }
  assert.match(balanceRefresh, /confirmProfileAvailableBalanceStateBeforeSend/);
  assert.match(balanceRefresh, /await refreshAvailableBalanceProfile\(reason\)/);
  assert.match(balanceRefresh, /return confirmedBalanceState === "insufficient"/);
  assert.match(balanceRefresh, /availableBalanceProfileRefreshPromise/);
  assert.match(balanceRefresh, /const balanceStateBefore = currentProfileAvailableBalanceState\(\)/);
  assert.match(balanceRefresh, /const balanceStateAfter = currentProfileAvailableBalanceState\(\)/);
});
