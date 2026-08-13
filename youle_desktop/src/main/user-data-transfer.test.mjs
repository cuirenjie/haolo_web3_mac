import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createUserDataSnapshot,
  pendingUserDataTransferPath,
  readSnapshotManifest,
  restoreUserDataSnapshot,
  scheduleUserDataExport,
  scheduleUserDataImport,
} from "./user-data-transfer.mjs";

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

test("user data snapshot keeps slim user data and skips runtime caches", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haolo-transfer-test-"));
  try {
    const userData = path.join(root, "userData");
    const external = path.join(root, "external-workspace");
    const snapshot = path.join(root, "snapshot");

    await writeText(path.join(userData, "Network", "Cookies"), "cookie-db");
    await writeText(path.join(userData, "Local Storage", "leveldb", "000003.log"), "local-storage");
    await writeText(path.join(userData, "Cache", "ignored.bin"), "cache");
    await writeText(path.join(userData, "thread-groups", "default", "haolo-ai-home", "sessions", "session.jsonl"), "session");
    await writeText(path.join(userData, "thread-groups", "default", "haolo-ai-home", "archived_sessions", "old.jsonl"), "old-session");
    await writeText(path.join(userData, "thread-groups", "default", "haolo-ai-home", "skills", "skill.md"), "skill");
    await writeText(path.join(userData, "thread-groups", "default", "haolo-ai-home", "memories_1.sqlite"), "memory");
    await writeText(path.join(userData, "thread-groups", "default", "haolo-ai-home", "state_5.sqlite-wal"), "state");
    await writeText(path.join(userData, "thread-groups", "default", "haolo-ai-home", "goals_1.sqlite-shm"), "goals");
    await writeText(path.join(userData, "thread-groups", "default", "haolo-ai-home", "logs_2.sqlite"), "logs");
    await writeText(path.join(userData, "thread-groups", "default", "haolo-ai-home", "plugins", "cache", "tool.exe"), "plugin-cache");
    await writeText(path.join(userData, "thread-groups", "default", "haolo-ai-home", "runtime-home", "cache.db"), "runtime-cache");
    await writeText(path.join(userData, "thread-groups", "default", "haolo-ai-home", ".tmp", "repo", ".git", "objects", "pack"), "tmp-cache");
    await writeText(path.join(userData, "thread-groups", "default", "outputs", "result.txt"), "result");
    await writeText(path.join(userData, "thread-groups", "default", "Microsoft", "Windows", "ignored.log"), "office-cache");
    await writeText(path.join(userData, "automation", "automation-store.json"), "jobs");
    await writeText(path.join(userData, "automation", "locks", "automation-worker.lock", "owner.json"), "lock");
    await writeText(path.join(userData, "default-haolo-ai", "auth.json"), "auth");
    await writeText(path.join(userData, "default-haolo-ai", "cache.bin"), "auth-cache");
    await writeText(path.join(external, "haolo-ai-home", "sessions", "external.jsonl"), "external-session");
    await writeText(path.join(external, "haolo-ai-home", "logs_2.sqlite"), "external-logs");
    await writeText(path.join(external, "haolo-ai-home", "plugins", "cache", "tool.exe"), "external-plugin-cache");
    await writeText(path.join(external, "outputs", "external-result.txt"), "external-result");

    await createUserDataSnapshot({
      destinationRoot: snapshot,
      userDataPath: userData,
      externalWorkspaces: [{ cwd: external, groupId: "external" }],
      productName: "haolo_desktop",
      appVersion: "test",
    });

    const manifest = await readSnapshotManifest(snapshot);
    assert.equal(manifest.format, "haolo-user-data-snapshot");
    assert.equal(manifest.data.externalWorkspaces.length, 1);
    await assert.doesNotReject(fs.access(path.join(snapshot, "data", "userData", "thread-groups", "default", "outputs", "result.txt")));
    await assert.doesNotReject(fs.access(path.join(snapshot, "data", "userData", "thread-groups", "default", "haolo-ai-home", "sessions", "session.jsonl")));
    await assert.doesNotReject(fs.access(path.join(snapshot, "data", "userData", "thread-groups", "default", "haolo-ai-home", "skills", "skill.md")));
    await assert.doesNotReject(fs.access(path.join(snapshot, "data", "userData", "thread-groups", "default", "haolo-ai-home", "memories_1.sqlite")));
    await assert.doesNotReject(fs.access(path.join(snapshot, "data", "userData", "thread-groups", "default", "haolo-ai-home", "state_5.sqlite-wal")));
    await assert.doesNotReject(fs.access(path.join(snapshot, "data", "userData", "automation", "automation-store.json")));
    await assert.doesNotReject(fs.access(path.join(snapshot, "data", "userData", "default-haolo-ai", "auth.json")));
    await assert.doesNotReject(fs.access(path.join(snapshot, "data", "external-workspaces", manifest.data.externalWorkspaces[0].id, "outputs", "external-result.txt")));
    await assert.doesNotReject(fs.access(path.join(snapshot, "data", "external-workspaces", manifest.data.externalWorkspaces[0].id, "haolo-ai-home", "sessions", "external.jsonl")));
    await assert.rejects(fs.access(path.join(snapshot, "data", "userData", "Cache", "ignored.bin")));
    await assert.rejects(fs.access(path.join(snapshot, "data", "userData", "Network", "Cookies")));
    await assert.rejects(fs.access(path.join(snapshot, "data", "userData", "thread-groups", "default", "haolo-ai-home", "logs_2.sqlite")));
    await assert.rejects(fs.access(path.join(snapshot, "data", "userData", "thread-groups", "default", "haolo-ai-home", "plugins", "cache", "tool.exe")));
    await assert.rejects(fs.access(path.join(snapshot, "data", "userData", "thread-groups", "default", "haolo-ai-home", "runtime-home", "cache.db")));
    await assert.rejects(fs.access(path.join(snapshot, "data", "userData", "thread-groups", "default", "haolo-ai-home", ".tmp", "repo", ".git", "objects", "pack")));
    await assert.rejects(fs.access(path.join(snapshot, "data", "userData", "thread-groups", "default", "Microsoft", "Windows", "ignored.log")));
    await assert.rejects(fs.access(path.join(snapshot, "data", "userData", "automation", "locks", "automation-worker.lock", "owner.json")));
    await assert.rejects(fs.access(path.join(snapshot, "data", "userData", "default-haolo-ai", "cache.bin")));
    await assert.rejects(fs.access(path.join(snapshot, "data", "external-workspaces", manifest.data.externalWorkspaces[0].id, "haolo-ai-home", "logs_2.sqlite")));
    await assert.rejects(fs.access(path.join(snapshot, "data", "external-workspaces", manifest.data.externalWorkspaces[0].id, "haolo-ai-home", "plugins", "cache", "tool.exe")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("export copies user data immediately without scheduling a relaunch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haolo-transfer-export-"));
  try {
    const appData = path.join(root, "appData");
    const userData = path.join(root, "userData");
    const destinationParent = path.join(root, "exports");
    await writeText(path.join(userData, "Local State"), "state");

    const app = {
      getPath(name) {
        if (name === "appData") return appData;
        if (name === "userData") return userData;
        throw new Error(`unexpected path name: ${name}`);
      },
    };
    const dialog = {
      async showOpenDialog() {
        return { canceled: false, filePaths: [destinationParent] };
      },
    };

    const result = await scheduleUserDataExport({
      app,
      dialog,
      productName: "haolo_desktop",
      appVersion: "test",
    });

    assert.equal(result.ok, true);
    assert.equal(result.operation, "export");
    assert.equal(result.requiresRelaunch, undefined);
    assert.equal(path.extname(result.exportPath), ".zip");
    await assert.doesNotReject(fs.access(result.exportPath));
    await assert.rejects(fs.access(pendingUserDataTransferPath(app, "haolo_desktop")));

    let importOpenDialogOptions = null;
    const importDialog = {
      async showOpenDialog(_window, options) {
        importOpenDialogOptions = options;
        return { canceled: false, filePaths: [result.exportPath] };
      },
    };
    let importConfirmationOptions = null;
    const importResult = await scheduleUserDataImport({
      app,
      dialog: importDialog,
      productName: "haolo_desktop",
      appVersion: "test",
      async requestConfirmation(options) {
        importConfirmationOptions = options;
        return true;
      },
    });

    assert.equal(importResult.ok, true);
    assert.equal(importResult.operation, "import");
    assert.equal(importResult.requiresRelaunch, true);
    assert.equal(importOpenDialogOptions.title, "选择用户数据备份 ZIP 文件");
    assert.deepEqual(importOpenDialogOptions.properties, ["openFile"]);
    assert.deepEqual(importOpenDialogOptions.filters, [{ name: "Haolo 用户数据备份 ZIP", extensions: ["zip"] }]);
    assert.equal(importConfirmationOptions.title, "导入用户数据");
    assert.equal(importConfirmationOptions.tone, "danger");
    const pending = JSON.parse(await fs.readFile(pendingUserDataTransferPath(app, "haolo_desktop"), "utf8"));
    assert.equal(pending.sourceRoot, result.exportPath);
    await assert.doesNotReject(fs.access(path.join(pending.stagingRoot, "data", "userData", "Local State")));
    const stagedManifest = await readSnapshotManifest(pending.stagingRoot);
    assert.equal(stagedManifest.format, "haolo-user-data-snapshot");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("restore replaces app data and only managed external workspace directories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haolo-transfer-restore-"));
  try {
    const userData = path.join(root, "userData");
    const external = path.join(root, "external-workspace");
    const snapshot = path.join(root, "snapshot");

    await writeText(path.join(userData, "Local State"), "original-state");
    await writeText(path.join(userData, "Cache", "ignored.bin"), "cache");
    await writeText(path.join(external, "haolo-ai-home", "sessions", "external.jsonl"), "original-external-session");
    await writeText(path.join(external, "outputs", "external-result.txt"), "original-external-result");
    await writeText(path.join(external, "keep.txt"), "user-file");

    await createUserDataSnapshot({
      destinationRoot: snapshot,
      userDataPath: userData,
      externalWorkspaces: [{ cwd: external, groupId: "external" }],
      productName: "haolo_desktop",
      appVersion: "test",
    });

    await writeText(path.join(userData, "Local State"), "mutated-state");
    await writeText(path.join(userData, "new-current-only.txt"), "current");
    await writeText(path.join(external, "haolo-ai-home", "sessions", "external.jsonl"), "mutated-external-session");
    await writeText(path.join(external, "outputs", "current-only.txt"), "current-output");

    await restoreUserDataSnapshot({ snapshotRoot: snapshot, userDataPath: userData });

    assert.equal(await fs.readFile(path.join(userData, "Local State"), "utf8"), "original-state");
    await assert.rejects(fs.access(path.join(userData, "new-current-only.txt")));
    await assert.rejects(fs.access(path.join(userData, "Cache", "ignored.bin")));
    assert.equal(await fs.readFile(path.join(external, "haolo-ai-home", "sessions", "external.jsonl"), "utf8"), "original-external-session");
    await assert.rejects(fs.access(path.join(external, "outputs", "current-only.txt")));
    assert.equal(await fs.readFile(path.join(external, "keep.txt"), "utf8"), "user-file");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
