// Opt-in process-local diagnosis. Never alter Windows proxy settings or make
// packaged clients silently bypass the user's configured proxy.
export function developmentDirectNetwork(env = process.env) {
  return Boolean(env.HAOLO_DESKTOP_DEV_SERVER_URL || env.CODEX_DESKTOP_DEV_SERVER_URL || env.YOULE_DESKTOP_DEV_SERVER_URL)
    && env.HAOLO_DEV_NETWORK_MODE === "direct";
}
