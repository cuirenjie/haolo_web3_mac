import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createProxyFreeHttpsFetch } from "../src/main/proxy-free-https-fetch.mjs";

test("proxy-free HTTPS transport connects to the approved origin without proxy environment routing", async () => {
  const observations = [];
  const agent = { destroy() {} };
  const requestImpl = (url, options, callback) => {
    const request = new PassThrough();
    const body = [];
    request.on("data", (chunk) => body.push(Buffer.from(chunk)));
    observations.push({ url, options, body });
    queueMicrotask(() => {
      const response = new PassThrough();
      response.statusCode = 200;
      response.statusMessage = "OK";
      response.rawHeaders = ["content-type", "application/json", "x-route", "direct-node-https"];
      callback(response);
      response.end('{"ok":true}');
    });
    return request;
  };
  const networkFetch = createProxyFreeHttpsFetch({
    allowedOrigins: ["https://market.haolo.example"],
    requestImpl,
    agent,
  });

  const response = await networkFetch("https://market.haolo.example/fapi/v1/klines", {
    method: "POST",
    headers: { authorization: "Bearer private-token", "content-type": "application/json" },
    body: "{}",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(observations[0].url.hostname, "market.haolo.example");
  assert.equal(observations[0].options.family, 4);
  assert.equal(observations[0].options.agent, agent);
  assert.equal(observations[0].options.headers["accept-encoding"], "identity");
  assert.equal(observations[0].options.headers["content-length"], "2");
  assert.equal(Buffer.concat(observations[0].body).toString("utf8"), "{}");
  await assert.rejects(
    networkFetch("https://fapi.binance.com/fapi/v1/ping"),
    /origin is not allowed/,
  );
});

test("proxy-free HTTPS transport honors an already-aborted caller signal", async () => {
  const controller = new AbortController();
  controller.abort(new Error("caller stopped"));
  const networkFetch = createProxyFreeHttpsFetch({
    allowedOrigins: ["https://market.haolo.example"],
    requestImpl() { throw new Error("request must not start"); },
    agent: { destroy() {} },
  });
  await assert.rejects(
    networkFetch("https://market.haolo.example/fapi/v1/ping", { signal: controller.signal }),
    /caller stopped/,
  );
});
