// Model traffic uses this origin; account/login/update traffic stays on haolo.com.
export const HAOLO_GATEWAY_ORIGIN = "https://haolo.pro";
export const HAOLO_GATEWAY_BASE_URL = `${HAOLO_GATEWAY_ORIGIN}/v1`;
export const HAOLO_GATEWAY_HOST = "haolo.pro";

const LEGACY_GATEWAY_PORTS = new Map([
  ["aiapi.youleai.top", new Set(["", "80", "443"])],
  ["8.216.5.161", new Set(["", "80", "443", "8080"])],
  ["54.235.242.62", new Set(["", "80", "3000"])],
]);

export function normalizeHaoloGatewayBaseUrl(value, fallback = HAOLO_GATEWAY_BASE_URL) {
  const text = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (!text) return fallback;
  let url;
  try {
    url = new URL(text);
  } catch {
    return text;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    return text;
  }
  const legacy = LEGACY_GATEWAY_PORTS.get(url.hostname.toLowerCase())?.has(url.port);
  const current = url.hostname.toLowerCase() === HAOLO_GATEWAY_HOST && ["", "80", "443"].includes(url.port);
  if (!legacy && !current) return text;
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${HAOLO_GATEWAY_ORIGIN}${pathname || "/v1"}`;
}

// Touch provider URLs only; retain custom providers, comments, and permissions.
export function migrateHaoloGatewayConfig(text) {
  let providerSection = false;
  return String(text).split(/(\r?\n)/).map((line) => {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (header) {
      providerSection = /^(?:profiles\.[^.]+\.)?model_providers\./.test(header[1].replace(/["']/g, ""));
    }
    if (!providerSection) return line;
    return line.replace(/^(\s*base_url\s*=\s*)(["'])(https?:\/\/[^"'\r\n]+)\2(\s*(?:#.*)?)$/, (_match, prefix, quote, url, suffix) =>
      `${prefix}${quote}${normalizeHaoloGatewayBaseUrl(url)}${quote}${suffix}`);
  }).join("");
}

// Credentials remain untouched: only known retired endpoints are migrated.
export function migrateHaoloGatewayAuth(auth) {
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return auth;
  const next = { ...auth };
  for (const key of ["LLMHUB_BASE_URL", "SUB2API_BASE_URL", "TRANSIT_BASE_URL", "MODEL_BASE_URL", "OPENAI_BASE_URL", "DEEPSEEK_BASE_URL"]) {
    if (typeof next[key] === "string" && next[key].trim()) {
      next[key] = normalizeHaoloGatewayBaseUrl(next[key]);
    }
  }
  const media = next.HAOLO_MEDIA_MODEL_CREDENTIALS;
  if (media && typeof media === "object" && !Array.isArray(media)) {
    const migrateMedia = (value) => !value || typeof value !== "object" || Array.isArray(value)
      ? value
      : Object.fromEntries(Object.entries(value).map(([key, entry]) => [
        key,
        key === "base_url" && typeof entry === "string"
          ? normalizeHaoloGatewayBaseUrl(entry)
          : migrateMedia(entry),
      ]));
    next.HAOLO_MEDIA_MODEL_CREDENTIALS = migrateMedia(media);
  }
  return next;
}
