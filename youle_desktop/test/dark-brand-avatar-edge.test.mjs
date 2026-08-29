import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

test("dark mode crops the white edge from built-in brand avatars only", async () => {
  const styles = await stylesSource;
  const renderer = await rendererSource;

  assert.match(
    styles,
    /html\[data-theme="dark"\] \.built-in-avatar-edge-crop-haolo\s*\{[^}]*transform: scale\(1\.09\);[^}]*transform-origin: center;[^}]*clip-path: inset\(4\.1% round var\(--avatar-radius\)\);[^}]*\}/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.built-in-avatar-edge-crop-video-expert\s*\{[^}]*transform: scale\(1\.025\);[^}]*transform-origin: center;[^}]*\}/s,
  );
  assert.doesNotMatch(styles, /html\[data-theme="light"\][^{]*\.built-in-avatar-edge-crop-(?:haolo|video-expert)/s);

  assert.match(renderer, /function builtInAvatarEdgeCropClassAttribute\(avatarUrl: string\)/);
  assert.match(renderer, /if \(avatarUrl === APP_AVATAR_URL\) return ` class="built-in-avatar-edge-crop-haolo"`;/);
  assert.match(renderer, /if \(avatarUrl === CONTACT_AGENT_AVATAR_URL\.videoExpert\) return ` class="built-in-avatar-edge-crop-video-expert"`;/);
  for (const renderFunction of ["renderContactAvatar", "renderMessageAvatar", "renderRoleAvatar", "renderThreadAvatar"]) {
    const start = renderer.indexOf(`function ${renderFunction}`);
    const end = renderer.indexOf("\nfunction ", start + 1);
    const block = renderer.slice(start, end < 0 ? undefined : end);
    assert.match(block, /builtInAvatarEdgeCropClassAttribute\(avatarUrl\)/, `${renderFunction} must mark built-in avatars`);
  }

  for (const renderFunction of ["renderWindowControls", "renderProfileMenu", "renderSettingsProfilePanel"]) {
    const start = renderer.indexOf(`function ${renderFunction}`);
    const end = renderer.indexOf("\nfunction ", start + 1);
    const block = renderer.slice(start, end < 0 ? undefined : end);
    assert.match(block, /builtInAvatarEdgeCropClassAttribute\(avatarUrl\)/, `${renderFunction} must mark the default profile avatar`);
  }
});
