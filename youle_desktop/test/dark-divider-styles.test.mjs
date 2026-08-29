import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("dividers and focused settings links use theme-aware neutral colors", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.contact-requests-page > header\s*\{[^}]*border-bottom: 1px solid var\(--border-subtle\);/s,
  );
  assert.match(styles, /\.library-file-row\s*\{[^}]*position: relative;[^}]*transition: background 0\.15s ease;/s);
  assert.match(
    styles,
    /\.library-file-row::after\s*\{[^}]*height: 0;[^}]*border-bottom: 1px solid var\(--border-subtle\);[^}]*pointer-events: none;/s,
  );
  assert.match(styles, /\.library-file-row:hover\s*\{[^}]*background: var\(--surface-hover-translucent\);/s);
  assert.match(styles, /\.library-file-row\.active::after\s*\{[^}]*opacity: 0;/s);

  const settingsHover = styles.match(/\.settings-link-row:hover\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(settingsHover, /background: var\(--surface-muted\);/);
  assert.match(settingsHover, /box-shadow: -17px 0 0 var\(--surface-muted\);/);
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.settings-link-row:hover\s*\{[^}]*background: #202329;[^}]*box-shadow: -17px 0 0 #202329;/s,
  );
  assert.doesNotMatch(
    styles,
    /html\[data-theme="dark"\] \.settings-update-button:hover\s*\{[^}]*box-shadow: -17px/s,
  );
  assert.match(
    styles,
    /\.settings-link-row:focus:not\(:focus-visible\)\s*\{[^}]*outline: none;/s,
  );
  assert.match(
    styles,
    /\.settings-link-row:focus-visible\s*\{[^}]*outline: 2px solid var\(--brand-blue\);[^}]*outline-offset: 1px;/s,
  );
});
