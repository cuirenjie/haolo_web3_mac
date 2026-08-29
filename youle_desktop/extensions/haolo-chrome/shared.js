export const PROTOCOL_VERSION = 1;
export const NATIVE_HOST_NAME = "com.haolo.chrome";
export const CONNECTION_STATES = Object.freeze({
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  ERROR: "error",
});

export function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
export async function extensionProfileId() {
  const stored = await chrome.storage.local.get("haoloProfileId");
  if (/^profile_[a-zA-Z0-9_-]{8,128}$/.test(stored.haoloProfileId || "")) return stored.haoloProfileId;
  const value = randomId("profile");
  await chrome.storage.local.set({ haoloProfileId: value });
  return value;
}

export function safeError(error, fallback = "Chrome extension operation failed.") {
  return {
    code: String(error?.code || "CHROME_EXTENSION_ERROR"),
    message: String(error?.message || fallback).slice(0, 2_000),
    category: String(error?.category || "execution"),
    retryable: Boolean(error?.retryable),
  };
}
