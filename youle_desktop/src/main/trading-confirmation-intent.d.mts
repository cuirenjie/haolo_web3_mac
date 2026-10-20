export function alertConfirmationIntentPrompt(input?: {
  userText?: string; lastAssistantMessage?: string; sourceText?: string;
}): string;
export function parseAlertConfirmationIntent(value: unknown): {
  ok: boolean; intent: string; confidence?: number; reason?: string; error?: string;
};
