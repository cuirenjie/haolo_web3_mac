import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const domainSource = readFile(
  new URL("../src/renderer/domain.ts", import.meta.url),
  "utf8",
);
const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);
const inactiveIconSource = readFile(
  new URL("../src/renderer/assets/nav/cube-library.svg", import.meta.url),
  "utf8",
);
const activeIconSource = readFile(
  new URL("../src/renderer/assets/nav/cube-library-active.svg", import.meta.url),
  "utf8",
);

test("results navigation uses the requested outlined cube icon", async () => {
  const [domain, renderer, inactiveIcon, activeIcon] = await Promise.all([
    domainSource,
    rendererSource,
    inactiveIconSource,
    activeIconSource,
  ]);

  assert.match(domain, /library: new URL\("\.\/assets\/nav\/cube-library\.svg"/);
  assert.match(domain, /libraryActive: new URL\("\.\/assets\/nav\/cube-library-active\.svg"/);
  assert.match(
    renderer,
    /renderNavIcon\("results", "成果库", HOME_ICON_URL\.library, HOME_ICON_URL\.libraryActive, state\.activeView === "results"\)/,
  );

  for (const icon of [inactiveIcon, activeIcon]) {
    assert.match(icon, /M12 3\.25L20 7\.75V16\.75L12 21\.25L4 16\.75V7\.75L12 3\.25Z/);
    assert.match(icon, /M4\.25 7\.9L12 12\.25L19\.75 7\.9M12 12\.25V21/);
    assert.match(icon, /stroke-width="1\.75"/);
  }
  assert.match(inactiveIcon, /#888B93/);
  assert.match(activeIcon, /stroke="black"|fill="black"/);
});

test("the cube navigation icon remains legible in dark mode and on keyboard focus", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /html\[data-theme="dark"\] \.nav-icon img,[\s\S]*?\{[^}]*filter:\s*brightness\(0\) invert\(0\.88\);/s,
  );
  assert.match(
    styles,
    /\.nav-icon:focus-visible\s*\{[^}]*outline:\s*2px solid rgba\(7, 93, 255, 0\.42\);[^}]*background:\s*rgba\(7, 93, 255, 0\.06\);/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.nav-icon:focus-visible\s*\{[^}]*outline-color:\s*rgba\(113, 190, 255, 0\.82\);[^}]*background:\s*rgba\(65, 153, 235, 0\.14\);/s,
  );
});
