import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const apiClientSource = readFile(new URL("../src/main/youle-api-client.mjs", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("about settings changes WeChat support to Telegram contact and opens the shared dialog", async () => {
  const source = await rendererSource;
  const aboutBlock = sourceBlock(source, "function renderSettingsAboutPanel", "function renderSettingsLinkRow");
  const linkRowBlock = sourceBlock(source, "function renderSettingsLinkRow", "function renderUpdateDialog");

  const websiteIndex = aboutBlock.indexOf('renderSettingsLinkRow("进入官网"');
  const supportIndex = aboutBlock.indexOf('renderSettingsLinkRow("联系Telegram"');
  assert.ok(websiteIndex !== -1 && supportIndex > websiteIndex);
  assert.match(aboutBlock, /renderSettingsLinkRow\("联系Telegram", "", "open-wecom-support"\)/);
  assert.doesNotMatch(aboutBlock, /客服微信/);
  assert.match(linkRowBlock, /action \? `data-action=/);
  assert.match(linkRowBlock, /class="settings-link-chevron"/);
});

test("about content moves up ten pixels as one group", async () => {
  const styles = await stylesSource;
  const aboutPanelBlock = sourceBlock(styles, ".settings-about-panel {", ".settings-app-icon {");

  assert.match(aboutPanelBlock, /margin-top: 28px/);
});

test("version and link content moves up three pixels below the app icon", async () => {
  const styles = await stylesSource;
  const aboutContentBlock = sourceBlock(styles, ".settings-about-content {", ".settings-version-row {");

  assert.match(aboutContentBlock, /margin: 35px auto 0/);
});

test("authenticated settings reuses the supplied customer service QR dialog", async () => {
  const source = await rendererSource;
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  const dialogBlock = sourceBlock(source, "function renderWeComSupportDialog", "function renderLoginActivateStep");
  const appEventsBlock = sourceBlock(source, "function bindEvents()", "function handleSkillsPlazaScroll");
  const sharedEventsBlock = sourceBlock(source, "function bindWeComSupportEvents", "function bindAgentPanelEvents");

  const dialogRenders = renderBlock.match(/state\.login\.wecomSupportOpen \? renderWeComSupportDialog\(\) : ""/g) || [];
  assert.equal(dialogRenders.length, 2);
  assert.match(dialogBlock, /class="login-wecom-qr-image"/);
  assert.match(dialogBlock, /src="\$\{escapeAttr\(CUSTOMER_SERVICE_QR_URL\)\}"/);
  assert.match(dialogBlock, /alt="客服联系方式二维码"/);
  assert.doesNotMatch(dialogBlock, /fetchSupportQrcode|二维码加载|加载失败/);
  assert.match(dialogBlock, /if \(!state\.auth\.authenticated && state\.login\.step === "code"\)/);
  assert.match(appEventsBlock, /bindWeComSupportEvents\(false\)/);
  assert.match(sharedEventsBlock, /openWeComSupportDialog\(\)/);
  assert.match(sharedEventsBlock, /querySelectorAll<HTMLElement>\('\[data-action="open-wecom-support"\]'\)/);
  assert.match(sharedEventsBlock, /state\.login\.wecomSupportOpen = false/);
  assert.match(sharedEventsBlock, /if \(restoreCountdownOnClose\) restoreLoginSupportCountdown\(\)/);
});

test("customer service dialog stays above settings while leaving toast space", async () => {
  const styles = await stylesSource;
  const backdropBlock = sourceBlock(styles, ".login-wecom-backdrop {", ".login-wecom-dialog {");
  const dialogBlock = sourceBlock(styles, ".login-wecom-dialog {", ".login-wecom-close {");

  assert.match(backdropBlock, /z-index: 98/);
  assert.match(dialogBlock, /z-index: 99/);
  assert.match(styles, /\.settings-dialog \{[\s\S]*?z-index: 90/);
  assert.match(styles, /\.toast \{[\s\S]*?z-index: 100/);
});

test("customer service dialog renders the supplied QR image in both themes", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const renderDialogBlock = sourceBlock(source, "function renderWeComSupportDialog", "function openWeComSupportDialog");
  const titleBlock = sourceBlock(styles, ".login-wecom-dialog h2 {", ".login-wecom-qr-image {");
  const imageBlock = sourceBlock(styles, ".login-wecom-qr-image {", ".login-activate-panel {");

  assert.match(renderDialogBlock, /联系Telegram/);
  assert.doesNotMatch(renderDialogBlock, /企业微信客服/);
  assert.match(renderDialogBlock, /<img class="login-wecom-qr-image"/);
  assert.match(titleBlock, /width: min\(216px, 100%\)/);
  assert.match(titleBlock, /padding-left: 35px/);
  assert.match(titleBlock, /font-size: calc\(14px \+ var\(--app-font-size-offset\)\)/);
  assert.match(titleBlock, /font-weight: 400/);
  assert.match(titleBlock, /text-align: left/);
  assert.match(imageBlock, /width: min\(216px, 100%\)/);
  assert.match(imageBlock, /max-height: min\(62vh, 460px\)/);
  assert.match(imageBlock, /background: var\(--surface-primary\)/);
  assert.match(imageBlock, /object-fit: contain/);
  assert.doesNotMatch(imageBlock, /filter:/);
  assert.match(styles, /\.login-wecom-close:hover/);
  assert.match(styles, /\.login-wecom-close:active/);
  assert.match(styles, /\.login-wecom-close:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.login-wecom-close:hover/);
});

test("the supplied customer service QR is bundled exactly once without the removed loading bridge", async () => {
  const sources = (await Promise.all([rendererSource, stylesSource, preloadSource, mainSource, apiClientSource])).join("\n");
  assert.match(sources, /CUSTOMER_SERVICE_QR_URL[\s\S]*customer-service-qr\.jpg/);
  assert.doesNotMatch(sources, /fetchSupportQrcode|bundledSupportQrcode|support-qrcode|login-wecom-support-qr/i);

  const qrAsset = new URL("../src/renderer/assets/customer-service-qr.jpg", import.meta.url);
  const qrBytes = await readFile(qrAsset);
  assert.equal(createHash("sha256").update(qrBytes).digest("hex"), "aafd6dd635f8a6cbea2f2d1fff576f5c6566b6534f5e97576f5b675f8cf87bcb");

  const removedAssets = [
    new URL("../src/main/assets/support-qrcode.jpg", import.meta.url),
    new URL("../src/renderer/assets/login-wecom-support-qr.png", import.meta.url),
  ];
  for (const asset of removedAssets) {
    await assert.rejects(access(asset));
  }
});
