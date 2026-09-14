import assert from "node:assert/strict";
import test from "node:test";
import { createConnectionLookup } from "../src/main/connection-route-lookup.mjs";

test("ordinary DNS resolvers without route invalidation retain their identity", () => {
  const lookup = () => {};
  assert.equal(createConnectionLookup(lookup), lookup);
  assert.equal(createConnectionLookup(null), null);
  assert.equal(createConnectionLookup(undefined), undefined);
});

test("concurrent connections retain separate selected addresses even when DNS completes out of order", () => {
  const callbacks = [];
  const invalidated = [];
  const lookup = (_host, _options, callback) => callbacks.push(callback);
  lookup.invalidate = (...args) => invalidated.push(args);
  const a = createConnectionLookup(lookup);
  const b = createConnectionLookup(lookup);
  a("gateway.example", { family: 4 }, () => {});
  b("gateway.example", { family: 4 }, () => {});
  callbacks[1](null, "203.0.113.2", 4);
  callbacks[0](null, "203.0.113.1", 4);
  a.invalidate("gateway.example");
  b.invalidate("gateway.example");
  assert.deepEqual(invalidated, [["gateway.example", "203.0.113.1"], ["gateway.example", "203.0.113.2"]]);
});

test("all-address DNS callbacks preserve their result and do not guess among multiple candidates", () => {
  const invalidated = [];
  const one = [{ address: "203.0.113.1", family: 4 }];
  let records = one;
  const lookup = (_host, options, callback) => { assert.equal(options.all, true); callback(null, records); };
  lookup.invalidate = (...args) => invalidated.push(args);
  const connection = createConnectionLookup(lookup);
  connection("gateway.example", { all: true }, (error, result) => { assert.equal(error, null); assert.equal(result, one); });
  connection.invalidate("gateway.example");
  records = [...one, { address: "203.0.113.2", family: 4 }];
  connection("gateway.example", { all: true }, (_error, result) => assert.equal(result, records));
  connection.invalidate("gateway.example");
  assert.deepEqual(invalidated, [["gateway.example", "203.0.113.1"]]);
});

test("DNS failure and failure before lookup never invalidate an unknown route", () => {
  const error = Object.assign(new Error("DNS unavailable"), { code: "ENOTFOUND" });
  const lookup = (_host, _options, callback) => callback(error);
  lookup.invalidate = () => assert.fail("No selected address can be attributed to this connection");
  const connection = createConnectionLookup(lookup);
  connection.invalidate("gateway.example");
  connection("gateway.example", (result) => assert.equal(result, error));
  connection.invalidate("gateway.example");
});

test("an actual peer overrides the DNS selection and a selected address cannot be attributed to another host", () => {
  const invalidated = [];
  const lookup = (_host, _options, callback) => callback(null, "203.0.113.1", 4);
  lookup.invalidate = (...args) => invalidated.push(args);
  const connection = createConnectionLookup(lookup);
  connection("gateway.example", { family: 4 }, () => {});
  connection.invalidate("unrelated.example");
  connection.invalidate("gateway.example", "203.0.113.2");
  const reused = createConnectionLookup(lookup);
  reused.invalidate("gateway.example", "203.0.113.3");
  assert.deepEqual(invalidated, [["gateway.example", "203.0.113.2"], ["gateway.example", "203.0.113.3"]]);
});
