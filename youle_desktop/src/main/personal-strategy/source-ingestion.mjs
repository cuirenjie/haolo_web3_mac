import net from "node:net";

const MAX_URLS = 3;
const MAX_DOCUMENT_BYTES = 1_000_000;
const MAX_DOCUMENT_CHARS = 60_000;
const URL_PATTERN = /https?:\/\/[^\s<>"'，。；！？）】》]+/giu;
const SECRET_QUERY_PATTERN = /(?:api[_-]?key|access[_-]?token|auth|authorization|credential|password|secret|signature)/iu;

function cleanText(value, max = MAX_DOCUMENT_CHARS) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);
}

function ipv4IsPrivate(hostname) {
  if (!net.isIPv4(hostname)) return false;
  const [first, second] = hostname.split(".").map(Number);
  return first === 10
    || first === 127
    || first === 0
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127)
    || first >= 224;
}

function ipv6IsPrivate(hostname) {
  if (!net.isIPv6(hostname)) return false;
  const normalized = hostname.toLowerCase();
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/u.test(normalized)
    || normalized.startsWith("ff")
    || normalized.startsWith("::ffff:");
}

export function safePersonalStrategyUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      !hostname
      || hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || ipv4IsPrivate(hostname)
      || ipv6IsPrivate(hostname)
    ) return "";
    for (const key of url.searchParams.keys()) {
      if (SECRET_QUERY_PATTERN.test(key)) return "";
    }
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

export function personalStrategyUrls(text, maxUrls = MAX_URLS) {
  const matches = String(text || "").match(URL_PATTERN) || [];
  return [...new Set(matches.map(safePersonalStrategyUrl).filter(Boolean))].slice(0, Math.max(0, maxUrls));
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Math.min(Number(code) || 32, 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Math.min(Number.parseInt(code, 16) || 32, 0x10ffff)));
}

export function strategyDocumentText(body, contentType = "") {
  const raw = cleanText(body, MAX_DOCUMENT_BYTES);
  if (!raw) return "";
  const looksLikeHtml = /html/iu.test(contentType) || /<(?:html|body|article|main|p|h[1-6])\b/iu.test(raw);
  if (!looksLikeHtml) return cleanText(raw);
  return cleanText(decodeHtmlEntities(raw
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/giu, " ")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<\/(?:p|div|article|section|main|li|h[1-6])>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n\s*\n\s*\n+/gu, "\n\n")));
}

export async function readPersonalStrategyUrls(text, {
  fetchImpl,
  timeoutMs = 12_000,
  maxBytes = MAX_DOCUMENT_BYTES,
  maxChars = MAX_DOCUMENT_CHARS,
} = {}) {
  if (typeof fetchImpl !== "function") return { documents: [], warnings: [] };
  const urls = personalStrategyUrls(text);
  const documents = [];
  const warnings = [];
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { Accept: "text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.1" },
      });
      const finalUrl = safePersonalStrategyUrl(response?.url || url);
      if (!finalUrl) throw new Error("链接重定向到了不允许访问的地址");
      if (!response?.ok) throw new Error(`HTTP ${Number(response?.status) || 0}`);
      const contentLength = Number(response.headers?.get?.("content-length") || 0);
      if (contentLength > maxBytes) throw new Error("页面内容过大");
      const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
      if (contentType && !/(?:text\/|application\/(?:json|xhtml\+xml|xml))/u.test(contentType)) {
        throw new Error(`不支持的页面类型：${contentType.split(";")[0]}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new Error("页面内容过大");
      const content = strategyDocumentText(bytes.toString("utf8"), contentType).slice(0, maxChars);
      if (!content) throw new Error("页面没有可读取的正文");
      documents.push({ url: finalUrl, content });
    } catch (error) {
      warnings.push({ url, message: String(error?.name === "AbortError" ? "读取超时" : error?.message || "读取失败").slice(0, 240) });
    } finally {
      clearTimeout(timer);
    }
  }
  return { documents, warnings };
}
