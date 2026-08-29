import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const domainSource = readFile(new URL("../src/renderer/domain.ts", import.meta.url), "utf8");
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const localIconSource = readFile(new URL("../src/renderer/assets/home/icon-skill-local.svg", import.meta.url), "utf8");

test("local skill cards use the same fixed light-gray source icon in every theme", async () => {
  const [domain, renderer, localIcon] = await Promise.all([domainSource, rendererSource, localIconSource]);

  assert.match(domain, /skillLocal: new URL\("\.\/assets\/home\/icon-skill-local\.svg", import\.meta\.url\)\.href/);
  assert.equal((renderer.match(/HOME_ICON_URL\.skillLocal/g) || []).length, 1);
  assert.match(localIcon, /fill="#8B93A0"/);
});
