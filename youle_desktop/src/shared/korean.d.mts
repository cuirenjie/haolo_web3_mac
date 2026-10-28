export function koreanText(value: unknown, depth?: number): string;
export function koreanCopy<T>(value: T): T;
export function withKoreanVariants<T extends Record<string, unknown>>(mapping: T): T & {ko: T[keyof T]; ja: T[keyof T]; vi: T[keyof T]};
export function localizedChoice(choices: readonly string[], language: string): string;
