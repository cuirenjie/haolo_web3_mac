import { createHash } from "node:crypto";
import { TRADING_PREFERENCE_CHOICE_FIELDS } from "../../shared/trading-preference-fields.mjs";
import { DEFAULT_TRADING_PREFERENCE_ENTRIES } from "./trading-preference-defaults.mjs";

const fields = Object.values(TRADING_PREFERENCE_CHOICE_FIELDS).flat();
const NO_NOTES = "无自定义补充说明";
const additionalKey = "additional_preferences";

export class TradingPreferenceError extends Error {
  constructor(code, message, fieldId = "") { super(message); this.code = code; this.fieldId = fieldId; }
}
const fail = (fieldId, message, code = "TRADING_PREFERENCE_INVALID") => {
  throw new TradingPreferenceError(code, message, fieldId);
};
const record = value => value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function text(value, max, fieldId) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /\u0000/.test(value)) fail(fieldId, "内容为空或过长，请简化后重试。");
  return value.trim();
}

export function validateTradingPreferenceDraft(params) {
  if (!record(params?.choices) || Object.keys(params.choices).some(id => !fields.some(field => field.id === id))) fail("", "交易偏好表单已失效，请重新打开设置。");
  const choices = {};
  for (const field of fields) {
    const choice = params.choices[field.id];
    const allowed = [...field.options.map(option => option.value), "custom"];
    if (!record(choice) || !Array.isArray(choice.selected) || !choice.selected.length
      || (!field.multiple && choice.selected.length !== 1)
      || new Set(choice.selected).size !== choice.selected.length
      || choice.selected.some(value => !allowed.includes(value))
      || (choice.selected.includes("none") && choice.selected.length !== 1)) fail(field.id, "请选择有效选项。");
    const custom = choice.selected.includes("custom") ? text(choice.custom, 280, field.id) : "";
    choices[field.id] = { selected: [...choice.selected], custom };
  }
  const extraNotes = params.extraNotes == null || params.extraNotes === "" ? "" : text(params.extraNotes, 2000, "extraNotes");
  return { choices, extraNotes };
}

function fingerprint(entries) {
  const identities = new Set([...DEFAULT_TRADING_PREFERENCE_ENTRIES.map(e => `${e.scope}.${e.key}`),
    "trading.profile.user_preference_notes", "trading.discipline.user_custom_rules", `trading.profile.${additionalKey}`]);
  const values = new Map(entries.filter(e => identities.has(`${e.scope}.${e.key}`)).map(e => [`${e.scope}.${e.key}`, e.value]));
  return createHash("sha256").update(JSON.stringify([...values].sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
}

// Original wording is UI metadata only. A chat edit invalidates its fingerprint,
// so reopening settings always reflects the currently effective configuration.
export function readTradingPreferenceForm(entries) {
  try {
    const raw = entries.findLast(e => e.scope === "preferences.form" && e.key === "trading_choices")?.value;
    const [version, digest, rows] = JSON.parse(raw);
    if (version !== 1 || digest !== fingerprint(entries) || !Array.isArray(rows) || rows.length !== fields.length) return null;
    const choices = Object.fromEntries(fields.map((field, i) => [field.id, { selected: rows[i][0], custom: rows[i][1] }]));
    const extraNotes = entries.findLast(e => e.scope === "trading.profile" && e.key === additionalKey)?.value;
    return validateTradingPreferenceDraft({ choices, extraNotes: extraNotes === NO_NOTES ? "" : extraNotes });
  } catch { return null; }
}
