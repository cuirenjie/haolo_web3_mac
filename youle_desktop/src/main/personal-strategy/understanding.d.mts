export type StrategyUnderstandingRule = {
  type: string;
  text: string;
  parameters: Record<string, unknown>;
};

export type StrategyUnderstanding = {
  schemaVersion: number;
  name: string;
  summary: string;
  direction: "long" | "short" | "both" | "unknown" | string;
  timeframes: string[];
  marketScope: string[];
  entryRules: StrategyUnderstandingRule[];
  exitRules: StrategyUnderstandingRule[];
  risk: Record<string, unknown>;
  exceptions: string[];
  evidence: Array<{ source: string; locator: string; quote: string; meaning: string }>;
  uncertainties: string[];
  questions: string[];
  confidence: number;
  compilerText: string;
  rawText: string;
};

export function normalizeStrategyUnderstanding(value: unknown, options?: { rawText?: string }): StrategyUnderstanding;
export function parseStrategyUnderstanding(value: unknown): { ok: boolean; error?: string; rawText: string; understanding?: StrategyUnderstanding };
export type StrategyConfirmationIntent = "confirm" | "cancel" | "revise" | "unclear";
export function strategyConfirmationIntentPrompt(options?: { userText?: string; strategyName?: string; lastAssistantMessage?: string }): string;
export function parseStrategyConfirmationIntent(value: unknown): { ok: boolean; intent: StrategyConfirmationIntent; confidence?: number; reason?: string; error?: string; rawText: string };
export function strategyUnderstandingCompilerText(value: unknown, fallbackText?: string): string;
export function strategyUnderstandingPrompt(options?: { sourceText?: string; previous?: unknown; userFeedback?: string; attachmentSummary?: string }): string;
export function strategyUnderstandingDisplayText(value: unknown, options?: { warnings?: string[] }): string;
