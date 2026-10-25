import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { HAOBAO_CONTRACTS } from "./contracts.generated.mjs";

const ajv = new Ajv2020({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false });
addFormats(ajv);
const validators = new Map();

export class HaobaoContractError extends Error {
  constructor(code, path = "") {
    super(code);
    this.name = "HaobaoContractError";
    this.code = code;
    this.path = path;
  }
}

function unique(items, key, code) {
  if (new Set(items.map((item) => item[key])).size !== items.length) {
    throw new HaobaoContractError(code);
  }
}

function expression(frame) {
  unique(frame.tones, "emotion", "HAOBAO_DUPLICATE_EMOTION");
  if ((frame.episode_id == null) !== (frame.episode_status == null)) {
    throw new HaobaoContractError("HAOBAO_EPISODE_FRAME_INCOMPLETE");
  }
}

function bubbles(items) {
  unique(items, "id", "HAOBAO_DUPLICATE_BUBBLE");
  for (const bubble of items) {
    if (!bubble.text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(bubble.text)) {
      throw new HaobaoContractError("HAOBAO_INVALID_TEXT");
    }
    if ((bubble.fact_refs ?? []).some((ref) => ref.kind !== "task_fact")) {
      throw new HaobaoContractError("HAOBAO_INVALID_FACT_REF");
    }
  }
}

function snapshot(value) {
  unique(value.messages, "id", "HAOBAO_DUPLICATE_MESSAGE");
  unique(value.episodes ?? [], "id", "HAOBAO_DUPLICATE_EPISODE");
  for (const refs of [value.allowed_refs, value.input_refs]) {
    if (new Set(refs.map((ref) => JSON.stringify([ref.kind, ref.id]))).size !== refs.length) {
      throw new HaobaoContractError("HAOBAO_DUPLICATE_SOURCE");
    }
  }
  const allowed = new Set(value.allowed_refs.map((ref) => JSON.stringify([ref.kind, ref.id, ref.revision])));
  const users = new Set(value.messages.filter((msg) => msg.role === "user").map((msg) => JSON.stringify([msg.id, msg.revision])));
  for (const ref of value.input_refs) {
    if (ref.kind !== "message" || !users.has(JSON.stringify([ref.id, ref.revision]))) {
      throw new HaobaoContractError("HAOBAO_INPUT_SOURCE_INVALID");
    }
    if (!allowed.has(JSON.stringify([ref.kind, ref.id, ref.revision]))) {
      throw new HaobaoContractError("HAOBAO_INPUT_NOT_ALLOWED");
    }
  }
  for (const msg of value.messages) {
    if ((msg.role === "user") !== (msg.visibility === "user_input")) {
      throw new HaobaoContractError("HAOBAO_MESSAGE_VISIBILITY_INVALID");
    }
    if (msg.visibility === "delivery_unknown" && allowed.has(JSON.stringify(["message", msg.id, msg.revision]))) {
      throw new HaobaoContractError("HAOBAO_UNKNOWN_DELIVERY_NOT_EVIDENCE");
    }
  }
}

export function validateHaobaoContract(name, value, { ownerId } = {}) {
  const schema = HAOBAO_CONTRACTS.contracts[name];
  if (!schema) throw new HaobaoContractError("HAOBAO_UNKNOWN_CONTRACT");
  let validate = validators.get(name);
  if (!validate) {
    validate = ajv.compile(schema);
    validators.set(name, validate);
  }
  if (!validate(value)) {
    throw new HaobaoContractError("HAOBAO_SCHEMA_INVALID", validate.errors?.[0]?.instancePath ?? "");
  }
  if (ownerId != null && value.owner_id !== ownerId) {
    throw new HaobaoContractError("HAOBAO_OWNER_MISMATCH");
  }
  if (name === "ExpressionFrame") expression(value);
  if (value.expression_basis) expression(value.expression_basis);
  if (name === "AffectState") expression(value.frame);
  if (name === "TurnContextSnapshot") snapshot(value);
  if (value.bubbles) bubbles(value.bubbles);
  for (const field of ["appraisal_events", "episode_updates", "intent_proposals"]) {
    if (Array.isArray(value[field])) unique(value[field], "id", "HAOBAO_DUPLICATE_ID");
  }
  // No coercion/default mutation, no HTML interpretation, no tool execution.
  return structuredClone(value);
}
