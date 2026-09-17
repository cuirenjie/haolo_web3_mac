import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const runtimeNames = new Set([
  "APP_UPDATE_CHECK_INTERVAL_MS", "appUpdateCheckTimer", "appUpdateCheckInFlight",
  "startAppUpdateChecks", "stopAppUpdateChecks", "checkForWindowsUpdate", "closeUpdateDialog",
  "renderUpdateDialog",
]);
const runtime = ts.transpileModule(parsed.statements.filter((statement) => (
  ts.isFunctionDeclaration(statement) && runtimeNames.has(statement.name?.text)
) || (
  ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some((declaration) => runtimeNames.has(declaration.name.getText(parsed)))
)).map((statement) => statement.getText(parsed)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

const FOUR_HOURS = 4 * 60 * 60 * 1000;
const availableUpdate = {
  update_available: true,
  force_update: true,
  latest: { version: "0.1.170", release_notes: "更新说明" },
  download: { url: "https://example.test/update.exe", size_bytes: 1024 },
};

function harness(t, check = async () => ({ update_available: false })) {
  const update = {
    checking: false, downloading: false, downloadProgress: null,
    dialogOpen: false, result: null, error: null,
  };
  const context = {
    APP_VERSION: "0.1.169",
    state: { settings: { update } },
    api: { checkWindowsUpdate: check === null ? undefined : t.mock.fn(check) },
    window: {
      setInterval: (...args) => setInterval(...args),
      clearInterval: (timer) => clearInterval(timer),
    },
    render: t.mock.fn(),
    showToast: t.mock.fn(),
    escapeHtml: String,
    escapeAttr: String,
    formatFileSize: (bytes) => `${bytes} B`,
  };
  runInNewContext(runtime, context);
  t.after(() => context.stopAppUpdateChecks());
  return { context, update, check: context.api.checkWindowsUpdate };
}

test("login starts one silent check and repeats exactly every four hours", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { context, update, check } = harness(t);
  context.startAppUpdateChecks();
  context.startAppUpdateChecks();
  await setImmediate();
  assert.equal(check.mock.callCount(), 1);
  assert.equal(check.mock.calls[0].arguments[0].version, "0.1.169");
  t.mock.timers.tick(FOUR_HOURS - 1);
  assert.equal(check.mock.callCount(), 1);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(check.mock.callCount(), 2);
  t.mock.timers.tick(FOUR_HOURS);
  await setImmediate();
  assert.equal(check.mock.callCount(), 3);
  assert.equal(update.checking, false);
  assert.equal(context.render.mock.callCount(), 0);
  assert.equal(context.showToast.mock.callCount(), 0);

  context.stopAppUpdateChecks();
  context.stopAppUpdateChecks();
  t.mock.timers.tick(FOUR_HOURS);
  assert.equal(check.mock.callCount(), 3);
  context.startAppUpdateChecks();
  await setImmediate();
  assert.equal(check.mock.callCount(), 4);
});

test("authentication changes and renderer teardown own the timer lifecycle", () => {
  const auth = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "applyAuthSession").getText(parsed);
  assert.match(auth, /if \(state\.auth\.authenticated\) \{\s*startAppUpdateChecks\(\)/);
  assert.match(auth, /else \{\s*stopAppUpdateChecks\(\)/);
  assert.match(source, /window\.addEventListener\("beforeunload", \(\) => \{\s*stopAppUpdateChecks\(\)/);
});

for (const [label, response] of [
  ["no newer version", { update_available: false }],
  ["incomplete update metadata", { update_available: true, latest: { version: "0.1.170" } }],
  ["invalid response", null],
  ["request failure", new Error("HTTP 503")],
]) {
  test(`${label} stays silent without rendering or publishing an error`, async (t) => {
    const { context, update } = harness(t, async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    await context.checkForWindowsUpdate({ silent: true });
    assert.equal(update.checking, false);
    assert.equal(update.dialogOpen, false);
    assert.equal(update.error, null);
    assert.equal(update.result, null);
    assert.equal(context.render.mock.callCount(), 0);
    assert.equal(context.showToast.mock.callCount(), 0);
  });
}

test("failed scheduled checks recover at the next four-hour interval", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let attempts = 0;
  const { context, update } = harness(t, async () => {
    if (++attempts === 1) throw new Error("offline");
    return availableUpdate;
  });
  context.startAppUpdateChecks();
  await setImmediate();
  assert.equal(update.error, null);
  t.mock.timers.tick(FOUR_HOURS);
  await setImmediate();
  assert.equal(attempts, 2);
  assert.equal(update.dialogOpen, true);
  assert.equal(update.result.force_update, true);
  assert.equal(context.render.mock.callCount(), 1);
  assert.equal(context.showToast.mock.callCount(), 0);
  assert.match(context.renderUpdateDialog(), /发现必须更新版本/);
  assert.match(context.renderUpdateDialog(), /data-action="quit-app"/);
  assert.match(context.renderUpdateDialog(), /data-action="download-update"/);
  assert.doesNotMatch(context.renderUpdateDialog(), /close-update-dialog|稍后再说/);
  context.closeUpdateDialog();
  assert.equal(update.dialogOpen, true);
});

test("a background request stays invisible and blocks overlapping checks", async (t) => {
  let resolve;
  const { context, update, check } = harness(t, () => new Promise((done) => { resolve = done; }));
  const pending = context.checkForWindowsUpdate({ silent: true });
  assert.equal(update.checking, false);
  await context.checkForWindowsUpdate();
  await context.checkForWindowsUpdate({ silent: true });
  assert.equal(check.mock.callCount(), 1);
  assert.equal(context.render.mock.callCount(), 0);
  resolve({ update_available: false });
  await pending;
  check.mock.mockImplementation(async () => ({ update_available: false }));
  await context.checkForWindowsUpdate({ silent: true });
  assert.equal(check.mock.callCount(), 2);
});

test("checks never reset an open mandatory update or an active download", async (t) => {
  const { context, update, check } = harness(t);
  update.result = availableUpdate;
  update.downloadProgress = { downloadedBytes: 512, totalBytes: 1024, percent: 50 };
  update.error = "Previous download failure";
  const snapshot = structuredClone(update);
  for (const state of [{ dialogOpen: true, downloading: false }, { dialogOpen: false, downloading: true }]) {
    Object.assign(update, state);
    await context.checkForWindowsUpdate({ silent: true });
    await context.checkForWindowsUpdate();
    assert.deepEqual(update, { ...snapshot, ...state });
  }
  assert.equal(check.mock.callCount(), 0);
  assert.equal(context.render.mock.callCount(), 0);
});

test("manual checks also suppress no-update and request-failure messages", async (t) => {
  for (const fail of [false, true]) {
    const { context, update } = harness(t, async () => {
      if (fail) throw new Error("offline");
      return { update_available: false };
    });
    const pending = context.checkForWindowsUpdate();
    assert.equal(update.checking, true);
    await pending;
    assert.equal(update.checking, false);
    assert.equal(update.error, null);
    assert.equal(update.dialogOpen, false);
    assert.equal(context.showToast.mock.callCount(), 0);
    assert.equal(context.render.mock.callCount(), 2);
  }
});

test("missing updater support is silent", async (t) => {
  const { context } = harness(t, null);
  context.startAppUpdateChecks();
  await context.checkForWindowsUpdate();
  assert.equal(context.render.mock.callCount(), 0);
  assert.equal(context.showToast.mock.callCount(), 0);
});

// macOS and optional server releases must remain dismissible.
test("optional updates preserve the server policy and can be dismissed", async (t) => {
  const { context, update } = harness(t, async () => ({ ...availableUpdate, force_update: false }));
  await context.checkForWindowsUpdate({ silent: true });
  assert.equal(update.dialogOpen, true);
  assert.equal(update.result.force_update, false);
  assert.match(context.renderUpdateDialog(), /close-update-dialog/);
  context.closeUpdateDialog();
  assert.equal(update.dialogOpen, false);
});
