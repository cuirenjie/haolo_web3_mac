import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LOCAL_FILE_MISSING_ERROR_CODE,
  managedThreadGroupRelativePath,
  outputsRelativePath,
  resolveExistingLocalPath,
} from "../src/main/local-file-resolver.mjs";

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-local-file-resolver-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeFixture(filePath, text = "fixture") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

test("keeps an existing local file path unchanged", async (t) => {
  const root = temporaryRoot(t);
  const filePath = path.join(root, "outputs", "article.html");
  writeFixture(filePath);

  const result = await resolveExistingLocalPath(filePath, { cwd: root });

  assert.equal(result.path, filePath);
  assert.equal(result.recovered, false);
  assert.equal(result.strategy, "exact");
});

test("accepts an existing directory when the caller allows any local path", async (t) => {
  const root = temporaryRoot(t);
  const directoryPath = path.join(root, "project files");
  fs.mkdirSync(directoryPath, { recursive: true });

  const result = await resolveExistingLocalPath(directoryPath, {
    cwd: root,
    expectedType: "any",
  });

  assert.equal(result.path, directoryPath);
  assert.equal(result.stats.isDirectory(), true);
  assert.equal(result.strategy, "exact");
});

test("rebases a managed artifact path after the Windows user-data root changes", async (t) => {
  const root = temporaryRoot(t);
  const managedRoot = path.join(root, "current-user-data", "thread-groups");
  const currentFile = path.join(managedRoot, "default", "outputs", "article.html");
  writeFixture(currentFile);
  const stalePath = path.join(
    path.parse(root).root,
    "Users",
    "PreviousUser",
    "AppData",
    "Roaming",
    "haolo_desktop",
    "thread-groups",
    "default",
    "outputs",
    "article.html",
  );

  const result = await resolveExistingLocalPath(stalePath, { managedWorkspacesRoot: managedRoot });

  assert.equal(result.path, currentFile);
  assert.equal(result.recovered, true);
  assert.equal(result.strategy, "managed-workspace-rebase");
});

test("rebases an outputs-relative artifact into the current external workspace", async (t) => {
  const root = temporaryRoot(t);
  const currentWorkspace = path.join(root, "current-project");
  const currentFile = path.join(currentWorkspace, "outputs", "nested", "report.docx");
  writeFixture(currentFile);
  const stalePath = path.join(root, "old-project", "outputs", "nested", "report.docx");

  const result = await resolveExistingLocalPath(stalePath, { cwd: currentWorkspace });

  assert.equal(result.path, currentFile);
  assert.equal(result.recovered, true);
  assert.equal(result.strategy, "current-workspace-rebase");
});

test("uses a unique artifact filename as a bounded legacy fallback", async (t) => {
  const root = temporaryRoot(t);
  const currentWorkspace = path.join(root, "workspace");
  const currentFile = path.join(currentWorkspace, "outputs", "new-layout", "preview.html");
  writeFixture(currentFile);
  const stalePath = path.join(root, "old-workspace", "outputs", "old-layout", "preview.html");

  const result = await resolveExistingLocalPath(stalePath, { cwd: currentWorkspace });

  assert.equal(result.path, currentFile);
  assert.equal(result.strategy, "unique-artifact-name");
});

test("does not guess when more than one artifact has the same filename", async (t) => {
  const root = temporaryRoot(t);
  const currentWorkspace = path.join(root, "workspace");
  writeFixture(path.join(currentWorkspace, "outputs", "one", "preview.html"), "one");
  writeFixture(path.join(currentWorkspace, "outputs", "two", "preview.html"), "two");
  const stalePath = path.join(root, "old-workspace", "outputs", "old-layout", "preview.html");

  await assert.rejects(
    resolveExistingLocalPath(stalePath, { cwd: currentWorkspace }),
    (error) => error?.code === LOCAL_FILE_MISSING_ERROR_CODE && !error.message.includes(stalePath),
  );
});

test("extracts only safe managed and outputs-relative suffixes", () => {
  const value = "C:\\Users\\Old\\AppData\\Roaming\\haolo_desktop\\thread-groups\\default\\outputs\\nested\\report.html";
  assert.equal(managedThreadGroupRelativePath(value), path.join("default", "outputs", "nested", "report.html"));
  assert.equal(outputsRelativePath(value), path.join("nested", "report.html"));
  assert.equal(outputsRelativePath("C:\\workspace\\outputs\\..\\secret.txt"), null);
});
