#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_NAME = "haolo-chrome-mcp";
const SERVER_VERSION = "0.1.0";
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";
const REQUEST_TIMEOUT_MS = 45_000;
const directory = path.dirname(fileURLToPath(import.meta.url));
const tools = JSON.parse(await fs.promises.readFile(path.join(directory, "tools.json"), "utf8"));
const knownTools = new Set(tools.map((tool) => tool.name));
const clientSessionId = `chrome_mcp_process_${process.pid}_${crypto.randomUUID()}`;
let inputBuffer = Buffer.alloc(0);
let outputFraming = null;
let nextNotificationId = 1;

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  void parseInputBuffer();
});
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();

async function parseInputBuffer() {
  while (true) {
    if (!looksLikeContentLengthFrame(inputBuffer)) {
      const newline = inputBuffer.indexOf(0x0a);
      if (newline < 0) return;
      const line = inputBuffer.subarray(0, newline).toString("utf8").trim();
      inputBuffer = inputBuffer.subarray(newline + 1);
      if (line) {
        outputFraming ||= "json-line";
        await handleRawMessage(line);
      }
      continue;
    }
    const headerEnd = inputBuffer.indexOf(Buffer.from("\r\n\r\n", "ascii"));
    if (headerEnd < 0) return;
    const header = inputBuffer.subarray(0, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      inputBuffer = inputBuffer.subarray(headerEnd + 4);
      continue;
    }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(match[1]);
    if (inputBuffer.length < bodyEnd) return;
    const body = inputBuffer.subarray(bodyStart, bodyEnd).toString("utf8");
    inputBuffer = inputBuffer.subarray(bodyEnd);
    outputFraming ||= "content-length";
    await handleRawMessage(body);
  }
}

function looksLikeContentLengthFrame(buffer) {
  return buffer.length > 0 && /^Content-Length:/i.test(buffer.subarray(0, Math.min(buffer.length, 32)).toString("ascii"));
}

async function handleRawMessage(body) {
  let message;
  try {
    message = JSON.parse(body);
  } catch (error) {
    writeMessage({ jsonrpc: "2.0", id: nextNotificationId++, error: jsonRpcError(-32700, `Invalid JSON: ${error.message}`) });
    return;
  }
  if (!Object.hasOwn(message, "id")) return;
  try {
    const result = await handleRequest(message.method, message.params || {});
    writeMessage({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    writeMessage({ jsonrpc: "2.0", id: message.id, error: error?.jsonRpcError || jsonRpcError(-32603, error?.message || String(error)) });
  }
}

async function handleRequest(method, params) {
  if (method === "initialize") {
    return { protocolVersion: params.protocolVersion || DEFAULT_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools };
  if (method === "tools/call") return callTool(params);
  if (method === "prompts/list") return { prompts: [] };
  if (method === "resources/list") return { resources: [] };
  if (method === "logging/setLevel") return {};
  throw withJsonRpcError(-32601, `Method not found: ${method}`);
}

async function callTool(params) {
  const name = String(params?.name || "");
  if (!knownTools.has(name)) throw withJsonRpcError(-32602, `Unknown tool: ${name}`);
  try {
    const payload = await requestBroker(name, params.arguments || {}, params._meta || {});
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error?.message || String(error) }],
    };
  }
}

async function requestBroker(name, args, meta) {
  const baseUrl = validateBrokerUrl(process.env.HAOLO_CHROME_BROKER_URL);
  const token = String(process.env.HAOLO_CHROME_BROKER_TOKEN || "").trim();
  if (!token) throw new Error("The Haolo Chrome local bridge is unavailable. Restart Haolo.");
  const context = {
    threadId: firstText(meta?.haoloThreadId, meta?.threadId, `${clientSessionId}:thread`),
    turnId: firstText(meta?.haoloTurnId, meta?.turnId, `${clientSessionId}:call:${crypto.randomUUID()}`),
    taskId: firstText(meta?.haoloChromeTaskId, meta?.taskId, `${clientSessionId}:task`),
    profileId: firstText(meta?.haoloChromeProfileId, meta?.profileId) || undefined,
  };
  const response = await fetch(new URL("/v1/tools/call", baseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ tool: name, arguments: args, context }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    const detail = payload?.error || {};
    throw new Error(JSON.stringify({
      code: detail.code || "CHROME_BRIDGE_ERROR",
      message: detail.message || `Haolo Chrome bridge returned HTTP ${response.status}`,
      category: detail.category || "execution",
      retryable: Boolean(detail.retryable),
    }));
  }
  if (!payload || typeof payload !== "object") throw new Error("The Haolo Chrome bridge returned an invalid response.");
  return payload;
}

function validateBrokerUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("The Haolo Chrome local bridge is unavailable. Restart Haolo."); }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("The Haolo Chrome bridge must use the loopback address.");
  return url;
}

function firstText(...values) {
  for (const value of values) {
    const text = typeof value === "string" ? value.trim() : "";
    if (text) return text.slice(0, 500);
  }
  return "";
}

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (outputFraming === "json-line") {
    process.stdout.write(`${body.toString("utf8")}\n`);
    return;
  }
  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, "ascii"), body]));
}

function jsonRpcError(code, message) { return { code, message }; }
function withJsonRpcError(code, message) {
  const error = new Error(message);
  error.jsonRpcError = jsonRpcError(code, message);
  return error;
}
