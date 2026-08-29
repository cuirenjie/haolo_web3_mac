import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("libraries no longer expose a standalone link category", async () => {
  const source = await rendererSource;
  const resultsNavigation = sourceBlock(
    source,
    "function renderResultsNavigation",
    "function renderResultsSkillsPane",
  );
  const materialsPage = sourceBlock(
    source,
    "function renderMaterialsPage",
    "function renderLibraryStatus",
  );

  assert.match(
    source,
    /type ResultKind = "agent" \| "command" \| "card" \| "media" \| "file";/,
  );
  assert.match(source, /type LibraryCategory = "all" \| "media" \| "file";/);
  assert.doesNotMatch(resultsNavigation, /renderCategoryButton\("link"/);
  assert.doesNotMatch(materialsPage, /renderCategoryButton\("link"/);
});

test("link-specific classification and filtering branches are removed", async () => {
  const source = await rendererSource;
  const classification = sourceBlock(
    source,
    "function classifyLibraryKind",
    "function allResultRows",
  );
  const filters = sourceBlock(
    source,
    "function filterLibraryRows",
    "function inferPreviewKind",
  );
  const previewInference = sourceBlock(
    source,
    "function inferPreviewKind",
    "function fileNameFromReference",
  );

  assert.doesNotMatch(classification, /"link"|text\.includes\("url"\)/);
  assert.doesNotMatch(filters, /category === "link"|row\.kind === "link"|return "link"/);
  assert.match(filters, /return row\.kind !== "media";/);
  assert.doesNotMatch(previewInference, /resultKind/);
  assert.match(
    previewInference,
    /lowerMime\.includes\("html"\) \|\| \/\\\.\(html\?\|url\)/,
  );
});
