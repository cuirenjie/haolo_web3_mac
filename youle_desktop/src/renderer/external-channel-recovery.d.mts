export class ExternalChannelRecoveryTurns {
  constructor(options?: { limit?: number });
  link(threadId: string, originalTurnId: string | null | undefined, recoveredTurnId: string | null | undefined): void;
  note(threadId: string, turnId: string | null | undefined, meta: Record<string, unknown> | null | undefined): void;
  matches(threadId: string, originalTurnId: string, candidateTurnId: string): boolean;
}
