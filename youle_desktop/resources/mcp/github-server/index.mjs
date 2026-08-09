#!/usr/bin/env node

const SERVER_NAME = "haolo-github-mcp";
const SERVER_VERSION = "1.0.0";
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";
const REQUEST_TIMEOUT_MS = 130_000;

const ownerRepo = {
  owner: { type: "string", description: "Repository owner or organization." },
  repo: { type: "string", description: "Repository name." },
};
const paging = {
  page: { type: "integer", minimum: 1, description: "Result page, starting at 1." },
  per_page: { type: "integer", minimum: 1, maximum: 100, description: "Results per page." },
};
const refProperty = { type: "string", description: "Branch, tag, or commit reference." };

const tools = [
  tool("github_status", "Read the Haolo GitHub relay status and policy.", {}, []),
  tool(
    "list_my_repositories",
    "List repositories available to the connected GitHub user.",
    {
      visibility: { type: "string", enum: ["all", "public", "private"] },
      affiliation: { type: "string", enum: ["owner", "collaborator", "organization_member"] },
      sort: { type: "string", enum: ["created", "updated", "pushed", "full_name"] },
      direction: { type: "string", enum: ["asc", "desc"] },
      ...paging,
    },
    [],
  ),
  tool(
    "search_repositories",
    "Search GitHub repositories visible to the connected user, or public repositories when disconnected.",
    {
      query: { type: "string", description: "GitHub repository search query." },
      sort: { type: "string", enum: ["stars", "forks", "help-wanted-issues", "updated"] },
      order: { type: "string", enum: ["asc", "desc"] },
      ...paging,
    },
    ["query"],
  ),
  tool("get_repository", "Read repository metadata and its default branch.", ownerRepo, ["owner", "repo"]),
  tool("list_branches", "List repository branches.", { ...ownerRepo, ...paging }, ["owner", "repo"]),
  tool(
    "get_branch",
    "Read a branch and its current commit.",
    { ...ownerRepo, branch: refProperty },
    ["owner", "repo", "branch"],
  ),
  tool(
    "get_file_contents",
    "Read a repository file or directory at an optional ref.",
    {
      ...ownerRepo,
      path: { type: "string", description: "Repository-relative path. Omit or use an empty string for root." },
      ref: refProperty,
    },
    ["owner", "repo"],
  ),
  tool(
    "list_commits",
    "List repository commits with optional filters.",
    {
      ...ownerRepo,
      sha: refProperty,
      path: { type: "string", description: "Repository-relative path filter." },
      author: { type: "string" },
      since: { type: "string", description: "ISO-8601 lower time bound." },
      until: { type: "string", description: "ISO-8601 upper time bound." },
      ...paging,
    },
    ["owner", "repo"],
  ),
  tool(
    "get_commit",
    "Read one commit.",
    { ...ownerRepo, ref: refProperty },
    ["owner", "repo", "ref"],
  ),
  tool(
    "compare_commits",
    "Compare two branches, tags, or commit references.",
    { ...ownerRepo, base: refProperty, head: refProperty, ...paging },
    ["owner", "repo", "base", "head"],
  ),
  tool(
    "search_code",
    "Search code within one explicit repository.",
    { ...ownerRepo, query: { type: "string", description: "GitHub code search query without a repo qualifier." }, ...paging },
    ["owner", "repo", "query"],
  ),
  tool(
    "list_issues",
    "List repository issues. Results can also contain pull requests.",
    {
      ...ownerRepo,
      state: { type: "string", enum: ["open", "closed", "all"] },
      labels: { type: "string", description: "Comma-separated label names." },
      sort: { type: "string", enum: ["created", "updated", "comments"] },
      direction: { type: "string", enum: ["asc", "desc"] },
      ...paging,
    },
    ["owner", "repo"],
  ),
  tool(
    "get_issue",
    "Read one issue.",
    { ...ownerRepo, issue_number: { type: "integer", minimum: 1 } },
    ["owner", "repo", "issue_number"],
  ),
  tool(
    "list_pull_requests",
    "List repository pull requests.",
    {
      ...ownerRepo,
      state: { type: "string", enum: ["open", "closed", "all"] },
      head: { type: "string" },
      base: refProperty,
      sort: { type: "string", enum: ["created", "updated", "popularity", "long-running"] },
      direction: { type: "string", enum: ["asc", "desc"] },
      ...paging,
    },
    ["owner", "repo"],
  ),
  tool(
    "get_pull_request",
    "Read one pull request.",
    { ...ownerRepo, pull_number: { type: "integer", minimum: 1 } },
    ["owner", "repo", "pull_number"],
  ),
  tool(
    "get_pull_request_files",
    "List files changed by a pull request.",
    { ...ownerRepo, pull_number: { type: "integer", minimum: 1 }, ...paging },
    ["owner", "repo", "pull_number"],
  ),
  tool(
    "create_branch",
    "Create a branch from an exact commit SHA.",
    {
      ...ownerRepo,
      branch: { type: "string", description: "New branch name." },
      sha: { type: "string", description: "Exact source commit SHA." },
    },
    ["owner", "repo", "branch", "sha"],
    false,
  ),
  tool(
    "create_or_update_file",
    "Create or update a UTF-8 text file on a branch, producing a commit.",
    {
      ...ownerRepo,
      path: { type: "string", description: "Repository-relative file path." },
      content: { type: "string", description: "Complete UTF-8 file content." },
      message: { type: "string", description: "Commit message." },
      branch: { type: "string", description: "Target branch." },
      sha: { type: "string", description: "Current blob SHA; required when replacing a file." },
    },
    ["owner", "repo", "path", "content", "message", "branch"],
    false,
  ),
  tool(
    "create_issue",
    "Create an issue.",
    {
      ...ownerRepo,
      title: { type: "string" },
      body: { type: "string" },
      labels: { type: "array", items: { type: "string" }, maxItems: 20 },
    },
    ["owner", "repo", "title"],
    false,
  ),
  tool(
    "add_issue_comment",
    "Add a comment to an issue or pull request conversation.",
    {
      ...ownerRepo,
      issue_number: { type: "integer", minimum: 1 },
      body: { type: "string" },
    },
    ["owner", "repo", "issue_number", "body"],
    false,
  ),
  tool(
    "create_pull_request",
    "Create a pull request; draft defaults to true.",
    {
      ...ownerRepo,
      title: { type: "string" },
      head: { type: "string", description: "Head branch." },
      base: { type: "string", description: "Base branch." },
      body: { type: "string" },
      draft: { type: "boolean", default: true },
      maintainer_can_modify: { type: "boolean", default: true },
    },
    ["owner", "repo", "title", "head", "base"],
    false,
  ),
];

