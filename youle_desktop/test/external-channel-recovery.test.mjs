import assert from "node:assert/strict";
import test from "node:test";
import { ExternalChannelRecoveryTurns } from "../src/renderer/external-channel-recovery.mjs";

test("automatic retries retain the original channel request across multiple turns", () => {
  const turns = new ExternalChannelRecoveryTurns();
  turns.note("wechat", "initial", { status: "scheduled", chainId: "chain", failedTurnId: "initial" });
  turns.note("wechat", "retry-1", { status: "started", chainId: "chain", failedTurnId: "initial" });
  turns.note("wechat", "retry-1", { status: "scheduled", chainId: "chain", failedTurnId: "retry-1" });
  turns.note("wechat", "retry-2", { status: "started", chainId: "chain", failedTurnId: "retry-1" });
  assert.equal(turns.matches("wechat", "initial", "retry-2"), true);
  assert.equal(turns.matches("wechat", "initial", "next-user-message"), false);
  assert.equal(turns.matches("telegram", "initial", "retry-2"), false);
});

test("failed recovery starts do not lose the real originating turn", () => {
  const turns = new ExternalChannelRecoveryTurns();
  turns.note("feishu", "initial", { status: "starting", chainId: "chain", failedTurnId: "initial" });
  turns.note("feishu", "start-2", { status: "cooling_down", chainId: "chain", failedTurnId: "start-2" });
  turns.note("feishu", "recovered", { status: "started", chainId: "chain", failedTurnId: "start-2" });
  assert.equal(turns.matches("feishu", "initial", "recovered"), true);
});

test("compaction/proxy replay may be followed by model recovery, without admitting future requests", () => {
  const turns = new ExternalChannelRecoveryTurns();
  turns.link("channel", "initial", "compacted");
  turns.note("channel", "recovered", { status: "started", chainId: "chain", failedTurnId: "compacted" });
  assert.equal(turns.matches("channel", "initial", "recovered"), true);
  assert.equal(turns.matches("channel", "recovered", "initial"), false);
  assert.equal(turns.matches("channel", "initial", "future"), false);
  turns.link("channel", "recovered", "initial"); // Defensive cycle handling.
  assert.equal(turns.matches("channel", "initial", "foreign"), false);
});

test("untrusted ordinary turn metadata cannot create a recovery relation; retained history is bounded", () => {
  const turns = new ExternalChannelRecoveryTurns({ limit: 2 });
  turns.note("channel", "foreign", { status: "completed", chainId: "chain", failedTurnId: "initial" });
  assert.equal(turns.matches("channel", "initial", "foreign"), false);
  for (let i = 0; i < 4; i++) {
    turns.note("channel", `start-${i}`, { status: "scheduled", chainId: `chain-${i}` });
    turns.note("channel", `end-${i}`, { status: "started", chainId: `chain-${i}` });
  }
  assert.equal(turns.edges.size, 2);
  assert.equal(turns.chains.size, 2);
  assert.equal(turns.matches("channel", "start-0", "end-0"), false);
  assert.equal(turns.matches("channel", "start-3", "end-3"), true);
});
