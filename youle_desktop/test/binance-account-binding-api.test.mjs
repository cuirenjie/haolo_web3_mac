import assert from "node:assert/strict";
import test from "node:test";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";

test("Windows account binding uses the shared encrypted credential API", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const method = String(init.method || "GET").toUpperCase();
    const body = method === "GET" || method === "DELETE"
      ? {}
      : JSON.parse(String(init.body || "{}"));
    const responseBody = method === "GET"
      ? { items: [{ id: "connection-mobile", deviceId: "mobile-device", venue: "binance", marketType: "usdm" }] }
      : method === "DELETE"
        ? { status: "revoked" }
        : { id: "connection-windows", ...body };
    try {
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      throw error;
    }
  };

  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.mobileBindingDeviceId = "97b8e996-c25a-4a8d-a295-d2d68cf898ba";

    await client.registerMobileDevice({ platform: "windows" });
    await client.listAccountConnections();
    await client.createAccountConnection({ label: "Windows", analysisConsent: false });
    await client.bindAccountConnectionCredentials("connection-windows", {
      apiKey: "desktop-api-key",
      apiSecret: "desktop-api-secret",
    });
    await client.getAccountConnectionSnapshot("connection-windows");
    await client.deleteAccountConnection("connection-windows");

    assert.equal(requests[0].url, "https://haolo.example/api/mobile/v1/devices");
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      id: "97b8e996-c25a-4a8d-a295-d2d68cf898ba",
      platform: "windows",
      notifications: false,
    });
    assert.equal(requests[1].url, "https://haolo.example/api/mobile/v1/account-connections");
    assert.equal(requests[1].init.method, "GET");
    assert.deepEqual(JSON.parse(requests[2].init.body), {
      deviceId: "97b8e996-c25a-4a8d-a295-d2d68cf898ba",
      venue: "binance",
      marketType: "usdm",
      label: "Windows",
      analysisConsent: false,
    });
    assert.match(
      requests[2].init.headers["Idempotency-Key"],
      /^windows-account-connection:97b8e996-c25a-4a8d-a295-d2d68cf898ba:[0-9a-f-]{36}$/,
    );
    assert.match(requests[3].url, /\/api\/mobile\/v1\/account-connections\/connection-windows\/credentials$/);
    assert.deepEqual(JSON.parse(requests[3].init.body), {
      apiKey: "desktop-api-key",
      apiSecret: "desktop-api-secret",
    });
    assert.match(requests[4].url, /\/api\/mobile\/v1\/account-connections\/connection-windows\/snapshot$/);
    assert.match(requests[5].url, /\/api\/mobile\/v1\/account-connections\/connection-windows$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
