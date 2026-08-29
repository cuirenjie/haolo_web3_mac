import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { HAOLO_GATEWAY_BASE_URL, migrateHaoloGatewayAuth, migrateHaoloGatewayConfig, normalizeHaoloGatewayBaseUrl } from "../src/main/haolo-gateway.mjs";
import { buildAppServerEnv, defaultCodexConfigArgs, loadDefaultCodexAuthEnv, syncDefaultCodexResources } from "../src/main/app-server-client.mjs";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";

const legacyBases = [
  "https://aiapi.youleai.top", "https://aiapi.youleai.top/v1/",
  "http://aiapi.youleai.top:80/v1", "HTTPS://AIAPI.YOULEAI.TOP/v1",
  "http://8.216.5.161:8080/v1", "http://54.235.242.62:3000/v1",
  "https://haolo.pro", "http://haolo.pro/v1",
];

test("known retired model endpoints migrate, including historical IPs", () => {
  for (const value of legacyBases) assert.equal(normalizeHaoloGatewayBaseUrl(value), HAOLO_GATEWAY_BASE_URL, value);
  assert.equal(normalizeHaoloGatewayBaseUrl(""), HAOLO_GATEWAY_BASE_URL);
  assert.equal(normalizeHaoloGatewayBaseUrl(null, null), null);
});

test("custom endpoints and lookalike hosts are never redirected", () => {
  for (const value of ["https://haolo.com", "http://127.0.0.1:9000/v1", "https://provider.example/v1",
    "https://aiapi.youleai.top.evil.example/v1", "https://aiapi.youleai.top:8443/v1",
    "https://user:password@aiapi.youleai.top/v1", "https://aiapi.youleai.top/v1?key=test",
    "https://aiapi.youleai.top/v1#custom", "not-a-url"]) {
    assert.equal(normalizeHaoloGatewayBaseUrl(value), value);
  }
});

test("nested media credentials migrate without changing keys or the input", () => {
  const auth = { LLMHUB_BASE_URL: legacyBases[0], OPENAI_API_KEY: "sk-fixture",
    HAOLO_MEDIA_MODEL_CREDENTIALS: { image_generation: { "gpt-image-2": {
      base_url: legacyBases[1], api_key: "sk-media-fixture", route_group_id: 13,
    } } } };
  const migrated = migrateHaoloGatewayAuth(auth);
  assert.equal(migrated.LLMHUB_BASE_URL, HAOLO_GATEWAY_BASE_URL);
  assert.equal(migrated.OPENAI_API_KEY, auth.OPENAI_API_KEY);
  assert.deepEqual(migrated.HAOLO_MEDIA_MODEL_CREDENTIALS.image_generation["gpt-image-2"], {
    base_url: HAOLO_GATEWAY_BASE_URL, api_key: "sk-media-fixture", route_group_id: 13,
  });
  assert.equal(auth.LLMHUB_BASE_URL, legacyBases[0]);
  assert.deepEqual(migrateHaoloGatewayAuth(migrated), migrated);
});

test("stored provider config migration preserves comments, custom URLs and permissions", () => {
  const source = [
    'approval_policy = "on-request"', '[model_providers.haolo_ai]',
    'base_url = "https://aiapi.youleai.top" # managed model origin',
    '[model_providers.custom]', 'base_url = "http://localhost:8080/v1"',
    '[profiles.test.model_providers."deepseek"]', "base_url = 'http://54.235.242.62:3000/v1'",
    '[mcp.custom]', 'base_url = "https://aiapi.youleai.top"', '',
  ].join("\r\n");
  const expected = source.replace('"https://aiapi.youleai.top" #', '"https://haolo.pro/v1" #')
    .replace("'http://54.235.242.62:3000/v1'", "'https://haolo.pro/v1'");
  assert.equal(migrateHaoloGatewayConfig(source), expected);
  assert.equal(migrateHaoloGatewayConfig(expected), expected);
});

