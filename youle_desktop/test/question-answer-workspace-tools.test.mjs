import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { QuestionAnswerWorkspaceToolSession } from "../src/main/workflow/question-answer-workspace-tools.mjs";

async function makeWorkspace() {
  const base = path.join(
    os.tmpdir(),
    `haolo-workspace-tools-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const root = path.join(base, "project");
  const uploads = path.join(base, "uploads");
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(uploads, { recursive: true });
  await writeFile(
    path.join(root, "src", "main.ts"),
    "export function startApp() {\n  return initializeRuntime();\n}\n",
    "utf8",
  );
  await writeFile(path.join(root, "README.md"), "# Example project\n", "utf8");
  await writeFile(path.join(root, ".env"), "SECRET=must-not-leak\n", "utf8");
  const uploadPath = path.join(uploads, "brief.md");
  await writeFile(uploadPath, "# External brief\nquality first\n", "utf8");
  const outsidePath = path.join(base, "outside.txt");
  await writeFile(outsidePath, "not authorized\n", "utf8");
  return { base, root, uploadPath, outsidePath };
}

test("read-only workspace tools provide broad group discovery and exact upload access", async () => {
  const workspace = await makeWorkspace();
  const session = new QuestionAnswerWorkspaceToolSession({
    cwd: workspace.root,
    explicitPaths: [workspace.uploadPath],
  });

  try {
    assert.deepEqual(
      session.definitions().map((tool) => tool.function.name),
      ["haolo_workspace_list", "haolo_workspace_search", "haolo_workspace_read"],
    );

    const listed = await session.list({ limit: 100 });
    assert.equal(listed.ok, true);
    assert.ok(listed.items.some((item) => item.path === "src/main.ts"));
    assert.ok(listed.items.some((item) => item.source === "upload"));
    assert.ok(!listed.items.some((item) => item.path === ".env"));

    const searched = await session.search({ query: "initializeRuntime" });
    assert.equal(searched.ok, true);
    assert.equal(searched.matches[0].path, "src/main.ts");
    assert.equal(searched.matches[0].line, 2);

    const read = await session.read({
      paths: ["src/main.ts", workspace.uploadPath],
    });
    assert.equal(read.ok, true);
    assert.match(read.files[0].content, /initializeRuntime/);
    assert.match(read.files[1].content, /quality first/);

    const denied = await session.read({ paths: [workspace.outsidePath] });
    assert.equal(denied.files[0].error.code, "FILE_OUTSIDE_READ_SCOPE");
  } finally {
    await rm(workspace.base, { recursive: true, force: true });
  }
});

test("workspace tool execution parses provider function-call envelopes", async () => {
  const workspace = await makeWorkspace();
  const session = new QuestionAnswerWorkspaceToolSession({
    cwd: workspace.root,
  });
  try {
    const result = await session.execute({
      id: "call_1",
      type: "function",
      function: {
        name: "haolo_workspace_read",
        arguments: JSON.stringify({ paths: ["README.md"] }),
      },
    });
    assert.equal(result.ok, true);
    assert.match(result.files[0].content, /Example project/);
  } finally {
    await rm(workspace.base, { recursive: true, force: true });
  }
});

test("large files remain searchable and pageable beyond the initial excerpt", async () => {
  const workspace = await makeWorkspace();
  const largePath = path.join(workspace.root, "src", "large.ts");
  const largeContent = [
    "export const beginning = true;",
    ...Array.from({ length: 80 }, (_, index) => `export const filler${index} = "${"x".repeat(20)}";`),
    "export const evidenceAtTheEnd = 'FOUND_DEEP_EVIDENCE';",
  ].join("\n");
  await writeFile(largePath, largeContent, "utf8");
  const session = new QuestionAnswerWorkspaceToolSession({
    cwd: workspace.root,
    maxReadFileChars: 120,
    maxReadTotalChars: 1_000,
  });

  try {
    const firstPage = await session.read({ paths: ["src/large.ts"] });
    assert.equal(firstPage.files[0].truncated, true);
    assert.ok(firstPage.files[0].nextByteOffset > 0);
    assert.doesNotMatch(firstPage.files[0].content, /FOUND_DEEP_EVIDENCE/);

    let nextOffset = firstPage.files[0].nextByteOffset;
    let assembled = firstPage.files[0].content;
    while (nextOffset !== null) {
      const nextPage = await session.read({
        paths: ["src/large.ts"],
        byteOffset: nextOffset,
        maxBytes: 120,
      });
      assembled += nextPage.files[0].content;
      nextOffset = nextPage.files[0].nextByteOffset;
    }
    assert.match(assembled, /FOUND_DEEP_EVIDENCE/);

    const searched = await session.search({ query: "FOUND_DEEP_EVIDENCE" });
    assert.equal(searched.ok, true);
    assert.equal(searched.matches[0].path, "src/large.ts");
    assert.equal(searched.matches[0].line, 82);
  } finally {
    await rm(workspace.base, { recursive: true, force: true });
  }
});
