import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const apiClientSource = readFile(new URL("../src/main/youle-api-client.mjs", import.meta.url), "utf8");
const mainProcessSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("recharge packages keep display totals and payment amounts aligned", async () => {
  const [renderer, apiClient] = await Promise.all([rendererSource, apiClientSource]);
  const pricing = sourceBlock(
    renderer,
    "const RECHARGE_TOKEN_RATE",
    "const RECHARGE_ORDER_POLL_INTERVAL_MS",
  );
  const rateMatch = pricing.match(/RECHARGE_TOKEN_RATE\s*=\s*([\d.]+)/);
  assert.ok(rateMatch, "missing recharge token rate");
  const rate = Number(rateMatch[1]);
  const bonuses = new Map(
    [...pricing.matchAll(/\[(\d+),\s*(\d+)\]/g)].map((match) => [Number(match[1]), Number(match[2])]),
  );

  assert.equal(rate, 3);
  assert.equal(bonuses.get(5_000), 50);
  assert.equal(bonuses.get(10_000), 130);
  assert.equal(bonuses.get(20_000), 400);
  assert.equal(Math.round(20 * rate), 60);
  assert.equal(Math.round(50 * rate) + bonuses.get(5_000), 200);
  assert.equal(Math.round(100 * rate) + bonuses.get(10_000), 430);
  assert.equal(Math.round(200 * rate) + bonuses.get(20_000), 1000);

  const createOrder = sourceBlock(
    renderer,
    "async function createRechargeOrderForCurrentAmount",
    "function closeRechargeQrcodeDialog",
  );
  assert.match(createOrder, /product_id: product\.id/);
  assert.match(createOrder, /payment_method: "online_dual"/);
  assert.match(createOrder, /api\.createTokenProductOrder/);

  const apiCreateOrder = sourceBlock(
    apiClient,
    "async createRechargeOrder",
    "async getRechargeOrder",
  );
  assert.match(apiCreateOrder, /compactObject\(\{[\s\S]*amount_fen: amountFen,[\s\S]*payment_method: paymentMethod,[\s\S]*\}\)/);
});

