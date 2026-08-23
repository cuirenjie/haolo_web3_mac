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

test("member center renders from settings with links, balances and reward rows", () => {
  const profileMenuStart = rendererSource.indexOf("function renderProfileMenu");
  const profileMenuEnd = rendererSource.indexOf("function renderSettingsProfilePanel", profileMenuStart);
  const settingsStart = rendererSource.indexOf("function renderSettingsDialog");
  const settingsEnd = rendererSource.indexOf("function renderSettingsUserDataRow", settingsStart);
  const profileMenu = rendererSource.slice(profileMenuStart, profileMenuEnd);
  const settings = rendererSource.slice(settingsStart, settingsEnd);
  assert.doesNotMatch(profileMenu, /邀请有礼|data-action="settings-referrals"/);
  assert.match(settings, /class="settings-referral-entry" data-action="settings-referrals"/);
  assert.doesNotMatch(settings, /<i aria-hidden="true">›<\/i>/);
  assert.ok(
    settings.indexOf('data-action="settings-referrals"') < settings.indexOf('data-action="logout"'),
    "the referral entry should sit above logout in settings",
  );
  assert.match(rendererSource, /function renderReferralCenterDialog/);
  assert.match(rendererSource, /待发放返佣/);
  assert.match(rendererSource, /累计已发放/);
  assert.match(rendererSource, /data-action="copy-referral-link"/);
  assert.match(rendererSource, /推广码:<span class="referral-code-value">/);
  assert.match(rendererSource, /data-action="copy-referral-code" data-referral-code="\$\{escapeAttr\(activeReferralCode\)\}" title="复制邀请码" aria-label="复制邀请码">/);
  assert.match(rendererSource, /class="referral-code-copy"[\s\S]*?<svg viewBox="0 0 20 20"/);
  assert.match(rendererSource, /function copyReferralCode/);
  assert.match(rendererSource, /copyReferralText\(code, "邀请码已复制"\)/);
  assert.doesNotMatch(rendererSource, /注册时即冻结当前链接规则/);
  assert.match(rendererSource, /function renderReferralCommissionRow/);
  assert.match(rendererSource, /referralDefaultLinkType/);
  for (const removedCopy of [
    "MEMBER CENTER",
    "分享HaoLo，清晰查看每一笔 USDT 返佣。",
    "后台账本实时记录",
    "笔返佣记录",
    "首次注册永久绑定",
    "我的专属推广",
    "专属邀请链接 ·",
    "REWARD RECORDS",
    "好友通过你的链接注册并完成 Web3 USDT 会员付款后，返佣会显示在这里。",
    "仅 Web3 USDT 会员订单参与返佣",
  ]) {
    assert.doesNotMatch(rendererSource, new RegExp(removedCopy));
  }
});

