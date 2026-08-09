import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("about settings adds customer service WeChat after the website link with the shared chevron", async () => {
  const source = await rendererSource;
  const aboutBlock = sourceBlock(source, "function renderSettingsAboutPanel", "function renderSettingsLinkRow");
  const linkRowBlock = sourceBlock(source, "function renderSettingsLinkRow", "function renderUpdateDialog");

  const websiteIndex = aboutBlock.indexOf('renderSettingsLinkRow("进入官网"');
  const supportIndex = aboutBlock.indexOf('renderSettingsLinkRow("客服微信"');
  assert.ok(websiteIndex !== -1 && supportIndex > websiteIndex);
  assert.match(aboutBlock, /renderSettingsLinkRow\("客服微信", "", "open-login-wecom-qr"\)/);
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

test("authenticated settings reuses the login support QR dialog and loader", async () => {
  const source = await rendererSource;
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  const openBlock = sourceBlock(source, "async function openLoginWeComQrDialog", "function renderLoginActivateStep");
  const appEventsBlock = sourceBlock(source, "function bindEvents()", "function handleSkillsPlazaScroll");
  const sharedEventsBlock = sourceBlock(source, "function bindLoginWeComQrEvents", "function bindAgentPanelEvents");

  const dialogRenders = renderBlock.match(/state\.login\.wecomQrOpen \? renderLoginWeComDialog\(\) : ""/g) || [];
  assert.equal(dialogRenders.length, 2);
  assert.match(openBlock, /api\.fetchSupportQrcode\(\)/);
  assert.match(openBlock, /if \(!state\.auth\.authenticated && state\.login\.step === "code"\)/);
  assert.match(appEventsBlock, /bindLoginWeComQrEvents\(false\)/);
  assert.match(sharedEventsBlock, /openLoginWeComQrDialog\(\)/);
  assert.match(sharedEventsBlock, /state\.login\.wecomQrOpen = false/);
  assert.match(sharedEventsBlock, /if \(restoreCountdownOnClose\) restoreLoginWecomCountdown\(\)/);
});

test("support QR dialog stays above settings while leaving toast space", async () => {
  const styles = await stylesSource;
  const backdropBlock = sourceBlock(styles, ".login-wecom-backdrop {", ".login-wecom-dialog {");
  const dialogBlock = sourceBlock(styles, ".login-wecom-dialog {", ".login-wecom-close {");

  assert.match(backdropBlock, /z-index: 98/);
  assert.match(dialogBlock, /z-index: 99/);
  assert.match(styles, /\.settings-dialog \{[\s\S]*?z-index: 90/);
  assert.match(styles, /\.toast \{[\s\S]*?z-index: 100/);
});

test("support QR title aligns with the QR image and omits the footer hint", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const renderDialogBlock = sourceBlock(source, "function renderLoginWeComDialog", "function loginWeComQrUrl");
  const titleBlock = sourceBlock(styles, ".login-wecom-dialog h2 {", ".login-wecom-qr {");

  assert.match(renderDialogBlock, /企业微信客服/);
  assert.doesNotMatch(renderDialogBlock, /请使用企业微信扫码联系工作人员/);
  assert.match(titleBlock, /width: min\(216px, 100%\)/);
  assert.match(titleBlock, /padding-left: 35px/);
  assert.match(titleBlock, /font-size: calc\(14px \+ var\(--app-font-size-offset\)\)/);
  assert.match(titleBlock, /font-weight: 400/);
  assert.match(titleBlock, /text-align: left/);
});
