import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  haoloContextEnvelopeInstructions,
  parseHaoloContextEnvelope,
} from "../src/main/workflow/haolo-context-envelope.mjs";

function withSourceFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-context-envelope-"));
  const folder = path.join(root, "haolo");
  const pptx = path.join(folder, "项目介绍.pptx");
  const other = path.join(root, "outside.txt");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(pptx, "fixture", "utf8");
  fs.writeFileSync(other, "outside", "utf8");
  try {
    return run({ root, folder, pptx, other });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function completeEnvelope({ pptx, body = "SOURCE: 项目介绍.pptx\nSLIDE 1\nHaoLo项目介绍与产品定位" }) {
  return [
    `HAOLO_CONTEXT_RESULT: ${JSON.stringify({
      status: "complete",
      sources: [{
        path: pptx,
        kind: "presentation",
        status: "read",
        contentUnits: 28,
        extractedCharacters: 20,
        skill: "Presentations",
      }],
      failedSources: [],
      skillsUsed: ["Presentations"],
      summary: "已提取 28 张幻灯片正文",
    })}`,
    "HAOLO_CONTEXT_BODY_BEGIN",
    body,
    "HAOLO_CONTEXT_BODY_END",
  ].join("\n");
}

test("validated Haolo context accepts presentation evidence inside an authorized folder", () => {
  withSourceFixture(({ folder, pptx }) => {
    const result = parseHaoloContextEnvelope({
      text: completeEnvelope({ pptx }),
      workspace: folder,
      authorizedPaths: [folder],
    });

    assert.equal(result.status, "complete");
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].path, pptx);
    assert.equal(result.sources[0].contentUnits, 28);
    assert.deepEqual(result.skillsUsed, ["Presentations"]);
    assert.match(result.body, /SLIDE 1/);
  });
});

test("explicit files must be proven readable before context can reach an external model", () => {
  withSourceFixture(({ folder, pptx, other }) => {
    assert.throws(
      () => parseHaoloContextEnvelope({
        text: completeEnvelope({ pptx: other }),
        workspace: folder,
        authorizedPaths: [pptx],
      }),
      (error) => error?.code === "HAOLO_CONTEXT_SOURCE_OUT_OF_SCOPE",
    );
  });
});

test("failure explanations and structure-only output cannot masquerade as context", () => {
  withSourceFixture(({ folder, pptx }) => {
    const failure = [
      `HAOLO_CONTEXT_RESULT: ${JSON.stringify({
        status: "failed",
        sources: [],
        failedSources: [{ path: pptx, reason: "blocked by policy" }],
        skillsUsed: [],
        summary: "当前环境只能确认 ZIP 结构，无法读取幻灯片正文",
      })}`,
      "HAOLO_CONTEXT_BODY_BEGIN",
      "共 28 张幻灯片和 147 个媒体文件。",
      "HAOLO_CONTEXT_BODY_END",
    ].join("\n");

    assert.throws(
      () => parseHaoloContextEnvelope({
        text: failure,
        workspace: folder,
        authorizedPaths: [folder],
      }),
      (error) => error?.code === "HAOLO_CONTEXT_READ_INCOMPLETE",
    );
  });
});

test("Haolo context instructions require real Presentations evidence", () => {
  const instructions = haoloContextEnvelopeInstructions();

  assert.match(instructions, /status=complete only after actual task-relevant body text/);
  assert.match(instructions, /PPT\/PPTX/);
  assert.match(instructions, /extractedCharacters/);
  assert.match(instructions, /not ZIP filenames or package metadata/);
});
