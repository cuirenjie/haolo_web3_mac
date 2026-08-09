import assert from "node:assert/strict";
import test from "node:test";

import { formatProfileBalancePoints } from "../src/renderer/profile-balance.ts";

test("profile balances omit suffixes and truncate to exactly two decimal places", () => {
  assert.equal(formatProfileBalancePoints(88.1993), "88.19");
  assert.equal(formatProfileBalancePoints(88.9999), "88.99");
  assert.equal(formatProfileBalancePoints(1.15), "1.15");
  assert.equal(formatProfileBalancePoints(12), "12.00");
  assert.equal(formatProfileBalancePoints(0), "0.00");
});

test("profile balance formatting accepts the API's string forms", () => {
  assert.equal(formatProfileBalancePoints("88.1993"), "88.19");
  assert.equal(formatProfileBalancePoints("$1,234.567"), "1,234.56");
  assert.equal(formatProfileBalancePoints("🐾1,234.567"), "1,234.56");
  assert.equal(formatProfileBalancePoints("1,234.567ฅ"), "1,234.56");
  assert.equal(formatProfileBalancePoints("1,234.567 lo"), "1,234.56");
  assert.equal(formatProfileBalancePoints("1,234.567"), "1,234.56");
  assert.equal(formatProfileBalancePoints("invalid"), null);
});