test("referral center covers light and dark interactive states", () => {
  assert.match(stylesSource, /\.referral-link-copy h3\s*\{[^}]*font-weight:\s*400;/s);
  assert.match(stylesSource, /\.referral-empty strong\s*\{[^}]*font-weight:\s*400;/s);
  assert.match(stylesSource, /\.referral-summary-grid span\s*\{[^}]*font-weight:\s*400;/s);
  assert.match(stylesSource, /\.referral-code-value\s*\{[^}]*color:\s*#0c1729;/s);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.referral-code-value\s*\{[^}]*color:\s*#f4f8ff;/s);
  assert.match(stylesSource, /\.referral-code-row \.referral-code-copy:hover:not\(:disabled\)/);
  assert.match(stylesSource, /\.referral-code-row \.referral-code-copy:active:not\(:disabled\)/);
  assert.match(stylesSource, /\.referral-code-row \.referral-code-copy:focus-visible/);
  assert.match(stylesSource, /\.referral-code-row small\s*\{[^}]*font-size:\s*calc\(11px \+ var\(--app-font-size-offset\)\);/s);
  assert.match(stylesSource, /\.referral-code-row \.referral-code-copy\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*min-height:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.referral-code-row \.referral-code-copy:hover:not\(:disabled\)/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.referral-code-row \.referral-code-copy:active:not\(:disabled\)/);
  assert.match(stylesSource, /\.settings-referral-entry:hover/);
  assert.match(stylesSource, /\.settings-referral-entry:active/);
  assert.match(stylesSource, /\.settings-referral-entry:focus-visible/);
  assert.match(stylesSource, /\.settings-referral-entry\s*\{[^}]*border:\s*1px solid #dedfe3;[^}]*background:\s*linear-gradient\(135deg, #f7f7f8, #f1f2f4\);/s);
  assert.match(stylesSource, /\.settings-referral-entry\s*\{[^}]*grid-template-columns:\s*32px minmax\(0, 1fr\);/s);
  assert.doesNotMatch(stylesSource, /\.settings-referral-entry > i/);
  assert.match(stylesSource, /\.settings-referral-entry-icon\s*\{[^}]*background:\s*#0f1115;[^}]*box-shadow:\s*0 6px 14px rgba\(15, 17, 21, 0\.18\);/s);
  assert.match(stylesSource, /\.referral-link-value button:hover:not\(:disabled\)/);
  assert.match(stylesSource, /\.referral-link-value button:focus-visible/);
  assert.match(stylesSource, /\.referral-link-value button:disabled/);
  assert.match(stylesSource, /\.referral-loading/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.referral-center-dialog/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.settings-referral-entry:hover/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.settings-referral-entry:active/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.settings-referral-entry:focus-visible/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.settings-referral-entry\s*\{[^}]*border-color:\s*#343942;[^}]*background:\s*linear-gradient\(135deg, #25282e, #202329\);/s);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.settings-referral-entry-icon\s*\{[^}]*background:\s*#08090b;/s);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.referral-link-value input:focus/);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.referral-section-head button:hover:not\(:disabled\)/);
});

test("referral center remains mounted across app renders and copy feedback does not rerender", () => {
  const renderStart = rendererSource.indexOf("function render()");
  const renderEnd = rendererSource.indexOf("function scheduleRender", renderStart);
  const renderBlock = rendererSource.slice(renderStart, renderEnd);
  const copyStart = rendererSource.indexOf("async function copyReferralText");
  const copyEnd = rendererSource.indexOf("function copyReferralLink", copyStart);
  const copyBlock = rendererSource.slice(copyStart, copyEnd);
  const toastStart = rendererSource.indexOf("function showToastWithoutRender");
  const toastEnd = rendererSource.indexOf("function openMyConfigPage", toastStart);
  const toastBlock = rendererSource.slice(toastStart, toastEnd);
  const overlayStart = stylesSource.indexOf(".referral-center-overlay {");
  const overlayEnd = stylesSource.indexOf("}", overlayStart);
  const overlayBlock = stylesSource.slice(overlayStart, overlayEnd);
  const dialogStart = stylesSource.indexOf(".referral-center-dialog {");
  const dialogEnd = stylesSource.indexOf("}", dialogStart);
  const dialogBlock = stylesSource.slice(dialogStart, dialogEnd);

  assert.match(renderBlock, /preservedReferralCenterOverlay/);
  assert.match(renderBlock, /preservedReferralCenterOverlay\.remove\(\)/);
  assert.match(renderBlock, /root\.appendChild\(preservedReferralCenterOverlay\)/);
  assert.match(rendererSource, /function bindReferralCenterContentEvents\(scope: ParentNode\)/);
  assert.match(copyBlock, /showToastWithoutRender\(successMessage, 2600\)/);
  assert.doesNotMatch(copyBlock, /\bshowToast\(|\brender\(/);
  assert.match(toastBlock, /root\.appendChild\(toast\)/);
  assert.doesNotMatch(toastBlock, /\brender\(/);
  assert.doesNotMatch(overlayBlock, /backdrop-filter|animation/);
  assert.doesNotMatch(dialogBlock, /animation/);
  assert.doesNotMatch(stylesSource, /@keyframes referral-(?:overlay|dialog)-in/);
});
