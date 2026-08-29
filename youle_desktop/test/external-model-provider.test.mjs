import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ExternalModelCredentialStore } from "../src/main/external-agent/credential-store.mjs";
import {
  EXTERNAL_MODEL_PROVIDER_IDS,
  getExternalModelProvider,
  normalizeExternalModelProviderId,
} from "../src/main/external-agent/provider-registry.mjs";
import {
  ExternalModelService,
  buildConnectionTestRequest,
} from "../src/main/external-agent/service.mjs";
import { createUserDataSnapshot, restoreUserDataSnapshot } from "../src/main/user-data-transfer.mjs";

const SECRET = "sk-test-super-secret-never-write-plaintext";

test("registry exposes exactly eight canonical providers and stable aliases", () => {
  assert.deepEqual(EXTERNAL_MODEL_PROVIDER_IDS, [
    "openai",
    "anthropic",
    "moonshot",
    "deepseek",
    "google",
    "perplexity",
    "xai",
    "xiaomi",
  ]);
  assert.equal(normalizeExternalModelProviderId("GPT"), "openai");
  assert.equal(normalizeExternalModelProviderId("Claude"), "anthropic");
  assert.equal(normalizeExternalModelProviderId("Kimi"), "moonshot");
  assert.equal(normalizeExternalModelProviderId("Gemini"), "google");
  assert.equal(normalizeExternalModelProviderId("Grok"), "xai");
  assert.equal(normalizeExternalModelProviderId("MiMo"), "xiaomi");
  assert.deepEqual(
    getExternalModelProvider("xiaomi").baseUrlOptions.map((option) => option.id),
    ["payg", "token-plan-cn", "token-plan-sgp", "token-plan-ams"],
  );
  for (const id of EXTERNAL_MODEL_PROVIDER_IDS) {
    const provider = getExternalModelProvider(id);
    assert.ok(provider.defaultModel);
    assert.ok(provider.baseUrlOptions[0].baseUrl.startsWith("https://"));
    assert.equal(provider.capabilities.toolsEnabled, false);
    assert.equal(provider.capabilities.writeAccess, false);
  }
});

test("credential store encrypts keys and never returns them in public status", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-provider-vault-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const storagePath = path.join(root, "external-model-credentials.json");
  const store = new ExternalModelCredentialStore({ storagePath, safeStorage: fakeSafeStorage() });

  const saved = await store.upsert({
    provider: "kimi",
    apiKey: SECRET,
    model: "kimi-k2.6",
    baseUrlProfile: "global",
  });
  assert.equal(saved.configured, true);
  assert.equal(saved.baseUrlProfile, "global");
  assert.equal(saved.keyConsoleUrl, "https://platform.kimi.ai/console/api-keys");
  assert.equal("apiKey" in saved, false);
  assert.equal("encryptedApiKey" in saved, false);

  const disk = await fs.promises.readFile(storagePath, "utf8");
  assert.equal(disk.includes(SECRET), false);
  const statuses = await store.listStatus();
  assert.equal(JSON.stringify(statuses).includes(SECRET), false);
  const resolved = await store.resolve("moonshot");
  assert.equal(resolved.apiKey, SECRET);
  assert.equal(resolved.baseUrl, "https://api.moonshot.ai/v1");

  await store.upsert({ provider: "moonshot", apiKey: "", model: "kimi-k2.5", baseUrlProfile: "china" });
  const updated = await store.resolve("kimi");
  assert.equal(updated.apiKey, SECRET);
  assert.equal(updated.model, "kimi-k2.5");
  assert.equal(updated.baseUrl, "https://api.moonshot.cn/v1");
});

test("credential store fails closed when Electron secure storage is unavailable", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-provider-no-vault-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const storagePath = path.join(root, "external-model-credentials.json");
  const store = new ExternalModelCredentialStore({
    storagePath,
    safeStorage: { isEncryptionAvailable: () => false },
  });
  await assert.rejects(
    store.upsert({ provider: "openai", apiKey: SECRET }),
    (error) => error?.code === "SECURE_STORAGE_UNAVAILABLE",
  );
  assert.equal(fs.existsSync(storagePath), false);
});

