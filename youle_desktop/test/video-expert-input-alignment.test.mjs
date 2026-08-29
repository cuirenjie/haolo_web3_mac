import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function cssBlock(source, selector) {
  const marker = `${selector} {`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing CSS block: ${selector}`);
  const end = source.indexOf("\n}", start + marker.length);
  assert.notEqual(end, -1, `unterminated CSS block: ${selector}`);
  return source.slice(start, end + 2);
}

test("video expert prompt and attachment rail use the full composer width in every theme", async () => {
  const styles = await stylesSource;
  const composer = cssBlock(styles, ".composer");
  const input = cssBlock(styles, ".composer-input-wrap");
  const attachmentWrap = cssBlock(styles, ".pending-attachments-wrap");

  assert.match(composer, /min-height:\s*158px;/);
  assert.match(composer, /margin:\s*0 10px 13px;/);
  assert.match(composer, /padding:\s*11px 15px 46px;/);
  assert.match(input, /width:\s*100%;/);
  assert.match(input, /height:\s*100px;/);
  assert.doesNotMatch(styles, /\.video-expert-composer\s*\{/);
  assert.doesNotMatch(styles, /\.video-expert-input-wrap\s*\{/);
  assert.match(attachmentWrap, /max-width:\s*100%;/);
  assert.doesNotMatch(styles, /\.video-expert-(?:composer-body|first-frame(?:-[\w-]+)?)\s*[{,:]/);
  assert.doesNotMatch(styles, /html\[data-theme="dark"\]\s+\.video-expert-(?:input-wrap|tools)\s*\{/);
});
