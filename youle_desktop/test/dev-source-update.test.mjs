import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEV_SOURCE_UPDATED_MESSAGE,
  DEV_UPDATE_PROMPT_READY_MESSAGE,
  installDevelopmentSourceUpdatePrompt,
  isManualDevelopmentRestartEnabled,
} from "../src/main/dev-source-update.mjs";
import {
  changedDevelopmentSourceFiles,
  snapshotDevelopmentSources,
  watchDevelopmentSources,
} from "../scripts/dev-source-watcher.mjs";

const developmentEnv = {
  HAOLO_DESKTOP_MANUAL_RESTART: "1",
  HAOLO_DESKTOP_DEV_SERVER_URL: "http://127.0.0.1:5177",
};

test("manual source restart prompt is enabled only for a default Electron dev client", () => {
  assert.equal(
    isManualDevelopmentRestartEnabled({
      env: developmentEnv,
      isPackaged: false,
    }),
    true,
  );
  assert.equal(
    isManualDevelopmentRestartEnabled({
      env: developmentEnv,
      isPackaged: true,
      isDefaultApp: true,
    }),
    true,
  );
  assert.equal(
    isManualDevelopmentRestartEnabled({
      env: developmentEnv,
      isPackaged: true,
      isDefaultApp: false,
    }),
    false,
  );
  assert.equal(
    isManualDevelopmentRestartEnabled({
      env: { HAOLO_DESKTOP_DEV_SERVER_URL: "http://127.0.0.1:5177" },
      isPackaged: false,
    }),
    false,
  );
  assert.equal(
    isManualDevelopmentRestartEnabled({
      env: { HAOLO_DESKTOP_MANUAL_RESTART: "1" },
      isPackaged: false,
    }),
    false,
  );
});

test("source snapshots ignore duplicate watch events when file contents did not change", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "haolo-dev-watch-"),
  );
  try {
    await mkdir(path.join(temporaryRoot, "main"), { recursive: true });
    const sourcePath = path.join(temporaryRoot, "main", "entry.mjs");
    await writeFile(sourcePath, "export const value = 1;\n", "utf8");
    const before = await snapshotDevelopmentSources(temporaryRoot);

    await writeFile(sourcePath, "export const value = 1;\n", "utf8");
    const duplicateEvent = await snapshotDevelopmentSources(temporaryRoot);
    assert.deepEqual(changedDevelopmentSourceFiles(before, duplicateEvent), []);

    await writeFile(sourcePath, "export const value = 2;\n", "utf8");
    const updated = await snapshotDevelopmentSources(temporaryRoot);
    assert.deepEqual(changedDevelopmentSourceFiles(duplicateEvent, updated), [
      "main/entry.mjs",
    ]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("development source watcher reports a settled content update once", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "haolo-dev-watch-live-"),
  );
  let watcher;
  try {
    const sourcePath = path.join(temporaryRoot, "main.ts");
    await writeFile(sourcePath, "export const value = 1;\n", "utf8");
    const update = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("source watcher did not report the update")),
        3000,
      );
      watcher = watchDevelopmentSources(
        temporaryRoot,
        (changedFiles) => {
          clearTimeout(timeout);
          resolve(changedFiles);
        },
        { debounceMs: 60, onError: reject },
      );
    });
    watcher = await watcher;
    await writeFile(sourcePath, "export const value = 2;\n", "utf8");
    assert.deepEqual(await update, ["main.ts"]);
  } finally {
    watcher?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("development update prompt restarts only after explicit approval", async () => {
  const messageTarget = new EventEmitter();
  const launcherMessages = [];
  messageTarget.send = (message, callback) => {
    launcherMessages.push(message);
    callback?.();
  };
  const prompts = [];
  let quitCount = 0;
  const installation = installDevelopmentSourceUpdatePrompt({
    app: {
      isPackaged: false,
      quit() {
        quitCount += 1;
      },
    },
    async requestConfirmation(options) {
      prompts.push(options);
      return true;
    },
    env: developmentEnv,
    messageTarget,
    requestRestart: async () => true,
  });

  messageTarget.emit("message", {
    type: DEV_SOURCE_UPDATED_MESSAGE,
    changedFiles: ["main/main.mjs"],
  });
  await waitFor(() => quitCount === 1);

  assert.equal(installation.enabled, true);
  assert.equal(launcherMessages[0]?.type, DEV_UPDATE_PROMPT_READY_MESSAGE);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].message, /是否重启开发客户端/);
  assert.match(prompts[0].detail, /main\/main\.mjs/);
  installation.dispose();
});

test("branded default Electron apps install the development update listener", () => {
  const messageTarget = new EventEmitter();
  messageTarget.defaultApp = true;
  const launcherMessages = [];
  messageTarget.send = (message, callback) => {
    launcherMessages.push(message);
    callback?.();
  };

  const installation = installDevelopmentSourceUpdatePrompt({
    app: { isPackaged: true },
    env: developmentEnv,
    messageTarget,
  });

  assert.equal(installation.enabled, true);
  assert.equal(messageTarget.listenerCount("message"), 1);
  assert.equal(launcherMessages[0]?.type, DEV_UPDATE_PROMPT_READY_MESSAGE);
  installation.dispose();
});

test("choosing later preserves the running development client", async () => {
  const messageTarget = new EventEmitter();
  let promptCount = 0;
  let quitCount = 0;
  let restartRequestCount = 0;
  const installation = installDevelopmentSourceUpdatePrompt({
    app: {
      isPackaged: false,
      quit() {
        quitCount += 1;
      },
    },
    async requestConfirmation() {
      promptCount += 1;
      return false;
    },
    env: developmentEnv,
    messageTarget,
    requestRestart: async () => {
      restartRequestCount += 1;
      return true;
    },
  });

  messageTarget.emit("message", {
    type: DEV_SOURCE_UPDATED_MESSAGE,
    changedFiles: ["renderer/main.ts"],
  });
  await waitFor(() => promptCount === 1);

  assert.equal(restartRequestCount, 0);
  assert.equal(quitCount, 0);
  installation.dispose();
});

test("packaged clients do not install a development update listener", () => {
  const messageTarget = new EventEmitter();
  const installation = installDevelopmentSourceUpdatePrompt({
    app: { isPackaged: true },
    env: developmentEnv,
    messageTarget,
  });
  assert.equal(installation.enabled, false);
  assert.equal(messageTarget.listenerCount("message"), 0);
});

test("manual development mode disables Vite HMR and the old automatic restart watcher", async () => {
  const viteConfig = await readFile(
    new URL("../vite.config.mjs", import.meta.url),
    "utf8",
  );
  const devScript = await readFile(
    new URL("../scripts/dev.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    viteConfig,
    /hmr:\s*manualDevelopmentRestart\s*\?\s*false\s*:\s*undefined/,
  );
  assert.match(devScript, /watchDevelopmentSources/);
  assert.match(devScript, /DEV_SOURCE_UPDATED_MESSAGE/);
  assert.match(devScript, /HAOLO_TRADING_ALERTS_ENABLED:\s*process\.env\.HAOLO_TRADING_ALERTS_ENABLED\s*\|\|\s*"1"/);
  assert.doesNotMatch(devScript, /src\/main changed; restarting Electron/);
  assert.doesNotMatch(devScript, /function watchMainProcessFiles/);
});

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("timed out waiting for asynchronous condition");
}
