import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { fetchServiceJson } from "../src/main/haolo-service-fetch.mjs";

// Execute the production updater and its normalizers without starting Electron.
const source = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = ["checkAppUpdate", "currentUpdateTarget", "macUpdateRequestArchitectures", "updateUserAgent",
  "normalizeAppUpdateResponse", "normalizeAppUpdateDownload", "normalizeAppVersion", "updateErrorMessage"];
const declarations = names.map((name) => {
  const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `Production function ${name} exists`);
  return node.getText(ast);
}).join("\n");
const variant = "haolo_windows_web3";
const available = { client_variant: variant, update_available: true, force_update: true,
  latest: { version: "0.1.168" }, download: { url: "https://assets.example.test/update.dmg", sha256: "test-hash" } };

function updater({ platform = "darwin", arch = "arm64", requestedArch = "universal", timeoutMs = 1000,
  respond = () => Response.json(available) } = {}) {
  const calls = [];
  const check = runInNewContext(`${declarations}\ncheckAppUpdate`, {
    URL, process: { platform, arch }, app: { getVersion: () => "0.1.167" }, fetchServiceJson,
    MAC_UPDATE_BASE_URL: "https://haolo.com", MAC_UPDATE_CHECK_PATH: "/api/app-updates/mac/check",
    MAC_UPDATE_ARCH: requestedArch, MAC_UPDATE_CLIENT_VARIANT: variant,
    WINDOWS_UPDATE_BASE_URL: "https://haolo.com", WINDOWS_UPDATE_CHECK_PATH: "/api/app-updates/windows/check",
    WINDOWS_UPDATE_CLIENT_VARIANT: variant, WINDOWS_UPDATE_TIMEOUT_MS: timeoutMs,
    haoloServiceFetch: async (value, init) => {
      const url = new URL(value);
      calls.push({ url, init });
      assert.equal(init.method, "GET");
      assert.equal(init.cache, "no-store");
      assert.equal(init.headers.Accept, "application/json");
      assert.equal(url.searchParams.get("client_variant"), variant);
      assert.equal(url.searchParams.get("version"), "0.1.167");
      return respond(url, init, calls.length);
    },
  });
  return { check, calls };
}

test("Mac updater falls back from universal to Apple Silicon through service transport", async () => {
  const { check, calls } = updater({ respond: (url) => Response.json(url.searchParams.get("arch") === "arm64"
    ? available : { client_variant: variant, update_available: false }) });
  const result = await check();
  assert.deepEqual(calls.map(({ url }) => url.searchParams.get("arch")), ["universal", "arm64"]);
  assert.equal(calls[0].url.pathname, "/api/app-updates/mac/check");
  assert.equal(calls[0].init.headers["User-Agent"], "haolo_desktop/0.1.167 (mac)");
  assert.equal(result.update_available, true);
  assert.equal(result.force_update, true);
  assert.equal(result.download.sha256, "test-hash");
});

test("Intel Mac updater tries configured architecture, runtime architecture and universal once each", async () => {
  const { check, calls } = updater({ arch: "x64", requestedArch: "arm64", respond: (url) => Response.json(
    url.searchParams.get("arch") === "universal" ? available : { client_variant: variant, update_available: false }) });
  assert.equal((await check()).update_available, true);
  assert.deepEqual(calls.map(({ url }) => url.searchParams.get("arch")), ["arm64", "x64", "universal"]);
});

test("Mac updater stops at an available architecture and keeps the server force-update decision", async () => {
  const { check, calls } = updater({ respond: () => Response.json({ ...available, force_update: false }) });
  const result = await check();
  assert.equal(calls.length, 1);
  assert.equal(result.latest.version, "0.1.168");
  assert.equal(result.force_update, false);
});

test("Mac updater rejects a different client channel before trying another architecture", async () => {
  const { check, calls } = updater({ respond: () => Response.json({ ...available, client_variant: "legacy-client" }) });
  const result = await check();
  assert.equal(calls.length, 1);
  assert.equal(result.update_available, false);
  assert.equal(result.force_update, false);
  assert.equal(result.download, null);
  assert.equal(result.client_variant, variant);
});

test("update service HTTP failures preserve the error instead of triggering architecture fallback", async () => {
  const { check, calls } = updater({ respond: () => Response.json({ detail: "maintenance" }, { status: 503 }) });
  await assert.rejects(check(), { message: "maintenance" });
  assert.equal(calls.length, 1);
});

test("Mac updater deadline includes a stalled JSON body and cancels the service request", async () => {
  const { check, calls } = updater({ timeoutMs: 10, respond: () => ({ ok: true, json: () => new Promise(() => {}) }) });
  await assert.rejects(check(), { name: "AbortError" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.signal.aborted, true);
});

test("Windows updater keeps its endpoint and does not add a Mac architecture", async () => {
  const { check, calls } = updater({ platform: "win32", arch: "x64" });
  assert.equal((await check()).platform, "windows");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/api/app-updates/windows/check");
  assert.equal(calls[0].url.searchParams.has("arch"), false);
  assert.equal(calls[0].init.headers["User-Agent"], "haolo_desktop/0.1.167");
});

test("Mac updater returns no update after exhausting unique architectures", async () => {
  const { check, calls } = updater({ requestedArch: "arm64",
    respond: () => Response.json({ client_variant: variant, update_available: false }) });
  const result = await check();
  assert.equal(result.update_available, false);
  assert.equal(result.download, null);
  assert.deepEqual(calls.map(({ url }) => url.searchParams.get("arch")), ["arm64", "universal"]);
});
