import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("the system dashboard remains expandable in compact windows", async () => {
  const styles = await stylesSource;
  assert.match(styles, /\.agent-panel\s*\{[^}]*display:\s*flex;/);

  const compactWindowStyles = sourceBlock(
    styles,
    "@media (max-width: 1100px)",
    "@media (max-width: 760px)",
  );
  assert.doesNotMatch(compactWindowStyles, /\.agent-panel\s*\{[^}]*display:\s*none;/);
});
