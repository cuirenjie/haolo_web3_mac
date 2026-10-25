import test from "node:test";
import assert from "node:assert/strict";
import { validateHaobaoContract } from "../src/shared/haobao/contracts.mjs";
import { HAOBAO_CONTRACTS } from "../src/shared/haobao/contracts.generated.mjs";

const owner = "12345678-1234-4234-8234-123456789abc";
const source = { kind: "message", id: "m1", revision: 1 };
function proposal() {
  return {
    schema_version: 1, snapshot_id: "s1",
    appraisal_events: [{ id: "e1", source_refs: [source], speech_act: "chat",
      target: "companion", confidence: "high", topic: "招呼", interpretation: "打招呼" }],
    expression_basis: { tones: [{ emotion: "calm", intensity: "light" }], mode: "natural", stance: "接话" },
    bubbles: [{ id: "b1", text: "在。" }],
  };
}

test("generated schema contains all frozen P0 contracts", () => {
  assert.equal(HAOBAO_CONTRACTS.schema_version, 1);
  assert.equal(Object.keys(HAOBAO_CONTRACTS.contracts).length, 13);
  for (const name of ["TurnProposal", "ReplyEnvelope", "MessageRequest", "TheoryConsensusRuleV1"]) {
    assert.equal(HAOBAO_CONTRACTS.contracts[name].additionalProperties, false);
    assert.ok(HAOBAO_CONTRACTS.contracts[name].required.includes("schema_version"));
  }
});

test("validate without mutating transport data or adding defaults", () => {
  const value = proposal();
  const before = structuredClone(value);
  const parsed = validateHaobaoContract("TurnProposal", value);
  assert.deepEqual(value, before);
  assert.deepEqual(parsed, value);
  assert.notEqual(parsed, value);
  assert.equal(parsed.bubbles[0].text, "在。");
});

test("unknown schema and boolean, string, missing versions fail closed", () => {
  assert.throws(() => validateHaobaoContract("Other", {}), /UNKNOWN_CONTRACT/);
  for (const version of [true, false, "1", 2, undefined]) {
    assert.throws(() => validateHaobaoContract("TurnProposal", { ...proposal(), schema_version: version }));
  }
});

test("untrusted model cannot attach tools or owner", () => {
  for (const field of ["owner_id", "grant", "command", "tool_calls", "completed"]) {
    assert.throws(() => validateHaobaoContract("TurnProposal", { ...proposal(), [field]: "injected" }));
  }
});

test("duplicate bubbles and source-as-fact are invalid", () => {
  const value = proposal();
  value.bubbles.push(value.bubbles[0]);
  assert.throws(() => validateHaobaoContract("TurnProposal", value), /DUPLICATE_BUBBLE/);
  value.bubbles = [{ id: "b1", text: "盯上了", fact_refs: [source] }];
  assert.throws(() => validateHaobaoContract("TurnProposal", value), /INVALID_FACT_REF/);
});

test("reply envelope is account bound and retains uncertain delivery separately", () => {
  const envelope = { schema_version: 1, id: "r1", owner_id: owner, companion_id: owner,
    conversation_id: owner, input_batch_id: "batch1", input_refs: [source],
    state_version: 1, memory_epoch: 0, persona_version: "haobao-persona-v1",
    bubbles: [{ id: "b1", text: "在。" }], presentation_hint: "neutral",
    created_at: "2026-10-25T14:00:00Z" };
  assert.deepEqual(validateHaobaoContract("ReplyEnvelope", envelope, { ownerId: owner }), envelope);
  assert.throws(() => validateHaobaoContract("ReplyEnvelope", envelope, { ownerId: "other" }), /OWNER_MISMATCH/);
  assert.throws(() => validateHaobaoContract("ReplyEnvelope", { ...envelope, read: true }));
});

test("dangerous control characters rejected but markup remains literal text", () => {
  for (const text of ["", "   ", "hello\u0000world", "a".repeat(1201)]) {
    const value = proposal(); value.bubbles[0].text = text;
    assert.throws(() => validateHaobaoContract("TurnProposal", value));
  }
  const value = proposal(); value.bubbles[0].text = "<b>literal</b> 🌤️";
  assert.equal(validateHaobaoContract("TurnProposal", value).bubbles[0].text, value.bubbles[0].text);
});

test("emotion mixture and episode pointer are consistent", () => {
  const value = proposal();
  value.expression_basis.tones.push(value.expression_basis.tones[0]);
  assert.throws(() => validateHaobaoContract("TurnProposal", value), /DUPLICATE_EMOTION/);
  value.expression_basis.tones.pop();
  value.expression_basis.episode_id = "ep1";
  assert.throws(() => validateHaobaoContract("TurnProposal", value), /FRAME_INCOMPLETE/);
});
