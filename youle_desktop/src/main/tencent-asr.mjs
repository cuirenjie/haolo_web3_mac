import crypto from "node:crypto";
import WebSocket from "ws";

const TENCENT_ASR_HOST = "asr.cloud.tencent.com";
const TENCENT_ASR_PATH = "/asr/v2";
const TENCENT_ASR_ENGINE = "16k_zh_en";
const CONNECT_TIMEOUT_MS = 10_000;
const FINAL_RESULT_TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 5_000;
const MAX_PCM_CHUNK_BYTES = 64 * 1024;
const OPEN_STATE = 1;

export class TencentAsrError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "TencentAsrError";
    this.code = code;
    this.serviceCode = options.serviceCode ?? null;
  }
}

export function resolveTencentAsrConfig(env = process.env) {
  const config = {
    appId: firstValue(env.HAOLO_TENCENT_ASR_APP_ID, env.TENCENTCLOUD_APP_ID),
    secretId: firstValue(env.HAOLO_TENCENT_ASR_SECRET_ID, env.TENCENTCLOUD_SECRET_ID),
    secretKey: firstValue(env.HAOLO_TENCENT_ASR_SECRET_KEY, env.TENCENTCLOUD_SECRET_KEY),
    token: firstValue(env.HAOLO_TENCENT_ASR_TOKEN, env.TENCENTCLOUD_SESSION_TOKEN),
    hotwordId: firstValue(env.HAOLO_TENCENT_ASR_HOTWORD_ID),
    hotwordList: firstValue(env.HAOLO_TENCENT_ASR_HOTWORD_LIST),
    engine: firstValue(env.HAOLO_TENCENT_ASR_ENGINE) || TENCENT_ASR_ENGINE,
  };
  const missing = [
    ["HAOLO_TENCENT_ASR_APP_ID", config.appId],
    ["HAOLO_TENCENT_ASR_SECRET_ID", config.secretId],
    ["HAOLO_TENCENT_ASR_SECRET_KEY", config.secretKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new TencentAsrError(
      "VOICE_NOT_CONFIGURED",
      `腾讯云语音识别尚未配置，请设置 ${missing.join("、")} 后重启客户端`,
    );
  }
  if (!/^\d+$/.test(config.appId)) {
    throw new TencentAsrError("VOICE_INVALID_CONFIG", "腾讯云语音识别 AppID 格式不正确");
  }
  return config;
}

export function normalizeTencentAsrCredentialPayload(payload, options = {}) {
  const roots = [payload, payload?.data, payload?.result].filter(isObject);
  const sources = [
    ...roots.map((item) => item.credentials).filter(isObject),
    ...roots,
  ];
  const read = (...keys) => {
    for (const source of sources) {
      for (const key of keys) {
        if (source[key] !== undefined && source[key] !== null) return source[key];
      }
    }
    return "";
  };
  const config = {
    appId: firstValue(read("app_id", "appId", "AppId")),
    secretId: firstValue(read("secret_id", "secretId", "tmp_secret_id", "tmpSecretId", "TmpSecretId")),
    secretKey: firstValue(read("secret_key", "secretKey", "tmp_secret_key", "tmpSecretKey", "TmpSecretKey")),
    token: firstValue(read("token", "Token")),
    hotwordId: firstValue(read("hotword_id", "hotwordId")),
    hotwordList: firstValue(read("hotword_list", "hotwordList")),
    engine: firstValue(read("engine", "engine_model_type", "engineModelType")) || TENCENT_ASR_ENGINE,
    expiresAt: normalizeCredentialExpiry(read("expires_at", "expiresAt", "expired_time", "expiredTime", "ExpiredTime")),
  };
  if (!config.appId || !config.secretId || !config.secretKey || !config.token || !config.expiresAt) {
    throw new TencentAsrError("VOICE_INVALID_CONFIG", "服务端返回的语音识别临时凭证不完整");
  }
  if (!/^\d+$/.test(config.appId)) {
    throw new TencentAsrError("VOICE_INVALID_CONFIG", "腾讯云语音识别 AppID 格式不正确");
  }
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  if (config.expiresAt <= nowMs + 30_000) {
    throw new TencentAsrError("VOICE_CREDENTIAL_EXPIRED", "语音识别临时凭证已过期，请重试");
  }
  return config;
}

export function buildTencentAsrWebSocketUrl(config, options = {}) {
  const timestamp = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const params = {
    convert_num_mode: 1,
    engine_model_type: config.engine || TENCENT_ASR_ENGINE,
    expired: timestamp + 24 * 60 * 60,
    filter_dirty: 0,
    filter_empty_result: 1,
    filter_modal: 1,
    filter_punc: 0,
    needvad: 1,
    nonce: options.nonce ?? crypto.randomInt(1, 1_000_000_000),
    secretid: config.secretId,
    timestamp,
    voice_format: 1,
    voice_id: options.voiceId || crypto.randomUUID(),
    word_info: 100,
  };
  if (config.token) params.token = config.token;
  if (config.hotwordId) params.hotword_id = config.hotwordId;
  if (config.hotwordList) params.hotword_list = config.hotwordList;

  const query = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  const signatureSource = `${TENCENT_ASR_HOST}${TENCENT_ASR_PATH}/${config.appId}?${query}`;
  const signature = crypto
    .createHmac("sha1", config.secretKey)
    .update(signatureSource, "utf8")
    .digest("base64");
  return `wss://${signatureSource}&signature=${encodeURIComponent(signature)}`;
}

export function createTencentAsrClient(options = {}) {
  const createSocket = options.createWebSocket || ((url) => new WebSocket(url));
  const getConfig = options.getConfig || (() => resolveTencentAsrConfig());
  const connectTimeoutMs = positiveInteger(options.connectTimeoutMs, CONNECT_TIMEOUT_MS);
  const finalTimeoutMs = positiveInteger(options.finalTimeoutMs, FINAL_RESULT_TIMEOUT_MS);
  const sendTimeoutMs = positiveInteger(options.sendTimeoutMs, SEND_TIMEOUT_MS);
  let activeSession = null;

  async function startSession(params = {}) {
    const requestId = String(params.requestId || "").trim();
    if (!requestId) throw new TencentAsrError("VOICE_INVALID_REQUEST", "语音识别请求缺少 requestId");
    if (activeSession) await cancel(activeSession.requestId);

    const config = await getConfig();
    const url = buildTencentAsrWebSocketUrl(config, {
      nowMs: options.nowMs?.(),
      nonce: options.nonce?.(),
      voiceId: options.voiceId?.(),
    });
    const socket = createSocket(url);
    const ready = deferred();
    const finalResult = deferred();
    finalResult.promise.catch(() => {});
    const session = {
      requestId,
      socket,
      engine: config.engine || TENCENT_ASR_ENGINE,
      onResult: typeof params.onResult === "function" ? params.onResult : () => {},
      segments: new Map(),
      latestText: "",
      ready,
      readyReceived: false,
      finalResult,
      finalReceived: false,
      ending: false,
      cancelled: false,
      failed: false,
      connectTimer: null,
      finalTimer: null,
    };
    activeSession = session;
    bindSocket(session);
    session.connectTimer = setTimeout(() => {
      failSession(session, new TencentAsrError("VOICE_CONNECT_TIMEOUT", "连接腾讯云语音识别超时"));
    }, connectTimeoutMs);
    session.connectTimer.unref?.();

    await ready.promise;
    return {
      requestId,
      engine: "tencent-cloud-asr",
      model: session.engine,
      streaming: true,
    };
  }

  async function sendAudio(params = {}) {
    const session = requireActiveSession(params.requestId);
    if (!session.readyReceived || session.ending) {
      throw new TencentAsrError("VOICE_SESSION_NOT_READY", "腾讯云语音识别连接尚未就绪");
    }
    const audio = audioBuffer(params.audioBytes);
    if (!audio.length || audio.length % 2 !== 0 || audio.length > MAX_PCM_CHUNK_BYTES) {
      throw new TencentAsrError("VOICE_INVALID_AUDIO", "语音数据必须是 16kHz 单声道 PCM16");
    }
    await sendSessionMessage(session, audio, { binary: true });
    return { requestId: session.requestId, sentBytes: audio.length };
  }

  async function finishSession(params = {}) {
    const session = requireActiveSession(params.requestId);
    if (!session.ending) {
      session.ending = true;
      await sendSessionMessage(session, JSON.stringify({ type: "end" }));
      session.finalTimer = setTimeout(() => {
        failSession(session, new TencentAsrError("VOICE_FINAL_TIMEOUT", "等待腾讯云最终识别结果超时"));
      }, finalTimeoutMs);
      session.finalTimer.unref?.();
    }
    const result = await session.finalResult.promise;
    cleanupSession(session, { closeSocket: true });
    return result;
  }

  async function cancel(requestId) {
    const session = activeSession;
    if (!session || (requestId && session.requestId !== requestId)) return false;
    session.cancelled = true;
    const error = new TencentAsrError("VOICE_CANCELLED", "已取消语音识别");
    session.ready.reject(error);
    session.finalResult.reject(error);
    cleanupSession(session, { closeSocket: true });
    return true;
  }

  function bindSocket(session) {
    session.socket.on("message", (data) => handleSocketMessage(session, data));
    session.socket.on("error", (error) => {
      failSession(session, new TencentAsrError("VOICE_NETWORK_ERROR", "腾讯云语音识别网络连接失败", { cause: error }));
    });
    session.socket.on("close", () => {
      if (session.cancelled || session.failed || session.finalReceived) return;
      failSession(session, new TencentAsrError("VOICE_CONNECTION_CLOSED", "腾讯云语音识别连接意外断开"));
    });
  }

  function handleSocketMessage(session, data) {
    if (session.cancelled || session.failed) return;
    let payload;
    try {
      payload = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
    } catch (error) {
      failSession(session, new TencentAsrError("VOICE_INVALID_RESPONSE", "腾讯云语音识别返回了无效数据", { cause: error }));
      return;
    }
    if (Number(payload.code) !== 0) {
      failSession(session, serviceError(payload));
      return;
    }
    if (!session.readyReceived) {
      session.readyReceived = true;
      clearTimer(session, "connectTimer");
      session.ready.resolve();
    }

    if (payload.result) {
      const result = payload.result;
      const index = Math.max(0, Number.parseInt(result.index, 10) || 0);
      session.segments.set(index, normalizeTranscript(result.voice_text_str));
      session.latestText = mergeTranscriptSegments(session.segments);
      emitResult(session, {
        text: session.latestText,
        final: false,
        index,
        sliceType: Number(result.slice_type) || 0,
        startMs: Number(result.start_time) || 0,
        endMs: Number(result.end_time) || 0,
        words: normalizeWords(result.word_list),
      });
    }

    if (Number(payload.final) === 1) {
      session.finalReceived = true;
      clearTimer(session, "finalTimer");
      const result = {
        requestId: session.requestId,
        text: session.latestText,
        final: true,
        engine: "tencent-cloud-asr",
        model: session.engine,
      };
      emitResult(session, result);
      session.finalResult.resolve(result);
    }
  }

  function emitResult(session, result) {
    try {
      session.onResult({
        ok: true,
        requestId: session.requestId,
        engine: "tencent-cloud-asr",
        model: session.engine,
        ...result,
      });
    } catch {}
  }

  function failSession(session, error) {
    if (session.cancelled || session.failed || session.finalReceived) return;
    session.failed = true;
    session.ready.reject(error);
    session.finalResult.reject(error);
    try {
      session.onResult({
        ok: false,
        requestId: session.requestId,
        code: error.code || "VOICE_TRANSCRIPTION_FAILED",
        message: error.message || "腾讯云语音识别失败",
        ...(error.serviceCode != null && Number.isFinite(Number(error.serviceCode))
          ? { serviceCode: Number(error.serviceCode) }
          : {}),
      });
    } catch {}
    cleanupSession(session, { closeSocket: true });
  }

  function requireActiveSession(requestId) {
    const session = activeSession;
    if (!session || session.requestId !== String(requestId || "")) {
      throw new TencentAsrError("VOICE_SESSION_NOT_FOUND", "语音识别会话不存在或已经结束");
    }
    if (session.failed) throw new TencentAsrError("VOICE_SESSION_FAILED", "语音识别会话已经失败");
    return session;
  }

  function cleanupSession(session, options = {}) {
    clearTimer(session, "connectTimer");
    clearTimer(session, "finalTimer");
    if (options.closeSocket && session.socket.readyState < 2) {
      try {
        if (typeof session.socket.terminate === "function") session.socket.terminate();
        else session.socket.close();
      } catch {}
    }
    if (activeSession === session) activeSession = null;
  }

  async function sendSessionMessage(session, data, sendOptions) {
    try {
      await sendSocketMessage(session, data, sendOptions);
    } catch (error) {
      failSession(session, error);
      throw error;
    }
  }

  function sendSocketMessage(session, data, sendOptions) {
    if (session.socket.readyState !== OPEN_STATE) {
      return Promise.reject(new TencentAsrError("VOICE_CONNECTION_CLOSED", "腾讯云语音识别连接不可用"));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const settle = (error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      timer = setTimeout(() => {
        settle(new TencentAsrError("VOICE_SEND_TIMEOUT", "发送语音数据超时"));
      }, sendTimeoutMs);
      const callback = (error) => {
        if (error) settle(new TencentAsrError("VOICE_NETWORK_ERROR", "发送语音数据失败", { cause: error }));
        else settle();
      };
      try {
        if (sendOptions) session.socket.send(data, sendOptions, callback);
        else session.socket.send(data, callback);
      } catch (error) {
        settle(new TencentAsrError("VOICE_NETWORK_ERROR", "发送语音数据失败", { cause: error }));
      }
    });
  }

  return {
    startSession,
    sendAudio,
    finishSession,
    cancel,
    shutdown: () => cancel(),
    isActive: () => Boolean(activeSession),
  };
}

export function mergeTranscriptSegments(segments) {
  let output = "";
  for (const [, rawText] of [...segments.entries()].sort(([left], [right]) => left - right)) {
    const text = normalizeTranscript(rawText);
    if (!text) continue;
    const boundary = /[a-zA-Z0-9]$/.test(output) && /^[a-zA-Z0-9]/.test(text) ? " " : "";
    output += `${boundary}${text}`;
  }
  return output.trim();
}

function serviceError(payload) {
  const serviceCode = Number(payload.code) || null;
  const messages = {
    4002: "腾讯云语音识别鉴权失败，请检查 AppID、SecretID 和 SecretKey",
    4003: "腾讯云账号尚未开通实时语音识别服务",
    4004: "腾讯云语音识别资源包已用完，请开通后付费或购买资源包",
    4005: "腾讯云账号欠费，语音识别服务已暂停",
    4006: "腾讯云语音识别并发数已达上限",
    4007: "腾讯云无法解码当前语音数据",
    4008: "腾讯云等待语音数据超时",
  };
  return new TencentAsrError(
    "VOICE_SERVICE_ERROR",
    messages[serviceCode] || String(payload.message || "腾讯云语音识别服务返回错误"),
    { serviceCode },
  );
}

function audioBuffer(value) {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Buffer.isBuffer(value)) return value;
  return Buffer.alloc(0);
}

function normalizeWords(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    text: normalizeTranscript(item?.word),
    startMs: Number(item?.start_time) || 0,
    endMs: Number(item?.end_time) || 0,
    stable: Number(item?.stable_flag) === 1,
  })).filter((item) => item.text);
}

function normalizeTranscript(value) {
  return String(value || "")
    .replace(/\s+([，。！？、；：,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function firstValue(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeCredentialExpiry(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric);
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function clearTimer(session, key) {
  if (!session[key]) return;
  clearTimeout(session[key]);
  session[key] = null;
}

function deferred() {
  let resolve;
  let reject;
  let settled = false;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = (value) => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    };
    reject = (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}
