import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isChatCompatibleRelayModel,
  isImageGenerationRelayModel,
  normalizeRelayImageModels,
  normalizeRelayProviderModels,
  providerModelCatalogErrorMessage,
} from "../src/main/provider-model-catalog.mjs";
import {
  normalizeBusinessModelPools,
  YouleApiClient,
} from "../src/main/youle-api-client.mjs";
import {
  createImageGenerationModelCatalogState,
  imageGenerationModelGroups,
  imageGenerationModelOptions,
  normalizeImageGenerationModelCatalog,
} from "../src/renderer/image-generation-model-catalog.ts";
import { mediaModelPriceLabel } from "../src/renderer/media-model-pricing.ts";
import {
  createProviderModelCatalogState,
  defaultProviderModelSelection,
  normalizeProviderModelCatalog,
  providerForCatalogModel,
  providerModelGroups,
  providerModelOptions,
} from "../src/renderer/provider-model-catalog.ts";

test("relay catalog keeps chat models, including future aliases, and filters non-chat models", () => {
  const models = normalizeRelayProviderModels({
    data: [
      { id: "gpt-5.6-terra" },
      { id: "gpt-7-future", display_name: "GPT 7 Future" },
      { id: "gpt-image-2" },
      { id: "grok-imagine" },
      { id: "veo-3.1" },
      { id: "imagen-4" },
      { id: "text-embedding-3-large" },
      { id: "voice-engine", capabilities: ["speech"] },
      { id: "multimodal-chat", capabilities: ["chat", "image"] },
      { id: "hidden-chat", hidden: true },
      { id: "GPT-7-FUTURE" },
    ],
  });

  assert.deepEqual(
    models.map((model) => model.id),
    ["gpt-5.6-terra", "gpt-7-future", "multimodal-chat"],
  );
  assert.equal(models[1].displayName, "GPT 7 Future");
  assert.equal(isChatCompatibleRelayModel({ id: "image-only", output_modalities: ["image"] }), false);
  assert.equal(isChatCompatibleRelayModel({ id: "future-chat", output_modalities: ["text"] }), true);
});

test("relay image catalog keeps available generation models and rejects video/chat entries", () => {
  const models = normalizeRelayImageModels({
    data: [
      {
        id: "aihubcc/gpt-image-2",
        unit_points: 1,
        billing_unit: "request",
      },
      { id: "gpt-image-1.5", display_name: "GPT Image 1.5" },
      { id: "gemini-3.1-flash-image" },
      { id: "seedream-4.5" },
      { id: "grok-imagine" },
      { id: "grok-imagine-video-1.5" },
      { id: "gpt-5.6-terra" },
      { id: "future-canvas", capabilities: ["image_generation"] },
      { id: "multimodal-chat", capabilities: ["chat", "image"] },
      { id: "hidden-image", hidden: true },
      { id: "AIHUBCC/GPT-IMAGE-2" },
    ],
  });

  assert.deepEqual(
    models.map((model) => model.id),
    [
      "aihubcc/gpt-image-2",
      "gpt-image-1.5",
      "gemini-3.1-flash-image",
      "seedream-4.5",
      "grok-imagine",
      "future-canvas",
    ],
  );
  assert.equal(models[1].displayName, "GPT Image 1.5");
  assert.equal(models[0].unitPoints, 1);
  assert.equal(models[0].billingUnit, "request");
  assert.equal(isImageGenerationRelayModel({ id: "future-image", output_modalities: ["image"] }), true);
  assert.equal(isImageGenerationRelayModel({ id: "future-video", output_modalities: ["video"] }), false);

  const catalog = {
    loading: false,
    ...normalizeImageGenerationModelCatalog({
      status: "online",
      models: models.map((model, index) => ({
        ...model,
        provider: index < 2 ? "openai" : "grok",
      })),
      fetchedAt: "2026-07-24T08:00:00.000Z",
    }),
  };
  assert.deepEqual(
    imageGenerationModelOptions(catalog).map((model) => model.value),
    models.map((model) => model.id),
  );
  assert.equal(imageGenerationModelOptions(catalog)[0].priceLabel, "1/次");
  assert.deepEqual(
    imageGenerationModelGroups(catalog).map((group) => ({
      label: group.label,
      models: group.options.map((model) => model.value),
    })),
    [
      {
        label: "GPT",
        models: ["aihubcc/gpt-image-2", "gpt-image-1.5"],
      },
      {
        label: "Grok",
        models: [
          "gemini-3.1-flash-image",
          "seedream-4.5",
          "grok-imagine",
          "future-canvas",
        ],
      },
    ],
  );
  assert.deepEqual(imageGenerationModelOptions(createImageGenerationModelCatalogState()), []);
});

