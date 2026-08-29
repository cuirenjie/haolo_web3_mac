export type LocalGroupRoutingMember = {
  selectionId: string;
  name: string;
  muted?: boolean;
  respondable?: boolean;
};

export const LOCAL_GROUP_CHAT_MUTED_REPLY: string;

export function firstMentionedLocalGroupMember<T extends LocalGroupRoutingMember>(
  text: string,
  members: T[],
): T | null;

export function mentionedLocalGroupMembers<T extends LocalGroupRoutingMember>(
  text: string,
  members: T[],
): T[];

export function stripLocalGroupMemberMentions<T extends LocalGroupRoutingMember>(
  text: string,
  members: T[],
): string;

export function localGroupSharedHistoryRequested<T extends LocalGroupRoutingMember>(
  text: string,
  members?: T[],
): boolean;

export function localGroupTargetAgentText(params: {
  agentText: string;
  targetName: string;
  includeOtherMemberHistory?: boolean;
}): string;

export function localGroupMessageRoute<T extends LocalGroupRoutingMember>(params: {
  members: T[];
  text: string;
  /** Quoted messages are context only and never select the responder. */
  quotedMemberId?: string | null;
}): {
  mode: "ordinary" | "mention";
  targets: T[];
};
