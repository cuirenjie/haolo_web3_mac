import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("media creation user echoes recover attachments after the reference preamble", async () => {
  const source = await rendererSource;
  const extraction = sourceSection(
    source,
    "function extractAttachmentsFromText",
    "function parseAttachmentLine",
  );

  const harness = `
    function stripInternalTurnGroupMemoryText(text) {
      return String(text || "");
    }
    function attachmentMetadataMarkerMatch(text) {
      return text.match(/(?:^|\\n\\n)(?:附件[:：])\\s*\\n/u);
    }
    function looksLikeConversationMemoryTitle() {
      return false;
    }
    function parseAttachmentLine(line) {
      if (!line.startsWith("- ") || !line.includes("object_key:")) return null;
      return { name: line.slice(2, line.indexOf(" (")) };
    }
    ${extraction}
    export { extractAttachmentsFromText };
  `;
  const transpiled = ts.transpileModule(harness, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const { extractAttachmentsFromText } = await import(
    `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`
  );
  const recovered = extractAttachmentsFromText(
    [
      "把 @图片1 中的人物的红领巾都去掉",
      "",
      "附件：",
      "附件引用关系（必须严格遵守）：",
      "提示词中的 @图片1、@图片2 是对下方同名附件的明确引用。",
      "未被 @ 标注的附件也属于本次消息。",
      "",
      "- 图片1（校园照片.jpg） (object_key: material/image-1, url: https://example.com/image-1.jpg)",
      "- 图片2（参考场景.png） (object_key: material/image-2, url: https://example.com/image-2.png)",
      "",
      "后续内部说明",
    ].join("\n"),
  );
  assert.deepEqual(
    recovered.map((attachment) => attachment.name),
    ["图片1（校园照片.jpg）", "图片2（参考场景.png）"],
  );

  assert.match(extraction, /let attachmentListStarted = false/);
  assert.match(
    extraction,
    /!attachmentListStarted && \(!trimmed \|\| !trimmed\.startsWith\("-"\)\)\) continue/,
  );
  assert.match(
    extraction,
    /if \(!attachment\) \{[\s\S]*if \(attachmentListStarted\) break;[\s\S]*continue;[\s\S]*attachmentListStarted = true/,
  );

  const sanitization = sourceSection(
    source,
    "function sanitizeUserMessageItem",
    "function rememberHiddenExternalChannelAgentPrompt",
  );
  assert.match(
    sanitization,
    /textSources\.flatMap\(\(text\) => extractAttachmentsFromText\(text\)\)/,
  );

  const reconciliation = sourceSection(
    source,
    "function upsertItem",
    "function removeMatchingLocalUserItem",
  );
  assert.match(
    reconciliation,
    /isUserSideThreadItem\(item\)[\s\S]*removeMatchingLocalUserItem\(threadId, item\)/,
  );
});

test("recovered media references retain their real image filenames", async () => {
  const source = await rendererSource;
  const displayNameParser = sourceSection(
    source,
    "function attachmentDisplayNameParts",
    "function parseAttachmentLine",
  );
  const transpiled = ts.transpileModule(
    `${displayNameParser}\nexport { attachmentDisplayNameParts };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    },
  );
  const { attachmentDisplayNameParts } = await import(
    `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`
  );

  assert.deepEqual(attachmentDisplayNameParts("图片1（abc.jpg）"), {
    name: "abc.jpg",
    mediaReferenceLabel: "图片1",
  });
  assert.deepEqual(
    attachmentDisplayNameParts("图片2（lolita_portrait-20260726.png）"),
    {
      name: "lolita_portrait-20260726.png",
      mediaReferenceLabel: "图片2",
    },
  );
  assert.deepEqual(attachmentDisplayNameParts("普通附件（最终版）.jpg"), {
    name: "普通附件（最终版）.jpg",
    mediaReferenceLabel: null,
  });

  const attachmentParser = sourceSection(
    source,
    "function parseAttachmentLine",
    "function attachmentMetaValue",
  );
  assert.match(attachmentParser, /attachmentDisplayNameParts\(displayName\)/);
  assert.match(attachmentParser, /media_reference_label: mediaReferenceLabel/);
});
