import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("profile editing lives in the first settings tab", async () => {
  const source = await rendererSource;
  const settings = sourceBlock(
    source,
    "function renderSettingsDialog",
    "function renderSettingsUserDataRow",
  );
  const profileTab = settings.indexOf('data-settings-tab="profile"');
  const generalTab = settings.indexOf('data-settings-tab="general"');

  assert.ok(
    profileTab >= 0 && profileTab < generalTab,
    "personal profile must appear before general settings",
  );
  assert.match(settings, /<span>个人资料<\/span>/);
  assert.match(
    settings,
    /activeTab === "profile"\s*\? renderSettingsProfilePanel\(\)/,
  );

  const panel = sourceBlock(
    source,
    "function renderSettingsProfilePanel",
    "function renderRechargePage",
  );
  assert.match(panel, /data-action="choose-profile-avatar"/);
  assert.match(panel, /id="profileNicknameInput"/);
  assert.match(panel, /data-action="save-profile-edit"/);
  assert.match(panel, /builtInAvatarEdgeCropClassAttribute\(avatarUrl\)/);
});

test("settings profile uses a circular avatar with top-aligned identity", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.settings-profile-avatar-row\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*flex-start;/s,
  );
  assert.match(
    styles,
    /\.profile-edit-avatar-image\s*\{[^}]*width:\s*76px;[^}]*height:\s*76px;[^}]*border-radius:\s*50%;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    styles,
    /\.settings-profile-submit\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*132px;[^}]*height:\s*42px;[^}]*justify-self:\s*center;[^}]*padding:\s*0 22px;/s,
  );
  assert.match(
    styles,
    /\.profile-edit-submit\s*\{[^}]*font-size:\s*calc\(14px \+ var\(--app-font-size-offset\)\);/s,
  );
  assert.match(styles, /html\[data-theme="dark"\] \.profile-edit-submit:hover:not\(:disabled\)/);
});

test("profile menu keeps recharge beside the balance and omits My Config", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const profileMenu = sourceBlock(
    source,
    "function renderProfileMenu",
    "function renderSettingsProfilePanel",
  );

  assert.match(
    profileMenu,
    /class="profile-token-balance"[\s\S]*?<strong>\$\{escapeHtml\(currentProfileBalance\(\)\)\}<\/strong>[\s\S]*?class="profile-recharge-button" data-action="profile-quota">充值<\/button>/,
  );
  assert.doesNotMatch(profileMenu, /open-my-config|我的配置/);
  assert.doesNotMatch(profileMenu, /data-action="logout"/);
  assert.match(
    styles,
    /\.profile-token-balance\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;[^}]*gap:\s*12px;/s,
  );
  assert.match(
    styles,
    /\.profile-menu\s*\{[^}]*position:\s*fixed;[^}]*left:\s*15px;[^}]*width:\s*min\(360px, calc\(100vw - 30px\)\);/s,
  );
  assert.match(
    styles,
    /\.profile-recharge-button\s*\{[^}]*min-width:\s*52px;[^}]*height:\s*26px;[^}]*border:\s*1px solid rgba\(17, 24, 39, 0\.2\);[^}]*background:\s*transparent;/s,
  );
});

