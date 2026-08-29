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

function height(block) {
  const match = block.match(/(?:^|\n)\s*height:\s*(\d+)px\b/);
  assert.ok(match, "missing fixed height declaration");
  return Number(match[1]);
}

test("library list and preview header dividers stay aligned", async () => {
  const styles = await stylesSource;
  const listHeaderHeight = height(cssBlock(styles, ".library-file-head"));
  const previewHeaderHeight = height(cssBlock(styles, ".library-preview-panel header"));

  assert.equal(listHeaderHeight, previewHeaderHeight);
  assert.match(
    cssBlock(styles, ".library-table-scroll"),
    new RegExp(`height:\\s*calc\\(100% - ${listHeaderHeight}px\\);`),
  );
});