test("recharge order polling retries transient failures without replacing the qrcode", async () => {
  const renderer = await rendererSource;
  const polling = sourceBlock(
    renderer,
    "async function pollRechargeOrder",
    "function renderSettingsDialog",
  );
  const catchStart = polling.indexOf("} catch (error) {");
  assert.notEqual(catchStart, -1, "missing recharge polling error handler");
  const errorHandler = polling.slice(catchStart);

  assert.match(
    errorHandler,
    /state\.rechargeQrcode\.orderNo !== orderNo[\s\S]*state\.rechargeQrcode\.kind !== paymentKind[\s\S]*state\.rechargeQrcode\.productId !== productId/,
  );
  assert.match(errorHandler, /state\.rechargeQrcode\.polling = true;/);
  assert.match(errorHandler, /state\.rechargeQrcode\.error = null;/);
  assert.match(errorHandler, /state\.rechargeQrcode\.message = `查询暂时失败，正在重试：\$\{errorMessage\(error\)\}`;/);
  assert.match(errorHandler, /scheduleRechargeOrderPolling\(\);/);
  assert.doesNotMatch(errorHandler, /state\.rechargeQrcode\.polling = false;/);
  assert.doesNotMatch(errorHandler, /state\.rechargeQrcode\.error = `查询失败/);
});

test("recharge button opens one pricing page with subscription above addon products", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const productDefinitions = sourceBlock(
    renderer,
    "const RECHARGE_SUBSCRIPTION_PRODUCTS",
    "const VOICE_INPUT_MAX_DURATION_MS",
  );
  const pageLayout = sourceBlock(
    renderer,
    "function renderRechargePage",
    "function consumptionPayload",
  );
  const subscriptionBalance = sourceBlock(
    renderer,
    "function renderRechargeSubscriptionBalance",
    "function renderRechargeProductCard",
  );
  const productCard = sourceBlock(
    renderer,
    "function renderRechargeProductCard",
    "function renderRechargeQrcodeDialog",
  );
  const page = [pageLayout, subscriptionBalance, productCard].join("\n");
  const profileHandler = renderer.match(
    /root\s*\.querySelectorAll<HTMLElement>\('\[data-action="profile-quota"\]'\)[\s\S]*?(?=root\s*\.querySelectorAll<HTMLButtonElement>\('\[data-action="buy-recharge-addon"\]'\))/,
  )?.[0] || "";
  const outsideClickHandler = sourceBlock(
    renderer,
    'root.querySelector<HTMLElement>(".desktop-shell")?.addEventListener("click"',
    'root.querySelector<HTMLButtonElement>(\'[data-action="toggle-left-panel"]\')',
  );
  assert.ok(profileHandler, "missing profile recharge handler");

  assert.match(page, /RECHARGE_SUBSCRIPTION_PRODUCTS/);
  assert.match(renderer, /<span>积分余额<\/span>/);
  assert.match(renderer, /class="profile-recharge-button" data-action="profile-quota">充值<\/button>/);
  assert.match(renderer, /function rechargeTokenMessageAction\(\)[\s\S]*?label: "充值积分"/);
  assert.match(productDefinitions, /detail: "总额度 600 积分·30天会员"/);
  assert.match(productDefinitions, /detail: "总额度 1,200 积分·30天会员"/);
  assert.match(productDefinitions, /detail: "总额度 4,000 积分·30天会员"/);
  assert.match(productDefinitions, /orderName: "60 积分加油包"[\s\S]*?detail: "60 积分·永久余额"/);
  assert.match(productDefinitions, /orderName: "200 积分加油包"[\s\S]*?detail: "200 积分·含50 积分赠送"/);
  assert.match(productDefinitions, /orderName: "430 积分加油包"[\s\S]*?detail: "430 积分·含130 积分赠送"/);
  assert.match(productDefinitions, /orderName: "1,000 积分加油包"[\s\S]*?detail: "1,000 积分·含400 积分赠送"/);
  assert.match(productDefinitions, /priceYuan: 99,[\s\S]*amountFen: 9_900/);
  assert.match(productDefinitions, /priceYuan: 169,[\s\S]*amountFen: 16_900/);
  assert.match(productDefinitions, /priceYuan: 499,[\s\S]*amountFen: 49_900/);
  assert.match(productDefinitions, /unitValue: "42\.42"[\s\S]*multiplier: "1:0\.023"/);
  assert.match(productDefinitions, /unitValue: "49\.7"[\s\S]*multiplier: "1:0\.02"/);
  assert.match(productDefinitions, /tokenAmount: 4000,[\s\S]*unitValue: "56\.1"/);
  assert.match(productDefinitions, /multiplier: "1:0\.017"/);
  assert.doesNotMatch(productDefinitions, /primaryCta/);
  assert.doesNotMatch(productDefinitions, /badge:/);
  assert.match(productDefinitions, /weeklyTokenAmount: 150/);
  assert.match(productDefinitions, /weeklyTokenAmount: 300/);
  assert.match(productDefinitions, /weeklyTokenAmount: 1000/);
  assert.match(productDefinitions, /features: \["每周额度上限 150 积分"/);
  assert.match(productDefinitions, /features: \["每周额度上限 300 积分"/);
  assert.match(productDefinitions, /features: \["每周额度上限 1,000 积分"/);
  assert.equal((productDefinitions.match(/进入积分余额/g) || []).length, 4);
  assert.match(productDefinitions, /"等级升级加速权益"/);
  assert.doesNotMatch(productDefinitions, /每7天最高|每个完整7天重置额度/);
  assert.doesNotMatch(productDefinitions, /detail: "每7天 \d[\d,]* 积分·30天会员"/);
  assert.match(page, /RECHARGE_ADDON_PRODUCTS/);
  assert.match(styles, /\.recharge-product-grid:not\(\.addon\)\s*\{[^}]*gap: calc\(2\.5% \+ 4\.533333px\);/s);
  assert.match(
    styles,
    /\.recharge-product-card:last-child \.recharge-product-help-popover\s*\{[^}]*right: -8px;[^}]*left: auto;/s,
  );
  assert.match(page, /月总额度 \$\{product\.tokenAmount\.toLocaleString\("en-US"\)\} 积分，分4周释放/);
  assert.match(page, /每周额度上限 \$\{product\.weeklyTokenAmount\.toLocaleString\("en-US"\)\} 积分/);
  assert.match(page, /class="recharge-product-help-quota"/);
  assert.match(
    styles,
    /\.recharge-product-card:last-child \.recharge-product-help-popover::before\s*\{[^}]*right: 12px;[^}]*left: auto;/s,
  );
  assert.ok(
    page.indexOf("RECHARGE_SUBSCRIPTION_PRODUCTS") < page.indexOf("RECHARGE_ADDON_PRODUCTS"),
    "subscription products must render above addon products",
  );
  assert.match(page, /class="recharge-page-intro"[\s\S]*class="recharge-page-balance"/);
  assert.match(page, /title="当前积分余额"[\s\S]*?<span>积分余额<\/span>/);
  assert.match(page, /const membership = currentMembershipPlan\(\);/);
  assert.match(page, /membership\.subscribed \? renderRechargeSubscriptionBalance\(\) : ""/);
  assert.match(subscriptionBalance, /currentSubscriptionBalanceDisplay\(\)/);
  assert.match(subscriptionBalance, /<span>订阅周余额<\/span>/);
  assert.match(subscriptionBalance, /<strong>\$\{escapeHtml\(balance\)\}<\/strong>/);
  assert.match(subscriptionBalance, /<time datetime=/);
  assert.match(styles, /\.recharge-page-intro > \.recharge-page-balances\s*\{[^}]*display: flex;[^}]*gap: 12px;/s);
  assert.match(styles, /\.recharge-page-balance time\s*\{[^}]*color: #8a98ab;[^}]*white-space: nowrap;/s);
  assert.doesNotMatch(page, /data-recharge-tab|recharge-page-eyebrow|recharge-page-notices|recharge-page-assurance/);
  assert.doesNotMatch(page, /轻量体验、稳定创作|一次购买、即时到账|\/ 次/);
  assert.doesNotMatch(renderer, /真实余额到账|进入真实 Token 余额|永久真实余额/);
  assert.doesNotMatch(productDefinitions, /\dToken|Token\s/);
  assert.match(productDefinitions, /解锁更多功能/);
  assert.match(productDefinitions, /比基础版更划算/);
  assert.doesNotMatch(productDefinitions, /cta: "购买加油包"/);
  assert.doesNotMatch(page, /\}Token|Token\s/);
  assert.doesNotMatch(page, /class="recharge-product-value"/);
  assert.doesNotMatch(page, /class="recharge-product-unit"/);
  assert.doesNotMatch(page, /30天总额度|余额到账|tokenLabel/);
  assert.match(
    page,
    /class="recharge-product-value-row">[\s\S]*?class="recharge-product-price"[\s\S]*?class="recharge-product-token"><strong>\$\{product\.tokenAmount\.toLocaleString\("zh-CN"\)\} 积分<\/strong><\/div>/,
  );
  assert.match(styles, /\.recharge-product-value-row\s*\{[^}]*display: flex;[^}]*align-items: center;/s);
  assert.match(styles, /\.recharge-product-token\s*\{[^}]*align-items: center;[^}]*justify-content: center;[^}]*text-align: center;/s);
  assert.match(styles, /\.recharge-product-card\s*\{[^}]*min-height: 310px;/s);
  assert.match(styles, /\.recharge-product-grid\.addon \.recharge-product-card\s*\{[^}]*min-height: 310px;/s);
  assert.match(styles, /\.recharge-product-card:hover\s*\{[^}]*border-color: #8dccff;/s);
  assert.match(
    styles,
    /\.recharge-product-grid:has\(\.recharge-product-card:hover\) \.recharge-product-card\.featured:not\(:hover\)\s*\{[^}]*border-color: #dce8f6;/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.recharge-product-grid:has\(\.recharge-product-card:hover\) \.recharge-product-card\.featured:not\(:hover\)\s*\{[^}]*border-color: rgba\(255, 255, 255, 0\.1\);/s,
  );
  assert.match(page, /<\/details>\s*\$\{bonus\}\s*<\/div>/);
  assert.match(page, /\+ \$\{product\.bonus\} 积分/);
  assert.match(renderer, /aria-label="积分加油包"/);
  assert.match(renderer, /productName: product\?\.orderName \|\| "积分加油包"/);
  assert.match(renderer, /微信或支付宝扫码支付，积分自动到账/);
  assert.match(renderer, /\$\{rechargeTokenEstimate\(amountFen\)\}<\/span> 积分\$\{bonusText\}/);
  assert.doesNotMatch(renderer, /Token加油包|Token自动到账|Token赠送/);
  assert.doesNotMatch(page, /class="recharge-product-price">[\s\S]*?\$\{bonus\}/);
  assert.match(page, /class="recharge-product-title-row"[\s\S]*?<details class="recharge-product-help">/);
  assert.match(page, /class="recharge-product-card \$\{product\.featured \? "featured" : ""\}"/);
  assert.match(page, /class="recharge-product-buy \$\{product\.featured \? "primary" : ""\}"/);
  assert.match(styles, /\.recharge-product-card\.featured\s*\{[^}]*border-color: #8dccff;/s);
  assert.match(
    styles,
    /\.recharge-product-grid:has\(\.recharge-product-card:hover\) \.recharge-product-card\.featured:not\(:hover\)\s*\{[^}]*border-color: #dce8f6;/s,
  );
  assert.match(
    styles,
    /\.recharge-product-buy\.primary,\s*\.recharge-product-card:hover \.recharge-product-buy\s*\{[^}]*background: #2f9bff;[^}]*color: #fff;/s,
  );
  assert.match(
    styles,
    /\.recharge-product-grid:has\(\.recharge-product-card:hover\)[\s\S]*?\.recharge-product-card\.featured:not\(:hover\)[\s\S]*?\.recharge-product-buy\.primary\s*\{[^}]*background: #fff;[^}]*color: #172033;/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\][\s\S]*?\.recharge-product-grid:has\(\.recharge-product-card:hover\)[\s\S]*?\.recharge-product-card\.featured:not\(:hover\)[\s\S]*?\.recharge-product-buy\.primary\s*\{[^}]*border-color: rgba\(255, 255, 255, 0\.1\);[^}]*background: #1b1e24;[^}]*color: #eef3fb;[^}]*box-shadow: none;/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.recharge-product-card\.featured\s*\{[^}]*border-color: rgba\(86, 159, 233, 0\.5\);[^}]*background:\s*linear-gradient\(180deg, rgba\(47, 155, 255, 0\.22\) 0%, rgba\(47, 155, 255, 0\.08\) 46%, transparent 76%\),\s*#191a1d;/s,
  );
  assert.match(page, /<summary aria-label="查看兑换说明"[^>]*>\?<\/summary>/);
  assert.match(page, /换算比率 1美元 = \$\{product\.unitValue\} 积分/);
  assert.match(page, /相当于只用 1美元，即可获得 ChatGPT 官方价值 \$\{product\.unitValue\}美元的积分，倍率 \$\{product\.multiplier\}/);
  assert.doesNotMatch(page, /\u2032/);
  assert.doesNotMatch(page, /成本倍率/);
  assert.doesNotMatch(renderer, /recharge-payment-note|function rechargePaymentNote/);
  assert.match(outsideClickHandler, /querySelectorAll<HTMLDetailsElement>\("\.recharge-product-help\[open\]"\)/);
  assert.match(outsideClickHandler, /if \(details !== clickedRechargeHelp\) details\.open = false;/);
  assert.match(profileHandler, /openRechargePage\(\)/);
  assert.doesNotMatch(profileHandler, /openRechargeQrcodeDialog/);
});

test("subscription payments use token-product IPC and wait for approved fulfillment", async () => {
  const [renderer, apiClient, mainProcess, preload] = await Promise.all([
    rendererSource,
    apiClientSource,
    mainProcessSource,
    preloadSource,
  ]);
  const creation = sourceBlock(
    renderer,
    "async function createSubscriptionOrder",
    "async function createRechargeOrderForCurrentAmount",
  );
  const polling = sourceBlock(
    renderer,
    "async function pollRechargeOrder",
    "function renderSettingsDialog",
  );
  const apiCreation = sourceBlock(
    apiClient,
    "async createTokenProductOrder",
    "async getTokenProductOrder",
  );

  assert.match(creation, /product_id: product\.id,/);
  assert.match(creation, /payment_method: "online_dual"/);
  assert.match(creation, /付款码正在准备中/);
  assert.match(apiCreation, /body: JSON\.stringify\(compactObject\(\{[\s\S]*product_id: productId,[\s\S]*payment_method: paymentMethod,[\s\S]*\}\)\)/);
  assert.match(apiClient, /DEFAULT_TOKEN_PRODUCT_ORDERS_PATH\s*=\s*"\/api\/finance\/token-products\/orders"/);
  assert.match(polling, /paymentKind === "subscription"\s*\? normalized === "approved"/);
  assert.match(polling, /const getOrder = productId \? api\.getTokenProductOrder : api\.getRechargeOrder/);
  assert.match(polling, /state\.rechargeQrcode\.transactionId/);
  assert.match(polling, /closeRechargeQrcodeDialog\(\)/);
  assert.match(polling, /refreshMembershipProfileAfterPayment\(\)/);
  assert.match(polling, /支付成功！订阅会员已生效/);
  assert.match(polling, /支付成功！订阅会员会在/);
  assert.match(renderer, /pendingMembershipActivationAt/);
  assert.match(apiClient, /pending_membership:/);
  assert.match(mainProcess, /ipcMain\.handle\("youle:createTokenProductOrder"/);
  assert.match(mainProcess, /ipcMain\.handle\("youle:getTokenProductOrder"/);
  assert.match(preload, /createTokenProductOrder: \(params\) => ipcRenderer\.invoke\("youle:createTokenProductOrder", params\)/);
  assert.match(preload, /getTokenProductOrder: \(params\) => ipcRenderer\.invoke\("youle:getTokenProductOrder", params\)/);
});

test("payment dialog renders WeChat and Alipay QR channels side by side with dark mode coverage", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const dialog = sourceBlock(
    renderer,
    "function renderRechargeQrcodeDialog",
    "function openRechargePage",
  );
  const appRender = sourceBlock(
    renderer,
    "function render()",
    "function scheduleRender",
  );
  const polling = sourceBlock(
    renderer,
    "async function pollRechargeOrder",
    "function renderSettingsDialog",
  );

  assert.match(dialog, /class="recharge-payment-options"/);
  assert.match(dialog, /class="recharge-qrcode-image"/);
  assert.match(dialog, /class="recharge-alipay-frame"/);
  assert.match(dialog, /class="recharge-alipay-loading"/);
  assert.match(dialog, /state\.rechargeQrcode\.alipayPaymentUrl/);
  assert.match(dialog, /微信支付/);
  assert.match(dialog, /支付宝支付/);
  assert.match(renderer, /rechargePaymentPortal\.id = "rechargePaymentPortal"/);
  assert.match(renderer, /function rechargePaymentPortalStructureSignature/);
  assert.match(renderer, /frame\.addEventListener\("load"/);
  assert.doesNotMatch(appRender, /renderRechargeQrcodeDialog\(\)/);
  assert.match(appRender, /syncRechargePaymentPortal\(\)/);
  assert.match(polling, /finally \{\s*syncRechargePaymentPortal\(\);\s*\}/);
  assert.match(styles, /\.recharge-payment-options\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,/);
  assert.match(styles, /\.recharge-alipay-frame\s*\{[\s\S]*width:\s*232px;[\s\S]*height:\s*232px;/);
  assert.match(styles, /\.recharge-payment-code-frame\.is-alipay-frame\.is-loaded \.recharge-alipay-loading/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.recharge-payment-options\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-payment-option/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-alipay-loading/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-qrcode-meta > span\.is-error/);
  assert.match(styles, /\.recharge-qrcode-error button:focus-visible/);
  assert.match(styles, /\.recharge-qrcode-error button:disabled/);
});