const knownTools = new Set(tools.map(({ name }) => name));
let inputBuffer = Buffer.alloc(0);
let outputFraming = null;
let nextNotificationId = 1;

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  void parseInputBuffer();
});
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();

function tool(name, description, properties, required, readOnly = true) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint: readOnly,
      openWorldHint: true,
    },
  };
}

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
  if (!buffer.length) return false;
  return /^Content-Length:/i.test(buffer.subarray(0, Math.min(buffer.length, 32)).toString("ascii"));
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
  if (!Object.hasOwn(message, "id")) return;
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
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
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
  if (!knownTools.has(name)) {
    throw withJsonRpcError(-32602, `Unknown tool: ${name}`);
  }
  try {
    const payload = await requestBroker(name, params.arguments || {});
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

async function requestBroker(name, args) {
  const baseUrl = validateBrokerUrl(process.env.HAOLO_GITHUB_BROKER_URL);
  const token = String(process.env.HAOLO_GITHUB_BROKER_TOKEN || "").trim();
  if (!token) throw new Error("The Haolo GitHub local bridge is unavailable. Restart Haolo.");
  const response = await fetch(new URL("/v1/tools/call", baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ tool: name, arguments: args }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = payload?.error || {};
    const message = error.message || `Haolo GitHub relay returned HTTP ${response.status}`;
    throw new Error(JSON.stringify({
      code: error.code || "GITHUB_RELAY_ERROR",
      message,
      category: error.category || "remote",
      retryable: Boolean(error.retryable),
      retry_after_ms: error.retry_after_ms ?? null,
      request_id: error.request_id ?? null,
      upstream_status: error.upstream_status ?? null,
    }));
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("The Haolo GitHub relay returned an invalid response.");
  }
  return payload;
}

function validateBrokerUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("The Haolo GitHub local bridge is unavailable. Restart Haolo.");
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("The Haolo GitHub bridge must use the local loopback address.");
  }
  return url;
}

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (outputFraming === "json-line") {
    process.stdout.write(`${body.toString("utf8")}\n`);
    return;
  }
  process.stdout.write(Buffer.concat([
    Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, "ascii"),
    body,
  ]));
}

function jsonRpcError(code, message) {
  return { code, message };
}

function withJsonRpcError(code, message) {
  const error = new Error(message);
  error.jsonRpcError = jsonRpcError(code, message);
  return error;
}