test("connection test requests use provider-specific authentication without tools", () => {
  for (const id of EXTERNAL_MODEL_PROVIDER_IDS) {
    const provider = getExternalModelProvider(id);
    const request = buildConnectionTestRequest({
      provider,
      apiKey: SECRET,
      model: provider.defaultModel,
      baseUrl: provider.baseUrlOptions[0].baseUrl,
    });
    assert.equal(request.url.startsWith("https://"), true);
    assert.equal(JSON.stringify(request).includes('"tools"'), false);
    if (id === "anthropic") {
      assert.equal(request.init.headers["x-api-key"], SECRET);
      assert.equal(request.init.headers["anthropic-version"], "2023-06-01");
      assert.equal("Authorization" in request.init.headers, false);
    } else {
      assert.equal(request.init.headers.Authorization, `Bearer ${SECRET}`);
    }
    if (id === "perplexity") {
      assert.equal(request.init.method, "POST");
      assert.equal(JSON.parse(request.init.body).max_tokens, 1);
    } else {
      assert.equal(request.init.method, "GET");
      assert.equal(request.init.body, undefined);
    }
  }
});

test("service returns sanitized connection status and redacts provider errors", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-provider-service-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const store = new ExternalModelCredentialStore({
    storagePath: path.join(root, "external-model-credentials.json"),
    safeStorage: fakeSafeStorage(),
  });
  await store.upsert({ provider: "openai", apiKey: SECRET });
  let captured = null;
  const service = new ExternalModelService({
    credentialStore: store,
    fetch: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
    now: () => new Date("2026-07-20T00:00:00.000Z"),
  });
  const result = await service.testConnection("gpt");
  assert.equal(result.ok, true);
  assert.equal(result.provider, "openai");
  assert.equal(result.modelVerified, false);
  assert.equal(result.testedAt, "2026-07-20T00:00:00.000Z");
  assert.equal(captured.init.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(JSON.stringify(result).includes(SECRET), false);

  const failingService = new ExternalModelService({
    credentialStore: store,
    fetch: async () => new Response(JSON.stringify({ error: { message: `invalid ${SECRET}` } }), { status: 401 }),
  });
  await assert.rejects(
    failingService.testConnection("openai"),
    (error) => error?.code === "AUTHENTICATION_FAILED" && !error.message.includes(SECRET) && error.message.includes("[REDACTED]"),
  );
});

test("user data export allowlist excludes the external credential vault", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-provider-export-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const userDataPath = path.join(root, "user-data");
  const destinationRoot = path.join(root, "snapshot");
  await fs.promises.mkdir(userDataPath, { recursive: true });
  await fs.promises.writeFile(path.join(userDataPath, "external-model-credentials.json"), SECRET, "utf8");
  await fs.promises.writeFile(path.join(userDataPath, "haolo-session.json"), "{}", "utf8");
  await createUserDataSnapshot({ userDataPath, destinationRoot, externalWorkspaces: [] });
  assert.equal(
    fs.existsSync(path.join(destinationRoot, "data", "userData", "external-model-credentials.json")),
    false,
  );

  const localVault = path.join(userDataPath, "external-model-credentials.json");
  await fs.promises.writeFile(localVault, "local-encrypted-vault", "utf8");
  await fs.promises.writeFile(
    path.join(destinationRoot, "data", "userData", "external-model-credentials.json"),
    "malicious-imported-vault",
    "utf8",
  );
  await restoreUserDataSnapshot({ snapshotRoot: destinationRoot, userDataPath, externalWorkspaces: [] });
  assert.equal(await fs.promises.readFile(localVault, "utf8"), "local-encrypted-vault");
});

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      return Buffer.from(`encrypted:${Buffer.from(value, "utf8").toString("base64")}`, "utf8");
    },
    decryptString(buffer) {
      const payload = buffer.toString("utf8");
      assert.match(payload, /^encrypted:/);
      return Buffer.from(payload.slice("encrypted:".length), "base64").toString("utf8");
    },
  };
}
