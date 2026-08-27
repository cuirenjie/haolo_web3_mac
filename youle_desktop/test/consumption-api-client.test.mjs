import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { YouleApiClient } from "../src/main/youle-api-client.mjs";

test("consumption client calls the authenticated backend contract", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("/export?")) {
      return new Response(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x01]), {
        status: 200,
        headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      });
    }
    return new Response(JSON.stringify({ ok: true, items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "access-token";

    await client.reportConsumptionAppEntry();
    await client.reportConsumptionEvent({
      interactionId: "turn-1",
      conversationId: "thread-1",
      childConversationId: "child-1",
      sourceType: "wechat",
      question: "question",
      answer: "answer",
      status: "complete",
      startedAt: "2026-07-18T00:00:00Z",
      endedAt: "2026-07-18T00:00:01Z",
    });
    await client.getConsumptionOverview({ unit: "usd" });
    await client.getConsumptionCalendar({ month: "2026-07", unit: "token" });
    await client.getConsumptionRecords({
      range: "7d",
      unit: "usd",
      language: "en",
      page: 2,
      pageSize: 20,
      runtimeStateProvided: true,
      activeInteractionIds: ["turn-active", "turn-child"],
      activeConversationIds: ["thread-provider"],
    });
    const report = await client.exportConsumptionReport({ unit: "usd" });

    assert.equal(requests.length, 6);
    assert.equal(requests[0].url, "https://haolo.example/api/consumption/me/app-enter");
    assert.equal(requests[1].url, "https://haolo.example/api/consumption/me/events");
    assert.deepEqual(JSON.parse(requests[1].init.body), {
      interaction_id: "turn-1",
      conversation_id: "thread-1",
      child_conversation_id: "child-1",
      source_type: "wechat",
      question: "question",
      answer: "answer",
      status: "complete",
      started_at: "2026-07-18T00:00:00Z",
      ended_at: "2026-07-18T00:00:01Z",
    });
    assert.match(requests[2].url, /\/overview\?unit=points$/);
    assert.match(requests[3].url, /\/calendar\?month=2026-07&unit=token$/);
    assert.match(
      requests[4].url,
      /\/records\?range=7d&unit=points&language=en&page=2&page_size=20&runtime_state=true&active_interaction_id=turn-active&active_interaction_id=turn-child&active_conversation_id=thread-provider$/,
    );
    assert.match(requests[5].url, /\/export\?unit=points$/);
    assert.deepEqual([...report.bytes], [0x50, 0x4b, 0x03, 0x04, 0x01]);
    assert.equal(report.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(requests[5].init.headers.Accept, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    for (const request of requests) {
      assert.equal(request.init.headers.Authorization, "Bearer access-token");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("consumption client forwards an exact calendar date", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "access-token";

    await client.getConsumptionRecords({
      range: "30d",
      date: "2026-07-19",
      unit: "token",
      language: "zh-TW",
      page: 1,
      pageSize: 6,
    });

    assert.match(requestedUrl, /\/records\?range=30d&date=2026-07-19&unit=token&language=zh-TW&page=1&page_size=6$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("calendar history sync drains the legacy export once without creating a local file", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes("/export?")) {
      return new Response(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x01]), {
        status: 200,
        headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      });
    }
    return new Response(JSON.stringify({ days: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "access-token";

    await client.getConsumptionCalendar({ month: "2026-06", unit: "token", includeHistory: true });
    await client.getConsumptionCalendar({ month: "2026-07", unit: "token", includeHistory: true });

    assert.equal(requests.filter((url) => url.includes("/export?")).length, 1);
    assert.match(requests[0], /\/export\?unit=token$/);
    assert.match(requests[1], /\/calendar\?month=2026-06&unit=token$/);
    assert.match(requests[2], /\/calendar\?month=2026-07&unit=token$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("background history sync is shared while foreground calendar requests remain independent", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const workbook = Promise.withResolvers();
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes("/export?")) return workbook.promise;
    return Response.json({ days: [] });
  };
  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "access-token";
    const first = client.syncConsumptionHistory({ unit: "points" });
    const duplicate = client.syncConsumptionHistory({ unit: "token" });
    const calendar = await client.getConsumptionCalendar({ month: "2026-08", unit: "points" });
    assert.deepEqual(calendar, { days: [] });
    assert.equal(client.consumptionHistorySyncCompleted, false);
    assert.equal(requests.filter((url) => url.includes("/export?")).length, 1);
    workbook.resolve(new Response(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x01])));
    assert.deepEqual(await first, { synced: true });
    assert.deepEqual(await duplicate, { synced: true });
    assert.deepEqual(await client.syncConsumptionHistory({ unit: "points" }), { synced: true });
    assert.equal(requests.filter((url) => url.includes("/export?")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resetting the consumption session ignores an old history sync completion", async () => {
  const originalFetch = globalThis.fetch;
  const workbook = Promise.withResolvers();
  globalThis.fetch = async () => workbook.promise;
  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "access-token";
    const pending = client.syncConsumptionHistory({ unit: "points" });
    await new Promise((resolve) => setImmediate(resolve));
    client.resetConsumptionHistorySync();
    workbook.resolve(new Response(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x01])));
    assert.deepEqual(await pending, { synced: false });
    assert.equal(client.consumptionHistorySyncCompleted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("consumption export rejects a successful non-xlsx response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "access-token";
    await assert.rejects(
      client.exportConsumptionReport({ unit: "token" }),
      /不是有效的 Excel 工作簿/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("consumption export streams a large workbook directly to the selected file", async () => {
  const originalFetch = globalThis.fetch;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "haolo-consumption-export-"));
  const destinationPath = path.join(directory, "all-usage.xlsx");
  const workbook = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03]);
  globalThis.fetch = async () => new Response(workbook, {
    status: 200,
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "access-token";
    const report = await client.exportConsumptionReport({ unit: "token", destinationPath });

    assert.equal(report.path, destinationPath);
    assert.equal(report.byteLength, workbook.length);
    assert.deepEqual([...await fs.readFile(destinationPath)], [...workbook]);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
