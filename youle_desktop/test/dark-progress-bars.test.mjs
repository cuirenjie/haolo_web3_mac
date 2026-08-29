import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("all dark-mode progress fills use the shared blue accent", async () => {
  const styles = await stylesSource;
  const marker = "/* Keep every progress fill bright and consistent against dark surfaces. */";
  const ruleStart = styles.indexOf(marker);

  assert.notEqual(ruleStart, -1);

  const ruleEnd = styles.indexOf("}", ruleStart);
  const progressRule = styles.slice(ruleStart, ruleEnd + 1);
  const coveredProgressFills = [
    ".update-download-dock-progress > span",
    ".progress > i",
    ".telegram-channel-login-stepper span.active",
    ".update-dialog-progress > span",
    ".subagent-cluster-progress-track > i:is(.filled, .current)",
    ".subagent-cluster-row:is(.completed, .failed, .interrupted)",
  ];

  for (const selector of coveredProgressFills) {
    assert.ok(progressRule.includes(selector), `missing dark-mode progress selector: ${selector}`);
  }
  assert.match(progressRule, /background:\s*var\(--brand-blue\);/);
});
