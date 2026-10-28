export const MODEL_RESPONSE_INCOMPLETE: string;
export interface IncompleteFacts { reason: string; responseId: string; inputTokens: number | null; outputTokens: number | null; outputItems: number | null; }
export function modelIncompleteFacts(value: unknown): IncompleteFacts | null;
export function incompleteErrorMessage(facts: IncompleteFacts): string;
export function incompleteResponseCopy(reason?: string, language?: string): {message: string; label: string; prompt: string; canContinue: boolean};
export function incompleteNoticeItem(threadId: string, turnId: string | null | undefined, reason: string, language: string, diagnosticSuffix?: string): {id: string; type: string; turnId: string | null | undefined; text: string; __youleLocalStatus: boolean; __youleIncompleteNotice: boolean; actions: {id: string; kind: string; label: string; text: string; conversation_id: string}[]};
export function preserveIncompletePartial<T>(existing: T | undefined, incoming: T): T;
