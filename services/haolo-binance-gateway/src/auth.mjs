import crypto from "node:crypto";

export const PRIVATE_EGRESS_PERMIT_TYPE = "haolo-binance-egress-permit";

export class GatewayAuthError extends Error {
  constructor(message, statusCode = 401) {
    super(message);
    this.name = "GatewayAuthError";
    this.statusCode = statusCode;
    this.code = statusCode === 401
      ? "AUTHENTICATION_REQUIRED"
      : statusCode === 429
        ? "RATE_LIMITED"
        : "AUTHENTICATION_UNAVAILABLE";
  }
}

function decodeJsonSegment(value, field) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new GatewayAuthError(`invalid JWT ${field}`);
  }
}

function timingSafeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signHs256(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyHaoloJwt(token, config, nowSeconds = Math.floor(Date.now() / 1_000)) {
  const compact = String(token || "").trim();
  const parts = compact.split(".");
  if (parts.length !== 3) throw new GatewayAuthError("invalid JWT");
  const header = decodeJsonSegment(parts[0], "header");
  const payload = decodeJsonSegment(parts[1], "payload");
  if (header?.alg !== "HS256" || header?.typ && header.typ !== "JWT") {
    throw new GatewayAuthError("unsupported JWT algorithm");
  }
  const expected = crypto.createHmac("sha256", config.jwtSecret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  if (!timingSafeTextEqual(parts[2], expected)) throw new GatewayAuthError("invalid JWT signature");
  if (!payload?.sub) throw new GatewayAuthError("JWT subject is missing");
  if (payload.exp == null || payload.exp === "" || !Number.isFinite(Number(payload.exp))) {
    throw new GatewayAuthError("JWT expiry is missing");
  }
  if (Number(payload.exp) <= nowSeconds) throw new GatewayAuthError("JWT expired");
  if (Number.isFinite(Number(payload.nbf)) && Number(payload.nbf) > nowSeconds + 30) throw new GatewayAuthError("JWT not active");
  if (config.jwtIssuer && payload.iss !== config.jwtIssuer) throw new GatewayAuthError("JWT issuer mismatch");
  if (config.jwtAudience) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(config.jwtAudience)) throw new GatewayAuthError("JWT audience mismatch");
  }
  return Object.freeze({ userId: String(payload.sub), payload });
}

export function signPrivateEgressPermit(claims, config, nowSeconds = Math.floor(Date.now() / 1_000)) {
  const expiresInSeconds = Math.max(5, Math.ceil(Number(config.privatePermitTtlMs || 15_000) / 1_000));
  return signHs256({
    typ: PRIVATE_EGRESS_PERMIT_TYPE,
    sub: String(claims.userId),
    jti: String(claims.permitId),
    sid: String(claims.shardId),
    host: String(claims.targetHost),
    market: String(claims.marketType),
    priority: String(claims.priority),
    weight: Number(claims.weight),
    iat: nowSeconds,
    exp: nowSeconds + expiresInSeconds,
    ...(config.jwtIssuer ? { iss: config.jwtIssuer } : {}),
    ...(config.jwtAudience ? { aud: config.jwtAudience } : {}),
  }, config.jwtSecret);
}

export function verifyPrivateEgressPermit(token, config, nowSeconds = Math.floor(Date.now() / 1_000)) {
  const identity = verifyHaoloJwt(token, config, nowSeconds);
  const payload = identity.payload || {};
  if (payload.typ !== PRIVATE_EGRESS_PERMIT_TYPE) throw new GatewayAuthError("invalid private egress permit");
  if (!payload.jti || !payload.sid || !payload.host || !["spot", "futures"].includes(payload.market)) {
    throw new GatewayAuthError("private egress permit claims are incomplete");
  }
  const weight = Number(payload.weight);
  if (!Number.isSafeInteger(weight) || weight < 1) throw new GatewayAuthError("private egress permit weight is invalid");
  return Object.freeze({
    userId: identity.userId,
    permitId: String(payload.jti),
    shardId: String(payload.sid),
    targetHost: String(payload.host).toLowerCase(),
    marketType: String(payload.market),
    priority: String(payload.priority || "background"),
    weight,
    payload,
  });
}

export function verifyHaoloAccessJwt(token, config, nowSeconds = Math.floor(Date.now() / 1_000)) {
  const identity = verifyHaoloJwt(token, config, nowSeconds);
  if (identity.payload?.typ === PRIVATE_EGRESS_PERMIT_TYPE) throw new GatewayAuthError("access token required");
  return identity;
}

export function bearerToken(headers = {}) {
  const raw = String(headers.authorization || headers.Authorization || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim() || "";
}

export function metricsAuthorized(headers = {}, expectedToken = "") {
  const token = bearerToken(headers);
  return Boolean(token && expectedToken && timingSafeTextEqual(token, expectedToken));
}

export function proxyToken(headers = {}) {
  const raw = String(headers["proxy-authorization"] || headers["Proxy-Authorization"] || "").trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(raw);
  if (bearer?.[1]) return bearer[1].trim();
  const basic = /^Basic\s+(.+)$/i.exec(raw);
  if (!basic?.[1]) return "";
  try {
    const decoded = Buffer.from(basic[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return "";
    const username = decoded.slice(0, separator);
    return username === "haolo" ? decoded.slice(separator + 1) : "";
  } catch {
    return "";
  }
}

export async function requireHttpIdentity(request, config, accessTokenVerifier = null) {
  const token = bearerToken(request.headers);
  if (!token && config.allowAnonymousPublic) {
    return Object.freeze({ userId: `anonymous:${request.socket.remoteAddress || "unknown"}`, payload: null });
  }
  if (!token) throw new GatewayAuthError("authentication required");
  return accessTokenVerifier
    ? accessTokenVerifier.verify(token)
    : verifyHaoloAccessJwt(token, config);
}
