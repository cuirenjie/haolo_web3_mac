import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

test("titlebar profile shows an online indicator and keeps the nickname styling neutral", async () => {
  const styles = await stylesSource;
  const renderer = await rendererSource;
  const renderStart = renderer.indexOf("function renderWindowControls()");
  const renderEnd = renderer.indexOf("\nfunction ", renderStart + 1);
  const renderBlock = renderer.slice(renderStart, renderEnd);

  assert.match(renderBlock, /class="titlebar-profile-avatar"/);
  assert.match(renderBlock, /class="titlebar-profile-online-dot" aria-hidden="true"/);
  assert.match(renderBlock, /class="titlebar-profile-name"/);
  assert.doesNotMatch(renderBlock, /renderMembershipBadge\("titlebar"\)/);
  assert.match(styles, /\.titlebar-profile\s*\{[^}]*font-weight:\s*400;/s);
  assert.match(
    styles,
    /\.titlebar-profile-avatar img\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*border-radius:\s*50%;/s,
  );
  assert.match(
    styles,
    /\.titlebar-profile-online-dot\s*\{[^}]*right:\s*-1px;[^}]*bottom:\s*-1px;[^}]*width:\s*10px;[^}]*height:\s*10px;[^}]*border:\s*2px solid #fff;[^}]*background:\s*#22c55e;/s,
  );
  assert.doesNotMatch(styles, /\.titlebar-profile-name\.member-highlight/);
});
