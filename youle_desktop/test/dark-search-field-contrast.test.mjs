import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

test("dark primary search fields stay visible against their surrounding surfaces", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /html\[data-theme="dark"\] \.contacts-search-box,\s*html\[data-theme="dark"\] \.skills-plaza-search\s*\{\s*background: var\(--surface-hover-strong\);/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.contacts-search-box:hover,\s*html\[data-theme="dark"\] \.skills-plaza-search:hover\s*\{\s*background: var\(--surface-interactive-hover\);/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.contacts-search-box:focus-within,[\s\S]*html\[data-theme="dark"\] \.contacts-search-box\.has-value,[\s\S]*html\[data-theme="dark"\] \.skills-plaza-search:focus-within\s*\{[\s\S]*background: var\(--surface-interactive-hover\);[\s\S]*box-shadow: 0 0 0 1px rgba\(255, 255, 255, 0\.08\);/,
  );
});
