import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

test("built-in login avatars crop their light halo without changing the layout footprint", async () => {
  const styles = await stylesSource;
  const renderer = await rendererSource;

  assert.match(
    styles,
    /\.login-logo:not\(\.login-logo-user\)\s*\{[^}]*transform: scale\(1\.09\);[^}]*transform-origin: center;[^}]*clip-path: circle\(45\.9% at center\);[^}]*\}/s,
  );
  assert.doesNotMatch(styles, /html\[data-theme="dark"\] \.login-logo\s*\{/s);

  assert.match(
    styles,
    /\.login-restore-avatar\s*\{[^}]*overflow: hidden;[^}]*border-radius: 50%;[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.login-restore-avatar img\s*\{[^}]*width: 100%;[^}]*height: 100%;[^}]*object-fit: cover;[^}]*\}/s,
  );

  const restoreStart = renderer.indexOf("function renderLoginRestoreStep");
  const restoreEnd = renderer.indexOf("\nfunction ", restoreStart + 1);
  const restoreBlock = renderer.slice(restoreStart, restoreEnd);
  assert.match(
    restoreBlock,
    /const avatarUrl = authProfileAvatarUrl\(state\.auth\.profile\) \|\| cachedLoginIdentity\?\.avatarUrl \|\| APP_AVATAR_URL;/,
  );
  assert.match(
    restoreBlock,
    /<span class="login-restore-avatar"><img\$\{builtInAvatarEdgeCropClassAttribute\(avatarUrl\)\}/,
  );
});