test("saved sessions and higher priority auth URLs migrate on load without logging out", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-domain-session-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storagePath = path.join(dir, "session.json");
  const authPath = path.join(dir, "auth.json");
  fs.writeFileSync(storagePath, JSON.stringify({ baseUrl: "https://haolo.com", token: "session-fixture",
    deviceId: "device-fixture", modelApiKey: "sk-fixture", modelBaseUrl: legacyBases[0],
    modelKeys: [{ provider: "codex", apiKey: "sk-fixture", baseUrl: legacyBases[1] }],
  }));
  fs.writeFileSync(authPath, JSON.stringify({ LLMHUB_BASE_URL: legacyBases[0], SUB2API_BASE_URL: legacyBases[1], OPENAI_API_KEY: "sk-fixture" }));
  const client = new YouleApiClient({ storagePath, authPath });
  await client.loadFromStorage();
  assert.equal(client.baseUrl, "https://haolo.com");
  assert.equal(client.token, "session-fixture");
  assert.equal(client.modelBaseUrl, HAOLO_GATEWAY_BASE_URL);
  assert.equal(client.modelKeys[0].baseUrl, HAOLO_GATEWAY_BASE_URL);
  const saved = JSON.parse(fs.readFileSync(storagePath, "utf8"));
  assert.equal(saved.modelBaseUrl, HAOLO_GATEWAY_BASE_URL);
  assert.equal(saved.modelKeys[0].apiKey, "sk-fixture");
  const auth = loadDefaultCodexAuthEnv({ authPath });
  assert.equal(auth.modelBaseUrl, HAOLO_GATEWAY_BASE_URL);
  assert.equal(auth.env.LLMHUB_BASE_URL, HAOLO_GATEWAY_BASE_URL);
  assert.equal(auth.env.SUB2API_BASE_URL, HAOLO_GATEWAY_BASE_URL);
  assert.equal(auth.env.OPENAI_API_KEY, "sk-fixture");
});

test("refreshed legacy backend keys drive model requests to the new gateway", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), authorization: options.headers.Authorization });
    if (String(url) === "https://haolo.com/api/sub2api/me/keys") {
      return Response.json({ keys: [{ provider: "codex", api_key: "sk-refreshed-fixture", base_url: legacyBases[1] }] });
    }
    assert.equal(String(url), "https://haolo.pro/v1/models");
    return Response.json({ data: [{ id: "gpt-5.6-terra" }] });
  };
  const client = new YouleApiClient();
  client.loaded = true;
  client.baseUrl = "https://haolo.com";
  client.token = "session-fixture";
  client.modelKeys = await client.fetchSub2ApiKeys();
  assert.equal(client.modelKeys[0].baseUrl, HAOLO_GATEWAY_BASE_URL);
  const catalog = await client.fetchProviderModelCatalog("codex", { force: true });
  assert.equal(catalog.status, "online");
  assert.equal(requests[1].authorization, "Bearer sk-refreshed-fixture");
  assert.deepEqual(requests.map((request) => request.url), ["https://haolo.com/api/sub2api/me/keys", "https://haolo.pro/v1/models"]);
});

test("inherited URLs and model launch arguments cannot route back to the retired gateway", () => {
  const env = buildAppServerEnv({ baseEnv: { LLMHUB_BASE_URL: legacyBases[0], SUB2API_BASE_URL: legacyBases[1],
    HAOLO_API_BASE_URL: "https://haolo.com", OPENAI_API_KEY: "sk-fixture" }, modelBaseUrl: legacyBases[0] });
  for (const field of ["LLMHUB_BASE_URL", "SUB2API_BASE_URL", "TRANSIT_BASE_URL", "MODEL_BASE_URL", "OPENAI_BASE_URL"]) {
    assert.equal(env[field], HAOLO_GATEWAY_BASE_URL, field);
  }
  assert.equal(env.HAOLO_API_BASE_URL, "https://haolo.com");
  const args = defaultCodexConfigArgs({ providerBaseUrl: legacyBases[0], deepSeekProviderBaseUrl: legacyBases[1] });
  assert.ok(args.includes('model_providers.haolo_ai.base_url="https://haolo.pro/v1"'));
  assert.doesNotMatch(args.join(" "), /aiapi\.youleai\.top/);
});

