import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("login and registration user avatars use a consistent 100px diameter", async () => {
  const styles = await stylesSource;

  assert.match(styles, /\.login-logo\s*\{[^}]*width:\s*118px;[^}]*height:\s*118px;/s);
  assert.match(
    styles,
    /\.login-logo-user\s*\{[^}]*width:\s*100px;[^}]*height:\s*100px;[^}]*border-radius:\s*50%;/s,
  );
  assert.match(
    styles,
    /\.login-restore-avatar\s*\{[^}]*width:\s*100px;[^}]*height:\s*100px;[^}]*border-radius:\s*50%;/s,
  );
  assert.match(
    styles,
    /\.login-avatar-picker button\s*\{[^}]*width:\s*100px;[^}]*height:\s*100px;[^}]*border-radius:\s*50%;/s,
  );
});
