import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const skillRoot = path.resolve("resources", "default-haolo-ai", "skills", ".system");
const imageScript = path.join(skillRoot, "imagegen", "scripts", "generate_openai_image.py");
const fallbackImageScript = path.join(skillRoot, "imagegen", "scripts", "image_gen.py");
const presetResolverScript = path.join(skillRoot, "imagegen", "scripts", "resolve_prompt_preset.py");
const videoScript = path.join(skillRoot, "videogen", "scripts", "generate_seedance_video.py");

function baseEnv(envOverride = {}) {
  return {
    ...process.env,
    LLMHUB_API_KEY: "sk-test",
    LLMHUB_BASE_URL: "https://haolo.pro/v1",
    SUB2API_API_KEY: "",
    SUB2API_BASE_URL: "",
    OPENAI_API_KEY: "",
    OPENAI_BASE_URL: "",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    ...envOverride,
  };
}

function runJson(script, args, envOverride = {}) {
  const result = spawnSync(python, [script, ...args], {
    cwd: path.resolve("."),
    env: baseEnv(envOverride),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function resolvePreset(request, outputDir, extraArgs = []) {
  return runJson(presetResolverScript, ["--request", request, "--output-dir", outputDir, ...extraArgs]);
}

function runProcessJsonAsync(script, args, envOverride = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, ...args], {
      cwd: path.resolve("."),
      env: baseEnv(envOverride),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out running ${path.basename(script)}`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      try {
        resolve({ status, stderr, stdout, payload: JSON.parse(stdout) });
      } catch (error) {
        reject(new Error(
          `${error.message}\nstdout: ${stdout || "<empty>"}\nstderr: ${stderr || "<empty>"}`,
          { cause: error },
        ));
      }
    });
  });
}

async function runJsonAsync(script, args, envOverride = {}, timeoutMs = 10_000) {
  const result = await runProcessJsonAsync(script, args, envOverride, timeoutMs);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.payload;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const contentType = String(request.headers["content-type"] || "");
      resolve(
        text && contentType.includes("application/json")
          ? JSON.parse(text)
          : text || null,
      );
    });
    request.on("error", reject);
  });
}

async function createMockMediaServer(options = {}) {
  const requests = [];
  let baseUrl = "";
  let imageSubmitCount = 0;
  let imageStatusCount = 0;
  let videoSubmitCount = 0;
  let videoStatusCount = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, baseUrl);
    const body = await readRequestBody(request);
    requests.push({
      method: request.method,
      path: url.pathname,
      searchParams: Object.fromEntries(url.searchParams),
      headers: request.headers,
      body,
    });

    if (request.method === "POST" && url.pathname === "/v1/images/edits") {
      imageSubmitCount += 1;
      const configuredSubmit = await options.onImageSubmit?.({ request, body, requests, imageSubmitCount });
      response.statusCode = configuredSubmit?.statusCode ?? 200;
      response.setHeader("Content-Type", "application/json");
      response.end(
        configuredSubmit?.rawBody ?? JSON.stringify(
          configuredSubmit?.body ?? { data: [{ url: `${baseUrl}/result-image.png` }] },
        ),
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/images/generations") {
      imageSubmitCount += 1;
      const configuredSubmit = await options.onImageSubmit?.({ request, body, requests, imageSubmitCount });
      response.statusCode = configuredSubmit?.statusCode ?? 200;
      response.setHeader("Content-Type", "application/json");
      response.end(
        configuredSubmit?.rawBody ?? JSON.stringify(configuredSubmit?.body ?? { code: 200, data: { task_id: "image-task" } }),
      );
      return;
    }
    if (
      request.method === "POST" &&
      ["/v1/videos", "/v1/videos/generations"].includes(url.pathname)
    ) {
      const isAsyncImageRequest = String(body?.model || "").startsWith("gpt-image-2-");
      if (isAsyncImageRequest) {
        imageSubmitCount += 1;
      } else {
        videoSubmitCount += 1;
      }
      const configuredSubmit = isAsyncImageRequest
        ? await options.onImageSubmit?.({
            request,
            body,
            requests,
            imageSubmitCount,
          })
        : await options.onVideoSubmit?.({
            request,
            body,
            requests,
            videoSubmitCount,
          });
      response.statusCode = configuredSubmit?.statusCode ?? 200;
      response.setHeader("Content-Type", "application/json");
      response.end(
        configuredSubmit?.rawBody ??
          JSON.stringify(
            configuredSubmit?.body ?? {
              code: 200,
              data: {
                task_id: isAsyncImageRequest
                  ? "image-async-task"
                  : "video-task",
              },
            },
          ),
      );
      return;
    }
    const directTaskMatch = /^\/v1\/videos\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && directTaskMatch) {
      const taskId = decodeURIComponent(directTaskMatch[1]);
      const isVideoTask = taskId === "video-task";
      if (isVideoTask) videoStatusCount += 1;
      else imageStatusCount += 1;
      const configuredStatus = isVideoTask
        ? typeof options.videoStatus === "function"
          ? await options.videoStatus({ request, taskId, requests, videoStatusCount, baseUrl })
          : options.videoStatus
        : typeof options.imageStatus === "function"
          ? await options.imageStatus({ request, taskId, requests, imageStatusCount, baseUrl })
          : options.imageStatus;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify(
          configuredStatus || (isVideoTask
            ? { status: "completed", video_url: `${baseUrl}/result-video.mp4` }
            : { status: "completed", progress: 100, video_url: `${baseUrl}/result-image.png` }),
        ),
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/media/status") {
      const taskId = url.searchParams.get("task_id");
      response.setHeader("Content-Type", "application/json");
      if (taskId === "image-task" || taskId === "image-async-task") {
        imageStatusCount += 1;
        const configuredStatus =
          typeof options.imageStatus === "function"
            ? await options.imageStatus({ request, taskId, requests, imageStatusCount, baseUrl })
            : options.imageStatus;
        response.end(
          JSON.stringify(
            configuredStatus || { status: "completed", progress: 100, video_url: `${baseUrl}/result-image.png` },
          ),
        );
        return;
      }
      if (taskId === "video-task") {
        videoStatusCount += 1;
        const configuredStatus =
          typeof options.videoStatus === "function"
            ? await options.videoStatus({ request, taskId, requests, videoStatusCount, baseUrl })
            : options.videoStatus;
        response.end(
          JSON.stringify(
            configuredStatus || {
              is_final: true,
              status: "completed",
              video_url: `${baseUrl}/result-video.mp4`,
            },
          ),
        );
        return;
      }
    }
    if (request.method === "GET" && url.pathname === "/v1/media/jobs") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        object: "list",
        data: [{
          task_id: "video-task",
          model: "grok-imagine-video-1.5",
          state: "completed",
          conversation_id: url.searchParams.get("conversation_id") || "",
          interaction_id: "video-request-1",
          cached: true,
          result_url: "/v1/media/cache?task_id=video-task",
        }],
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/media/cache") {
      response.setHeader("Content-Type", "video/mp4");
      response.end(Buffer.from([0, 0, 0, 18, 102, 116, 121, 112, 105, 115, 111, 109]));
      return;
    }
    if (
      request.method === "GET" &&
      (url.pathname === "/v1/videos/image-task/content" ||
        url.pathname === "/v1/videos/image-async-task/content")
    ) {
      response.setHeader("Content-Type", "image/png");
      response.end(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"));
      return;
    }
    if (request.method === "GET" && url.pathname === "/result-image.png") {
      response.setHeader("Content-Type", "image/png");
      response.end(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"));
      return;
    }
    if (request.method === "GET" && url.pathname === "/reference-image.png") {
      response.setHeader("Content-Type", "image/png");
      response.end(
        Buffer.from(
          "89504e470d0a1a0a0000000d494844520000000100000001",
          "hex",
        ),
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/result-video.mp4") {
      response.setHeader("Content-Type", "video/mp4");
      response.end(Buffer.from([0, 0, 0, 18, 102, 116, 121, 112, 105, 115, 111, 109]));
      return;
    }
    if (request.method === "GET" && url.pathname === "/nested-result-video.mp4") {
      response.setHeader("Content-Type", "video/mp4");
      response.end(Buffer.from([0, 0, 0, 18, 102, 116, 121, 112, 105, 115, 111, 109]));
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    requests,
    get imageSubmitCount() {
      return imageSubmitCount;
    },
    get imageStatusCount() {
      return imageStatusCount;
    },
    get videoSubmitCount() {
      return videoSubmitCount;
    },
    get videoStatusCount() {
      return videoStatusCount;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("image skill defaults to AIHubCC image task contract", () => {
  const dryRun = runJson(imageScript, ["--prompt", "red cube", "--dry-run"]);
  const forcedPythonTransport = runJson(
    imageScript,
    ["--prompt", "red cube", "--dry-run"],
    { HAOLO_GEN_HTTP_TRANSPORT: "urllib" },
  );
  const windowsCurlAvailable =
    process.platform === "win32" &&
    spawnSync("curl.exe", ["--version"], { encoding: "utf8" }).status === 0;

  assert.equal(dryRun.api_url, "https://haolo.pro/v1/images/generations");
  assert.equal(dryRun.status_url_template, "https://haolo.pro/v1/media/status?task_id=<TASK_ID>");
  assert.equal(dryRun.timeout_seconds, 600);
  assert.equal(dryRun.http_transport, windowsCurlAvailable ? "curl" : "urllib");
  assert.equal(forcedPythonTransport.http_transport, "urllib");
  assert.equal(dryRun.credential_source, "environment:LLMHUB_API_KEY");
  assert.equal(dryRun.payload.model, "aihubcc/gpt-image-2");
  assert.equal(dryRun.payload.prompt, "red cube");
  assert.deepEqual(dryRun.payload, {
    model: "aihubcc/gpt-image-2",
    prompt: "red cube",
    size: "auto",
    quality: "auto",
    response_format: "url",
    n: 1,
  });
});

test("image Director applies the configured timeout to submit reads", () => {
  const source = fs.readFileSync(imageScript, "utf8");
  const custom = runJson(imageScript, [
    "--prompt",
    "red cube",
    "--timeout",
    "37",
    "--dry-run",
  ]);

  assert.equal(custom.timeout_seconds, 37);
  assert.doesNotMatch(source, /timeout=120/);
  assert.equal(source.match(/timeout=args\.timeout/g)?.length, 2);
});

test("image Director canonicalizes every historical GPT Image 2 alias, including exact selections", () => {
  const canonical = runJson(imageScript, [
    "--prompt",
    "red cube",
    "--model",
    "aihubcc/gpt-image-2",
    "--dry-run",
  ]);
  const bare = runJson(imageScript, [
    "--prompt",
    "red cube",
    "--model",
    "gpt-image-2",
    "--exact-model",
    "--dry-run",
  ]);
  const legacy = runJson(imageScript, [
    "--prompt",
    "red cube",
    "--model",
    "buming/gpt-image-2",
    "--exact-model",
    "--dry-run",
  ]);

  assert.equal(canonical.payload.model, "aihubcc/gpt-image-2");
  assert.equal(bare.payload.model, "aihubcc/gpt-image-2");
  assert.equal(legacy.payload.model, "aihubcc/gpt-image-2");
});

test("fallback image CLI canonicalizes the historical Buming model alias", () => {
  const result = runJson(fallbackImageScript, [
    "generate",
    "--prompt",
    "red cube",
    "--model",
    "buming/gpt-image-2",
    "--dry-run",
    "--no-augment",
  ]);

  assert.equal(result.model, "aihubcc/gpt-image-2");
});

test("image Director selects the route-group credential for the configured media model", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-media-model-credential-"));
  try {
    const credentialsPath = path.join(tempRoot, "auth.json");
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        HAOLO_MEDIA_MODEL_CREDENTIALS: {
          image_generation: {
            "gpt-image-2-1k": {
              provider: "codex",
              route_group_id: 33,
              api_key: "sk-route-group-33",
              base_url: "https://media-relay.example/v1",
            },
          },
        },
      }),
      "utf8",
    );
    const dryRun = runJson(
      imageScript,
      [
        "--prompt",
        "red cube",
        "--model",
        "gpt-image-2-1k",
        "--exact-model",
        "--dry-run",
      ],
      {
        LLMHUB_API_KEY: "",
        LLMHUB_BASE_URL: "",
        HAOLO_MODEL_CREDENTIALS_FILE: credentialsPath,
      },
    );

    assert.equal(dryRun.api_url, "https://media-relay.example/v1/videos");
    assert.equal(dryRun.credential_source, "haolo_business_model_pool");
    assert.equal(dryRun.payload.model, "gpt-image-2-1k");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("image Director default model matches the unprefixed live-pool credential key", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "haolo-default-image-model-credential-"),
  );
  try {
    const credentialsPath = path.join(tempRoot, "auth.json");
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        HAOLO_MEDIA_MODEL_CREDENTIALS: {
          image_generation: {
            "gpt-image-2": {
              provider: "codex",
              route_group_id: 2,
              api_key: "sk-default-image-route",
              base_url: "https://media-relay.example/v1",
            },
          },
        },
      }),
      "utf8",
    );
    const dryRun = runJson(
      imageScript,
      ["--prompt", "red cube", "--dry-run"],
      {
        LLMHUB_API_KEY: "",
        LLMHUB_BASE_URL: "",
        HAOLO_MODEL_CREDENTIALS_FILE: credentialsPath,
      },
    );

    assert.equal(
      dryRun.api_url,
      "https://media-relay.example/v1/images/generations",
    );
    assert.equal(dryRun.credential_source, "haolo_business_model_pool");
    assert.equal(dryRun.payload.model, "aihubcc/gpt-image-2");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("image Director rejects a non-positive polling interval", () => {
  const result = spawnSync(python, [imageScript, "--prompt", "red cube", "--poll-interval", "0", "--dry-run"], {
    cwd: path.resolve("."),
    env: baseEnv(),
    encoding: "utf8",
  });

  assert.equal(result.status, 3);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error_class, "request");
  assert.match(payload.error, /poll-interval/);
});

test("local image preset resolver records matched and unmatched gates", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-preset-gate-"));
  try {
    const request = "帮我生成一张东方校园女孩的照片";
    const first = resolvePreset(request, outputDir);
    const second = resolvePreset(request, outputDir);
    const unmatched = resolvePreset("生成抽象蓝色几何视觉", outputDir);
    const collage = resolvePreset("帮我做一张照片拼贴", outputDir);
    const restoration = resolvePreset("帮我做旧照片修复", outputDir);
    const photoEdit = resolvePreset("提升这张照片画质", outputDir);
    const presetFilename = resolvePreset("请使用小红书封面图提示词.txt生成封面", outputDir);

    assert.equal(first.preset_checked, true);
    assert.equal(first.matched, true);
    assert.equal(first.preset_id, "真实照片");
    assert.equal(first.match_type, "generic_photo");
    assert.equal(first.matched_keyword, "照片");
    assert.equal(first.request_sha256, crypto.createHash("sha256").update(request).digest("hex"));
    assert.equal(first.preset_sha256, crypto.createHash("sha256").update(fs.readFileSync(first.preset_path)).digest("hex"));
    assert.equal(fs.existsSync(first.check_file), true);
    assert.equal(first.request_sha256, second.request_sha256);
    assert.notEqual(first.request_id, second.request_id);

    assert.equal(unmatched.preset_checked, true);
    assert.equal(unmatched.matched, false);
    assert.equal(unmatched.preset_id, "none");
    assert.equal(unmatched.match_type, "none");
    assert.equal(unmatched.preset_text, "");
    assert.equal(collage.preset_id, "照片拼贴");
    assert.equal(collage.match_type, "keyword");
    assert.equal(restoration.preset_id, "老照片修复");
    assert.equal(restoration.match_type, "keyword");
    assert.equal(photoEdit.preset_id, "none");
    assert.equal(presetFilename.preset_id, "小红书封面图");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("image Director rejects missing, mismatched, or tampered preset gates before POST", async () => {
  const mock = await createMockMediaServer();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-preset-reject-"));
  try {
    const common = [
      "--prompt",
      "final prompt",
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--output-dir",
      outputDir,
    ];
    const missing = await runProcessJsonAsync(imageScript, [...common, "--user-request", "original request"]);
    assert.equal(missing.status, 3);
    assert.equal(missing.payload.error_class, "request");

    const mismatchGate = resolvePreset("original request", outputDir);
    const mismatch = await runProcessJsonAsync(imageScript, [
      ...common,
      "--user-request",
      "different request",
      "--preset-check-file",
      mismatchGate.check_file,
    ]);
    assert.equal(mismatch.status, 3);
    assert.equal(mismatch.payload.error_class, "request");

    const matchedGate = resolvePreset("帮我生成一张东方校园女孩的照片", outputDir);
    const tamperedRecord = JSON.parse(fs.readFileSync(matchedGate.check_file, "utf8"));
    tamperedRecord.preset_sha256 = "0".repeat(64);
    fs.writeFileSync(matchedGate.check_file, JSON.stringify(tamperedRecord), "utf8");
    const tampered = await runProcessJsonAsync(imageScript, [
      ...common,
      "--user-request",
      "帮我生成一张东方校园女孩的照片",
      "--preset-check-file",
      matchedGate.check_file,
    ]);
    assert.equal(tampered.status, 3);
    assert.equal(tampered.payload.error_class, "request");

    const collisionRequest = "生成抽象黄色几何视觉";
    const collisionGate = resolvePreset(collisionRequest, outputDir);
    const collision = await runProcessJsonAsync(imageScript, [
      ...common,
      "--user-request",
      collisionRequest,
      "--preset-check-file",
      collisionGate.check_file,
      "--prompt-output",
      collisionGate.check_file,
    ]);
    assert.equal(collision.status, 3);
    assert.equal(collision.payload.error_class, "request");
    assert.equal(JSON.parse(fs.readFileSync(collisionGate.check_file, "utf8")).request_id, collisionGate.request_id);

    const unsafeGate = resolvePreset("生成抽象蓝色几何视觉", outputDir);
    const unsafeRecord = JSON.parse(fs.readFileSync(unsafeGate.check_file, "utf8"));
    unsafeRecord.request_id = "../../../escaped-job";
    fs.writeFileSync(unsafeGate.check_file, JSON.stringify(unsafeRecord), "utf8");
    const unsafe = await runProcessJsonAsync(imageScript, [
      ...common,
      "--user-request",
      "生成抽象蓝色几何视觉",
      "--preset-check-file",
      unsafeGate.check_file,
    ]);
    assert.equal(unsafe.status, 3);
    assert.equal(unsafe.payload.error_class, "request");
    assert.equal(fs.existsSync(path.join(outputDir, "escaped-job.json")), false);
    assert.equal(mock.imageSubmitCount, 0);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("image skill completes submit, status polling, and download against media API contract", async () => {
  const mock = await createMockMediaServer();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-flow-"));
  try {
    const userRequest = "mock image";
    const preset = resolvePreset(userRequest, outputDir);
    const result = await runJsonAsync(imageScript, [
      "--prompt",
      "mock image",
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--output-dir",
      outputDir,
      "--basename",
      "mock-image",
      "--timeout",
      "5",
      "--poll-interval",
      "1",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.model, "aihubcc/gpt-image-2");
    assert.equal(result.task_id, "image-task");
    assert.equal(result.preset_check.preset_checked, true);
    assert.equal(result.preset_check.preset_id, "none");
    assert.equal(result.source_url, `${mock.baseUrl}/result-image.png`);
    assert.equal(result.saved.length, 1);
    assert.equal(fs.existsSync(result.saved[0]), true);

    const submit = mock.requests.find((entry) => entry.path === "/v1/images/generations");
    assert.equal(submit.body.model, "aihubcc/gpt-image-2");
    assert.equal(submit.body.prompt, "mock image");
    assert.equal(submit.body.response_format, "url");

    const status = mock.requests.find((entry) => entry.path === "/v1/media/status");
    assert.deepEqual(status.searchParams, { task_id: "image-task" });
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("image Director stops immediately when task status explicitly reports timeout", async () => {
  const mock = await createMockMediaServer({
    imageStatus: {
      state: "timed_out",
      error: "upstream generation deadline exceeded",
    },
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-explicit-timeout-"));
  try {
    const userRequest = "mock image timeout";
    const preset = resolvePreset(userRequest, outputDir);
    const startedAt = Date.now();
    const result = await runProcessJsonAsync(
      imageScript,
      [
        "--prompt",
        userRequest,
        "--user-request",
        userRequest,
        "--preset-check-file",
        preset.check_file,
        "--base-url",
        `${mock.baseUrl}/v1`,
        "--output-dir",
        outputDir,
        "--basename",
        "mock-image-timeout",
        "--timeout",
        "600",
        "--poll-interval",
        "1",
      ],
      {},
      5_000,
    );

    assert.equal(result.status, 3);
    assert.equal(result.payload.pending, false);
    assert.equal(result.payload.state, "failed");
    assert.match(result.payload.error, /timed_out/);
    assert.equal(result.payload.safe_to_resubmit, true);
    assert.equal(result.payload.fallback_allowed, true);
    assert.equal(result.payload.fallback_model, "gpt-image-2-1k");
    assert.deepEqual(result.payload.fallback_models, [
      "gpt-image-2-1k",
      "gpt-image-2-2k",
      "gpt-image-2-3.5k",
    ]);
    assert.equal(mock.imageStatusCount, 1);
    assert.ok(Date.now() - startedAt < 3_000);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("image Director preserves an exact model selection after terminal timeout", async () => {
  const mock = await createMockMediaServer({
    imageStatus: {
      state: "timed_out",
      error: "upstream generation deadline exceeded",
    },
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-exact-timeout-"));
  try {
    const userRequest = "mock exact image timeout";
    const preset = resolvePreset(userRequest, outputDir);
    const result = await runProcessJsonAsync(
      imageScript,
      [
        "--prompt",
        userRequest,
        "--user-request",
        userRequest,
        "--preset-check-file",
        preset.check_file,
        "--base-url",
        `${mock.baseUrl}/v1`,
        "--output-dir",
        outputDir,
        "--basename",
        "mock-exact-image-timeout",
        "--model",
        "gpt-image-2",
        "--exact-model",
        "--timeout",
        "600",
        "--poll-interval",
        "1",
      ],
      {},
      5_000,
    );

    assert.equal(result.status, 3);
    assert.equal(result.payload.fallback_allowed, false);
    assert.equal(result.payload.fallback_model, null);
    assert.deepEqual(result.payload.fallback_models, []);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("image generation mode tries synchronous Image2 before the asynchronous 1K fallback", async () => {
  const machineError = {
    code: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
    category: "remote",
    retryable: true,
    retry_after_ms: 60_000,
    request_id: "relay-media-image-route-exhausted",
    upstream_status: 502,
    route_exhausted: true,
  };
  const mock = await createMockMediaServer({
    onImageSubmit: () => ({
      statusCode: 502,
      body: {
        error: {
          type: "upstream_error",
          message: "Upstream service temporarily unavailable",
          ...machineError,
        },
      },
    }),
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-provider-fallback-"));
  try {
    const userRequest = "mock provider-only image route exhaustion";
    const preset = resolvePreset(userRequest, outputDir);
    const result = await runProcessJsonAsync(
      imageScript,
      [
        "--prompt",
        userRequest,
        "--user-request",
        userRequest,
        "--preset-check-file",
        preset.check_file,
        "--base-url",
        `${mock.baseUrl}/v1`,
        "--output-dir",
        outputDir,
        "--basename",
        "mock-provider-image-route-exhaustion",
        "--model",
        "gpt-image-2",
        "--exact-model",
        "--provider-fallback-only",
        "--timeout",
        "600",
        "--poll-interval",
        "1",
      ],
      {},
      5_000,
    );

    assert.equal(result.status, 3);
    assert.equal(result.payload.pending, false);
    assert.equal(result.payload.state, "failed");
    assert.equal(result.payload.safe_to_resubmit, true);
    assert.equal(result.payload.fallback_allowed, true);
    assert.equal(result.payload.fallback_model, "gpt-image-2-1k");
    assert.deepEqual(result.payload.fallback_models, ["gpt-image-2-1k"]);
    assert.deepEqual(result.payload.machine_error, machineError);
    assert.equal(mock.imageSubmitCount, 1);
    assert.equal(mock.imageStatusCount, 0);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("image Director returns pending immediately for an explicit timeout response code", async () => {
  const mock = await createMockMediaServer({
    imageStatus: {
      code: 504,
      message: "gateway timeout",
    },
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-timeout-code-"));
  try {
    const userRequest = "mock image timeout response";
    const preset = resolvePreset(userRequest, outputDir);
    const startedAt = Date.now();
    const result = await runJsonAsync(
      imageScript,
      [
        "--prompt",
        userRequest,
        "--user-request",
        userRequest,
        "--preset-check-file",
        preset.check_file,
        "--base-url",
        `${mock.baseUrl}/v1`,
        "--output-dir",
        outputDir,
        "--basename",
        "mock-image-timeout-code",
        "--timeout",
        "600",
        "--poll-interval",
        "1",
      ],
      {},
      5_000,
    );

    assert.equal(result.pending, true);
    assert.equal(result.task_id, "image-task");
    assert.match(result.error, /explicit timeout code 504/);
    assert.equal(mock.imageStatusCount, 1);
    assert.ok(Date.now() - startedAt < 3_000);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("image skill and ordinary-chat routing declare the guarded fallback chain", () => {
  const skill = fs.readFileSync(path.join(skillRoot, "imagegen", "SKILL.md"), "utf8");
  const main = fs.readFileSync(path.resolve("src", "main", "main.mjs"), "utf8");
  const workflowRuntime = fs.readFileSync(path.resolve("src", "main", "workflow", "runtime.mjs"), "utf8");

  for (const model of [
    "gpt-image-2",
    "gpt-image-2-1k",
    "gpt-image-2-2k",
    "gpt-image-2-3.5k",
  ]) {
    assert.match(skill, new RegExp(model.replace(".", "\\.")));
    assert.match(main, new RegExp(model.replace(".", "\\.")));
  }
  assert.match(skill, /fallback_allowed=true/);
  assert.match(skill, /Never switch models for `pending`, `reconciling`, `active_elsewhere`/);
  assert.match(skill, /--strict-edit/);
  assert.match(skill, /strict_edit_reference_task_unavailable/);
  assert.match(main, /Never switch while a task is pending, reconciling, active elsewhere/);
  assert.match(main, /every Director invocation must include --strict-edit/);
  assert.match(main, /selected base aihubcc\/gpt-image-2 uses --exact-model --provider-fallback-only/);
  assert.match(workflowRuntime, /Image input fidelity contract/);
  assert.match(workflowRuntime, /invoke the bundled image Director with --strict-edit/);
});

test("matched preset prompt is saved before the unchanged AIHubCC submit", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-matched-"));
  const promptOutput = path.join(outputDir, "matched-prompt.txt");
  let promptExistedAtSubmit = false;
  let promptAtSubmit = "";
  const mock = await createMockMediaServer({
    onImageSubmit: ({ body }) => {
      promptExistedAtSubmit = fs.existsSync(promptOutput);
      promptAtSubmit = promptExistedAtSubmit ? fs.readFileSync(promptOutput, "utf8").trimEnd() : "";
      promptAtSubmit = promptAtSubmit.replace(/\r\n/g, "\n");
    },
  });
  try {
    const userRequest = "帮我生成一张东方校园女孩的照片";
    const preset = resolvePreset(userRequest, outputDir);
    const finalPrompt = `${preset.preset_text}\n\n用户原始要求：${userRequest}`;
    const result = await runJsonAsync(imageScript, [
      "--prompt",
      finalPrompt,
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--prompt-output",
      promptOutput,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--output-dir",
      outputDir,
      "--basename",
      "matched-image",
      "--timeout",
      "5",
      "--poll-interval",
      "1",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.preset_check.preset_id, "真实照片");
    assert.equal(promptExistedAtSubmit, true);
    assert.equal(promptAtSubmit, finalPrompt);
    assert.equal(promptAtSubmit.includes(preset.preset_text), true);
    assert.equal(promptAtSubmit.includes(userRequest), true);
    const submit = mock.requests.find((entry) => entry.path === "/v1/images/generations");
    assert.deepEqual(Object.keys(submit.body).sort(), [
      "model",
      "n",
      "prompt",
      "quality",
      "response_format",
      "size",
    ]);
    assert.equal(submit.body.model, "aihubcc/gpt-image-2");
    assert.equal(submit.body.size, "auto");
    assert.equal(submit.body.quality, "auto");
    assert.equal(submit.body.response_format, "url");
    assert.equal(submit.body.n, 1);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("Director enforces the matched local preset and literal request in the submitted prompt", async () => {
  const mock = await createMockMediaServer();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-enforced-preset-"));
  const promptOutput = path.join(outputDir, "enforced-prompt.txt");
  try {
    const userRequest = "帮我生成一张东方校园女孩的照片";
    const preset = resolvePreset(userRequest, outputDir);
    const result = await runJsonAsync(imageScript, [
      "--prompt",
      "NO PRESET CONTENT",
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--prompt-output",
      promptOutput,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--output-dir",
      outputDir,
      "--basename",
      "enforced-image",
      "--timeout",
      "5",
      "--poll-interval",
      "1",
    ]);

    assert.equal(result.ok, true);
    const submit = mock.requests.find((entry) => entry.path === "/v1/images/generations");
    assert.equal(submit.body.prompt.includes(preset.preset_text), true);
    assert.equal(submit.body.prompt.includes(userRequest), true);
    assert.equal(submit.body.prompt.includes("NO PRESET CONTENT"), true);
    assert.equal(fs.readFileSync(promptOutput, "utf8").trimEnd(), submit.body.prompt);
    assert.deepEqual(Object.keys(submit.body).sort(), [
      "model",
      "n",
      "prompt",
      "quality",
      "response_format",
      "size",
    ]);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("accepted image task persists before polling and resumes without another POST", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-resume-"));
  const userRequest = "生成抽象蓝色几何视觉";
  const preset = resolvePreset(userRequest, outputDir);
  const jobFile = path.join(outputDir, ".media-jobs", `image-${preset.request_id}.json`);
  const promptOutput = path.join(outputDir, "resume-prompt.txt");
  let complete = false;
  let acceptedJournalSeen = false;
  const mock = await createMockMediaServer({
    imageStatus: () => {
      const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
      acceptedJournalSeen ||= job.task_id === "image-task" && job.state === "accepted";
      return complete
        ? { status: "completed", progress: "100", video_url: `${mock.baseUrl}/result-image.png` }
        : { is_final: false, state: "running", progress: "10", result_url: "" };
    },
  });
  const args = [
    "--prompt",
    "abstract blue geometric visual",
    "--user-request",
    userRequest,
    "--preset-check-file",
    preset.check_file,
    "--prompt-output",
    promptOutput,
    "--base-url",
    `${mock.baseUrl}/v1`,
    "--output-dir",
    outputDir,
    "--basename",
    "resume-image",
    "--timeout",
    "1",
    "--poll-interval",
    "1",
  ];
  try {
    const pending = await runJsonAsync(imageScript, args);
    assert.equal(pending.ok, false);
    assert.equal(pending.pending, true);
    assert.equal(pending.safe_to_resubmit, false);
    assert.equal(pending.task_id, "image-task");
    assert.equal(mock.imageSubmitCount, 1);
    assert.equal(acceptedJournalSeen, true);
    const pendingJob = JSON.parse(fs.readFileSync(jobFile, "utf8"));
    assert.equal(pendingJob.state, "pending");
    assert.equal(pendingJob.task_id, "image-task");
    assert.match(pendingJob.payload_sha256, /^[a-f0-9]{64}$/);
    const originalPromptAudit = fs.readFileSync(promptOutput, "utf8");

    const changedParams = await runProcessJsonAsync(imageScript, [...args, "--size", "1024x1024"]);
    assert.equal(changedParams.status, 3);
    assert.equal(changedParams.payload.error_class, "request");
    assert.equal(mock.imageSubmitCount, 1);

    const driftArgs = [...args];
    driftArgs[driftArgs.indexOf("--prompt") + 1] = "changed prompt that must not replace the audit file";
    const changedPrompt = await runProcessJsonAsync(imageScript, driftArgs);
    assert.equal(changedPrompt.status, 3);
    assert.equal(changedPrompt.payload.error_class, "request");
    assert.equal(fs.readFileSync(promptOutput, "utf8"), originalPromptAudit);
    assert.equal(mock.imageSubmitCount, 1);

    complete = true;
    const resumed = await runJsonAsync(imageScript, [...args.slice(0, -4), "--timeout", "5", "--poll-interval", "1"]);
    assert.equal(resumed.ok, true);
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.task_id, "image-task");
    assert.equal(fs.existsSync(resumed.saved[0]), true);
    assert.equal(mock.imageSubmitCount, 1);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("ambiguous image submit failures never POST the same gated request again", async () => {
  const mock = await createMockMediaServer({
    onImageSubmit: () => ({ statusCode: 502, body: { error: "upstream response lost" } }),
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-ambiguous-submit-"));
  try {
    const userRequest = "生成抽象紫色几何视觉";
    const preset = resolvePreset(userRequest, outputDir);
    const args = [
      "--prompt",
      userRequest,
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--output-dir",
      outputDir,
      "--basename",
      "ambiguous-image",
    ];

    const first = await runJsonAsync(imageScript, args);
    assert.equal(first.pending, true);
    assert.equal(first.state, "reconciling");
    assert.equal(first.task_id, null);
    assert.equal(first.safe_to_resubmit, false);
    assert.equal(mock.imageSubmitCount, 1);

    const second = await runJsonAsync(imageScript, args);
    assert.equal(second.pending, true);
    assert.equal(second.task_id, null);
    assert.match(second.retry_action, /do_not_retry_automatically/);
    assert.equal(mock.imageSubmitCount, 1);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("structured retryable route exhaustion authorizes the next image fallback without resubmitting", async () => {
  const machineError = {
    code: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
    category: "remote",
    retryable: true,
    retry_after_ms: 60_000,
    request_id: "relay-image-route-exhausted",
    upstream_status: 502,
    route_exhausted: true,
  };
  const mock = await createMockMediaServer({
    onImageSubmit: () => ({
      statusCode: 502,
      body: {
        error: {
          type: "upstream_error",
          message: "Upstream service temporarily unavailable",
          ...machineError,
        },
      },
    }),
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-route-exhausted-"));
  try {
    const userRequest = "生成抽象橙色几何视觉";
    const preset = resolvePreset(userRequest, outputDir);
    const args = [
      "--prompt",
      userRequest,
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--model",
      "gpt-image-2-1k",
      "--output-dir",
      outputDir,
      "--basename",
      "route-exhausted-image",
    ];

    const first = await runProcessJsonAsync(imageScript, args);
    assert.equal(first.status, 3);
    assert.equal(first.payload.pending, false);
    assert.equal(first.payload.state, "failed");
    assert.equal(first.payload.safe_to_resubmit, true);
    assert.equal(first.payload.fallback_allowed, true);
    assert.equal(first.payload.fallback_reason, "authoritative_retryable_route_exhaustion");
    assert.equal(first.payload.fallback_model, "gpt-image-2-2k");
    assert.deepEqual(first.payload.fallback_models, ["gpt-image-2-2k", "gpt-image-2-3.5k"]);
    assert.deepEqual(first.payload.machine_error, {
      category: machineError.category,
      code: machineError.code,
      request_id: machineError.request_id,
      retry_after_ms: machineError.retry_after_ms,
      retryable: machineError.retryable,
      route_exhausted: machineError.route_exhausted,
      upstream_status: machineError.upstream_status,
    });
    assert.equal(mock.imageSubmitCount, 1);

    const job = JSON.parse(
      fs.readFileSync(
        path.join(outputDir, ".media-jobs", `image-${preset.request_id}.json`),
        "utf8",
      ),
    );
    assert.equal(job.state, "failed");
    assert.equal(job.accepted, false);
    assert.equal(job.terminal, true);
    assert.deepEqual(job.machine_error, machineError);

    const resumed = await runProcessJsonAsync(imageScript, args);
    assert.equal(resumed.status, 3);
    assert.equal(resumed.payload.fallback_allowed, true);
    assert.equal(resumed.payload.fallback_model, "gpt-image-2-2k");
    assert.equal(mock.imageSubmitCount, 1);

    const legacyJob = {
      ...job,
      state: "reconciling",
      last_error: `HTTP 502: ${JSON.stringify({
        error: {
          type: "upstream_error",
          message: "Upstream service temporarily unavailable",
          ...machineError,
        },
      })}`,
    };
    for (const field of ["accepted", "terminal", "error_class", "http_status", "machine_error"]) {
      delete legacyJob[field];
    }
    const jobFile = path.join(outputDir, ".media-jobs", `image-${preset.request_id}.json`);
    fs.writeFileSync(jobFile, `${JSON.stringify(legacyJob, null, 2)}\n`);

    const migrated = await runProcessJsonAsync(imageScript, args);
    assert.equal(migrated.status, 3);
    assert.equal(migrated.payload.fallback_allowed, true);
    assert.equal(migrated.payload.fallback_model, "gpt-image-2-2k");
    assert.deepEqual(migrated.payload.machine_error, machineError);
    assert.equal(mock.imageSubmitCount, 1);
    const migratedJob = JSON.parse(fs.readFileSync(jobFile, "utf8"));
    assert.equal(migratedJob.state, "failed");
    assert.equal(migratedJob.accepted, false);
    assert.equal(migratedJob.terminal, true);
    assert.deepEqual(migratedJob.machine_error, machineError);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("route exhaustion after image task acceptance does not switch models", async () => {
  const machineError = {
    code: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
    category: "remote",
    retryable: true,
    retry_after_ms: null,
    request_id: null,
    upstream_status: 502,
    route_exhausted: true,
  };
  const mock = await createMockMediaServer({
    imageStatus: {
      is_final: true,
      state: "failed",
      error: machineError,
    },
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-accepted-route-exhausted-"));
  try {
    const userRequest = "create an accepted task that later fails";
    const preset = resolvePreset(userRequest, outputDir);
    const result = await runProcessJsonAsync(imageScript, [
      "--prompt",
      userRequest,
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--output-dir",
      outputDir,
      "--basename",
      "accepted-route-exhausted",
      "--timeout",
      "5",
      "--poll-interval",
      "1",
    ]);

    assert.equal(result.status, 3);
    assert.equal(result.payload.pending, false);
    assert.equal(result.payload.task_id, "image-task");
    assert.equal(result.payload.fallback_allowed, false);
    assert.equal(result.payload.safe_to_resubmit, false);
    assert.deepEqual(result.payload.machine_error, machineError);
    assert.equal(mock.imageSubmitCount, 1);
    assert.equal(mock.imageStatusCount, 1);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("malformed 2xx submit responses become structured reconciliation without another POST", async () => {
  const mock = await createMockMediaServer({
    onImageSubmit: () => ({ statusCode: 200, rawBody: "not-json" }),
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-malformed-submit-"));
  try {
    const userRequest = "生成抽象青色几何视觉";
    const preset = resolvePreset(userRequest, outputDir);
    const args = [
      "--prompt",
      userRequest,
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--output-dir",
      outputDir,
      "--basename",
      "malformed-image",
    ];

    const first = await runJsonAsync(imageScript, args);
    assert.equal(first.pending, true);
    assert.equal(first.state, "reconciling");
    assert.match(first.error, /(?:Invalid|Expected) JSON/);
    assert.equal(mock.imageSubmitCount, 1);

    const second = await runJsonAsync(imageScript, args);
    assert.equal(second.pending, true);
    assert.equal(second.task_id, null);
    assert.equal(mock.imageSubmitCount, 1);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("concurrent invocations of one preset check acquire one submit owner", async () => {
  const mock = await createMockMediaServer({
    onImageSubmit: async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-concurrent-"));
  try {
    const userRequest = "生成抽象绿色几何视觉";
    const preset = resolvePreset(userRequest, outputDir);
    const args = [
      "--prompt",
      userRequest,
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--output-dir",
      outputDir,
      "--basename",
      "concurrent-image",
      "--timeout",
      "5",
      "--poll-interval",
      "1",
    ];

    const results = await Promise.all([runJsonAsync(imageScript, args), runJsonAsync(imageScript, args)]);
    assert.equal(mock.imageSubmitCount, 1);
    assert.equal(results.some((result) => result.ok === true), true);
    assert.equal(results.some((result) => result.state === "active_elsewhere"), true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("one preset check keeps one journal even when a retry changes output directory", async () => {
  const mock = await createMockMediaServer();
  const checkOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-stable-journal-"));
  const otherOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-other-output-"));
  try {
    const userRequest = "生成抽象橙色几何视觉";
    const preset = resolvePreset(userRequest, checkOutputDir);
    const common = [
      "--prompt",
      userRequest,
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--basename",
      "stable-journal-image",
      "--timeout",
      "5",
      "--poll-interval",
      "1",
    ];

    const first = await runJsonAsync(imageScript, [...common, "--output-dir", checkOutputDir]);
    assert.equal(first.ok, true);
    assert.equal(mock.imageSubmitCount, 1);

    const movedOutput = await runProcessJsonAsync(imageScript, [...common, "--output-dir", otherOutputDir]);
    assert.equal(movedOutput.status, 3);
    assert.equal(movedOutput.payload.error_class, "request");
    assert.equal(mock.imageSubmitCount, 1);
  } finally {
    fs.rmSync(checkOutputDir, { recursive: true, force: true });
    fs.rmSync(otherOutputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("image skill sends tier-model reference URLs through the documented fields", () => {
  const dryRun = runJson(imageScript, [
    "--prompt",
    "use both references",
    "--model",
    "gpt-image-2-2k",
    "--exact-model",
    "--image-url",
    "https://example.com/ref-1.png",
    "--image-url",
    "https://example.com/ref-2.png",
    "--aspect-ratio",
    "16:9",
    "--dry-run",
  ]);

  assert.deepEqual(dryRun.payload, {
    model: "gpt-image-2-2k",
    prompt: "use both references",
    aspect_ratio: "16:9",
    reference_image_urls: [
      "https://example.com/ref-1.png",
      "https://example.com/ref-2.png",
    ],
  });
  assert.equal(dryRun.api_url, "https://haolo.pro/v1/videos");
  assert.equal(
    dryRun.status_url_template,
    "https://haolo.pro/v1/videos/<TASK_ID>",
  );
});

test("image Director maps the final Buming image2 fallback to its distinct contract", () => {
  const dryRun = runJson(
    imageScript,
    [
      "--prompt",
      "use both references",
      "--model",
      "image2",
      "--image-url",
      "https://example.com/ref-1.png",
      "--image-url",
      "https://example.com/ref-2.png",
      "--size",
      "1024x1536",
      "--dry-run",
    ],
    {
      LLMHUB_API_KEY: "",
      LLMHUB_BASE_URL: "",
      OPENAI_API_KEY: "test-openai-image-key",
      OPENAI_BASE_URL: "https://haolo.pro/v1",
    },
  );

  assert.equal(dryRun.credential_source, "environment:OPENAI_API_KEY");
  assert.equal(dryRun.api_url, "https://haolo.pro/v1/images/generations");
  assert.deepEqual(dryRun.payload, {
    model: "image2",
    prompt: "use both references",
    size: "1024x1536",
    quality: "high",
    response_format: "url",
    n: 1,
    image: [
      "https://example.com/ref-1.png",
      "https://example.com/ref-2.png",
    ],
  });
});

test("image skill uses the documented base edit and asynchronous-only 1K routes", () => {
  const edit = runJson(imageScript, [
    "--prompt",
    "edit this image",
    "--model",
    "gpt-image-2",
    "--image-url",
    "https://example.com/ref.png",
    "--dry-run",
  ]);
  assert.equal(edit.api_url, "https://haolo.pro/v1/images/edits");
  assert.deepEqual(edit.payload, {
    model: "aihubcc/gpt-image-2",
    prompt: "edit this image",
    image: "https://example.com/ref.png",
  });

  const oneK = runJson(imageScript, [
    "--prompt",
    "draw at 1K",
    "--model",
    "gpt-image-2-1k",
    "--exact-model",
    "--dry-run",
  ]);
  assert.equal(oneK.api_url, "https://haolo.pro/v1/videos");
  assert.equal(
    oneK.status_url_template,
    "https://haolo.pro/v1/videos/<TASK_ID>",
  );
  assert.deepEqual(oneK.payload, {
    model: "gpt-image-2-1k",
    prompt: "draw at 1K",
    aspect_ratio: "1:1",
  });
});

test("image endpoint overrides still derive the documented route for each model", () => {
  const edit = runJson(
    imageScript,
    [
      "--prompt",
      "edit this image",
      "--image-url",
      "https://example.com/ref.png",
      "--api-url",
      "https://relay.example/v1/images/generations",
      "--dry-run",
    ],
  );
  assert.equal(edit.api_url, "https://relay.example/v1/images/edits");

  const asyncImage = runJson(
    imageScript,
    [
      "--prompt",
      "draw at 2K",
      "--model",
      "gpt-image-2-2k",
      "--exact-model",
      "--api-url",
      "https://relay.example/v1/videos/generations",
      "--dry-run",
    ],
  );
  assert.equal(asyncImage.api_url, "https://relay.example/v1/videos");
  assert.equal(
    asyncImage.status_url_template,
    "https://relay.example/v1/videos/<TASK_ID>",
  );
});

test("image Director has no output-count option and rejects model-incompatible sizes", () => {
  const countResult = spawnSync(
    python,
    [imageScript, "--prompt", "red cube", "--n", "2", "--dry-run"],
    {
      cwd: path.resolve("."),
      env: baseEnv(),
      encoding: "utf8",
    },
  );
  assert.notEqual(countResult.status, 0);
  assert.match(countResult.stderr, /unrecognized arguments: --n 2/);

  const baseSizeResult = spawnSync(
    python,
    [imageScript, "--prompt", "red cube", "--size", "2048x2048", "--dry-run"],
    {
      cwd: path.resolve("."),
      env: baseEnv(),
      encoding: "utf8",
    },
  );
  assert.notEqual(baseSizeResult.status, 0);
  assert.match(baseSizeResult.stderr, /invalid choice/);

  const asyncSizeResult = spawnSync(
    python,
    [
      imageScript,
      "--prompt",
      "red cube",
      "--model",
      "gpt-image-2-2k",
      "--exact-model",
      "--size",
      "1536x1024",
      "--dry-run",
    ],
    {
      cwd: path.resolve("."),
      env: baseEnv(),
      encoding: "utf8",
    },
  );
  assert.notEqual(asyncSizeResult.status, 0);
  const asyncSizeError = JSON.parse(asyncSizeResult.stdout.trim());
  assert.equal(asyncSizeError.error_class, "request");
  assert.match(asyncSizeError.error, /uses --aspect-ratio, not --size/);
});

test("base image edit downloads one reference and submits multipart form data", async () => {
  const mock = await createMockMediaServer();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-edit-flow-"));
  try {
    const userRequest = "edit mock image";
    const preset = resolvePreset(userRequest, outputDir);
    const result = await runJsonAsync(imageScript, [
      "--prompt",
      "edit mock image",
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--model",
      "gpt-image-2",
      "--image-url",
      `${mock.baseUrl}/reference-image.png`,
      "--output-dir",
      outputDir,
      "--basename",
      "mock-image-edit",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.source_url, `${mock.baseUrl}/result-image.png`);
    const submit = mock.requests.find(
      (entry) => entry.method === "POST" && entry.path === "/v1/images/edits",
    );
    assert.equal(typeof submit.body, "string");
    assert.match(submit.body, /name="model"\r\n\r\naihubcc\/gpt-image-2/);
    assert.match(submit.body, /name="prompt"/);
    assert.match(submit.body, /name="image"; filename="reference\.png"/);
    assert.equal(
      submit.headers["x-haolo-reference-image-url"],
      `${mock.baseUrl}/reference-image.png`,
    );
    assert.equal(
      mock.requests.some(
        (entry) =>
          entry.method === "POST" &&
          entry.path === "/v1/images/generations",
      ),
      false,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("image Director saves one artifact when sync response repeats one image as URL and Base64", async () => {
  const imageBytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  let mock;
  mock = await createMockMediaServer({
    onImageSubmit: () => ({
      body: {
        data: [
          { url: `${mock.baseUrl}/result-image.png` },
          { b64_json: imageBytes.toString("base64") },
        ],
      },
    }),
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-deduplicate-"));
  try {
    const userRequest = "deduplicate one sync image";
    const preset = resolvePreset(userRequest, outputDir);
    const result = await runJsonAsync(imageScript, [
      "--prompt",
      userRequest,
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--output-dir",
      outputDir,
      "--basename",
      "deduplicated-image",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.source_urls.length, 2);
    assert.equal(result.saved.length, 1);
    assert.equal(fs.existsSync(result.saved[0]), true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("strict edit hardens the prompt, uses multipart edits, and journals source-image proof", async () => {
  const mock = await createMockMediaServer();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-strict-image-edit-"));
  try {
    const userRequest = "remove only the red scarf";
    const preset = resolvePreset(userRequest, outputDir);
    const referenceUrl = `${mock.baseUrl}/reference-image.png`;
    const result = await runJsonAsync(imageScript, [
      "--prompt",
      userRequest,
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--model",
      "gpt-image-2",
      "--image-url",
      referenceUrl,
      "--strict-edit",
      "--output-dir",
      outputDir,
      "--basename",
      "strict-image-edit",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.operation_mode, "strict_edit");
    assert.deepEqual(result.reference_delivery, {
      count: 1,
      transport: "multipart/form-data",
      field: "image",
      endpoint: `${mock.baseUrl}/v1/images/edits`,
      strict_edit: true,
    });
    assert.equal(result.reference_images.length, 1);
    assert.equal(result.reference_images[0].mime_type, "image/png");
    assert.equal(result.reference_images[0].byte_length, 24);
    assert.equal(result.reference_images[0].width, 1);
    assert.equal(result.reference_images[0].height, 1);
    assert.equal(
      result.reference_images[0].url_sha256,
      crypto.createHash("sha256").update(referenceUrl).digest("hex"),
    );
    assert.equal(
      result.reference_images[0].content_sha256,
      crypto.createHash("sha256").update(
        Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex"),
      ).digest("hex"),
    );

    const submit = mock.requests.find((entry) => entry.path === "/v1/images/edits");
    assert.match(submit.body, /STRICT LOCAL EDIT CONTRACT/);
    assert.match(submit.body, /Modify only the explicitly requested regions/);
    assert.equal(mock.requests.some((entry) => entry.path === "/v1/images/generations"), false);

    const journal = JSON.parse(fs.readFileSync(
      path.join(outputDir, ".media-jobs", `image-${preset.request_id}.json`),
      "utf8",
    ));
    assert.equal(journal.strict_edit, true);
    assert.deepEqual(journal.reference_delivery, result.reference_delivery);
    assert.deepEqual(journal.reference_images, result.reference_images);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("selected 1K strict edit submits an async reference task and only completes on completed", async () => {
  const mock = await createMockMediaServer({
    imageStatus: ({ imageStatusCount, baseUrl }) =>
      imageStatusCount === 1
        ? { status: "succeeded", progress: 100, video_url: `${baseUrl}/result-image.png` }
        : { status: "completed", progress: 100 },
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-1k-reference-edit-"));
  try {
    const userRequest = "change only the skirt to pale yellow";
    const preset = resolvePreset(userRequest, outputDir);
    const referenceUrl = `${mock.baseUrl}/reference-image.png`;
    const result = await runJsonAsync(imageScript, [
      "--prompt", userRequest,
      "--user-request", userRequest,
      "--preset-check-file", preset.check_file,
      "--base-url", `${mock.baseUrl}/v1`,
      "--model", "gpt-image-2-1k-async",
      "--exact-model",
      "--image-url", referenceUrl,
      "--strict-edit",
      "--aspect-ratio", "1:1",
      "--poll-interval", "1",
      "--output-dir", outputDir,
      "--basename", "one-k-reference-edit",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.model, "gpt-image-2-1k");
    assert.equal(result.operation_mode, "reference_edit");
    assert.equal(mock.imageSubmitCount, 1);
    assert.equal(mock.imageStatusCount, 2);
    const submit = mock.requests.find((entry) => entry.path === "/v1/videos");
    assert.ok(submit);
    assert.equal(submit.body.model, "gpt-image-2-1k");
    assert.equal(submit.body.aspect_ratio, "1:1");
    assert.equal("size" in submit.body, false);
    assert.deepEqual(submit.body.reference_image_urls, [referenceUrl]);
    assert.match(submit.body.prompt, /REFERENCE-GUIDED EDIT CONTRACT/);
    assert.equal(
      mock.requests.some((entry) => entry.path === "/v1/videos/image-async-task/content"),
      true,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("strict edit permits asynchronous reference tiers and advances only after a safe rejection", async () => {
  const asyncTierProcess = spawnSync(python, [
    imageScript,
    "--prompt", "edit only the scarf",
    "--model", "gpt-image-2-2k",
    "--exact-model",
    "--image-url", "https://example.com/reference.png",
    "--strict-edit",
    "--dry-run",
  ], {
    cwd: path.resolve("."),
    env: baseEnv(),
    encoding: "utf8",
  });
  const asyncTier = {
    status: asyncTierProcess.status,
    payload: JSON.parse(asyncTierProcess.stdout),
  };
  assert.equal(asyncTier.status, 0);
  assert.equal(asyncTier.payload.operation_mode, "reference_edit");
  assert.equal(asyncTier.payload.api_url, "https://haolo.pro/v1/videos");
  assert.deepEqual(asyncTier.payload.payload.reference_image_urls, ["https://example.com/reference.png"]);

  const machineError = {
    category: "transport",
    code: "SERVICE_TEMPORARILY_UNAVAILABLE",
    message: "No available compatible accounts",
    request_id: "strict-edit-route-unavailable",
    retry_after_ms: 0,
    retryable: true,
    route_exhausted: false,
    type: "api_error",
    upstream_status: 0,
  };
  const mock = await createMockMediaServer({
    onImageSubmit: () => ({ statusCode: 503, body: { error: machineError } }),
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-strict-image-unavailable-"));
  try {
    const userRequest = "edit only the scarf without changing anything else";
    const preset = resolvePreset(userRequest, outputDir);
    const result = await runProcessJsonAsync(imageScript, [
      "--prompt",
      userRequest,
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--image-url",
      `${mock.baseUrl}/reference-image.png`,
      "--strict-edit",
      "--output-dir",
      outputDir,
      "--basename",
      "strict-image-unavailable",
    ]);

    assert.equal(result.status, 3);
    assert.equal(result.payload.state, "failed");
    assert.equal(result.payload.fallback_allowed, true);
    assert.equal(result.payload.fallback_model, "gpt-image-2-1k");
    assert.deepEqual(result.payload.fallback_models, [
      "gpt-image-2-1k",
      "gpt-image-2-2k",
      "gpt-image-2-3.5k",
    ]);
    assert.equal(result.payload.fallback_blocked_reason, null);
    assert.equal(mock.imageSubmitCount, 2);
    assert.equal(
      mock.requests.filter((entry) => entry.path === "/v1/images/edits").length,
      2,
    );
    assert.equal(mock.requests.some((entry) => entry.path === "/v1/images/generations"), false);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("base image edit retries once without optional media routing after a pre-submit catalog policy mismatch", async () => {
  const mock = await createMockMediaServer({
    onImageSubmit: ({ imageSubmitCount }) => {
      if (imageSubmitCount === 1) {
        return {
          statusCode: 403,
          body: {
            error: {
              category: "policy",
              code: "PERMISSION_DENIED",
              message: 'model "aihubcc/gpt-image-2" is not enabled for 媒体创作',
              request_id: "image-edit-policy-mismatch",
              retry_after_ms: 0,
              retryable: false,
              route_exhausted: false,
              type: "permission_error",
              upstream_status: 0,
            },
          },
        };
      }
      return undefined;
    },
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-edit-policy-retry-"));
  try {
    const userRequest = "edit the reference without changing identity";
    const preset = resolvePreset(userRequest, outputDir);
    const result = await runJsonAsync(imageScript, [
      "--prompt",
      userRequest,
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--model",
      "gpt-image-2",
      "--image-url",
      `${mock.baseUrl}/reference-image.png`,
      "--interaction-id",
      "image-edit-policy-retry",
      "--conversation-id",
      "image-edit-policy-retry-thread",
      "--source-type",
      "multi_model_cluster_node",
      "--output-dir",
      outputDir,
      "--basename",
      "image-edit-policy-retry",
    ]);

    assert.equal(result.ok, true);
    const submits = mock.requests.filter((entry) => entry.path === "/v1/images/edits");
    assert.equal(submits.length, 2);
    assert.equal(submits[0].headers["x-haolo-model-pool"], "media_creation");
    assert.equal(submits[0].headers["x-haolo-model-capability"], "image_generation");
    assert.equal(submits[1].headers["x-haolo-model-pool"], undefined);
    assert.equal(submits[1].headers["x-haolo-model-capability"], undefined);
    assert.equal(submits[1].headers["x-haolo-interaction-id"], "image-edit-policy-retry");
    assert.equal(
      submits[1].headers["x-haolo-conversation-id"],
      "image-edit-policy-retry-thread",
    );
    assert.equal(
      submits[1].headers["x-haolo-source-type"],
      "multi_model_cluster_node",
    );
    assert.equal(
      submits[1].headers["x-haolo-reference-image-url"],
      `${mock.baseUrl}/reference-image.png`,
    );
    assert.equal(submits[0].body, submits[1].body);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("base image edit retries once without optional media routing after a pre-provider 503", async () => {
  const machineError = {
    category: "transport",
    code: "SERVICE_TEMPORARILY_UNAVAILABLE",
    message: "No available compatible accounts",
    request_id: "image-edit-compatible-account-retry",
    retry_after_ms: 0,
    retryable: true,
    route_exhausted: false,
    type: "api_error",
    upstream_status: 0,
  };
  const mock = await createMockMediaServer({
    onImageSubmit: ({ imageSubmitCount }) => (
      imageSubmitCount === 1
        ? { statusCode: 503, body: { error: machineError } }
        : undefined
    ),
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-edit-account-retry-"));
  try {
    const userRequest = "edit the image after a compatible-account routing miss";
    const preset = resolvePreset(userRequest, outputDir);
    const result = await runJsonAsync(imageScript, [
      "--prompt",
      userRequest,
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--model",
      "gpt-image-2",
      "--image-url",
      `${mock.baseUrl}/reference-image.png`,
      "--output-dir",
      outputDir,
      "--basename",
      "image-edit-account-retry",
    ]);

    assert.equal(result.ok, true);
    const submits = mock.requests.filter((entry) => entry.path === "/v1/images/edits");
    assert.equal(submits.length, 2);
    assert.equal(submits[0].headers["x-haolo-model-pool"], "media_creation");
    assert.equal(submits[1].headers["x-haolo-model-pool"], undefined);
    assert.equal(submits[1].headers["x-haolo-model-capability"], undefined);
    assert.equal(submits[0].body, submits[1].body);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("repeated pre-provider 503 authorizes the selected Image2 provider fallback without an ambiguous journal", async () => {
  const machineError = {
    category: "transport",
    code: "SERVICE_TEMPORARILY_UNAVAILABLE",
    message: "No available compatible accounts",
    request_id: "image-edit-compatible-account-exhausted",
    retry_after_ms: 0,
    retryable: true,
    route_exhausted: false,
    type: "api_error",
    upstream_status: 0,
  };
  const mock = await createMockMediaServer({
    onImageSubmit: () => ({ statusCode: 503, body: { error: machineError } }),
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-edit-account-exhausted-"));
  try {
    const userRequest = "edit the image through an available Image2 provider";
    const preset = resolvePreset(userRequest, outputDir);
    const args = [
      "--prompt",
      userRequest,
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--model",
      "gpt-image-2",
      "--exact-model",
      "--provider-fallback-only",
      "--image-url",
      `${mock.baseUrl}/reference-image.png`,
      "--output-dir",
      outputDir,
      "--basename",
      "image-edit-account-exhausted",
    ];

    const first = await runProcessJsonAsync(imageScript, args);
    assert.equal(first.status, 3);
    assert.equal(first.payload.pending, false);
    assert.equal(first.payload.state, "failed");
    assert.equal(first.payload.safe_to_resubmit, true);
    assert.equal(first.payload.fallback_allowed, true);
    assert.equal(first.payload.fallback_model, "gpt-image-2-1k");
    assert.equal(
      first.payload.fallback_reason,
      "authoritative_pre_provider_route_failure",
    );
    assert.deepEqual(first.payload.machine_error, {
      category: machineError.category,
      code: machineError.code,
      request_id: machineError.request_id,
      retry_after_ms: machineError.retry_after_ms,
      retryable: machineError.retryable,
      route_exhausted: machineError.route_exhausted,
      upstream_status: machineError.upstream_status,
    });
    assert.equal(mock.imageSubmitCount, 2);

    const resumed = await runProcessJsonAsync(imageScript, args);
    assert.equal(resumed.status, 3);
    assert.equal(resumed.payload.fallback_allowed, true);
    assert.equal(resumed.payload.fallback_model, "gpt-image-2-1k");
    assert.equal(mock.imageSubmitCount, 2);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("async 2K image completes relay submit, media polling, and download", async () => {
  const mock = await createMockMediaServer();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-image-2k-flow-"));
  try {
    const userRequest = "mock 2k image";
    const preset = resolvePreset(userRequest, outputDir);
    const result = await runJsonAsync(imageScript, [
      "--prompt",
      "mock 2k image",
      "--user-request",
      userRequest,
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--model",
      "gpt-image-2-2k",
      "--exact-model",
      "--aspect-ratio",
      "3:2",
      "--output-dir",
      outputDir,
      "--basename",
      "mock-image-2k",
      "--timeout",
      "5",
      "--poll-interval",
      "1",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.model, "gpt-image-2-2k");
    assert.equal(result.task_id, "image-async-task");
    assert.equal(result.source_url, `${mock.baseUrl}/result-image.png`);
    assert.equal(fs.existsSync(result.saved[0]), true);
    const submit = mock.requests.find(
      (entry) =>
        entry.method === "POST" &&
        entry.path === "/v1/videos" &&
        entry.body?.model === "gpt-image-2-2k",
    );
    assert.deepEqual(submit.body, {
      model: "gpt-image-2-2k",
      prompt: "mock 2k image",
      aspect_ratio: "3:2",
    });
    assert.ok(
      mock.requests.some(
        (entry) =>
          entry.method === "GET" &&
          entry.path === "/v1/videos/image-async-task",
      ),
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("image skill correlates the fixed generation charge with the current Haolo conversation", async () => {
  const mock = await createMockMediaServer();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-image-billing-correlation-"));
  try {
    const preset = resolvePreset("draw a billed cat", outputDir);
    const result = await runJsonAsync(imageScript, [
      "--prompt",
      "draw a billed cat",
      "--user-request",
      "draw a billed cat",
      "--preset-check-file",
      preset.check_file,
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--allow-insecure-http",
      "--conversation-id",
      "thread-image-billing-correlation",
      "--output-dir",
      outputDir,
      "--basename",
      "billed-cat",
      "--timeout",
      "5",
      "--poll-interval",
      "1",
    ]);

    assert.equal(result.ok, true);
    const submit = mock.requests.find(
      (entry) => entry.method === "POST" && entry.path === "/v1/images/generations",
    );
    assert.equal(
      submit.headers["x-haolo-conversation-id"],
      "thread-image-billing-correlation",
    );
    assert.equal(submit.headers["x-haolo-interaction-id"], undefined);
    assert.equal(submit.headers["x-haolo-model-pool"], "media_creation");
    assert.equal(
      submit.headers["x-haolo-model-capability"],
      "image_generation",
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("Buming image2 fallback preserves references and bypasses media-pool routing headers", async () => {
  const mock = await createMockMediaServer({
    onImageSubmit: ({ body }) => (
      body?.model === "image2"
        ? { body: { data: [{ url: `${mock.baseUrl}/result-image.png` }] } }
        : null
    ),
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "buming-image2-flow-"));
  try {
    const userRequest = "combine two references with Buming image2";
    const preset = resolvePreset(userRequest, outputDir);
    const referenceUrl = `${mock.baseUrl}/reference-image.png`;
    const result = await runJsonAsync(
      imageScript,
      [
        "--prompt",
        userRequest,
        "--user-request",
        userRequest,
        "--preset-check-file",
        preset.check_file,
        "--base-url",
        `${mock.baseUrl}/v1`,
        "--model",
        "image2",
        "--image-url",
        referenceUrl,
        "--image-url",
        referenceUrl,
        "--size",
        "1024x1536",
        "--output-dir",
        outputDir,
        "--basename",
        "buming-image2",
        "--timeout",
        "5",
      ],
      {
        LLMHUB_API_KEY: "",
        LLMHUB_BASE_URL: "",
        OPENAI_API_KEY: "test-openai-image-key",
        OPENAI_BASE_URL: `${mock.baseUrl}/v1`,
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.model, "image2");
    assert.equal(result.task_id, null);
    assert.equal(fs.existsSync(result.saved[0]), true);
    const submit = mock.requests.find(
      (entry) =>
        entry.method === "POST" &&
        entry.path === "/v1/images/generations" &&
        entry.body?.model === "image2",
    );
    assert.deepEqual(submit.body, {
      model: "image2",
      prompt: userRequest,
      size: "1024x1536",
      quality: "high",
      response_format: "url",
      n: 1,
      image: [referenceUrl, referenceUrl],
    });
    assert.equal(submit.headers.authorization, "Bearer test-openai-image-key");
    assert.equal(submit.headers["x-haolo-model-pool"], undefined);
    assert.equal(submit.headers["x-haolo-model-capability"], undefined);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("image Director maps 1K, 2K, and 3.5K client ratios to aspect_ratio", () => {
  for (const model of ["gpt-image-2-1k", "gpt-image-2-2k", "gpt-image-2-3.5k"]) {
    const dryRun = runJson(imageScript, [
      "--prompt",
      "wide cinematic landscape",
      "--model",
      model,
      "--exact-model",
      "--aspect-ratio",
      "16:9",
      "--dry-run",
    ]);

    assert.equal(dryRun.payload.model, model);
    assert.equal(dryRun.payload.aspect_ratio, "16:9");
    assert.equal("size" in dryRun.payload, false);
  }

  const adaptive = runJson(imageScript, [
    "--prompt",
    "compose adaptively",
    "--model",
    "gpt-image-2-3.5k",
    "--exact-model",
    "--aspect-ratio",
    "auto",
    "--dry-run",
  ]);
  assert.equal(adaptive.payload.aspect_ratio, "1:1");
  assert.equal("size" in adaptive.payload, false);
});

test("image skill ignores Codex OPENAI_BASE_URL when bundled Youle config is present", () => {
  const dryRun = runJson(imageScript, ["--prompt", "red cube", "--dry-run"], {
    LLMHUB_BASE_URL: "",
    SUB2API_BASE_URL: "",
    TRANSIT_BASE_URL: "",
    MODEL_BASE_URL: "",
    OPENAI_BASE_URL: "https://chatgpt.com:18080/backend-api/codex",
  });

  assert.equal(dryRun.endpoint_source, "haolo_default_config");
  assert.equal(dryRun.api_url, "https://haolo.pro/v1/images/generations");
  assert.equal(dryRun.status_url_template, "https://haolo.pro/v1/media/status?task_id=<TASK_ID>");
});

test("video skill defaults to the documented Grok 1.5 asynchronous contract", () => {
  const imageUrl = "https://example.com/first-frame.png";
  const dryRun = runJson(videoScript, ["--prompt", "red cube rotates", "--image-url", imageUrl, "--dry-run"]);

  assert.equal(dryRun.submit_url, "https://haolo.pro/v1/videos");
  assert.equal(dryRun.status_url_template, "https://haolo.pro/v1/videos/<TASK_ID>");
  assert.equal(dryRun.credential_source, "environment:LLMHUB_API_KEY");
  assert.match(dryRun.http_transport, /^(curl|urllib)$/);
  assert.equal(dryRun.payload.model, "grok-imagine-video-1.5");
  assert.equal(dryRun.payload.prompt, "red cube rotates");
  assert.deepEqual(dryRun.fallback_models, [
    "aihubcc/grok-video-3.5",
    "omni-fast-no-water",
  ]);
  assert.deepEqual(dryRun.payload, {
    model: "grok-imagine-video-1.5",
    prompt: "red cube rotates",
    image: imageUrl,
    seconds: "6",
    aspect_ratio: "16:9",
    resolution: "720p",
  });
});

test("video skill maps the Buming Grok provider fallback to its distinct contract", () => {
  const imageUrl = "https://example.com/first-frame.png";
  const dryRun = runJson(videoScript, [
    "--prompt",
    "camera pushes in",
    "--model",
    "aihubcc/grok-video-3.5",
    "--image-url",
    imageUrl,
    "--aspect-ratio",
    "9:16",
    "--resolution",
    "720p",
    "--duration",
    "10",
    "--dry-run",
  ]);

  assert.equal(dryRun.payload.model, "aihubcc/grok-video-3.5");
  assert.deepEqual(dryRun.payload, {
    model: "aihubcc/grok-video-3.5",
    prompt: "camera pushes in",
    params: {
      images: [imageUrl],
      aspect_ratio: "9:16",
      resolution: "720p",
      duration: 10,
    },
  });
  assert.deepEqual(dryRun.fallback_models, ["omni-fast-no-water"]);
});

test("video expert provider-only mode locks selected Grok and exposes only Buming Grok", () => {
  const dryRun = runJson(videoScript, [
    "--prompt",
    "camera pushes in",
    "--model",
    "grok-imagine-video-1.5",
    "--exact-model",
    "--provider-fallback-only",
    "--image-url",
    "https://example.com/first-frame.png",
    "--duration",
    "10",
    "--dry-run",
  ]);

  assert.equal(dryRun.payload.seconds, "10");
  assert.deepEqual(dryRun.fallback_models, ["aihubcc/grok-video-3.5"]);
});

test("video skill accepts a UTF-8 BOM prompt file under a legacy Windows output encoding", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "videogen-bom-prompt-"));
  const promptFile = path.join(tempDir, "prompt.txt");
  try {
    fs.writeFileSync(promptFile, "\ufeff提起裙摆，走两步", "utf8");
    const result = spawnSync(
      python,
      [
        videoScript,
        "--prompt-file",
        promptFile,
        "--image-url",
        "https://example.com/first.png",
        "--dry-run",
      ],
      {
        cwd: path.resolve("."),
        env: {
          ...baseEnv(),
          PYTHONIOENCODING: "cp1252",
        },
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.payload.prompt, "提起裙摆，走两步");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("video skill ignores Codex OPENAI_BASE_URL by default", () => {
  const dryRun = runJson(videoScript, ["--prompt", "red cube rotates", "--image-url", "https://example.com/first.png", "--dry-run"], {
    LLMHUB_BASE_URL: "",
    SUB2API_BASE_URL: "",
    OPENAI_BASE_URL: "https://chatgpt.com:18080/backend-api/codex",
  });

  assert.equal(dryRun.submit_url, "https://haolo.pro/v1/videos");
  assert.equal(dryRun.status_url_template, "https://haolo.pro/v1/videos/<TASK_ID>");
});

test("video skill sends documented image-to-video params", () => {
  const imageUrl = "https://example.com/input.png";
  const dryRun = runJson(videoScript, [
    "--prompt",
    "animate the image",
    "--mode",
    "pro",
    "--first-frame-url",
    imageUrl,
    "--aspect-ratio",
    "9:16",
    "--resolution",
    "720p",
    "--duration",
    "15",
    "--dry-run",
  ]);

  assert.equal(dryRun.payload.model, "grok-imagine-video-1.5");
  assert.equal(dryRun.status_url_template, "https://haolo.pro/v1/videos/<TASK_ID>");
  assert.deepEqual(dryRun.payload, {
    model: "grok-imagine-video-1.5",
    prompt: "animate the image",
    image: imageUrl,
    seconds: "15",
    aspect_ratio: "9:16",
    resolution: "720p",
  });
});

test("video skill omits image fields for a text-to-video model contract", () => {
  const dryRun = runJson(videoScript, [
    "--prompt",
    "a paper boat crosses a moonlit lake",
    "--model",
    "Seedance-2.0-720p",
    "--input-mode",
    "text-to-video",
    "--aspect-ratio",
    "16:9",
    "--duration",
    "5",
    "--dry-run",
  ]);

  assert.equal(dryRun.input_mode, "text-to-video");
  assert.deepEqual(dryRun.payload, {
    model: "Seedance-2.0-720p",
    prompt: "a paper boat crosses a moonlit lake",
    aspect_ratio: "16:9",
    duration: 5,
  });
});

test("video skill preserves ordered first and last frame URLs", () => {
  const firstFrameUrl = "https://example.com/first.png";
  const lastFrameUrl = "https://example.com/last.png";
  const dryRun = runJson(videoScript, [
    "--prompt",
    "transition naturally between the two frames",
    "--model",
    "Seedance-2.0-720p",
    "--input-mode",
    "first-last-frame-to-video",
    "--image-url",
    firstFrameUrl,
    "--last-frame-url",
    lastFrameUrl,
    "--dry-run",
  ]);

  assert.equal(dryRun.input_mode, "first-last-frame-to-video");
  assert.equal(dryRun.payload.first_image_url, firstFrameUrl);
  assert.equal(dryRun.payload.last_image_url, lastFrameUrl);
  assert.equal("reference_image_urls" in dryRun.payload, false);
});

test("video skill maps documented Omni image options to its provider contract", () => {
  const imageUrl = "https://example.com/omni-input.png";
  const dryRun = runJson(videoScript, [
    "--prompt",
    "animate the product",
    "--model",
    "omni-fast-no-water",
    "--input-mode",
    "text-or-image-to-video",
    "--image-url",
    imageUrl,
    "--aspect-ratio",
    "16:9",
    "--size",
    "1280x720",
    "--resolution",
    "720p",
    "--duration",
    "10",
    "--dry-run",
  ]);

  assert.deepEqual(dryRun.payload, {
    model: "omni-fast-no-water",
    prompt: "animate the product",
    images: [imageUrl],
    aspect_ratio: "16:9",
    duration: 10,
  });
});

test("video skill maps documented Omni V2V source videos", () => {
  const videoUrls = [
    "https://example.com/source-1.mp4",
    "https://example.com/source-2.mp4",
  ];
  const dryRun = runJson(videoScript, [
    "--prompt",
    "restyle both source clips",
    "--model",
    "omni-fast-v2v-no-water",
    "--input-mode",
    "video-to-video",
    "--video-url",
    videoUrls[0],
    "--video-url",
    videoUrls[1],
    "--aspect-ratio",
    "9:16",
    "--resolution",
    "720p",
    "--duration",
    "10",
    "--dry-run",
  ]);

  assert.deepEqual(dryRun.payload, {
    model: "omni-fast-v2v-no-water",
    prompt: "restyle both source clips",
    videos: videoUrls,
    aspect_ratio: "9:16",
    duration: 10,
  });
});

test("video skill maps documented Seedance options to its provider contract", () => {
  const imageUrl = "https://example.com/seedance-input.png";
  const dryRun = runJson(videoScript, [
    "--prompt",
    "slow camera orbit",
    "--model",
    "Seedance-2.0-720p",
    "--input-mode",
    "text-or-image-to-video",
    "--image-url",
    imageUrl,
    "--aspect-ratio",
    "21:9",
    "--size",
    "1680x720",
    "--resolution",
    "720p",
    "--duration",
    "15",
    "--dry-run",
  ]);

  assert.deepEqual(dryRun.payload, {
    model: "Seedance-2.0-720p",
    prompt:
      "Use @image1 as the source visual and primary subject reference. " +
      "Preserve its subject identity, face, clothing, objects, composition, " +
      "and environment unless the following instructions explicitly request a change.\n\n" +
      "slow camera orbit",
    aspect_ratio: "21:9",
    duration: 15,
    reference_image_urls: [imageUrl],
  });
});

test("video skill preserves an explicit Seedance image binding", () => {
  const prompt = "Animate @image1 while preserving the same person and room.";
  const dryRun = runJson(videoScript, [
    "--prompt",
    prompt,
    "--model",
    "Seedance-2.0-720p",
    "--input-mode",
    "image-to-video",
    "--image-url",
    "https://example.com/seedance-bound-input.png",
    "--aspect-ratio",
    "9:16",
    "--resolution",
    "720p",
    "--duration",
    "10",
    "--dry-run",
  ]);

  assert.equal(dryRun.payload.prompt, prompt);
  assert.equal(dryRun.payload.prompt.match(/@image1/gi)?.length, 1);
});

test("video skill preserves the Seedance 480p business model", () => {
  const imageUrl = "https://example.com/seedance-480p-input.png";
  const dryRun = runJson(videoScript, [
    "--prompt",
    "walk toward the camera",
    "--model",
    "Seedance-2.0-480p",
    "--input-mode",
    "image-to-video",
    "--image-url",
    imageUrl,
    "--aspect-ratio",
    "9:16",
    "--resolution",
    "480p",
    "--duration",
    "15",
    "--dry-run",
  ]);

  assert.equal(dryRun.payload.model, "Seedance-2.0-480p");
  assert.equal("resolution" in dryRun.payload, false);
  assert.deepEqual(dryRun.payload.reference_image_urls, [imageUrl]);
});

test("video skill preserves both Seedance 2.0 Mini business models", () => {
  for (const [model, resolution] of [
    ["Seedance-2.0-mini-480p", "480p"],
    ["Seedance-2.0-mini-720p", "720p"],
  ]) {
    const dryRun = runJson(videoScript, [
      "--prompt",
      "test a low-cost cinematic draft",
      "--model",
      model,
      "--input-mode",
      "text-to-video",
      "--aspect-ratio",
      "16:9",
      "--resolution",
      resolution,
      "--duration",
      "8",
      "--dry-run",
    ]);

    assert.deepEqual(dryRun.payload, {
      model,
      prompt: "test a low-cost cinematic draft",
      aspect_ratio: "16:9",
      duration: 8,
    });
  }
});

test("video skill maps Seedance mixed image, video, and audio references", () => {
  const dryRun = runJson(videoScript, [
    "--prompt",
    "combine all references",
    "--model",
    "Seedance-2.0-1080p",
    "--input-mode",
    "multimodal-to-video",
    "--image-url",
    "https://example.com/main.png",
    "--image-url",
    "https://example.com/style.png",
    "--video-url",
    "https://example.com/motion.mp4",
    "--audio-url",
    "https://example.com/music.mp3",
    "--aspect-ratio",
    "4:3",
    "--resolution",
    "1080p",
    "--duration",
    "12",
    "--dry-run",
  ]);

  assert.deepEqual(dryRun.payload, {
    model: "Seedance-2.0-1080p",
    prompt:
      "Use @image1, @image2 as the visual references, with @image1 as the " +
      "primary subject reference. Preserve the referenced identities, appearances, " +
      "objects, and environments unless the following instructions explicitly request a change.\n\n" +
      "combine all references",
    aspect_ratio: "4:3",
    duration: 12,
    reference_image_urls: [
      "https://example.com/main.png",
      "https://example.com/style.png",
    ],
    reference_videos: ["https://example.com/motion.mp4"],
    reference_audios: ["https://example.com/music.mp3"],
  });
});

test("video skill rejects Seedance audio without a main image", () => {
  const result = spawnSync(
    python,
    [
      videoScript,
      "--prompt",
      "use this soundtrack",
      "--model",
      "Seedance-2.0-720p",
      "--input-mode",
      "multimodal-to-video",
      "--audio-url",
      "https://example.com/music.mp3",
      "--resolution",
      "720p",
      "--duration",
      "5",
      "--dry-run",
    ],
    {
      cwd: path.resolve("."),
      env: baseEnv(),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /requires at least one main image/);
});

test("video skill rejects Seedance reference video without a main image", () => {
  const result = spawnSync(
    python,
    [
      videoScript,
      "--prompt",
      "use this motion",
      "--model",
      "Seedance-2.0-720p",
      "--input-mode",
      "multimodal-to-video",
      "--video-url",
      "https://example.com/motion.mp4",
      "--resolution",
      "720p",
      "--duration",
      "5",
      "--dry-run",
    ],
    {
      cwd: path.resolve("."),
      env: baseEnv(),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /requires at least one main image/);
});

test("video skill completes submit, status polling, and download against media API contract", async () => {
  const mock = await createMockMediaServer();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihubcc-video-flow-"));
  try {
    const firstFrameUrl = `${mock.baseUrl}/first-frame.png`;
    const result = await runJsonAsync(videoScript, [
      "--prompt",
      "mock video",
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--image-url",
      firstFrameUrl,
      "--output-dir",
      outputDir,
      "--job-dir",
      path.join(outputDir, "jobs"),
      "--request-id",
      "video-contract-flow",
      "--conversation-id",
      "video-contract-thread",
      "--basename",
      "mock-video",
      "--timeout",
      "5",
      "--poll-interval",
      "1",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.model, "grok-imagine-video-1.5");
    assert.equal(result.task_id, "video-task");
    assert.equal(result.source_url, `${mock.baseUrl}/result-video.mp4`);
    assert.equal(fs.existsSync(result.saved), true);

    const submit = mock.requests.find((entry) => entry.path === "/v1/videos");
    assert.deepEqual(submit.body, {
      model: "grok-imagine-video-1.5",
      prompt: "mock video",
      image: firstFrameUrl,
      seconds: "6",
      aspect_ratio: "16:9",
      resolution: "720p",
    });

    const status = mock.requests.find(
      (entry) =>
        entry.path === "/v1/videos/video-task",
    );
    assert.ok(status);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("video skill prefers the downloadable nested result over a broken gateway content URL", async () => {
  const mock = await createMockMediaServer({
    videoStatus: ({ baseUrl }) => ({
      is_final: true,
      status: "completed",
      video_url: "/v1/videos/vid-missing/content",
      data: [{ url: `${baseUrl}/nested-result-video.mp4` }],
    }),
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-video-download-"));
  try {
    const result = await runJsonAsync(videoScript, [
      "--prompt",
      "mock omni video",
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--model",
      "omni-fast-no-water",
      "--exact-model",
      "--input-mode",
      "text-to-video",
      "--duration",
      "10",
      "--output-dir",
      outputDir,
      "--job-dir",
      path.join(outputDir, "jobs"),
      "--request-id",
      "omni-download-url-priority",
      "--conversation-id",
      "omni-download-url-priority-thread",
      "--basename",
      "mock-omni-video",
      "--timeout",
      "5",
      "--poll-interval",
      "1",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.source_url, `${mock.baseUrl}/nested-result-video.mp4`);
    assert.equal(fs.existsSync(result.saved), true);
    assert.ok(
      mock.requests.some(
        (entry) => entry.path === "/nested-result-video.mp4",
      ),
    );
    assert.equal(
      mock.requests.some(
        (entry) => entry.path === "/v1/videos/vid-missing/content",
      ),
      false,
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("Omni V2V retries without optional media routing hints after a pre-submit catalog policy mismatch", async () => {
  const mock = await createMockMediaServer({
    onVideoSubmit: ({ videoSubmitCount }) => {
      if (videoSubmitCount === 1) {
        return {
          statusCode: 403,
          body: {
            error: {
              category: "policy",
              code: "PERMISSION_DENIED",
              message:
                'model "omni-fast-v2v-no-water" is not enabled for 媒体创作',
              request_id: "omni-v2v-policy-mismatch",
              retry_after_ms: 0,
              retryable: false,
              route_exhausted: false,
              type: "permission_error",
              upstream_status: 0,
            },
          },
        };
      }
      return undefined;
    },
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-v2v-policy-retry-"));
  try {
    const result = await runJsonAsync(
      videoScript,
      [
        "--prompt",
        "combine both source videos",
        "--base-url",
        `${mock.baseUrl}/v1`,
        "--model",
        "omni-fast-v2v-no-water",
        "--exact-model",
        "--input-mode",
        "video-to-video",
        "--video-url",
        "https://example.com/source-1.mp4",
        "--video-url",
        "https://example.com/source-2.mp4",
        "--duration",
        "10",
        "--aspect-ratio",
        "9:16",
        "--resolution",
        "720p",
        "--output-dir",
        outputDir,
        "--job-dir",
        path.join(outputDir, "jobs"),
        "--request-id",
        "omni-v2v-policy-retry",
        "--conversation-id",
        "omni-v2v-policy-retry-thread",
        "--basename",
        "omni-v2v-policy-retry",
        "--timeout",
        "5",
        "--poll-interval",
        "1",
      ],
      {
        HAOLO_MODEL_POOL: "media_creation",
        HAOLO_MODEL_CAPABILITY: "video_generation",
        HAOLO_SOURCE_TYPE: "contact",
      },
    );

    assert.equal(result.ok, true);
    const submits = mock.requests.filter(
      (entry) => entry.path === "/v1/videos/generations",
    );
    assert.equal(submits.length, 2);
    assert.equal(submits[0].headers["x-haolo-model-pool"], "media_creation");
    assert.equal(
      submits[0].headers["x-haolo-model-capability"],
      "video_generation",
    );
    assert.equal(submits[1].headers["x-haolo-model-pool"], undefined);
    assert.equal(submits[1].headers["x-haolo-model-capability"], undefined);
    assert.equal(
      submits[1].headers["x-haolo-interaction-id"],
      "omni-v2v-policy-retry",
    );
    assert.equal(
      submits[1].headers["x-haolo-conversation-id"],
      "omni-v2v-policy-retry-thread",
    );
    assert.deepEqual(submits[0].body, submits[1].body);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("structured video route exhaustion authorizes AIHubCC Grok to Buming Grok fallback without a second submit", async () => {
  const machineError = {
    code: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
    category: "remote",
    retryable: true,
    retry_after_ms: 60_000,
    request_id: "relay-video-route-exhausted",
    upstream_status: 502,
    route_exhausted: true,
  };
  const mock = await createMockMediaServer({
    onVideoSubmit: () => ({
      statusCode: 502,
      body: {
        error: {
          type: "upstream_error",
          message: "Upstream service temporarily unavailable",
          ...machineError,
        },
      },
    }),
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-video-route-exhausted-"));
  const args = [
    "--prompt",
    "animate the frame",
    "--base-url",
    `${mock.baseUrl}/v1`,
    "--image-url",
    `${mock.baseUrl}/first-frame.png`,
    "--request-id",
    "video-route-exhausted-1",
    "--conversation-id",
    "thread-video-route-exhausted",
    "--job-dir",
    path.join(tempDir, "jobs"),
    "--output-dir",
    path.join(tempDir, "output"),
    "--duration",
    "15",
    "--timeout",
    "5",
    "--poll-interval",
    "1",
  ];
  try {
    const first = await runProcessJsonAsync(videoScript, args);
    assert.equal(first.status, 1);
    assert.equal(first.payload.pending, false);
    assert.equal(first.payload.state, "failed");
    assert.equal(first.payload.safe_to_resubmit, true);
    assert.equal(first.payload.fallback_allowed, true);
    assert.equal(first.payload.fallback_model, "aihubcc/grok-video-3.5");
    assert.deepEqual(first.payload.fallback_models, [
      "aihubcc/grok-video-3.5",
      "omni-fast-no-water",
    ]);
    assert.deepEqual(first.payload.machine_error, machineError);
    assert.deepEqual(first.payload.fallback_adjustments, {
      model: "aihubcc/grok-video-3.5",
      input_mode: "image-to-video",
      duration: "15",
      aspect_ratio: "16:9",
      resolution: "720p",
      size: null,
    });
    assert.equal(mock.videoSubmitCount, 1);

    const resumed = await runProcessJsonAsync(videoScript, args);
    assert.equal(resumed.status, 1);
    assert.equal(resumed.payload.fallback_model, "aihubcc/grok-video-3.5");
    assert.equal(mock.videoSubmitCount, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("an ambiguous video 502 without a task ID authorizes the Buming fallback", async () => {
  const mock = await createMockMediaServer({
    onVideoSubmit: () => ({
      statusCode: 502,
      body: {
        error: {
          message: "Media response did not include a task ID",
          type: "api_error",
        },
      },
    }),
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-video-ambiguous-502-"));
  const args = [
    "--prompt",
    "animate the frame",
    "--base-url",
    `${mock.baseUrl}/v1`,
    "--image-url",
    `${mock.baseUrl}/first-frame.png`,
    "--model",
    "grok-imagine-video-1.5",
    "--exact-model",
    "--provider-fallback-only",
    "--request-id",
    "video-ambiguous-502-1",
    "--conversation-id",
    "thread-video-ambiguous-502",
    "--job-dir",
    path.join(tempDir, "jobs"),
    "--output-dir",
    path.join(tempDir, "output"),
    "--timeout",
    "5",
    "--poll-interval",
    "1",
  ];
  try {
    const result = await runProcessJsonAsync(videoScript, args);

    assert.equal(result.status, 1);
    assert.equal(result.payload.pending, false);
    assert.equal(result.payload.state, "failed");
    assert.equal(result.payload.safe_to_resubmit, true);
    assert.equal(result.payload.fallback_allowed, true);
    assert.equal(result.payload.fallback_model, "aihubcc/grok-video-3.5");
    assert.deepEqual(result.payload.fallback_models, ["aihubcc/grok-video-3.5"]);
    assert.equal(result.payload.fallback_reason, "submit_without_task_id");
    assert.equal(result.payload.acceptance_ambiguous, true);
    assert.equal(result.payload.duplicate_risk_accepted, true);
    assert.equal(mock.videoSubmitCount, 1);

    const repeated = await runProcessJsonAsync(videoScript, args);
    assert.equal(repeated.status, 1);
    assert.equal(repeated.payload.fallback_model, "aihubcc/grok-video-3.5");
    assert.equal(mock.videoSubmitCount, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("a successful video submit response without a task ID authorizes the next model", async () => {
  const mock = await createMockMediaServer({
    onVideoSubmit: () => ({
      statusCode: 200,
      body: { code: 200, data: { status: "accepted" } },
    }),
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-video-missing-task-id-"));
  try {
    const result = await runProcessJsonAsync(videoScript, [
      "--prompt",
      "animate the frame",
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--image-url",
      `${mock.baseUrl}/first-frame.png`,
      "--request-id",
      "video-missing-task-id-1",
      "--conversation-id",
      "thread-video-missing-task-id",
      "--job-dir",
      path.join(tempDir, "jobs"),
      "--output-dir",
      path.join(tempDir, "output"),
      "--timeout",
      "5",
      "--poll-interval",
      "1",
    ]);

    assert.equal(result.status, 1);
    assert.equal(result.payload.pending, false);
    assert.equal(result.payload.fallback_allowed, true);
    assert.equal(result.payload.fallback_model, "aihubcc/grok-video-3.5");
    assert.equal(result.payload.fallback_reason, "submit_without_task_id");
    assert.equal(result.payload.duplicate_risk_accepted, true);
    assert.equal(mock.videoSubmitCount, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("video skill resumes a cached user task without a second submit", async () => {
  const mock = await createMockMediaServer();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-video-resume-"));
  const outputDir = path.join(tempDir, "output");
  const jobDir = path.join(tempDir, "jobs");
  try {
    const result = await runJsonAsync(videoScript, [
      "--resume-latest",
      "--base-url",
      `${mock.baseUrl}/v1`,
      "--conversation-id",
      "thread-video-1",
      "--job-dir",
      jobDir,
      "--output-dir",
      outputDir,
      "--basename",
      "recovered-video",
      "--timeout",
      "5",
      "--poll-interval",
      "1",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.recovered, true);
    assert.equal(result.task_id, "video-task");
    assert.equal(fs.existsSync(result.saved), true);
    assert.equal(mock.videoSubmitCount, 0);
    assert.equal(
      mock.requests.some((entry) => entry.path === "/v1/media/jobs"),
      true,
    );
    assert.equal(
      mock.requests.some((entry) => entry.path === "/v1/media/cache"),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    await mock.close();
  }
});

test("concurrent video invocations with one request id submit only once", async () => {
  const mock = await createMockMediaServer({
    onVideoSubmit: async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return null;
    },
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-video-lock-"));
  const args = [
    "--prompt",
    "one charged task",
    "--base-url",
    `${mock.baseUrl}/v1`,
    "--image-url",
    `${mock.baseUrl}/first-frame.png`,
    "--request-id",
    "video-request-1",
    "--conversation-id",
    "thread-concurrent-video",
    "--job-dir",
    path.join(tempDir, "jobs"),
    "--output-dir",
    path.join(tempDir, "output"),
    "--basename",
    "same-video",
    "--timeout",
    "5",
    "--poll-interval",
    "1",
  ];
  try {
    const invocations = await Promise.allSettled([
      runProcessJsonAsync(videoScript, args, {}, 10_000),
      runProcessJsonAsync(videoScript, args, {}, 10_000),
    ]);
    const [first, second] = invocations.map((invocation) => {
      if (invocation.status === "rejected") throw invocation.reason;
      return invocation.value;
    });

    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(first.payload.task_id, "video-task");
    assert.equal(second.payload.task_id, "video-task");
    assert.equal(mock.videoSubmitCount, 1);
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } finally {
      await mock.close();
    }
  }
});

test("video expert IPC routes through bundled videogen skill script", () => {
  const source = fs.readFileSync(path.resolve("src/main/main.mjs"), "utf8");

  assert.match(source, /resolveBundledVideoGenScript/);
  assert.match(source, /generate_seedance_video\.py/);
  assert.match(source, /resumeLatestVideoGeneration/);
  assert.match(source, /"youle:resumeVideo"/);
  assert.match(source, /"--resume-latest"/);
  assert.match(source, /isSafeMediaCreationGrokProviderFallback/);
  assert.match(source, /BUMING_GROK_VIDEO_MODEL/);
  assert.match(source, /failure\.fallback_model === BUMING_GROK_VIDEO_MODEL/);
  assert.match(source, /exactModel: true/);
  assert.match(source, /providerFallbackOnly: model === AIHUBCC_GROK_VIDEO_MODEL/);
  assert.match(source, /"--provider-fallback-only"/);
  assert.doesNotMatch(source, /fetchVideoGenerationJson|pollVideoGenerationResult|downloadVideoGenerationResult/);
  assert.doesNotMatch(source, /\/videos\/generations/);
});

test("video skill supports text-to-video without an image url", () => {
  const result = spawnSync(python, [videoScript, "--prompt", "animate this", "--dry-run"], {
    cwd: path.resolve("."),
    env: baseEnv(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.input_mode, "text-or-image-to-video");
  assert.equal(payload.payload.model, "grok-imagine-video-1.5");
  assert.equal("image" in payload.payload, false);
});

test("video skill rejects first-last mode until both frame URLs are present", () => {
  const result = spawnSync(
    python,
    [
      videoScript,
      "--prompt",
      "transition",
      "--input-mode",
      "first-last-frame-to-video",
      "--image-url",
      "https://example.com/first.png",
      "--dry-run",
    ],
    {
      cwd: path.resolve("."),
      env: baseEnv(),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error_class, "request");
  assert.match(payload.error, /requires exactly two image URLs/);
});

test("video skill rejects unsupported durations", () => {
  const result = spawnSync(
    python,
    [videoScript, "--prompt", "animate this", "--image-url", "https://example.com/first.png", "--duration", "30", "--dry-run"],
    {
      cwd: path.resolve("."),
      env: baseEnv(),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error_class, "request");
  assert.match(payload.error, /duration 30 is not supported/);
});
