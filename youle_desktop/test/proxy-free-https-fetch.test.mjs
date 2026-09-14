import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createProxyFreeHttpsFetch } from "../src/main/proxy-free-https-fetch.mjs";

test("an interrupted response body invalidates only its peer and is not replayed", async () => {
  const invalidated = [];
  const routeLookup = () => {};
  routeLookup.invalidate = (...args) => invalidated.push(args);
  let calls = 0;
  const network = createProxyFreeHttpsFetch({
    allowedOrigins: ["https://market.haolo.example"], routeLookup, agent: { destroy() {} },
    requestImpl(_url, _options, callback) {
      calls += 1;
      const request = new PassThrough();
      request.socket = { remoteAddress: "203.0.113.8" };
      queueMicrotask(() => {
        const response = new PassThrough();
        response.statusCode = 200;
        response.rawHeaders = [];
        callback(response);
        response.write('{"partial":');
        response.emit("aborted");
        response.destroy(Object.assign(new Error("reset"), { code: "ECONNRESET" }));
      });
      return request;
    },
  });
  await assert.rejects(network("https://market.haolo.example/fapi/v1/klines"), { code: "ECONNRESET" });
  assert.equal(calls, 1);
  assert.deepEqual(invalidated, [["market.haolo.example", "203.0.113.8"]]);
});

test("caller cancellation during body transfer does not invalidate a healthy edge", async () => {
  const controller = new AbortController();
  const invalidated = [];
  const routeLookup = () => {};
  routeLookup.invalidate = (...args) => invalidated.push(args);
  const network = createProxyFreeHttpsFetch({
    allowedOrigins: ["https://market.haolo.example"], routeLookup, agent: { destroy() {} },
    requestImpl(_url, _options, callback) {
      const request = new PassThrough();
      request.socket = { remoteAddress: "203.0.113.8" };
      queueMicrotask(() => {
        const response = new PassThrough();
        response.statusCode = 200;
        response.rawHeaders = [];
        callback(response);
        response.write("[");
        controller.abort(new Error("caller cancelled"));
      });
      return request;
    },
  });
  await assert.rejects(network("https://market.haolo.example/fapi/v1/klines", { signal: controller.signal }), /caller cancelled/);
  assert.deepEqual(invalidated, []);
});

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

test("proxy-free HTTPS transport resolves a dead gateway hostname through trusted candidates", async () => {
  const lookupCalls = [];
  let requestOptions;
  const requestImpl = (_url, options, callback) => {
    requestOptions = options;
    const request = new PassThrough();
    queueMicrotask(() => {
      const response = new PassThrough();
      response.statusCode = 200;
      response.statusMessage = "OK";
      response.rawHeaders = [];
      callback(response);
      response.end("{}");
    });
    return request;
  };
  const lookupImpl = (hostname, _options, callback) => {
    lookupCalls.push(hostname);
    if (hostname === "gateway-resolver.example") {
      callback(null, "203.0.113.8", 4);
      return;
    }
    callback(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
  };
  const networkFetch = createProxyFreeHttpsFetch({
    allowedOrigins: ["https://market.dead.example"],
    resolutionCandidatesByHostname: {
      "market.dead.example": ["gateway-resolver.example", "203.0.113.9"],
    },
    requestImpl,
    lookupImpl,
    agent: { destroy() {} },
  });

  const response = await networkFetch("https://market.dead.example/health");
  assert.equal(response.status, 200);
  const resolved = await new Promise((resolve, reject) => {
    requestOptions.lookup("market.dead.example", { family: 4 }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(resolved, { address: "203.0.113.8", family: 4 });
  assert.deepEqual(lookupCalls, ["gateway-resolver.example"]);
  assert.equal(requestOptions.servername, undefined, "the original URL hostname must remain the TLS SNI authority");
});

test("proxy-free HTTPS transport falls back to a pinned address when candidate DNS is unavailable", async () => {
  let requestLookup;
  const captureFetch = createProxyFreeHttpsFetch({
    allowedOrigins: ["https://market.dead.example"],
    resolutionCandidatesByHostname: {
      "market.dead.example": ["gateway-resolver.example", "203.0.113.9"],
    },
    lookupImpl(_hostname, _options, callback) {
      callback(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
    },
    requestImpl(_url, options, callback) {
      requestLookup = options.lookup;
      const request = new PassThrough();
      queueMicrotask(() => {
        const response = new PassThrough();
        response.statusCode = 200;
        response.rawHeaders = [];
        callback(response);
        response.end("{}");
      });
      return request;
    },
    agent: { destroy() {} },
  });
  await captureFetch("https://market.dead.example/health");
  const resolved = await new Promise((resolve, reject) => {
    requestLookup("market.dead.example", { family: 4 }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(resolved, { address: "203.0.113.9", family: 4 });
});
