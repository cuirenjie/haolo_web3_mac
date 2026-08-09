#!/usr/bin/env node

const SERVER_NAME = "youle-deepseek-mcp";
const SERVER_VERSION = "0.1.0";
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const REQUEST_TIMEOUT_MS = 120_000;

const tools = [
  {
    name: "chat_completion",
    description: "Ask DeepSeek a question or ask it to review supplied context.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Standalone user message to send to DeepSeek.",
        },
        messages: {
          type: "array",
          description: "OpenAI-compatible chat messages. Takes precedence over message.",
          items: {
            type: "object",
            properties: {
              role: { type: "string", enum: ["system", "user", "assistant"] },
              content: { type: "string" },
            },
            required: ["role", "content"],
          },
        },
        system: {
          type: "string",
          description: "Optional system message prepended when messages is not provided.",
        },
        model: {
          type: "string",
          description: "DeepSeek model. Defaults to DEEPSEEK_MODEL or deepseek-chat.",
        },
        temperature: {
          type: "number",
          description: "Sampling temperature.",
        },
        max_tokens: {
          type: "integer",
          description: "Maximum tokens to generate.",
        },
        top_p: {
          type: "number",
          description: "Nucleus sampling value, when supported by the DeepSeek-compatible endpoint.",
        },
        response_format: {
          type: "object",
          description: "Optional OpenAI-compatible response_format object.",
        },
        thinking: {
          type: "object",
          description: "Optional provider-specific thinking configuration. Passed through only when provided.",
        },
        conversation_id: {
          type: "string",
          description: "Optional provider-specific conversation id. Passed through only when provided.",
        },
      },
    },
  },
];

let inputBuffer = Buffer.alloc(0);
let nextNotificationId = 1;
let outputFraming = null;

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  void parseInputBuffer();
});

process.stdin.on("end", () => {
  process.exit(0);
});

process.stdin.resume();

async function parseInputBuffer() {
  while (true) {
    if (!looksLikeContentLengthFrame(inputBuffer)) {
      const newline = inputBuffer.indexOf(0x0a);
      if (newline >= 0) {
        const line = inputBuffer.subarray(0, newline).toString("utf8").trim();
        inputBuffer = inputBuffer.subarray(newline + 1);
        if (line) {
          outputFraming ||= "json-line";
          await handleRawMessage(line);
        }
        continue;
      }
      return;
    }

    const headerEnd = inputBuffer.indexOf(Buffer.from("\r\n\r\n", "ascii"));
    if (headerEnd < 0) return;

    const header = inputBuffer.subarray(0, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      inputBuffer = inputBuffer.subarray(headerEnd + 4);
      continue;
    }

    const contentLength = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    if (inputBuffer.length < bodyEnd) return;

    const body = inputBuffer.subarray(bodyStart, bodyEnd).toString("utf8");
    inputBuffer = inputBuffer.subarray(bodyEnd);
    outputFraming ||= "content-length";
    await handleRawMessage(body);
  }
}

function looksLikeContentLengthFrame(buffer) {
  if (!buffer.length) {
    return false;
  }
  const preview = buffer.subarray(0, Math.min(buffer.length, 32)).toString("ascii");
  return /^Content-Length:/i.test(preview);
}

async function handleRawMessage(body) {
  let message;
  try {
    message = JSON.parse(body);
  } catch (error) {
    writeMessage({
      jsonrpc: "2.0",
      id: nextNotificationId++,
      error: jsonRpcError(-32700, `Invalid JSON: ${error.message}`),
    });
    return;
  }

  if (!Object.hasOwn(message, "id")) {
    return;
  }

  try {
    const result = await handleRequest(message.method, message.params || {});
    writeMessage({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      error: error?.jsonRpcError || jsonRpcError(-32603, error?.message || String(error)),
    });
  }
}

async function handleRequest(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params.protocolVersion || DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools };
    case "tools/call":
      return callTool(params);
    case "prompts/list":
      return { prompts: [] };
    case "resources/list":
      return { resources: [] };
    case "logging/setLevel":
      return {};
    default:
      throw withJsonRpcError(-32601, `Method not found: ${method}`);
  }
}

async function callTool(params) {
  const name = String(params?.name || "");
  if (name !== "chat_completion") {
    throw withJsonRpcError(-32602, `Unknown tool: ${name}`);
  }

  try {
    const text = await requestDeepSeek(params.arguments || {});
    return {
      content: [{ type: "text", text }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error?.message || String(error) }],
    };
  }
}

async function requestDeepSeek(args) {
  const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured for the Youle DeepSeek MCP server.");
  }

  const messages = normalizeMessages(args);
  if (!messages.length) {
    throw new Error("Provide either message or messages for chat_completion.");
  }

  const payload = compactObject({
    model: String(args.model || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL).trim(),
    messages,
    temperature: finiteNumber(args.temperature),
    top_p: finiteNumber(args.top_p ?? args.topP),
    max_tokens: finiteInteger(args.max_tokens ?? args.maxTokens),
    response_format: plainObject(args.response_format ?? args.responseFormat),
    thinking: plainObject(args.thinking),
    conversation_id: nonEmptyString(args.conversation_id ?? args.conversationId),
    stream: false,
  });

  const response = await fetch(joinUrl(process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL, "/chat/completions"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const detail = json?.error?.message || json?.message || text.slice(0, 800) || response.statusText;
    throw new Error(`DeepSeek API returned HTTP ${response.status}: ${detail}`);
  }

  const choice = Array.isArray(json?.choices) ? json.choices[0] : null;
  const message = choice?.message || {};
  const answer = [message.reasoning_content, message.content].filter(Boolean).join("\n\n").trim();
  return answer || JSON.stringify(json, null, 2);
}

function normalizeMessages(args) {
  if (Array.isArray(args.messages)) {
    return args.messages
      .map((message) => ({
        role: normalizeRole(message?.role),
        content: String(message?.content || "").trim(),
      }))
      .filter((message) => message.role && message.content);
  }

  const messages = [];
  const system = String(args.system || "").trim();
  if (system) {
    messages.push({ role: "system", content: system });
  }

  const message = String(args.message || args.prompt || "").trim();
  if (message) {
    messages.push({ role: "user", content: message });
  }
  return messages;
}

function normalizeRole(role) {
  const value = String(role || "").trim();
  return ["system", "user", "assistant"].includes(value) ? value : "user";
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""));
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function nonEmptyString(value) {
  const text = String(value || "").trim();
  return text || undefined;
}

function joinUrl(baseUrl, suffix) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(suffix || "").replace(/^\/+/, "")}`;
}

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (outputFraming === "json-line") {
    process.stdout.write(`${body.toString("utf8")}\n`);
    return;
  }
  const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, "ascii");
  process.stdout.write(Buffer.concat([header, body]));
}

function jsonRpcError(code, message) {
  return { code, message };
}

function withJsonRpcError(code, message) {
  const error = new Error(message);
  error.jsonRpcError = jsonRpcError(code, message);
  return error;
}
