import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { modelToolNetworkEnv, modelToolNetworkConfigArgs, withModelToolNetwork } from "../src/main/model-tool-network.mjs";

function python(code, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || "python", ["-c", code], { env, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });
}

test("tool environment preserves credentials, canonical job bases, custom providers and proxy exclusions", () => {
  const before = { OPENAI_API_KEY: "test", OPENAI_BASE_URL: "https://haolo.pro/v1", LLMHUB_BASE_URL: "https://haolo.pro/v1", DEEPSEEK_BASE_URL: "https://custom.example/v1", NO_PROXY: "internal.example" };
  const after = modelToolNetworkEnv(before, "http://127.0.0.1:32123/v1");
  assert.equal(after.OPENAI_BASE_URL, "http://127.0.0.1:32123/v1");
  assert.equal(after.LLMHUB_BASE_URL, before.LLMHUB_BASE_URL);
  assert.equal(after.DEEPSEEK_BASE_URL, before.DEEPSEEK_BASE_URL);
  assert.equal(after.OPENAI_API_KEY, "test");
  assert.match(after.NO_PROXY, /internal\.example,127\.0\.0\.1,localhost/);
  assert.equal(before.HAOLO_MODEL_RELAY_URL, undefined);
  assert.throws(() => modelToolNetworkEnv(before, "http://remote.example/v1"));
  assert.deepEqual(modelToolNetworkConfigArgs(after, "updated"), []);
  const routed = modelToolNetworkEnv({ DEEPSEEK_BASE_URL: "https://haolo.pro/v1", DEEPSEEK_API_KEY: "never-on-cli" }, "http://127.0.0.1:32123/v1");
  assert.deepEqual(modelToolNetworkConfigArgs(routed, "updated"), ["-c", 'mcp_servers.deepseek.env.DEEPSEEK_BASE_URL="http://127.0.0.1:32123/v1"']);
  assert.deepEqual(modelToolNetworkConfigArgs(routed, "preserved-existing"), []);
  assert.deepEqual(modelToolNetworkConfigArgs(routed, "skipped"), []);
});

for (const transport of ["urllib", "curl"]) {
  test(`bundled Python ${transport} image/video submit, poll and download use model routing`, async (t) => {
    const output = await mkdtemp(path.join(os.tmpdir(), "haolo-model-tool-test-"));
    t.after(() => rm(output, { recursive: true, force: true }));
    const calls = [];
    let relayBase;
    await withModelToolNetwork({ ...process.env, HAOLO_GEN_HTTP_TRANSPORT: transport, HAOLO_GEN_USE_PROXY: "0", TEST_OUTPUT: output }, {
      fetch: async (url, init) => {
        calls.push({ url, method: init.method });
        assert.equal(new Headers(init.headers).get("authorization"), "Bearer sk-test");
        if (url.includes("/content")) return new Response("test-media-bytes", { headers: { "content-type": url.includes("image") ? "image/png" : "video/mp4" } });
        return Response.json({ id: "test-job", status: "completed" });
      },
    }, async (env) => {
      relayBase = env.HAOLO_MODEL_RELAY_URL;
      await python(`
import importlib.util, os
from pathlib import Path
root = Path('resources/default-haolo-ai/skills/.system')
for name, script in [('image', 'imagegen/scripts/generate_openai_image.py'), ('video', 'videogen/scripts/generate_seedance_video.py')]:
    spec = importlib.util.spec_from_file_location(name, root / script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    base = 'https://haolo.pro/v1'
    assert module.http_json(base + '/' + name + '/submit', 'sk-test', {'prompt': 'test'})['id'] == 'test-job'
    assert module.http_json(base + '/media/status?task_id=' + name, 'sk-test')['status'] == 'completed'
    url = base + '/' + name + '/content?signature=fixture'
    if name == 'image':
        result = module.download_result(url, 'sk-test', base, os.environ['TEST_OUTPUT'], 'image', 'png', 'test', 0)
    else:
        result = module.download_video(url, 'sk-test', base, os.environ['TEST_OUTPUT'], 'video')
    assert Path(result).read_bytes() == b'test-media-bytes'
    assert module.model_transport_url('https://cdn.example/content') == 'https://cdn.example/content'
    assert module.model_transport_url('https://haolo.pro.evil.example/v1') == 'https://haolo.pro.evil.example/v1'
`, env);
    });
    assert.deepEqual(calls.map(({ url, method }) => `${method} ${new URL(url).pathname}${new URL(url).search}`), [
      "POST /v1/image/submit", "GET /v1/media/status?task_id=image", "GET /v1/image/content?signature=fixture",
      "POST /v1/video/submit", "GET /v1/media/status?task_id=video", "GET /v1/video/content?signature=fixture",
    ]);
    await assert.rejects(fetch(`${relayBase}/models`));
  });
}

test("the transient relay closes when a child fails and does not replay its paid POST", async () => {
  let attempts = 0;
  let base;
  await assert.rejects(withModelToolNetwork({}, { fetch: async () => { attempts++; throw new Error("network failed"); } }, async (env) => {
    base = env.HAOLO_MODEL_RELAY_URL;
    assert.equal((await fetch(`${base}/images/generations`, { method: "POST", body: "{}" })).status, 502);
    throw new Error("child failed");
  }), /child failed/);
  assert.equal(attempts, 1);
  await assert.rejects(fetch(`${base}/models`));
});