test("resource sync migrates both runtime home layouts and is idempotent", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-domain-config-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const home of [dir, path.join(dir, "runtime-home", ".codex")]) {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, "config.toml"), '[model_providers.haolo_ai]\nbase_url = "https://aiapi.youleai.top/v1"\n');
  }
  const first = syncDefaultCodexResources(dir, { skipPlugins: true });
  assert.equal(first.copied.filter((name) => name.endsWith(":gateway-domain")).length, 2);
  for (const home of first.codexHomes) {
    assert.match(fs.readFileSync(path.join(home, "config.toml"), "utf8"), /base_url = "https:\/\/haolo\.pro\/v1"/);
  }
  const second = syncDefaultCodexResources(dir, { skipPlugins: true });
  assert.equal(second.copied.some((name) => name.endsWith(":gateway-domain")), false);
});

test("bundled media scripts migrate explicit legacy URLs and cached video polling URLs", () => {
  const skillRoot = path.resolve("resources/default-haolo-ai/skills/.system");
  const script = `
import importlib.util, io, json, sys, tempfile
from pathlib import Path
root = Path(sys.argv[1])
def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, root / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
image = load('image_test', 'imagegen/scripts/generate_openai_image.py')
video = load('video_test', 'videogen/scripts/generate_seedance_video.py')
chat = load('chat_test', 'imagegen/scripts/generate_chat_image.py')
for module in (image, video, chat):
    assert module.migrate_gateway_url('http://8.216.5.161:8080/v1') == 'https://haolo.pro/v1'
    assert module.migrate_gateway_url('https://aiapi.youleai.top.evil.example/v1') == 'https://aiapi.youleai.top.evil.example/v1'
    assert module.migrate_gateway_url('http://localhost:9999/v1') == 'http://localhost:9999/v1'
assert image.normalized_haolo_api_url('https://aiapi.youleai.top/v1/images/generations') == 'https://haolo.pro/v1/images/generations'
assert image.normalize_base_url('https://aiapi.youleai.top') == 'https://haolo.pro/v1'
assert video.normalize_base_url('https://aiapi.youleai.top/v1/videos') == 'https://haolo.pro/v1'
assert video.resolve_status_url('https://haolo.pro/v1', 'grok-imagine-video-1.5', 'task', {'polling_url': 'https://aiapi.youleai.top/v1/media/status?task_id=task'}) == 'https://haolo.pro/v1/media/status?task_id=task'
class FakeResponse(io.BytesIO):
    headers = {'Content-Type': 'image/png'}
class FakeOpener:
    def open(self, request, timeout):
        assert request.full_url == 'https://haolo.pro/v1/files/result?task_id=task'
        assert request.get_header('Authorization') == 'Bearer sk-fixture'
        return FakeResponse(b'fixture-media-bytes')
image.OPENER = FakeOpener()
video.get_opener = lambda: FakeOpener()
video.resolve_http_transport = lambda: 'urllib'
for module in (image, video):
    calls = []
    original_replace, original_sleep = module.os.replace, module.time.sleep
    def transient_replace(source, destination):
        calls.append((source, destination))
        if len(calls) < 3:
            error = PermissionError('test sharing violation')
            error.winerror = 32
            raise error
    try:
        module.os.replace = transient_replace
        module.time.sleep = lambda delay: None
        module.replace_job_file('source', 'destination')
        assert len(calls) == 3
        calls.clear()
        def permanent_failure(source, destination):
            calls.append((source, destination))
            error = PermissionError('test permanent sharing violation')
            error.winerror = 32
            raise error
        module.os.replace = permanent_failure
        try:
            module.replace_job_file('source', 'destination')
        except PermissionError:
            assert len(calls) == 10
        else:
            raise AssertionError('retry must remain bounded')
    finally:
        module.os.replace, module.time.sleep = original_replace, original_sleep
with tempfile.TemporaryDirectory() as temporary:
    legacy_result = 'https://aiapi.youleai.top/v1/files/result?task_id=task'
    image.download_result(legacy_result, 'sk-fixture', 'https://haolo.pro/v1', temporary, 'image', 'png', 'stamp', 1)
    video.download_video(legacy_result, 'sk-fixture', 'https://haolo.pro/v1', temporary, 'video')
print(json.dumps({'ok': True}))
`;
  const result = spawnSync(process.env.PYTHON || (process.platform === "win32" ? "python" : "python3"), ["-c", script, skillRoot], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).ok, true);
});
