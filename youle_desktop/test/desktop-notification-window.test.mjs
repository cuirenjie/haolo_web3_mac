import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainProcessSource = await readFile(
  new URL("../src/main/main.mjs", import.meta.url),
  "utf8",
);

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`, "u"));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

test("desktop fallback notification has enough room for wrapped completion copy", () => {
  const bounds = mainProcessSource.match(
    /const DESKTOP_NOTIFICATION_BOUNDS = \{\s*width:\s*(\d+),\s*height:\s*(\d+),\s*margin:\s*(\d+),\s*\};/u,
  );
  assert.ok(bounds, "Missing desktop notification bounds");
  assert.ok(Number(bounds[1]) >= 380, "Notification should be wide enough to avoid avoidable wrapping");
  assert.ok(Number(bounds[2]) >= 150, "Notification should not clip two-line completion copy");

  const cardRule = cssRule(mainProcessSource, ".card");
  assert.match(cardRule, /position:\s*relative;/u);
  assert.match(cardRule, /min-height:\s*100%;/u);
  assert.match(cardRule, /background:\s*#fff;/u);
  assert.doesNotMatch(cardRule, /padding:\s*14px\s+96px/u);

  const headRule = cssRule(mainProcessSource, ".head");
  assert.match(headRule, /padding-right:\s*92px;/u);
});
