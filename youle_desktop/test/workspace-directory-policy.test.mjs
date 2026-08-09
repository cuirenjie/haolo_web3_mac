import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WORKSPACE_UNAVAILABLE_ERROR_CODE,
  ensureWorkspaceDirectory,
  isPathInsideOrSame,
  workspaceCodexHomePath,
  workspaceDirectoryStatus,
} from "../src/main/workspace-directory-policy.mjs";

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-workspace-policy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("managed thread-group workspaces are still created automatically", (t) => {
  const root = temporaryDirectory(t);
  const managedRoot = path.join(root, "thread-groups");
  const workspace = path.join(managedRoot, "default");

  const status = ensureWorkspaceDirectory(workspace, managedRoot);

  assert.equal(status.available, true);
  assert.equal(status.created, true);
  assert.equal(fs.statSync(workspace).isDirectory(), true);
});

test("missing external workspaces are rejected without recreating their path", (t) => {
  const root = temporaryDirectory(t);
  const managedRoot = path.join(root, "thread-groups");
  const workspace = path.join(root, "锟斤拷锟斤拷-haolo-ai-home");

  assert.throws(
    () => ensureWorkspaceDirectory(workspace, managedRoot),
    (error) => error?.code === WORKSPACE_UNAVAILABLE_ERROR_CODE && error?.reason === "missing",
  );
  assert.equal(fs.existsSync(workspace), false);
});

test("existing external workspaces keep working", (t) => {
  const root = temporaryDirectory(t);
  const managedRoot = path.join(root, "thread-groups");
  const workspace = path.join(root, "external-workspace");
  fs.mkdirSync(workspace);

  const status = ensureWorkspaceDirectory(workspace, managedRoot);

  assert.equal(status.available, true);
  assert.equal(status.managed, false);
  assert.equal(status.created, undefined);
});

test("managed-root prefix siblings are not treated as managed", (t) => {
  const root = temporaryDirectory(t);
  const managedRoot = path.join(root, "thread-groups");
  const sibling = path.join(root, "thread-groups-old", "missing");

  assert.equal(isPathInsideOrSame(managedRoot, sibling), false);
  assert.equal(workspaceDirectoryStatus(sibling, managedRoot).managed, false);
  assert.throws(
    () => ensureWorkspaceDirectory(sibling, managedRoot),
    (error) => error?.code === WORKSPACE_UNAVAILABLE_ERROR_CODE,
  );
  assert.equal(fs.existsSync(sibling), false);
});

test("a desktop workspace keeps a new Codex home inside the managed app-data root", (t) => {
  const root = temporaryDirectory(t);
  const managedRoot = path.join(root, "app-data", "thread-groups");
  const desktopWorkspace = path.join(root, "Desktop");
  fs.mkdirSync(desktopWorkspace);

  const codexHome = workspaceCodexHomePath(desktopWorkspace, {
    managedRoot,
    externalHomeRoot: managedRoot,
  });
  fs.mkdirSync(codexHome, { recursive: true });

  assert.equal(isPathInsideOrSame(managedRoot, codexHome), true);
  assert.equal(fs.existsSync(path.join(desktopWorkspace, "haolo-ai-home")), false);
  assert.equal(
    codexHome,
    workspaceCodexHomePath(desktopWorkspace, { managedRoot, externalHomeRoot: managedRoot }),
  );
});

test("managed and existing legacy workspace homes keep their current locations", (t) => {
  const root = temporaryDirectory(t);
  const managedRoot = path.join(root, "app-data", "thread-groups");
  const managedWorkspace = path.join(managedRoot, "default");
  const externalWorkspace = path.join(root, "existing-project");
  const legacyExternalHome = path.join(externalWorkspace, "haolo-ai-home");
  fs.mkdirSync(managedWorkspace, { recursive: true });
  fs.mkdirSync(legacyExternalHome, { recursive: true });

  assert.equal(
    workspaceCodexHomePath(managedWorkspace, { managedRoot, externalHomeRoot: managedRoot }),
    path.join(managedWorkspace, "haolo-ai-home"),
  );
  assert.equal(
    workspaceCodexHomePath(externalWorkspace, { managedRoot, externalHomeRoot: managedRoot }),
    legacyExternalHome,
  );
});

test("an existing legacy home under a Unicode external workspace uses the isolated managed home", (t) => {
  const root = temporaryDirectory(t);
  const managedRoot = path.join(root, "app-data", "thread-groups");
  const externalWorkspace = path.join(root, "珍珠棉深加工对账单");
  const legacyExternalHome = path.join(externalWorkspace, "haolo-ai-home");
  fs.mkdirSync(legacyExternalHome, { recursive: true });

  const codexHome = workspaceCodexHomePath(externalWorkspace, {
    managedRoot,
    externalHomeRoot: managedRoot,
  });

  assert.equal(isPathInsideOrSame(managedRoot, codexHome), true);
  assert.notEqual(codexHome, legacyExternalHome);
  assert.match(path.basename(path.dirname(codexHome)), /^\.external-home-[0-9a-f]{24}$/);
});

test("main-process workspace entry points share the guarded directory policy", () => {
  const source = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const rendererSource = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

  assert.match(source, /function workspaceCodexHome[\s\S]*?workspaceCodexHomePath\(cwd \|\| desktopWorkspace\(\)/);
  assert.match(source, /function getClientForCwd[\s\S]*?ensureThreadGroupWorkspaceDirectory\(workspace\);[\s\S]*?const existing = appServerClients\.get/);
  assert.match(source, /legacyHomes: \[colocatedCodexHome\],[\s\S]*?targetHome: codexHome/);
  assert.match(source, /function getClientForThread[\s\S]*?ensureThreadGroupWorkspaceDirectory\(serverClient\.__youleWorkspaceCwd \|\| fallbackCwd\);/);
  assert.match(source, /async function localPluginRuntimeContext[\s\S]*?ensureThreadGroupWorkspaceDirectory\(cwd\);/);
  assert.match(source, /async function openThreadGroupFolder[\s\S]*?ensureThreadGroupWorkspaceDirectory\(folderPath\);/);
  assert.doesNotMatch(source, /fs\.mkdirSync\((?:cwd|workspace), \{ recursive: true \}\)/);
  assert.match(rendererSource, /await refreshSkills\(\{\s*cwd: workspaceForGroupId\(groupIdForThreadContext\(state\.currentThreadId\)\),\s*forceReload: true,\s*reason: "startup"/);
});
