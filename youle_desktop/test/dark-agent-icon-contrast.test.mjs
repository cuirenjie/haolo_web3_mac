import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

test("dark mode only recolors transparent GPT artwork and preserves the Grok bitmap", async () => {
  const styles = await stylesSource;
  const renderer = await rendererSource;

  assert.match(
    renderer,
    /if \(avatarUrl === CONTACT_AGENT_AVATAR_URL\.gpt\)\s*\{[^}]+dark-theme-white-agent-icon/s,
  );
  assert.doesNotMatch(
    renderer,
    /CONTACT_AGENT_AVATAR_URL\.grok[^}]+dark-theme-white-agent-icon/s,
  );
  assert.match(
    renderer,
    /grok: new URL\("\.\/assets\/friend\/agent-grok\.png", import\.meta\.url\)\.href/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.dark-theme-white-agent-icon\s*\{[^}]*filter: brightness\(0\) invert\(1\);[^}]*\}/s,
  );
  assert.doesNotMatch(
    styles,
    /html:not\(\[data-theme="dark"\]\)[^{]*\.dark-theme-white-agent-icon|html\[data-theme="light"\][^{]*\.dark-theme-white-agent-icon/s,
  );
});
