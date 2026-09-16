import { HAOLO_GATEWAY_BASE_URL, HAOLO_GATEWAY_HOST } from "./haolo-gateway.mjs";
import { ModelRequestRelay } from "./model-request-relay.mjs";

// Process-local only: keep credentials and persisted media job URLs unchanged.
export function modelToolNetworkEnv(env, relayBaseUrl) {
  if (!relayBaseUrl) return { ...env };
  const relay = new URL(relayBaseUrl);
  if (relay.protocol !== "http:" || relay.hostname !== "127.0.0.1" || !relay.port) {
    throw new Error("Model tools require a local routing relay");
  }
  const next = { ...env, HAOLO_MODEL_RELAY_URL: relay.href.replace(/\/$/, "") };
  for (const name of ["OPENAI_BASE_URL", "DEEPSEEK_BASE_URL", "TRANSIT_BASE_URL", "MODEL_BASE_URL"]) {
    if (!next[name]) continue;
    let url;
    try { url = new URL(next[name]); } catch { continue; }
    if (url.protocol === "https:" && url.hostname === HAOLO_GATEWAY_HOST && !url.port && !url.username && !url.password) {
      next[name] = `${relay.origin}${url.pathname}${url.search}`;
    }
  }
  for (const name of ["NO_PROXY", "no_proxy"]) {
    next[name] = [env[name], "127.0.0.1", "localhost"].filter(Boolean).join(",");
  }
  return next;
}

export async function withModelToolNetwork(env, { fetch }, run) {
  if (typeof fetch !== "function") throw new Error("Model tool routing transport is unavailable");
  const relay = new ModelRequestRelay({ upstreamBaseUrl: HAOLO_GATEWAY_BASE_URL, fetch });
  try {
    await relay.start();
    return await run(modelToolNetworkEnv(env, relay.localBaseUrl()));
  } finally {
    await relay.stop();
  }
}

export function modelToolNetworkConfigArgs(env, managedMcpAction) {
  if (!["updated", "unchanged"].includes(managedMcpAction) || !env.HAOLO_MODEL_RELAY_URL || !env.DEEPSEEK_BASE_URL) return [];
  const relay = new URL(env.HAOLO_MODEL_RELAY_URL);
  let deepSeek;
  try { deepSeek = new URL(env.DEEPSEEK_BASE_URL); } catch { return []; }
  if (relay.origin !== deepSeek.origin || relay.hostname !== "127.0.0.1" || relay.protocol !== "http:" || deepSeek.username || deepSeek.password) return [];
  // Override only the managed MCP's base URL in this process. Never put keys or
  // the temporary loopback port into persisted config/auth files.
  return ["-c", `mcp_servers.deepseek.env.DEEPSEEK_BASE_URL=${JSON.stringify(env.DEEPSEEK_BASE_URL)}`];
}
