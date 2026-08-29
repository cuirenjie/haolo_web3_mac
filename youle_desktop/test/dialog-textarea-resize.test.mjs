import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesPath = new URL("../src/renderer/styles.css", import.meta.url);

test("dialog textareas do not show native resize handles", async () => {
  const styles = await readFile(stylesPath, "utf8");

  assert.match(styles, /dialog textarea\s*\{[\s\S]*?resize:\s*none;/);
  assert.match(styles, /\.prompt-favorite-dialog textarea\s*\{[\s\S]*?resize:\s*none;/);
});
