import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("Telegram login progress stays blue in dark mode", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.telegram-channel-login-stepper span\.active\s*\{[^}]*background: #2aabee;/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.telegram-channel-login-stepper span\.active\s*\{[^}]*background: #2aabee;/s,
  );
});
