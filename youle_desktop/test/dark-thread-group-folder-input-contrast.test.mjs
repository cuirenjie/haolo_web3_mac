import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function darkDeclarationsFor(styles, selector) {
  const target = `html[data-theme="dark"] ${selector}`;
  return [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/gs)]
    .filter(([, selectors]) =>
      selectors
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(",")
        .map((item) => item.trim())
        .includes(target),
    )
    .map(([, , declarations]) => declarations)
    .join("\n");
}

test("dark new-folder input remains distinct from its dialog", async () => {
  const styles = await stylesSource;
  const input = darkDeclarationsFor(styles, "#threadGroupFolderNameInput");
  const focus = darkDeclarationsFor(styles, "#threadGroupFolderNameInput:focus");

  assert.match(input, /border: 1px solid var\(--line-strong\);/);
  assert.match(input, /background: var\(--surface-interactive-hover\);/);
  assert.match(focus, /border-color: var\(--brand-blue\);/);
  assert.match(focus, /box-shadow: 0 0 0 2px rgba\(91, 157, 255, 0\.18\);/);
});
