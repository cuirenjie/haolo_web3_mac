// Match the business pool's authorization ID before credential lookup or dispatch.
export const DEEPSEEK_FLASH_MODEL = "deepseek-flash";
export const LEGACY_DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";
export function canonicalDeepSeekModel(value) {
  const model = String(value ?? "").trim();
  return [DEEPSEEK_FLASH_MODEL, LEGACY_DEEPSEEK_FLASH_MODEL].includes(model.toLowerCase())
    ? DEEPSEEK_FLASH_MODEL : model;
}
export function isDeepSeekFlashModel(value) {
  return canonicalDeepSeekModel(value) === DEEPSEEK_FLASH_MODEL;
}
export function migrateDeepSeekModelSelection(params = {}) {
  let next = params;
  for (const key of ["model", "modelId", "model_id"]) {
    if (isDeepSeekFlashModel(params[key]) && params[key] !== DEEPSEEK_FLASH_MODEL) {
      next = { ...next, [key]: DEEPSEEK_FLASH_MODEL };
    }
  }
  // Inspect model-selection envelopes only; never rewrite historical messages.
  for (const key of ["settings", "config", "response", "collaborationMode", "collaboration_mode"]) {
    if (!params[key] || typeof params[key] !== "object" || Array.isArray(params[key])) continue;
    const value = migrateDeepSeekModelSelection(params[key]);
    if (value !== params[key]) next = { ...next, [key]: value };
  }
  return next;
}
