export type AppLanguage = "en" | "zh-CN" | "zh-TW";

export const APP_LANGUAGE_STORAGE_KEY: "haolo.appearance.language";
export const APP_LANGUAGES: readonly AppLanguage[];
export function isAppLanguage(value: unknown): value is AppLanguage;
export function normalizeAppLanguage(value: unknown): AppLanguage;
export function readStoredAppLanguage(storage?: Pick<Storage, "getItem">): AppLanguage | null;
export function loadAppLanguage(storage?: Pick<Storage, "getItem">): AppLanguage;
export function resolveAppLanguagePreference(options?: {
  currentLanguage?: unknown;
  mainLanguage?: unknown;
  mainPreferenceStored?: boolean;
  rendererLanguage?: unknown;
  userSelected?: boolean;
}): AppLanguage;
export function appLanguageLocale(language?: AppLanguage): "en-US" | "zh-CN" | "zh-TW";
export function getCurrentAppLanguage(): AppLanguage;
export function appLanguageOptions(): Array<{ value: AppLanguage; label: string }>;
export function configureTraditionalCharacterMap(simplified: string, traditional: string): void;
export function translateAppText(value: unknown, language?: AppLanguage): string;
export function translateTradingAnnotationText(value: unknown, language?: AppLanguage): string;
export function localizeAppTree(root: Node | null, language?: AppLanguage): void;
export function applyAppLanguage(
  language: AppLanguage,
  options?: { persist?: boolean; root?: Node | null },
): AppLanguage;
export function observeAppLanguage(root: Node | null): () => void;
