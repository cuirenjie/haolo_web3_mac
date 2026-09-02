import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const apiClientSource = readFile(new URL("../src/main/youle-api-client.mjs", import.meta.url), "utf8");
const mainProcessSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const browserMockSource = readFile(new URL("../src/renderer/browser_mock.ts", import.meta.url), "utf8");
const prototypeSource = readFile(new URL("../../haolo-ai-recharge.html", import.meta.url), "utf8");
const binancePaymentLogoSource = readFile(new URL("../src/renderer/assets/binance-bnb-logo.svg", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("recharge page shows subscriptions and selectable crypto payment networks without addon packages", async () => {
  const [renderer, styles, browserMock, binancePaymentLogo] = await Promise.all([
    rendererSource,
    stylesSource,
    browserMockSource,
    binancePaymentLogoSource,
  ]);
  const products = sourceBlock(
    renderer,
    "const RECHARGE_SUBSCRIPTION_PRODUCTS",
    "const VOICE_INPUT_MAX_DURATION_MS",
  );
  const page = sourceBlock(renderer, "function renderRechargePage", "function consumptionPayload");
  const productCard = sourceBlock(
    renderer,
    "function renderRechargeProductCard",
    "function openRechargePage",
  );
  const paymentEvents = sourceBlock(
    renderer,
    "function finishRechargeMarketLogoLoad",
    "function bindEvents",
  );
  const paymentDetails = sourceBlock(
    renderer,
    "function renderRechargePaymentDetailsShell",
    "function consumptionPayload",
  );
  const chainPaymentDetails = sourceBlock(
    paymentDetails,
    "const fixedPaymentAmount",
    "function rechargePaymentQrDataUrl",
  );
  const productEvents = sourceBlock(
    renderer,
    "function bindRechargeProductCardEvents",
    "function bindRechargePaymentMethodEvents",
  );
  const paymentDetailsStyles = sourceBlock(
    styles,
    ".recharge-payment-details {",
    ".recharge-payment-details[hidden]",
  );
  const pageScrollStyles = sourceBlock(
    styles,
    ".recharge-page-scroll {",
    ".recharge-subscription-content",
  );

  assert.match(products, /id: "subscription_trial"[\s\S]*?priceUsdt: 4\.9[\s\S]*?billingPeriod: "3天"[\s\S]*?tokenAmount: 100[\s\S]*?requiresTrialEligibility: true/);
  assert.match(products, /description: "首次开通专享，体验 AI 行情解读与基础交易分析。"/);
  assert.ok(products.indexOf('id: "subscription_trial"') < products.indexOf('id: "subscription_basic"'));
  assert.match(products, /id: "subscription_basic"[\s\S]*?priceUsdt: 99[\s\S]*?billingPeriod: "月"[\s\S]*?tokenAmount: 1000/);
  assert.match(products, /id: "subscription_pro"[\s\S]*?priceUsdt: 499[\s\S]*?billingPeriod: "半年"[\s\S]*?tokenAmount: 6000/);
  assert.match(products, /id: "subscription_flagship"[\s\S]*?priceUsdt: 799[\s\S]*?billingPeriod: "年"[\s\S]*?tokenAmount: 12000/);
  for (const description of [
    "适合日常看盘、行情问答与基础策略分析。",
    "适合持续行情研判、多策略分析与交易计划制定。",
    "适合高频行情分析、复杂策略研究与专业交易辅助。",
  ]) assert.ok(products.includes(`description: "${description}"`), `missing trading plan copy: ${description}`);
  assert.doesNotMatch(products, /priceYuan|amountFen/);
  assert.match(products, /let selectedRechargeProductId = "subscription_trial"/);
  assert.doesNotMatch(products, /featured:\s*true/);
  assert.match(productCard, /<strong>\$\{product\.priceUsdt\}U<\/strong><small>\/\$\{escapeHtml\(product\.billingPeriod\)\}<\/small>/);
  assert.doesNotMatch(productCard, /<span>¥<\/span>|product\.priceYuan/);
  assert.match(productCard, /class="recharge-product-card \$\{isSelected \? "selected" : ""\} \$\{unavailable \? "unavailable" : ""\}"/);
  assert.match(productCard, /role="radio"[\s\S]*?aria-checked="\$\{isSelected \? "true" : "false"\}"[\s\S]*?aria-disabled="\$\{unavailable \? "true" : "false"\}"[\s\S]*?tabindex="\$\{unavailable \? "-1" : "0"\}"/);
  assert.doesNotMatch(productCard, /recharge-product-help|<summary|查看兑换说明/);
  assert.doesNotMatch(products, /id: "addon_|kind: "addon"/);
  assert.match(products, /id: "binance_internal"[\s\S]*?asset: "BNB"[\s\S]*?label: "币安内部转账"[\s\S]*?kind: "internal"/);
  assert.match(products, /id: "okx_internal"[\s\S]*?asset: "OKB"[\s\S]*?label: "OKX内部转账"[\s\S]*?kind: "internal"/);
  assert.ok(products.indexOf('id: "binance_internal"') < products.indexOf('id: "bsc"'));
  assert.ok(products.indexOf('id: "okx_internal"') < products.indexOf('id: "bsc"'));
  assert.match(products, /id: "bsc"[\s\S]*?asset: "BNB"[\s\S]*?label: "币安链BSC 网络"[\s\S]*?id: "tron"[\s\S]*?asset: "TRX"[\s\S]*?label: "波场TRON 网络"/);
  assert.match(products, /id: "arbitrum"[\s\S]*?asset: "ARB"[\s\S]*?label: "Arbitrum One 网络"/);
  assert.match(paymentDetails, /const recipientAddress = responseRecipient/);
  assert.match(products, /let selectedRechargePaymentNetwork: RechargePaymentNetworkId \| null = "binance_internal"/);
  assert.match(page, /RECHARGE_SUBSCRIPTION_PRODUCTS/);
  assert.match(page, /class="recharge-product-grid subscription" role="radiogroup"[\s\S]*?aria-required="true"/);
  assert.match(page, /const visibleProducts = visibleRechargeSubscriptionProducts\(\)/);
  assert.match(page, /style="--recharge-product-columns: \$\{visibleProducts\.length\}"/);
  assert.match(page, /\$\{visibleProducts\.map\(renderRechargeProductCard\)\.join\(""\)\}/);
  assert.match(page, /class="recharge-subscription-content"/);
  assert.match(page, /class="recharge-history-action"[\s\S]*?class="recharge-support-button" data-action="open-website-support"[\s\S]*?<span>联系客服<\/span>[\s\S]*?class="recharge-history-button"/);
  assert.match(pageScrollStyles, /overflow: hidden/);
  assert.match(pageScrollStyles, /padding: 12px clamp\(22px, 3\.4vw, 48px\) 47px/);
  assert.doesNotMatch(styles, /\.recharge-page-scroll\s*\{[^}]*scrollbar-color/);
  assert.match(styles, /\.recharge-subscription-content\s*\{\s*transform: translateY\(15px\)/);
  assert.match(page, /class="recharge-payment-shell"[\s\S]*?renderRechargePaymentMethods\(\)[\s\S]*?renderRechargePaymentDetailsShell\(\)/);
  assert.match(page, /class="recharge-payment-methods" role="radiogroup"/);
  assert.match(styles, /\.recharge-payment-shell\s*\{[\s\S]*?margin-top: 35px[\s\S]*?padding-top: 20px/);
  assert.match(styles, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.recharge-payment-shell\s*\{\s*margin-top: 12px/);
  assert.match(styles, /\.recharge-payment-methods\s*\{[\s\S]*?height: 50px/);
  assert.match(styles, /\.recharge-payment-network\s*\{[\s\S]*?min-height: 40px/);
  assert.match(paymentDetailsStyles, /margin-top: 0/);
  assert.doesNotMatch(paymentDetailsStyles, /border-top/);
  assert.match(page, /renderRechargePaymentDetailsShell\(\)/);
  assert.match(page, /type="radio"[\s\S]*?name="recharge-payment-network"/);
  assert.match(renderer, /const RECHARGE_BINANCE_LOGO_URL = new URL\("\.\/assets\/binance-bnb-logo\.svg", import\.meta\.url\)\.href/);
  assert.match(page, /function renderRechargePaymentMethodLogo[\s\S]*?network\.id === "binance_internal" \|\| network\.id === "bsc"[\s\S]*?recharge-payment-binance-logo[\s\S]*?network\.id !== "okx_internal"[\s\S]*?recharge-payment-exchange-logo okx/);
  assert.match(chainPaymentDetails, /recharge-payment-qr-logo[\s\S]*?renderRechargePaymentMethodLogo\(network\)/);
  assert.match(binancePaymentLogo, /<circle[^>]*fill="#0b0e11"/);
  assert.match(binancePaymentLogo, /<path fill="#f0b90b"/);
  assert.doesNotMatch(page, /RECHARGE_ADDON_PRODUCTS|recharge-addon-section|积分加油包|临时不够/);
  assert.doesNotMatch(styles, /recharge-addon-|recharge-product-(?:grid\.addon|bonus)/);
  assert.doesNotMatch(productCard, /<button|data-action=|product\.cta/);
  assert.match(paymentEvents, /hyperliquidTradingMarketAssetLogoUrl\(asset\)/);
  assert.match(paymentEvents, /selectedRechargePaymentNetwork = network\.id/);
  assert.match(paymentEvents, /if \(!rechargePaymentViewActive\)[\s\S]*?rechargePaymentViewActive = true;[\s\S]*?activateRechargePaymentSelection\(\)/);
  assert.match(paymentEvents, /updateRechargePaymentDetails\(\)/);
  assert.match(paymentDetails, /支付金额/);
  assert.match(paymentDetails, /function visibleRechargeSubscriptionProducts\(\)[\s\S]*?RECHARGE_SUBSCRIPTION_PRODUCTS\.filter\(\(product\) => !rechargeProductIsUnavailable\(product\)\)/);
  assert.match(paymentDetails, /function ensureRechargeProductSelection\(\)[\s\S]*?visibleRechargeSubscriptionProducts\(\)[\s\S]*?candidate\.id === "subscription_basic"[\s\S]*?selectedRechargeProductId = product\.id/);
  assert.match(paymentDetails, /function rechargePaymentSelection\(\)[\s\S]*?ensureRechargeProductSelection\(\)/);
  assert.match(paymentDetails, /收款地址/);
  assert.doesNotMatch(paymentDetails, /临时地址<\/span>|本订单专属临时地址/);
  assert.match(paymentDetails, /payment_state === "underpaid"/);
  assert.match(paymentDetails, /payment_state === "expired_underpaid_review"/);
  assert.match(paymentDetails, /订单已过期且只收到部分款项，已转入人工核对；请勿继续付款。/);
  assert.match(paymentDetails, /还需补付/);
  assert.match(paymentDetails, /order\.payable_amount/);
  assert.match(paymentDetails, /order\.recipient_address/);
  assert.match(renderer, /normalizeRechargePaymentAmount/);
  assert.match(paymentDetails, /network\.kind === "internal"[\s\S]*?recharge-payment-internal-steps/);
  assert.match(paymentDetails, /收款账号/);
  assert.match(paymentDetails, /const fixedPaymentAmount = String\(product\.priceUsdt\)/);
  assert.match(paymentDetails, /<span class="recharge-payment-step-label">收款地址<\/span>[\s\S]*?class="recharge-payment-internal-field account"/);
  assert.match(paymentDetails, /<strong>\$\{escapeHtml\(fixedPaymentAmount\)\}<small>USDT<\/small><\/strong>/);
  assert.match(paymentDetails, /data-copy-recharge-amount="\$\{escapeAttr\(fixedPaymentAmount\)\}"/);
  assert.doesNotMatch(paymentDetails, /recharge-payment-summary(?:-row)?/);
  assert.match(chainPaymentDetails, /class="recharge-payment-details-main internal-transfer"/);
  assert.doesNotMatch(chainPaymentDetails, /recharge-payment-progress|recharge-payment-detecting|检测到账中/);
  assert.match(chainPaymentDetails, /recharge-payment-qr-column[\s\S]*?recharge-payment-internal-countdown/);
  assert.match(paymentDetails, /金额必须完全一致/);
  assert.match(paymentDetails, /data-copy-recharge-amount/);
  assert.match(paymentDetails, /copyAmountButton\.dataset\.copyRechargeAmount \|\| order\.payable_amount/);
  assert.match(paymentDetails, /network\?\.kind === "internal"\) return/);
  assert.match(paymentDetails, /QRCode\.toDataURL\(order\.recipient_address/);
  assert.match(paymentDetails, /errorCorrectionLevel: "H"/);
  assert.match(paymentDetails, /data-recharge-payment-qr-image/);
  assert.match(paymentDetails, /data-copy-recharge-address/);
  assert.match(paymentDetails, /检测到账中/);
  assert.match(paymentDetails, /data-recharge-payment-countdown/);
  assert.doesNotMatch(paymentDetails, />30:00 剩余</);
  assert.match(paymentDetails, /会员服务协议/);
  assert.match(paymentDetails, /api\.createWeb3PaymentOrder/);
  assert.match(paymentDetails, /api\.getWeb3PaymentOrder/);
  assert.match(paymentDetails, /paymentChannel: "web3"/);
  assert.match(paymentDetails, /rechargePaymentOrdersBySelection\.set\(orderSelectionKey, order\)/);
  assert.match(paymentDetails, /panel\?\.dataset\.rechargePaymentFingerprint !== visualFingerprint/);
  assert.match(paymentDetails, /panel\.dataset\.rechargePaymentFingerprint = rechargePaymentOrderVisualFingerprint\(order\)/);
  assert.match(paymentDetails, /orderSelectionKey !== expectedSelectionKey/);
  assert.match(paymentDetails, /rechargePaymentSelectionKey\(selection\.product\.id, selection\.network\.id\)/);
  assert.match(paymentDetails, /createRechargePaymentOrder\(\{ force: true, preserveExisting: true \}\)/);
  assert.match(renderer, /RECHARGE_PAYMENT_CREATE_AUTO_RETRY_LIMIT = 1/);
  assert.match(paymentDetails, /retryAttempt: retryAttempt \+ 1/);
  assert.match(paymentDetails, /rechargePaymentOrderErrorsBySelection\.delete\(selectionKey\)[\s\S]*?createRechargePaymentOrder\(\{ force: true, preserveExisting: true \}\)/);
  assert.match(paymentDetails, /rechargePaymentOrderLoadingSelections\.has\(selectionKey\) && !order/);
  assert.match(renderer, /state\.activeView !== "recharge"[\s\S]*?rechargePaymentViewActive = false/);
  assert.doesNotMatch(paymentDetails, /请使用 [^<]+ 支付 USDT，并确保收款账号和三位小数金额完全一致/);
  assert.doesNotMatch(paymentDetails, /切换套餐或支付方式不会取消当前有效订单，请勿重复支付/);
  assert.match(paymentDetails, /status === "expired"/);
  assert.match(paymentDetails, /function reconcileExpiredRechargePaymentOrder/);
  assert.match(paymentDetails, /api\.getWeb3PaymentOrder\(\{ orderNo: order\.order_no \}\)/);
  assert.match(paymentDetails, /previousOrderNo: order\.order_no/);
  assert.match(paymentDetails, /正在确认订单最终状态/);
  assert.match(paymentDetails, /暂时无法确认最后一次到账结果，请勿重复支付/);
  assert.match(paymentDetails, /积分已全部到账/);
  assert.match(productEvents, /selectedRechargeProductId = product\.id/);
  assert.match(productEvents, /selectedCard\.getAttribute\("aria-disabled"\) === "true"/);
  assert.match(productEvents, /card\.classList\.toggle\("selected", isSelected\)/);
  assert.match(productEvents, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(styles, /\.recharge-product-card\.selected/);
  assert.match(styles, /\.recharge-product-card:focus-visible/);
  assert.match(styles, /\.recharge-support-button:hover:not\(:disabled\)/);
  assert.match(styles, /\.recharge-support-button:active:not\(:disabled\)/);
  assert.match(styles, /\.recharge-support-button:focus-visible/);
  assert.match(styles, /\.recharge-support-button:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-support-button/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-support-button:hover:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-support-button:active:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-support-button:disabled/);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.recharge-product-card\.selected/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-product-card\.selected/);
  assert.doesNotMatch(styles, /\.recharge-payment-network-(?:note|warning)\b/);
  assert.match(styles, /\.recharge-payment-underpaid\s*\{[\s\S]*?var\(--recharge-details-warning-bg\)/);
  assert.match(styles, /\.recharge-payment-details\s*\{[\s\S]*?--recharge-details-warning-text: #8a4b00/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-payment-details\s*\{[\s\S]*?--recharge-details-warning-text: #ffd27a/);
  assert.match(styles, /\.recharge-product-grid\s*\{[\s\S]*?grid-template-columns: repeat\(var\(--recharge-product-columns, 4\), minmax\(190px, 1fr\)\)/);
  assert.match(styles, /\.recharge-product-grid\s*\{[\s\S]*?gap: calc\(1\.25% \+ 2\.266667px\)/);
  assert.match(styles, /\.recharge-product-card\[aria-disabled="true"\]/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-product-card\[aria-disabled="true"\]/);
  assert.doesNotMatch(styles, /recharge-product-card\.featured/);
  assert.match(styles, /\.recharge-payment-network:hover/);
  assert.match(styles, /\.recharge-payment-network:has\(input:not\(:disabled\)\):active/);
  assert.match(styles, /\.recharge-payment-network:has\(input:checked\)/);
  assert.match(styles, /\.recharge-payment-network:has\(input:focus-visible\)/);
  assert.match(styles, /\.recharge-payment-network:has\(input:disabled\)/);
  assert.match(styles, /\.recharge-payment-network-grid\s*\{[\s\S]*?grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.recharge-payment-details-main\.internal-transfer/);
  assert.doesNotMatch(styles, /\.recharge-payment-(?:progress|detecting|countdown)\b|--recharge-details-divider/);
  assert.match(styles, /\.recharge-payment-qr-column > \.recharge-payment-internal-countdown\s*\{[\s\S]*?width: 194px/);
  assert.match(styles, /\.recharge-payment-internal-field\.amount strong/);
  assert.match(styles, /\.recharge-payment-internal-detecting/);
  assert.doesNotMatch(styles, /recharge-product-card\.payment-locked/);
  assert.match(styles, /\.recharge-payment-network-icon \.trading-market-asset-logo\.loading/);
  assert.match(styles, /\.recharge-payment-network-icon \.trading-market-asset-logo\s*\{[\s\S]*?animation: none;[\s\S]*?transition: none;/);
  assert.match(styles, /\.recharge-payment-binance-logo\s*\{[\s\S]*?width: 24px;[\s\S]*?height: 24px;[\s\S]*?object-fit: contain;/);
  assert.match(styles, /\.recharge-payment-internal-logo \.recharge-payment-binance-logo\s*\{[\s\S]*?width: 52px;[\s\S]*?height: 52px;/);
  assert.match(styles, /\.recharge-payment-qr-logo \.recharge-payment-binance-logo\s*\{[\s\S]*?width: 30px;[\s\S]*?height: 30px;/);
  assert.match(styles, /\.recharge-payment-internal-logo \.trading-market-asset-logo\s*\{[\s\S]*?animation: none;[\s\S]*?transition: none;/);
  assert.match(styles, /\.recharge-payment-qr-logo\s*\{[\s\S]*?animation: none;[\s\S]*?transition: none;/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-payment-shell/);
  assert.match(styles, /\.recharge-payment-details/);
  assert.match(styles, /\.recharge-payment-details\[hidden\]/);
  assert.match(styles, /\.recharge-payment-qr-frame\.loading/);
  assert.match(styles, /\.recharge-payment-qr-frame\.error/);
  assert.match(styles, /\.recharge-payment-address-copy:hover/);
  assert.match(styles, /\.recharge-payment-address-copy:active/);
  assert.match(styles, /\.recharge-payment-address-copy:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-payment-details/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-payment-details\s*\{[\s\S]*?--recharge-internal-field-bg:[\s\S]*?--recharge-internal-status-bg:/);
  assert.match(styles, /\.recharge-payment-state\.paid/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-payment-state\.expired/);
  assert.doesNotMatch(styles, /recharge-payment-(?:internal|preservation)-note/);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.recharge-product-card/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-product-card/);
  assert.doesNotMatch(styles, /recharge-product-help/);
  assert.match(browserMock, /const mockWeb3PaymentOrders = new Map<string, any>\(\)/);
  assert.match(browserMock, /selectionKey = `\$\{productId\}:\$\{network\}:web3`/);
  assert.match(browserMock, /mockWeb3PaymentOrders\.get\(selectionKey\)/);
  assert.match(browserMock, /mockWeb3PaymentOrders\.set\(selectionKey, order\)/);
  assert.match(browserMock, /subscription_trial: \{ name: "体验版订阅", price: "4\.900", internalPrice: "4\.873", tokens: "100", months: 0, days: 3, plan: "trial" \}/);
  assert.match(browserMock, /subscription_basic: \{ name: "基础版订阅", price: "99\.000", internalPrice: "98\.931"/);
  assert.match(browserMock, /payable_amount: network === "binance_internal" \|\| network === "okx_internal"[\s\S]*?\? product\.internalPrice[\s\S]*?: product\.price/);
  assert.match(browserMock, /binance_internal: "1261385376"/);
  assert.match(browserMock, /okx_internal: "694504753333973132"/);
});

test("legacy WeChat and Alipay payment flow is absent from every desktop layer", async () => {
  const [renderer, styles, apiClient, mainProcess, preload, prototype] = await Promise.all([
    rendererSource,
    stylesSource,
    apiClientSource,
    mainProcessSource,
    preloadSource,
    prototypeSource,
  ]);
  const runtime = [renderer, apiClient, mainProcess, preload].join("\n");

  assert.doesNotMatch(runtime, /online_dual|alipayPaymentUrl|alipay_payment_url/);
  assert.doesNotMatch(runtime, /fetchRechargeQrcode|createRechargeOrder|getRechargeOrder/);
  assert.match(apiClient, /\/api\/finance\/web3\/token-products\/orders/);
  assert.match(mainProcess, /youle:createWeb3PaymentOrder/);
  assert.match(preload, /youle:getWeb3PaymentOrder/);
  assert.doesNotMatch(runtime, /createTokenProductOrder|getTokenProductOrder/);
  assert.doesNotMatch(runtime, /youle:(?:fetchRechargeQrcode|createRechargeOrder|getRechargeOrder|createTokenProductOrder|getTokenProductOrder)/);
  assert.doesNotMatch(apiClient, /\/api\/finance\/(?:recharge\/(?:qrcode|orders)|token-products\/orders)/);
  assert.doesNotMatch(renderer, /rechargeQrcode|rechargePaymentPortal|buy-recharge|微信支付|支付宝支付|付款码/);
  assert.doesNotMatch(styles, /recharge-(?:qrcode|payment-portal|alipay)|recharge-product-buy/);
  assert.doesNotMatch(prototype, /paymentModal|openPayment|confirmPayment|buy-plan|buy-boost|微信支付|支付宝支付|付款码/);
});
