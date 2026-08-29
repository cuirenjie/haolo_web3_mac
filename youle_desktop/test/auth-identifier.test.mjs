import assert from "node:assert/strict";
import test from "node:test";
import {
  authChannelLabel,
  detectAuthIdentifier,
  maskAuthIdentifier,
  normalizeAuthIdentifier,
  normalizePhoneIdentifier,
  oppositeAuthChannel,
} from "../src/renderer/auth-identifier.js";

test("detectAuthIdentifier normalizes email and mainland phone inputs", () => {
  assert.deepEqual(detectAuthIdentifier(" Person@Example.COM "), {
    channel: "email",
    identifier: "person@example.com",
  });
  assert.deepEqual(detectAuthIdentifier("138 0013 8000"), {
    channel: "sms",
    identifier: "13800138000",
  });
  assert.deepEqual(detectAuthIdentifier("+86 138-0013-8000"), {
    channel: "sms",
    identifier: "13800138000",
  });
});

test("identifier validation rejects unsupported or mismatched values", () => {
  assert.equal(detectAuthIdentifier("not-an-identifier"), null);
  assert.equal(detectAuthIdentifier("12800138000"), null);
  assert.equal(normalizeAuthIdentifier("person@example.com", "sms"), "");
  assert.equal(normalizeAuthIdentifier("13800138000", "email"), "");
  assert.equal(normalizePhoneIdentifier("0086 13800138000"), "008613800138000");
});

test("secondary channel and masked copy match the web auth flow", () => {
  assert.equal(oppositeAuthChannel("email"), "sms");
  assert.equal(oppositeAuthChannel("sms"), "email");
  assert.equal(authChannelLabel("sms"), "手机号");
  assert.equal(authChannelLabel("email"), "邮箱");
  assert.equal(maskAuthIdentifier("sms", "13800138000"), "138****8000");
  assert.equal(maskAuthIdentifier("email", "person@example.com"), "pe***n@example.com");
});
