import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("the email-only identifier controls move up together by 10px", async () => {
  const renderer = await rendererSource;
  const styles = await stylesSource;
  const start = renderer.indexOf("function renderLoginIdentifierStep");
  const end = renderer.indexOf("\nfunction ", start + 1);
  const identifierStep = renderer.slice(start, end);

  assert.match(
    identifierStep,
    /class="login-identifier-action-group"[\s\S]*class="login-fields login-email-fields"[\s\S]*type="email"[\s\S]*class="login-error"[\s\S]*class="primary-button login-submit[\s\S]*renderLoginAgreement\(\)[\s\S]*<\/div>/,
  );
  assert.doesNotMatch(identifierStep, /renderLoginMethodSwitch|switch-login-wechat/);
  assert.match(styles, /\.login-identifier-action-group\s*\{[^}]*display:\s*grid;[^}]*transform:\s*translateY\(-10px\);/s);
});
