import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

test("the dark profile menu brightens the near-black egg, egg-cat and cat level icons", async () => {
  const [styles, renderer] = await Promise.all([stylesSource, rendererSource]);
  const lightRule = styles.match(/\.profile-level-icons img\s*\{([^}]*)\}/)?.[1] || "";

  assert.doesNotMatch(lightRule, /filter:/);
  assert.match(renderer, /data-level-icon="\$\{escapeAttr\(icon\.type\)\}"/);
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.profile-level-icons img\[data-level-icon="egg"\],\s*html\[data-theme="dark"\] \.profile-level-icons img\[data-level-icon="egg_cat"\],\s*html\[data-theme="dark"\] \.profile-level-icons img\[data-level-icon="cat"\]\s*\{[^}]*filter: grayscale\(1\) invert\(0\.88\);[^}]*\}/s,
  );
  assert.doesNotMatch(styles, /html\[data-theme="dark"\] \.profile-level-icons img\s*\{/);
});
