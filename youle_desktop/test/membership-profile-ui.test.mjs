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
    /\.settings-profile-submit\s*\{[^}]*width:\s*96px;[^}]*height:\s*39\.6px;[^}]*justify-self:\s*center;/s,
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
    /\.profile-token-balance\s*\{[^}]*display:\s*flex;[^}]*gap:\s*20px;/s,
  );
  assert.match(
    styles,
    /\.profile-menu\s*\{[^}]*position:\s*fixed;[^}]*left:\s*27px;/s,
  );
  assert.match(
    styles,
    /\.profile-recharge-button\s*\{[^}]*min-width:\s*52px;[^}]*height:\s*26px;[^}]*border:\s*1px solid rgba\(17, 24, 39, 0\.2\);[^}]*background:\s*transparent;/s,
  );
});

test("logout lives at the bottom of settings", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const settings = sourceBlock(
    source,
    "function renderSettingsDialog",
    "function renderSettingsUserDataRow",
  );

  const navEnd = settings.indexOf("</nav>");
  const logout = settings.indexOf('class="settings-logout-button" data-action="logout"');
  assert.ok(
    navEnd >= 0 && logout > navEnd,
    "logout should be a separate control below settings navigation",
  );
  assert.match(settings, /state\.loggingOut \? "退出中\.\.\." : "退出登录"/);
  assert.match(styles, /\.settings-side\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
  assert.match(
    styles,
    /\.settings-logout-button\s*\{[^}]*margin-top:\s*auto;[^}]*border:\s*1px solid rgba\(220, 38, 38, 0\.16\);/s,
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

test("membership badges replace the profile pencil and show the subscribed weekly balance", async () => {
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
  const subscriptionBadgeHandler = sourceBlock(source, "function bindEvents", "function openChannelDialog");

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
    /context === "profile"[\s\S]*?!plan\.subscribed[\s\S]*?data-action="profile-quota"[\s\S]*?查看充值方案/,
  );
  assert.match(
    membership,
    /plan\.subscribed[\s\S]*?class="profile-membership-details profile-subscription-details-anchor"[\s\S]*?data-action="show-profile-subscription-details"[\s\S]*?aria-controls="profileMembershipDetailsPopover"/,
  );
  assert.match(membership, /state\.profileSubscriptionDetails\.anchor === "badge"/);
  assert.match(membership, /aria-expanded="\$\{detailsOpen\}"/);
  assert.match(membership, /id="profileMembershipDetailsPopover"[\s\S]*?renderProfileSubscriptionDetails\(\)/);
  assert.match(
    membership,
    /context === "consumption"[\s\S]*?!plan\.subscribed[\s\S]*?data-action="profile-quota"[\s\S]*?查看充值方案/,
  );
  assert.match(
    membership,
    /state\.profileSubscriptionDetails\.anchor === "consumption-badge"[\s\S]*?class="consumption-membership-details profile-subscription-details-anchor"[\s\S]*?data-subscription-details-anchor="consumption-badge"/,
  );
  assert.match(membership, /id="consumptionMembershipDetailsPopover"[\s\S]*?renderProfileSubscriptionDetails\(\)/);
  assert.match(subscriptionBadgeHandler, /data-action="show-profile-subscription-details"/);
  assert.match(subscriptionBadgeHandler, /event\.stopPropagation\(\)/);
  assert.match(subscriptionBadgeHandler, /button\.dataset\.subscriptionDetailsAnchor === "consumption-badge" \? "consumption-badge" : "badge"/);
  assert.match(subscriptionBadgeHandler, /toggleProfileSubscriptionDetails\(anchor\)/);
  assert.match(subscriptionBadgeHandler, /#profileSubscriptionBalanceHelp > summary/);
  assert.match(subscriptionBadgeHandler, /toggleProfileSubscriptionDetails\("balance"\)/);
  assert.match(membership, /subscription_balance_refresh_at/);
  assert.match(membership, /<span>订阅周余额<\/span>/);
  assert.match(membership, /id="profileSubscriptionBalanceHelp" class="recharge-product-help profile-subscription-help profile-subscription-details-anchor"/);
  assert.match(membership, /<summary[^>]*>\?<\/summary>/);
  assert.match(membership, /api\.getSubscriptionBalanceDetails\(\)/);
  assert.match(membership, /details\.totalBalance/);
  assert.match(membership, /details\.creditedBalance/);
  assert.match(membership, /details\.pendingBalance/);
  assert.match(membership, /details\.nextCreditAt \?/);
  assert.match(membership, /details\.membershipExpiresAt/);
  assert.doesNotMatch(membership, /estimateSubscriptionCreditedAmount|creditedInstallments|installmentAmount/);
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
  assert.doesNotMatch(styles, /\.membership-badge-member::before/);
  assert.match(styles, /\.settings-profile-panel\s*\{[^}]*margin-top: 36px;/s);
  assert.doesNotMatch(styles, /\.titlebar-profile-name\.member-highlight/);
  assert.match(
    styles,
    /\.profile-subscription-row time\s*\{[^}]*color: var\(--text-subtle\);[^}]*transform: translateY\(1px\);/s,
  );
  assert.match(
    styles,
    /\.profile-subscription-row\s*\{[^}]*grid-template-columns: 104px minmax\(0, 1fr\);/s,
  );
  assert.match(
    styles,
    /\.profile-token-row strong\s*\{[^}]*font-weight: 700;/s,
  );
  assert.match(
    styles,
    /\.profile-subscription-row b\s*\{[^}]*font-weight: 700;/s,
  );
  assert.match(
    styles,
    /\.profile-subscription-help summary\s*\{[^}]*width: 15px;[^}]*height: 15px;[^}]*background: #f4faff;/s,
  );
  assert.match(styles, /\.profile-subscription-help-popover\s*\{[^}]*background: #172033;/s);
  assert.match(styles, /\.profile-membership-details,\s*\.consumption-membership-details\s*\{[^}]*position: relative;[^}]*display: inline-flex;/s);
  assert.match(styles, /\.profile-subscription-help-popover\.profile-membership-details-popover\s*\{[^}]*right: -8px;[^}]*left: auto;/s);
  assert.match(styles, /\.profile-subscription-help-popover\.consumption-membership-details-popover\s*\{[^}]*right: auto;[^}]*left: -8px;/s);
  assert.match(styles, /\.profile-subscription-help-popover\.consumption-membership-details-popover::before\s*\{[^}]*right: auto;[^}]*left: 28px;/s);
});
