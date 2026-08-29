import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  stripWindowsLocalFileDescriptionSuffix,
  stripWindowsSourceLocationSuffix,
} from "../src/main/local-file-reference.mjs";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");

test("Windows file references drop trailing source line and column numbers", () => {
  assert.equal(
    stripWindowsSourceLocationSuffix("E:\\code\\xiaochao\\src\\ui\\views\\CtNavigation3DWidget.cpp:83"),
    "E:\\code\\xiaochao\\src\\ui\\views\\CtNavigation3DWidget.cpp",
  );
  assert.equal(stripWindowsSourceLocationSuffix("E:/code/example.cpp:83:12"), "E:/code/example.cpp");
  assert.equal(stripWindowsSourceLocationSuffix("file:///E:/code/example.cpp:83"), "file:///E:/code/example.cpp");
  assert.equal(stripWindowsSourceLocationSuffix("\\\\server\\share\\example.cpp:83:12"), "\\\\server\\share\\example.cpp");
});

test("Windows source location cleanup preserves drive letters and ordinary paths", () => {
  assert.equal(stripWindowsSourceLocationSuffix("E:\\code\\example.cpp"), "E:\\code\\example.cpp");
  assert.equal(stripWindowsSourceLocationSuffix("E:\\"), "E:\\");
  assert.equal(stripWindowsSourceLocationSuffix("/tmp/example.cpp:83"), "/tmp/example.cpp:83");
  assert.equal(stripWindowsSourceLocationSuffix("https://example.com/file.cpp:83"), "https://example.com/file.cpp:83");
});

test("Windows file references drop prose appended after the file extension", () => {
  assert.equal(
    stripWindowsLocalFileDescriptionSuffix(
      "E:/code/xiaochao/docs/superpowers/specs/2026-07-16-ultrasound-stream-ct-mpr-full-optimization-design.md：负责裁剪、单扇形",
    ),
    "E:/code/xiaochao/docs/superpowers/specs/2026-07-16-ultrasound-stream-ct-mpr-full-optimization-design.md",
  );
  assert.equal(stripWindowsLocalFileDescriptionSuffix("E:\\code\\report.pdf:owner"), "E:\\code\\report.pdf");
  assert.equal(stripWindowsLocalFileDescriptionSuffix("file:///E:/code/example.cpp:83"), "file:///E:/code/example.cpp:83");
});

test("Windows file description cleanup preserves ordinary paths", () => {
  assert.equal(stripWindowsLocalFileDescriptionSuffix("E:\\code\\example.cpp"), "E:\\code\\example.cpp");
  assert.equal(stripWindowsLocalFileDescriptionSuffix("E:\\资料\\阶段：二\\报告.md"), "E:\\资料\\阶段：二\\报告.md");
  assert.equal(stripWindowsLocalFileDescriptionSuffix("/tmp/report.md：说明"), "/tmp/report.md：说明");
  assert.equal(stripWindowsLocalFileDescriptionSuffix("https://example.com/report.md：说明"), "https://example.com/report.md：说明");
});

test("Markdown local links and main-process file opens both normalize source locations", async () => {
  const renderer = await rendererSource;
  const main = await mainSource;
  const inlineStart = renderer.indexOf("function formatInlineMessageText");
  const inlineEnd = renderer.indexOf("function applyMessageSearchKeywordHighlight", inlineStart);
  const inlineBlock = renderer.slice(inlineStart, inlineEnd);

  assert.ok(inlineStart >= 0 && inlineEnd > inlineStart);
  assert.match(inlineBlock, /const localPath = cleanMessageLocalPath\(markdownUrl\);/);
  assert.match(renderer, /cleaned = stripMessageLocalPathDescriptionSuffix\(cleaned\);/);
  assert.match(
    main,
    /const normalized = stripWindowsSourceLocationSuffix\(stripWindowsLocalFileDescriptionSuffix\(normalizeLocalPreviewPath\(value\)\)\);/,
  );
});
