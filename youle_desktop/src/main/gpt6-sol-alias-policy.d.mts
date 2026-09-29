export const GPT_6_SOL_DISPLAY_MODEL: "gpt-6-sol";
export const GPT_6_SOL_RUNTIME_MODEL: "gpt-5.6-sol";
export function isGpt6SolDisplayModel(value: unknown): boolean;
export function displayModelAliasForSelection(value: unknown): string;
export function runtimeModelForSelection(value: unknown): string;
export function migrateGpt6SolSelection<T extends Record<string, unknown>>(params: T): T & Record<string, unknown>;
