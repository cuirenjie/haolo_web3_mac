export type AuthIdentifierChannel = "email" | "sms";

export type AuthIdentifier = {
  channel: AuthIdentifierChannel;
  identifier: string;
};

export function normalizePhoneIdentifier(value: unknown): string;
export function normalizeAuthIdentifier(value: unknown, channel: AuthIdentifierChannel): string;
export function detectAuthIdentifier(value: unknown): AuthIdentifier | null;
export function oppositeAuthChannel(channel: AuthIdentifierChannel | ""): AuthIdentifierChannel | null;
export function authChannelLabel(channel: AuthIdentifierChannel): "手机号" | "邮箱";
export function maskAuthIdentifier(channel: AuthIdentifierChannel, identifier: unknown): string;