test("media model prices use the server billing unit in the compact picker label", () => {
  assert.equal(mediaModelPriceLabel(2, "second"), "2/秒");
  assert.equal(mediaModelPriceLabel(2.5, "request"), "2.5/次");
  assert.equal(mediaModelPriceLabel(8, "request"), "8/次");
  assert.equal(mediaModelPriceLabel(0, "second"), "");
  assert.equal(mediaModelPriceLabel(2, "unknown"), "");
});

test("renderer options are driven only by returned models and accept new model ids without an update", () => {
  const catalog = {
    loading: false,
    ...normalizeProviderModelCatalog({
      fetchedAt: "2026-07-23T08:00:00.000Z",
      providers: [
        {
          provider: "openai",
          status: "online",
          models: [
            { id: "gpt-5.6-terra" },
            { id: "gpt-7-future", displayName: "GPT 7 Future", isDefault: true },
          ],
        },
        {
          provider: "claude",
          status: "online",
          models: [],
        },
        {
          provider: "deepseek",
          status: "error",
          stale: true,
          error: "模型目录暂时不可用",
          models: [{ id: "deepseek-next" }],
        },
      ],
    }),
  };

  const codex = providerModelOptions(catalog, "codex");
  assert.deepEqual(
    codex.map(({ value, label, isDefault }) => ({ value, label, isDefault })),
    [
      { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", isDefault: false },
      { value: "gpt-7-future", label: "GPT 7 Future", isDefault: true },
    ],
  );
  assert.deepEqual(codex[0].inputModalities, ["text", "file", "image"]);
  assert.deepEqual(codex[1].inputModalities, ["text", "file"]);
  assert.deepEqual(providerModelOptions(catalog, "claude"), []);
  assert.equal(catalog.providers.claude.status, "standby");
  assert.equal(catalog.providers.deepseek.status, "error");
  assert.equal(catalog.providers.deepseek.stale, true);
  assert.equal(providerForCatalogModel(catalog, "GPT-7-FUTURE"), "codex");
  assert.equal(
    providerModelGroups(catalog).find((group) => group.provider === "deepseek")?.stale,
    true,
  );

  const empty = createProviderModelCatalogState();
  assert.deepEqual(providerModelOptions(empty, "codex"), []);
});

test("configured question catalogs preserve backend labels, defaults, models, and provider order", () => {
  const catalog = {
    loading: false,
    ...normalizeProviderModelCatalog({
      configured: true,
      providers: [
        {
          provider: "grok",
          models: [
            { id: "grok-4.3", displayName: "后台 Grok 4.3" },
            {
              id: "grok-4.5",
              displayName: "grok-4.5",
              isDefault: true,
            },
          ],
        },
        {
          provider: "openai",
          models: [
            { id: "gpt-5.4", displayName: "后台保留 5.4" },
            { id: "gpt-5.6-terra", displayName: "后台 Terra" },
          ],
        },
      ],
    }),
  };

  assert.deepEqual(
    providerModelGroups(catalog).map((group) => ({
      provider: group.provider,
      models: group.options.map((option) => ({
        value: option.value,
        label: option.label,
        isDefault: option.isDefault === true,
      })),
    })),
    [
      {
        provider: "grok",
        models: [
          {
            value: "grok-4.3",
            label: "后台 Grok 4.3",
            isDefault: false,
          },
          {
            value: "grok-4.5",
            label: "grok-4.5",
            isDefault: true,
          },
        ],
      },
      {
        provider: "codex",
        models: [
          {
            value: "gpt-5.4",
            label: "后台保留 5.4",
            isDefault: false,
          },
          {
            value: "gpt-5.6-terra",
            label: "后台 Terra",
            isDefault: false,
          },
        ],
      },
    ],
  );
  assert.equal(defaultProviderModelSelection(catalog)?.provider, "grok");
  assert.equal(
    defaultProviderModelSelection(catalog)?.option.value,
    "grok-4.5",
  );
});

test("question mode uses the server default across providers and otherwise the first available model", () => {
  const configuredDefault = {
    loading: false,
    ...normalizeProviderModelCatalog({
      providers: [
        {
          provider: "openai",
          models: [
            { id: "gpt-5.6-sol" },
            { id: "gpt-5.6-terra" },
          ],
        },
        {
          provider: "claude",
          models: [
            { id: "claude-fable-5", displayName: "fable-5", isDefault: true },
          ],
        },
      ],
    }),
  };

  const selectedDefault = defaultProviderModelSelection(configuredDefault);
  assert.equal(selectedDefault?.provider, "claude");
  assert.equal(selectedDefault?.option.value, "claude-fable-5");

  const noServerDefault = {
    loading: false,
    ...normalizeProviderModelCatalog({
      providers: [
        {
          provider: "openai",
          models: [
            { id: "gpt-5.6-sol" },
            { id: "gpt-5.6-terra" },
          ],
        },
      ],
    }),
  };

  assert.equal(
    providerModelOptions(noServerDefault, "codex").find(
      (option) => option.isDefault,
    )?.value,
    "gpt-5.6-terra",
    "the existing per-provider curated fallback remains available",
  );
  const selectedFallback = defaultProviderModelSelection(noServerDefault);
  assert.equal(selectedFallback?.provider, "codex");
  assert.equal(
    selectedFallback?.option.value,
    "gpt-5.6-sol",
    "the global question-mode fallback is the first available model",
  );
  assert.equal(
    defaultProviderModelSelection(createProviderModelCatalogState()),
    null,
  );
});

test("renderer hides the legacy exact model and retired GPT family", () => {
  const catalog = {
    loading: false,
    ...normalizeProviderModelCatalog({
      providers: [
        {
          provider: "openai",
          models: [
            { id: "gpt-5.4", isDefault: true },
            { id: "gpt-5.4-mini" },
            { id: "gpt-5.5" },
          ],
        },
      ],
    }),
  };

  assert.deepEqual(
    providerModelOptions(catalog, "codex").map((model) => model.value),
    ["gpt-5.4-mini"],
  );
  assert.equal(providerForCatalogModel(catalog, "gpt-5.4"), "codex");
});

test("catalog errors expose stable user-facing messages instead of upstream details", () => {
  assert.equal(providerModelCatalogErrorMessage({ status: 401 }), "模型目录鉴权失败");
  assert.equal(providerModelCatalogErrorMessage({ status: 429 }), "模型目录请求过于频繁");
  assert.equal(providerModelCatalogErrorMessage({ code: "REQUEST_TIMEOUT" }), "模型目录请求超时");
  assert.equal(
    providerModelCatalogErrorMessage(new Error("upstream leaked a secret")),
    "模型目录暂时不可用",
  );
});

test("desktop main fetches each configured provider catalog with its relay key and caches it", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let failClaude = false;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === "https://haolo.example/api/sub2api/model-pools") {
      return new Response(JSON.stringify({ configured: false, pools: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    requests.push({
      url: String(url),
      authorization: init.headers?.Authorization,
      modelPool: init.headers?.["X-Haolo-Model-Pool"],
      modelCapability: init.headers?.["X-Haolo-Model-Capability"],
    });
    if (failClaude && init.headers?.Authorization === "Bearer sk-claude-user") {
      return new Response(JSON.stringify({ error: { message: "relay unavailable" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    const data =
      init.headers?.Authorization === "Bearer sk-claude-user"
        ? [{ id: "claude-sonnet-5" }, { id: "text-embedding-3-large" }]
        : [];
    return new Response(JSON.stringify({ object: "list", data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient({ providerModelCatalogTtlMs: 60_000 });
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      {
        provider: "claude",
        apiKey: "sk-claude-user",
        baseUrl: "https://transit.example/v1",
      },
      {
        provider: "codex",
        apiKey: "sk-codex-user",
        baseUrl: "https://transit.example/v1",
      },
    ];

    const first = await client.listProviderModelCatalog();
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.url === "https://transit.example/v1/models"));
    assert.deepEqual(
      requests.map((request) => request.authorization).sort(),
      ["Bearer sk-claude-user", "Bearer sk-codex-user"],
    );
    assert.ok(requests.every((request) => request.modelPool === "question_answer"));
    assert.ok(requests.every((request) => request.modelCapability === "question_answer"));
    assert.deepEqual(first.providers[0].models.map((model) => model.id), [
      "claude-sonnet-5",
    ]);
    assert.equal(first.providers[0].status, "online");
    assert.equal(first.providers[1].status, "standby");
    assert.doesNotMatch(JSON.stringify(first), /sk-(?:claude|codex)-user/);

    const cached = await client.listProviderModelCatalog();
    assert.equal(requests.length, 2);
    assert.ok(cached.providers.every((provider) => provider.source === "cache"));

    failClaude = true;
    const refreshed = await client.listProviderModelCatalog({ force: true });
    assert.equal(requests.length, 4);
    const claude = refreshed.providers.find((provider) => provider.provider === "claude");
    assert.equal(claude.status, "error");
    assert.equal(claude.stale, true);
    assert.deepEqual(claude.models.map((model) => model.id), ["claude-sonnet-5"]);
    assert.equal(claude.error, "模型目录暂时不可用");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("desktop question catalog follows configured provider and model sort order", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === "https://haolo.example/api/sub2api/model-pools") {
      return new Response(
        JSON.stringify({
          configured: true,
          pools: [
            {
              id: "question_answer",
              enabled: true,
              capabilities: ["question_answer"],
              models: [
                {
                  id: "gpt-5.6-terra",
                  display_name: "后台 Terra",
                  provider: "codex",
                  route_group_id: 2,
                  capabilities: ["question_answer"],
                  sort_order: 3,
                  enabled: true,
                },
                {
                  id: "grok-4.5",
                  display_name: "后台 Grok 4.5",
                  provider: "grok",
                  route_group_id: 7,
                  capabilities: ["question_answer"],
                  sort_order: 2,
                  is_default: true,
                  enabled: true,
                },
                {
                  id: "grok-4.3",
                  display_name: "grok-4.3",
                  provider: "grok",
                  route_group_id: 7,
                  capabilities: ["question_answer"],
                  sort_order: 1,
                  enabled: true,
                },
                {
                  id: "gpt-5.6-sol",
                  display_name: "后台 Sol",
                  provider: "codex",
                  route_group_id: 2,
                  capabilities: ["question_answer"],
                  sort_order: 4,
                  enabled: true,
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const authorization = init.headers?.Authorization;
    const models =
      authorization === "Bearer sk-grok-user"
        ? [{ id: "grok-4.5" }, { id: "grok-4.3" }]
        : [{ id: "gpt-5.6-sol" }, { id: "gpt-5.6-terra" }];
    return new Response(JSON.stringify({ object: "list", data: models }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      {
        provider: "codex",
        groupId: 2,
        apiKey: "sk-codex-user",
        baseUrl: "https://transit.example/v1",
      },
      {
        provider: "grok",
        groupId: 7,
        apiKey: "sk-grok-user",
        baseUrl: "https://transit.example/v1",
      },
    ];

    const catalog = await client.listProviderModelCatalog();
    assert.equal(catalog.configured, true);
    assert.deepEqual(
      catalog.providers.map((provider) => provider.provider),
      ["grok", "codex"],
    );
    assert.deepEqual(
      catalog.providers[0].models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        isDefault: model.isDefault,
      })),
      [
        {
          id: "grok-4.3",
          displayName: "grok-4.3",
          isDefault: false,
        },
        {
          id: "grok-4.5",
          displayName: "后台 Grok 4.5",
          isDefault: true,
        },
      ],
    );
    assert.deepEqual(
      catalog.providers[1].models.map((model) => model.id),
      ["gpt-5.6-terra", "gpt-5.6-sol"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("desktop queries image models with the same primary relay key used by the image skill", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let fail = false;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === "https://haolo.example/api/sub2api/model-pools") {
      return new Response(JSON.stringify({ configured: false, pools: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    requests.push({
      url: String(url),
      authorization: init.headers?.Authorization,
      modelPool: init.headers?.["X-Haolo-Model-Pool"],
      modelCapability: init.headers?.["X-Haolo-Model-Capability"],
    });
    if (fail) {
      return new Response(JSON.stringify({ error: { message: "relay unavailable" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        object: "list",
        data: [
          { id: "gpt-5.6-terra" },
          { id: "aihubcc/gpt-image-2" },
          { id: "gpt-image-2-1k-async" },
          { id: "grok-imagine-video-1.5" },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const client = new YouleApiClient({ providerModelCatalogTtlMs: 60_000 });
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelApiKey = "sk-primary-image-user";
    client.modelBaseUrl = "https://transit.example/v1";

    const first = await client.listImageGenerationModels();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://transit.example/v1/models");
    assert.equal(requests[0].authorization, "Bearer sk-primary-image-user");
    assert.equal(requests[0].modelPool, "media_creation");
    assert.equal(requests[0].modelCapability, "image_generation");
    assert.deepEqual(first.models.map((model) => model.id), [
      "aihubcc/gpt-image-2",
      "gpt-image-2-1k-async",
    ]);
    assert.equal(first.models[0].required_image_count, 0);
    assert.equal(first.models[0].max_image_count, 1);
    assert.equal(first.models[0].max_image_long_edge, 2048);
    assert.equal(first.models[1].required_image_count, 0);
    assert.equal(first.models[1].max_image_count, 6);
    assert.equal(first.models[1].max_image_total_bytes, 5 * 1024 * 1024);
    assert.equal(first.status, "online");
    assert.doesNotMatch(JSON.stringify(first), /sk-primary-image-user/);

    const cached = await client.listImageGenerationModels();
    assert.equal(requests.length, 1);
    assert.equal(cached.source, "cache");

    fail = true;
    const refreshed = await client.listImageGenerationModels({ force: true });
    assert.equal(requests.length, 2);
    assert.equal(refreshed.status, "error");
    assert.equal(refreshed.stale, true);
    assert.deepEqual(refreshed.models.map((model) => model.id), [
      "aihubcc/gpt-image-2",
      "gpt-image-2-1k-async",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("media creation preload shares one pool request and caches both catalogs", async () => {
  const originalFetch = globalThis.fetch;
  let poolRequests = 0;
  let videoCatalogRequests = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === "https://haolo.example/api/sub2api/model-pools") {
      poolRequests += 1;
      return new Response(
        JSON.stringify({
          configured: true,
          pools: [
            {
              id: "media_creation",
              enabled: true,
              capabilities: ["image_generation", "video_generation"],
              models: [
                {
                  id: "aihubcc/gpt-image-2",
                  provider: "codex",
                  enabled: true,
                  is_default: true,
                  capabilities: ["image_generation"],
                },
                {
                  id: "grok-imagine-video-1.5-preview",
                  provider: "grok",
                  enabled: true,
                  is_default: true,
                  capabilities: ["video_generation"],
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (String(url) === "https://haolo.example/api/video-expert/models") {
      videoCatalogRequests += 1;
      return new Response(
        JSON.stringify({
          default_model: "aihubcc/grok-video-3.5",
          models: [{ id: "aihubcc/grok-video-3.5" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    throw new Error(`unexpected request: ${url}`);
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";

    const [images, videos] = await Promise.all([
      client.listImageGenerationModels(),
      client.listVideoExpertModels(),
    ]);
    assert.deepEqual(images.models.map((model) => model.id), [
      "aihubcc/gpt-image-2",
    ]);
    assert.equal(images.models[0].max_image_count, 1);
    assert.deepEqual(videos.models.map((model) => model.id), [
      "grok-imagine-video-1.5",
    ]);
    assert.equal(poolRequests, 1);
    assert.equal(videoCatalogRequests, 1);

    const [cachedImages, cachedVideos] = await Promise.all([
      client.listImageGenerationModels(),
      client.listVideoExpertModels(),
    ]);
    assert.equal(cachedImages.source, "cache");
    assert.equal(cachedVideos.source, "cache");
    assert.equal(poolRequests, 1);
    assert.equal(videoCatalogRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("desktop preserves media-pool aliases while using route-specific video capabilities", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url) === "https://haolo.example/api/video-expert/models") {
      return new Response(
        JSON.stringify({
          default_model: "aihubcc/grok-video-3.5",
          models: [
            {
              id: "aihubcc/grok-video-3.5",
              display_name: "Grok Video 3.5",
              input_mode: "image-to-video",
              screen_sizes: [
                {
                  value: "9:16",
                  size: "720x1280",
                  resolution: "720p",
                },
              ],
              durations: ["10", "15"],
              default_duration: "10",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (String(url) === "https://haolo.example/api/sub2api/model-pools") {
      return new Response(
        JSON.stringify({
          configured: true,
          pools: [
            {
              id: "media_creation",
              enabled: true,
              capabilities: ["image_generation", "video_generation"],
              models: [
                {
                  id: "grok-imagine-video-1.5-preview",
                  display_name: "Grok Imagine Video 1.5",
                  provider: "grok",
                  route_group_id: 10,
                  capabilities: ["video_generation"],
                  enabled: true,
                  is_default: true,
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    throw new Error(`unexpected request: ${url}`);
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";

    const catalog = await client.listVideoExpertModels();
    assert.equal(catalog.models.length, 1);
    assert.equal(catalog.default_model, "grok-imagine-video-1.5");
    assert.equal(catalog.models[0].id, "grok-imagine-video-1.5");
    assert.equal(catalog.models[0].display_name, "Grok Imagine Video 1.5");
    assert.equal(catalog.models[0].provider, "grok");
    assert.equal(catalog.models[0].route_group_id, 10);
    assert.deepEqual(
      catalog.models[0].durations.map((item) => item.value),
      Array.from({ length: 15 }, (_, index) => String(index + 1)),
    );
    assert.equal(catalog.models[0].default_duration, "6");
    const cached = await client.listVideoExpertModels();
    assert.equal(cached.source, "cache");
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("desktop fills the documented capabilities for every configured video model", async () => {
  const originalFetch = globalThis.fetch;
  const configuredModels = [
    ["Seedance-2.0-720p", "Seedance"],
    ["Seedance-2.0-480p", "Seedance"],
    ["Seedance-2.0-1080p", "Seedance"],
    ["Seedance-2.0-mini-480p", "Seedance"],
    ["Seedance-2.0-mini-720p", "Seedance"],
    ["grok-imagine-video-1.5", "grok"],
    ["omni-fast-no-water", "gemini"],
    ["omni-fast-v2v-no-water", "gemini"],
  ];
  globalThis.fetch = async (url) => {
    if (String(url) === "https://haolo.example/api/video-expert/models") {
      return new Response(
        JSON.stringify({
          error: "legacy video capability catalog is unavailable",
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (String(url) === "https://haolo.example/api/sub2api/model-pools") {
      return new Response(
        JSON.stringify({
          configured: true,
          pools: [
            {
              id: "media_creation",
              enabled: true,
              capabilities: ["image_generation", "video_generation"],
              models: configuredModels.map(([id, provider], index) => ({
                id,
                provider,
                unit_points:
                  id === "Seedance-2.0-mini-480p"
                    ? 2
                    : id === "Seedance-2.0-mini-720p"
                      ? 3
                      : id === "grok-imagine-video-1.5"
                        ? 8
                        : undefined,
                billing_unit: id.startsWith("Seedance-2.0-mini-")
                  ? "second"
                  : id === "grok-imagine-video-1.5"
                    ? "request"
                    : undefined,
                enabled: true,
                is_default: index === 0,
                capabilities: ["video_generation"],
              })),
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    throw new Error(`unexpected request: ${url}`);
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";

    const catalog = await client.listVideoExpertModels();
    assert.equal(catalog.default_model, "Seedance-2.0-720p");
    const modelsById = new Map(catalog.models.map((model) => [model.id, model]));
    assert.deepEqual(
      [...modelsById.keys()].sort(),
      configuredModels.map(([id]) => id).sort(),
    );
    const seedance = modelsById.get("Seedance-2.0-720p");
    assert.equal(seedance.input_mode, "multimodal-to-video");
    assert.equal(seedance.max_image_count, 4);
    assert.equal(seedance.max_video_count, 3);
    assert.equal(seedance.max_audio_count, 1);
    assert.equal(seedance.max_prompt_chars, 5000);
    assert.equal(seedance.screen_sizes.length, 6);
    assert.equal(seedance.durations.length, 12);
    const mini480 = modelsById.get("Seedance-2.0-mini-480p");
    assert.equal(mini480.input_mode, "multimodal-to-video");
    assert.equal(mini480.default_resolution, "480p");
    assert.equal(mini480.screen_sizes.length, 6);
    assert.equal(mini480.durations.length, 12);
    assert.equal(mini480.unit_points, 2);
    assert.equal(mini480.billing_unit, "second");
    const mini720 = modelsById.get("Seedance-2.0-mini-720p");
    assert.equal(mini720.default_resolution, "720p");
    assert.equal(mini720.unit_points, 3);
    assert.equal(mini720.billing_unit, "second");
    const grok = modelsById.get("grok-imagine-video-1.5");
    assert.equal(grok.input_mode, "text-or-image-to-video");
    assert.equal(grok.required_image_count, 0);
    assert.equal(grok.screen_sizes.length, 7);
    assert.equal(grok.durations.length, 15);
    assert.equal(grok.default_duration, "6");
    assert.equal(grok.unit_points, 8);
    assert.equal(grok.billing_unit, "request");
    assert.equal(mediaModelPriceLabel(grok.unit_points, grok.billing_unit), "8/次");
    assert.equal(modelsById.get("omni-fast-no-water").max_image_count, 5);
    assert.equal(modelsById.get("omni-fast-no-water").default_resolution, "720p");
    assert.deepEqual(modelsById.get("omni-fast-no-water").durations, [
      { value: "10", label: "10秒" },
    ]);
    assert.equal(
      modelsById.get("omni-fast-v2v-no-water").input_mode,
      "video-to-video",
    );
    assert.equal(modelsById.get("omni-fast-v2v-no-water").max_video_count, 2);
    assert.equal(
      modelsById.get("omni-fast-v2v-no-water").default_resolution,
      "720p",
    );
    assert.deepEqual(modelsById.get("omni-fast-v2v-no-water").durations, [
      { value: "10", label: "10秒" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("desktop persists media model credentials by technical route group without exposing them in the catalog", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-business-model-auth-"));
  try {
    const authPath = path.join(tempRoot, "auth.json");
    const client = new YouleApiClient({ authPath });
    client.loaded = true;
    client.modelApiKey = "sk-primary";
    client.modelBaseUrl = "https://transit.example/v1";
    client.modelKeys = [
      {
        provider: "grok",
        groupId: 7,
        apiKey: "sk-chat-route",
        baseUrl: "https://chat.example/v1",
      },
      {
        provider: "media",
        groupId: 33,
        apiKey: "sk-image-route",
        baseUrl: "https://media.example/v1",
      },
    ];
    client.businessModelPoolsCache = {
      cachedAt: Date.now(),
      result: normalizeBusinessModelPools({
        configured: true,
        catalog_version: 9,
        pools: [
          {
            id: "media_creation",
            enabled: true,
            capabilities: ["image_generation", "video_generation"],
            models: [
              {
                id: "catalog/image-model",
                provider: "grok",
                route_group_id: 33,
                enabled: true,
                capabilities: ["image_generation"],
              },
            ],
          },
        ],
      }),
    };

    await client.saveModelAuth();

    const credential = client.businessModelCredential(
      "media_creation",
      "image_generation",
      "catalog/image-model",
    );
    assert.equal(credential.apiKey, "sk-image-route");
    assert.equal(credential.groupId, 33);

    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    assert.equal(auth.OPENAI_API_KEY, "sk-primary");
    assert.deepEqual(
      auth.HAOLO_MEDIA_MODEL_CREDENTIALS.image_generation["catalog/image-model"],
      {
        provider: "grok",
        route_group_id: 33,
        api_key: "sk-image-route",
        base_url: "https://media.example/v1",
      },
    );
    assert.doesNotMatch(
      JSON.stringify(client.businessModelPoolsCache.result),
      /sk-(?:primary|image-route)/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("media creation uses the media relay when a model is misassigned to a chat platform route", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-media-route-repair-"));
  try {
    const authPath = path.join(tempRoot, "auth.json");
    const client = new YouleApiClient({ authPath });
    client.loaded = true;
    client.modelApiKey = "sk-primary";
    client.modelBaseUrl = "https://transit.example/v1";
    client.modelKeys = [
      {
        provider: "gemini",
        groupId: 6,
        apiKey: "sk-chat-platform",
        baseUrl: "https://chat.example/v1",
      },
      {
        provider: "media",
        groupId: 13,
        apiKey: "sk-media-platform",
        baseUrl: "https://media.example/v1",
      },
    ];
    client.businessModelPoolsCache = {
      cachedAt: Date.now(),
      result: normalizeBusinessModelPools({
        configured: true,
        pools: [
          {
            id: "media_creation",
            enabled: true,
            capabilities: ["video_generation"],
            models: [
              {
                id: "omni-fast-v2v-no-water",
                provider: "gemini",
                route_group_id: 6,
                enabled: true,
                capabilities: ["video_generation"],
              },
            ],
          },
        ],
      }),
    };

    const credential = client.businessModelCredential(
      "media_creation",
      "video_generation",
      "omni-fast-v2v-no-water",
    );
    assert.equal(credential.apiKey, "sk-media-platform");
    assert.equal(credential.groupId, 13);

    await client.saveModelAuth();
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    assert.deepEqual(
      auth.HAOLO_MEDIA_MODEL_CREDENTIALS.video_generation[
        "omni-fast-v2v-no-water"
      ],
      {
        provider: "gemini",
        route_group_id: 13,
        api_key: "sk-media-platform",
        base_url: "https://media.example/v1",
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
