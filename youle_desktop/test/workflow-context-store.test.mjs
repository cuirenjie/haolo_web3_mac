import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ReadOnlyContextBroker, contextPackageText } from "../src/main/workflow/read-context-broker.mjs";
import { issueLocalFileReviewGrant } from "../src/main/workflow/local-file-review.mjs";
import { WorkflowRunStore } from "../src/main/workflow/run-store.mjs";

test("read-only context broker selects relevant local files and skips secrets", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-workflow-context-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.writeFile(path.join(root, "architecture.md"), "ExecutorAdapter CapabilityGrant ExecutionResult 工作流架构", "utf8");
  await fs.promises.writeFile(path.join(root, "unrelated.txt"), "午餐菜单", "utf8");
  await fs.promises.writeFile(path.join(root, ".env"), "SECRET=never-send", "utf8");

  const broker = new ReadOnlyContextBroker({ maxSelectedFiles: 2 });
  const context = await broker.buildPackage({ cwd: root, prompt: "评审 ExecutorAdapter 工作流架构" });

  assert.ok(context.items.some((item) => item.relativePath === "architecture.md"));
  assert.ok(context.items.every((item) => item.relativePath !== ".env"));
  assert.match(contextPackageText(context), /CapabilityGrant/);
  assert.equal(context.selectionPolicy, "quality_optimal_read_only");
});

test("read-only context broker can restrict a request to semantically selected uploads", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-workflow-upload-scope-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.writeFile(path.join(root, "unrelated-project.md"), "GROUP_CONTEXT_MUST_NOT_BE_SENT", "utf8");
  const selectedUpload = path.join(root, "selected-brief.md");
  await fs.promises.writeFile(selectedUpload, "SELECTED_UPLOAD_CONTENT", "utf8");

  const broker = new ReadOnlyContextBroker({ maxSelectedFiles: 8 });
  const context = await broker.buildPackage({
    cwd: root,
    prompt: "总结我选中的材料",
    explicitPaths: [selectedUpload],
    includeWorkspace: false,
    extractPromptPaths: false,
  });

  assert.deepEqual(context.items.map((item) => item.relativePath), ["selected-brief.md"]);
  assert.match(contextPackageText(context), /SELECTED_UPLOAD_CONTENT/);
  assert.doesNotMatch(contextPackageText(context), /GROUP_CONTEXT_MUST_NOT_BE_SENT/);
});

test("read-only context broker never fills the budget with zero-relevance files", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-workflow-relevance-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.writeFile(
    path.join(root, "adapter-notes.md"),
    "The ExecutorAdapter validates one task envelope.",
    "utf8",
  );
  await Promise.all(
    Array.from({ length: 40 }, (_, index) => fs.promises.writeFile(
      path.join(root, `noise-${String(index).padStart(2, "0")}.txt`),
      "unrelated filler content ".repeat(900),
      "utf8",
    )),
  );

  const maxContextChars = 200_000;
  const broker = new ReadOnlyContextBroker({
    maxSelectedFiles: 50,
    maxFileChars: 20_000,
    maxContextChars,
  });
  const context = await broker.buildPackage({
    cwd: root,
    prompt: "Explain ExecutorAdapter",
  });

  assert.ok(context.candidateCount > 1);
  assert.deepEqual(context.items.map((item) => item.relativePath), ["adapter-notes.md"]);
  assert.ok(context.items.every((item) => item.score > 0));
  assert.equal(context.eligibleCandidateCount, 1);
  assert.ok(context.totalChars < maxContextChars / 10);
  assert.deepEqual(context.catalog, ["adapter-notes.md"]);
});

test("workflow context broker enforces the current node CapabilityGrant", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-workflow-grant-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "brief.md");
  await fs.promises.writeFile(filePath, "NODE_SCOPED_CONTENT", "utf8");
  const broker = new ReadOnlyContextBroker({ maxSelectedFiles: 1 });
  const grant = issueLocalFileReviewGrant({
    workflowId: "workflow_grant",
    nodeId: "reader",
    root,
    explicitPaths: [filePath],
    purpose: "read the brief",
  });

  const context = await broker.buildPackage({
    cwd: root,
    prompt: "读取 brief.md",
    explicitPaths: [filePath],
    nodeId: "reader",
    authorizationMode: "capability_grant",
    capabilityGrant: grant,
  });
  assert.match(contextPackageText(context), /NODE_SCOPED_CONTENT/);

  await assert.rejects(
    broker.buildPackage({
      cwd: root,
      prompt: "读取 brief.md",
      explicitPaths: [filePath],
      nodeId: "other-node",
      authorizationMode: "capability_grant",
      capabilityGrant: grant,
    }),
    /subject does not match/,
  );
});

test("SQLite run store persists snapshots and ordered events", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-workflow-store-"));
  const store = new WorkflowRunStore(path.join(root, "runs.sqlite"));
  t.after(() => store.close());
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const run = {
    protocolVersion: 1,
    id: "workflow_test",
    threadId: "thread_test",
    status: "planning",
    sequence: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    nodes: [{ id: "root-plan", status: "running" }],
  };
  store.save(run, { runId: run.id, sequence: 1, type: "run.created", createdAt: run.updatedAt });

  assert.equal(store.get(run.id).threadId, run.threadId);
  assert.equal(store.latestForThread(run.threadId).id, run.id);
  assert.deepEqual(store.nonTerminalRuns().map((entry) => entry.id), [run.id]);
  assert.equal(store.events(run.id).length, 1);

  run.status = "failed";
  run.sequence = 2;
  run.updatedAt = "2026-01-01T00:00:02.000Z";
  store.save(run, { runId: run.id, sequence: 2, type: "run.failed", createdAt: run.updatedAt });
  assert.deepEqual(store.nonTerminalRuns(), []);
});
