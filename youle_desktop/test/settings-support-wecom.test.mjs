import assert from "node:assert/strict";
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

test("all customer-service entries open the website support flow", async () => {
  const source = await rendererSource;
  const aboutBlock = sourceBlock(source, "function renderSettingsAboutPanel", "function renderSettingsLinkRow");
  const supportEvents = sourceBlock(source, "function bindWebsiteSupportEvents", "function bindAgentPanelEvents");

  assert.match(aboutBlock, /renderSettingsLinkRow\("联系客服", "", "open-website-support"\)/);
  assert.equal((source.match(/data-action="open-website-support"/g) || []).length, 4);
  assert.match(supportEvents, /api\.openWebsiteSupport\(\)/);
  assert.match(supportEvents, /HAOLO_HOME_URL\}\/\#support=open/);
  assert.match(supportEvents, /aria-busy/);
  assert.match(supportEvents, /HTMLButtonElement[\s\S]*disabled = true/);
  assert.match(supportEvents, /暂时无法打开网页版客服，请稍后重试。/);
});

test("desktop main process keeps handoff secrets out of renderer and opens only the homepage", async () => {
  const [preload, main, apiClient] = await Promise.all([preloadSource, mainSource, apiClientSource]);
  const handler = sourceBlock(
    main,
    'ipcMain.handle("youle:openWebsiteSupport"',
    'ipcMain.handle("youle:refreshProfile"',
  );
  const clientMethod = sourceBlock(
    apiClient,
    "async createDesktopWebHandoff()",
    "async fetchSub2ApiKeys",
  );

  assert.match(preload, /openWebsiteSupport: \(\) => ipcRenderer\.invoke\("youle:openWebsiteSupport"\)/);
  assert.doesNotMatch(preload, /desktop_handoff|handoffTicket|accessToken|refreshToken/);
  assert.match(handler, /apiClient\.createDesktopWebHandoff\(\)/);
  assert.match(handler, /new URL\("\/", HAOLO_HOME_URL\)/);
  assert.match(handler, /support: "open"/);
  assert.match(handler, /fragment\.set\("desktop_handoff", handoffTicket\)/);
  assert.match(handler, /shell\.openExternal\(supportUrl\.toString\(\)\)/);
  assert.doesNotMatch(handler, /return \{[^}]*ticket|return \{[^}]*url/);
  assert.match(clientMethod, /desktopWebHandoffPath/);
  assert.match(clientMethod, /\^hdw1/);
  assert.match(apiClient, /token\|ticket\|password/);
});

test("customer service QR dialog, styles and bundled image are fully removed", async () => {
  const sources = (await Promise.all([
    rendererSource,
    stylesSource,
    preloadSource,
    mainSource,
    apiClientSource,
  ])).join("\n");

  assert.doesNotMatch(sources, /CUSTOMER_SERVICE_QR_URL|renderWeComSupportDialog|login-wecom|open-wecom-support|close-wecom-support/i);
  await assert.rejects(access(new URL("../src/renderer/assets/customer-service-qr.jpg", import.meta.url)));
});

test("existing support entry styles still cover light, dark, hover, focus and disabled states", async () => {
  const styles = await stylesSource;

  assert.match(styles, /\.recharge-support-button[\s\S]*?background:/);
  assert.match(styles, /\.recharge-support-button:hover/);
  assert.match(styles, /\.recharge-support-button:focus-visible/);
  assert.match(styles, /\.recharge-support-button:disabled/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*\.recharge-support-button/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*\.settings-link-row/);
  assert.doesNotMatch(styles, /login-wecom/);
});
