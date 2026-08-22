import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { YouleApiClient } from "../src/main/youle-api-client.mjs";

const rendererSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const preloadSource = await readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");

test("referral API client uses the authenticated desktop contract", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ items: [], profile: {}, summary: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "access-token";
    await client.getReferralDashboard();
    await client.listReferralLinks();
    await client.createReferralLink({ linkType: "ordinary_direct", channelLabel: "客户端邀请有礼" });
    await client.listReferralCommissions({ limit: 500 });

    assert.deepEqual(requests.map((item) => item.url), [
      "https://haolo.example/api/referrals/me",
      "https://haolo.example/api/referrals/me/links",
      "https://haolo.example/api/referrals/me/links",
      "https://haolo.example/api/referrals/me/commissions?limit=100",
    ]);
    for (const request of requests) assert.equal(request.init.headers.Authorization, "Bearer access-token");
    assert.deepEqual(JSON.parse(requests[2].init.body), {
      link_type: "ordinary_direct",
      channel_label: "客户端邀请有礼",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("main and preload expose the complete referral bridge", () => {
  for (const method of ["getReferralDashboard", "listReferralLinks", "createReferralLink", "listReferralCommissions"]) {
    assert.match(preloadSource, new RegExp(`youle:${method}`));
    assert.match(mainSource, new RegExp(`ipcMain\\.handle\\(\"youle:${method}\"`));
    assert.match(mainSource, new RegExp(`getYouleApiClient\\(\\)\\.${method}`));
  }
});

test("member center renders links, balances, immutable attribution copy and reward rows", () => {
  assert.match(rendererSource, /data-action="profile-referrals"/);
  assert.match(rendererSource, /function renderReferralCenterDialog/);
  assert.match(rendererSource, /待发放返佣/);
  assert.match(rendererSource, /累计已发放/);
  assert.match(rendererSource, /data-action="copy-referral-link"/);
  assert.match(rendererSource, /注册时即冻结当前链接规则/);
  assert.match(rendererSource, /function renderReferralCommissionRow/);
  assert.match(rendererSource, /仅 Web3 USDT 会员订单参与返佣/);
  assert.match(rendererSource, /referralDefaultLinkType/);
});

test("referral center covers light and dark interactive states", () => {
  assert.match(stylesSource, /\.profile-referral-entry:hover/);
  assert.match(stylesSource, /\.profile-referral-entry:focus-visible/);
  assert.match(stylesSource, /\.referral-link-value button:hover:not\(:disabled\)/);
  assert.match(stylesSource, /\.referral-link-value button:focus-visible/);
  assert.match(stylesSource, /\.referral-link-value button:disabled/);
  assert.match(stylesSource, /\.referral-loading/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.referral-center-dialog/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.referral-link-value input:focus/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.referral-section-head button:hover:not\(:disabled\)/);
});