test("referral entry and logout live at the bottom of settings", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const settings = sourceBlock(
    source,
    "function renderSettingsDialog",
    "function renderSettingsUserDataRow",
  );

  const navEnd = settings.indexOf("</nav>");
  const referral = settings.indexOf('class="settings-referral-entry" data-action="settings-referrals"');
  const logout = settings.indexOf('class="settings-logout-button" data-action="logout"');
  assert.ok(
    navEnd >= 0 && referral > navEnd && logout > referral,
    "the referral entry and logout should be separate controls below settings navigation",
  );
  assert.match(settings, /state\.loggingOut \? "退出中\.\.\." : "退出登录"/);
  assert.match(styles, /\.settings-side\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
  assert.match(
    styles,
    /\.settings-referral-entry\s*\{[^}]*margin-top:\s*auto;/s,
  );
  assert.match(
    styles,
    /\.settings-logout-button\s*\{[^}]*margin-top:\s*12px;[^}]*border:\s*1px solid rgba\(220, 38, 38, 0\.16\);/s,
  );
  assert.match(
    styles,
    /\.settings-logout-button\s*\{[^}]*transform:\s*translateY\(10px\) scale\(0\.8\);[^}]*transform-origin:\s*center bottom;/s,
  );
  assert.match(
    styles,
    /\.settings-logout-button\s*\{[^}]*font-size:\s*calc\(16\.25px \+ var\(--app-font-size-offset\)\);/s,
  );
  assert.match(styles, /\.settings-logout-button\s*\{[^}]*font-weight:\s*400;/s);
  assert.match(styles, /\.settings-logout-button:hover:not\(:disabled\)\s*\{/);
  assert.match(styles, /\.settings-logout-button:active:not\(:disabled\)\s*\{/);
  assert.match(styles, /\.settings-logout-button:focus-visible\s*\{/);
  assert.match(styles, /\.settings-logout-button:disabled\s*\{/);
});

test("membership badges replace the profile pencil without opening a details popover", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const titlebar = sourceBlock(
    source,
    "function renderWindowControls",
    "function renderLeftPanelToggle",
  );
  const profileMenu = sourceBlock(
    source,
    "function renderProfileMenu",
    "function renderSettingsProfilePanel",
  );
  const consumptionPage = sourceBlock(
    source,
    "function renderConsumptionPage",
    "function renderConsumptionCalendar",
  );
  const membership = sourceBlock(
    source,
    "function currentMembershipPlan",
    "function profileCitizenId",
  );
  const rechargeBalance = sourceBlock(
    source,
    "function renderRechargeSubscriptionBalance",
    "function renderRechargeProductCard",
  );
  assert.doesNotMatch(titlebar, /renderMembershipBadge\("titlebar"\)/);
  assert.match(
    styles,
    /\.profile-head img\s*\{[^}]*width:\s*58px;[^}]*height:\s*58px;[^}]*border-radius:\s*50%;/s,
  );
  assert.doesNotMatch(titlebar, /const membership = currentMembershipPlan\(\);/);
  assert.match(titlebar, /class="titlebar-profile-name"/);
  assert.match(profileMenu, /renderMembershipBadge\("profile", membership\)/);
  assert.match(consumptionPage, /renderMembershipBadge\("consumption"\)/);
  assert.match(consumptionPage, /const membership = currentMembershipPlan\(\)/);
  assert.match(consumptionPage, /class="consumption-header-balances"/);
  assert.match(
    consumptionPage,
    /membership\.subscribed \? renderRechargeSubscriptionBalance\(\) : ""/,
  );
  assert.match(styles, /\.consumption-header-balances\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*12px;/s);
  assert.doesNotMatch(profileMenu, /open-profile-edit|profile-edit-button/);
  assert.match(
    profileMenu,
    /membership\.subscribed \? renderProfileSubscriptionBalance\(\) : ""/,
  );
  assert.match(membership, /label: "体验版"/);
  assert.match(membership, /label: "基础版"/);
  assert.match(membership, /label: "专业版"/);
  assert.match(membership, /label: "旗舰版"/);
  assert.match(
    membership,
    /context === "profile" \|\| context === "consumption"[\s\S]*?!plan\.subscribed[\s\S]*?data-action="profile-quota"[\s\S]*?查看充值方案/,
  );
  assert.match(
    membership,
    /return `<span class="\$\{className\}" data-membership-plan="\$\{plan\.id\}" aria-label="当前套餐：\$\{plan\.label\}">\$\{plan\.label\}<\/span>`;/,
  );
  assert.doesNotMatch(source, /profileSubscriptionDetails|show-profile-subscription-details/);
  assert.doesNotMatch(membership, /查看订阅余额明细|profileMembershipDetailsPopover|consumptionMembershipDetailsPopover|renderProfileSubscriptionDetails/);
  assert.match(membership, /subscription_balance_refresh_at/);
  assert.match(membership, /<span>订阅余额<\/span>/);
  assert.match(rechargeBalance, /title="当前订阅余额"/);
  assert.match(rechargeBalance, /<span>订阅余额<\/span>/);
  assert.doesNotMatch(source, /订阅周余额/);
  assert.doesNotMatch(membership, /profileSubscriptionBalanceHelp|<summary[^>]*>\?<\/summary>/);
  assert.doesNotMatch(source, /DEV_(?:BASIC|PRO|FLAGSHIP)_MEMBERSHIP_PREVIEW/);
});

test("membership badge styling distinguishes experience and subscribed plans", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.membership-badge-experience\s*\{[^}]*background: #f1f2f4;[^}]*color: #717986;/s,
  );
  assert.match(
    styles,
    /\.membership-badge-member\s*\{[^}]*linear-gradient\([^}]*#ffd77c[^}]*color: #6d3700;/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.membership-badge-experience\s*\{[^}]*background: #30343a;[^}]*color: #bec4cd;/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.membership-badge-member\s*\{[^}]*border-color: rgba\(255, 190, 82, 0\.42\);/s,
  );
  assert.doesNotMatch(styles, /\.membership-badge-member::before/);
  assert.match(styles, /\.settings-profile-panel\s*\{[^}]*margin-top: 36px;/s);
  assert.doesNotMatch(styles, /\.titlebar-profile-name\.member-highlight/);
  assert.match(
    styles,
    /\.profile-subscription-row time\s*\{[^}]*color: var\(--text-subtle\);[^}]*transform: translateY\(1px\);/s,
  );
  assert.match(
    styles,
    /\.profile-level-row,\s*\.profile-token-row,\s*\.profile-subscription-row\s*\{[^}]*grid-template-columns:\s*104px minmax\(0, 1fr\);[^}]*column-gap:\s*18px;/s,
  );
  assert.match(styles, /\.profile-subscription-label > span\s*\{[^}]*white-space:\s*normal;/s);
  assert.match(styles, /\.profile-subscription-row > strong\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(
    styles,
    /\.profile-token-row strong\s*\{[^}]*font-weight: 700;/s,
  );
  assert.match(
    styles,
    /\.profile-subscription-row b\s*\{[^}]*font-weight: 700;/s,
  );
  assert.doesNotMatch(styles, /\.profile-subscription-help summary/);
  assert.doesNotMatch(styles, /profile-subscription-help-popover|profile-membership-details-popover|consumption-membership-details-popover/);
});
