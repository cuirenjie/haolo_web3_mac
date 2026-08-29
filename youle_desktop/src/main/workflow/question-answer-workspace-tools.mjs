import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const IGNORED_DIRECTORIES = new Set([
  ".git", ".svn", ".hg", "node_modules", "dist", "build", "release",
  "coverage", ".next", ".nuxt", ".cache", ".idea", ".vscode",
  "__pycache__", ".pytest_cache",
]);

const READABLE_EXTENSIONS = new Set([
  ".txt", ".md", ".mdx", ".json", ".jsonc", ".yaml", ".yml", ".toml",
  ".ini", ".cfg", ".csv", ".tsv", ".xml", ".html", ".css", ".scss",
  ".less", ".svg", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue",
  ".svelte", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".swift",
  ".cs", ".cpp", ".cc", ".c", ".h", ".hpp", ".sql", ".graphql", ".gql",
  ".sh", ".ps1", ".bat", ".cmd", ".dockerfile", ".gitignore",
]);

const SENSITIVE_FILE_PATTERN = /(^|[._-])(\.env|credentials?|secrets?|private[_-]?key|id_rsa|tokens?|cookies?|passwords?)([._-]|$)/i;
const DEFAULT_MAX_ENUMERATED_FILES = 25_000;
const DEFAULT_LIST_PAGE_SIZE = 500;
const MAX_LIST_PAGE_SIZE = 2_000;
const DEFAULT_SEARCH_RESULTS = 200;
const MAX_SEARCH_RESULTS = 500;
const DEFAULT_READ_FILE_CHARS = 256_000;
const DEFAULT_READ_TOTAL_CHARS = 1_000_000;
const MAX_READ_PATHS = 64;

export class QuestionAnswerWorkspaceToolSession {
  constructor({
    cwd,
    explicitPaths = [],
    maxEnumeratedFiles = DEFAULT_MAX_ENUMERATED_FILES,
    maxReadFileChars = DEFAULT_READ_FILE_CHARS,
    maxReadTotalChars = DEFAULT_READ_TOTAL_CHARS,
  } = {}) {
    this.root = path.resolve(String(cwd || process.cwd()));
    this.explicitPathValues = uniqueStrings(explicitPaths).map((value) => (
      path.resolve(value)
    ));
    this.explicitPaths = new Set(
      this.explicitPathValues.map((value) => value.toLowerCase()),
    );
    this.maxEnumeratedFiles = positiveInteger(
      maxEnumeratedFiles,
      DEFAULT_MAX_ENUMERATED_FILES,
    );
    this.maxReadFileChars = positiveInteger(
      maxReadFileChars,
      DEFAULT_READ_FILE_CHARS,
    );
    this.maxReadTotalChars = positiveInteger(
      maxReadTotalChars,
      DEFAULT_READ_TOTAL_CHARS,
    );
    this.inventoryPromise = null;
    this.evidenceKeys = new Set();
  }

  definitions() {
    return [
      {
        type: "function",
        function: {
          name: "haolo_workspace_list",
          description: "List readable files in the current Haolo group workspace. Use pagination until you have enough project coverage.",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Optional workspace-relative directory prefix.",
              },
              offset: {
                type: "integer",
                minimum: 0,
                description: "Zero-based pagination offset.",
              },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: MAX_LIST_PAGE_SIZE,
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "haolo_workspace_search",
          description: "Search readable files in the current group and uploaded files. Returns matching paths, line numbers, and excerpts.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Literal text or symbol to search for.",
              },
              path: {
                type: "string",
                description: "Optional workspace-relative directory prefix.",
              },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: MAX_SEARCH_RESULTS,
              },
            },
            required: ["query"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "haolo_workspace_read",
          description: "Read complete or ranged text from files in the current group or the explicitly uploaded files. Call repeatedly when a file is truncated.",
          parameters: {
            type: "object",
            properties: {
              paths: {
                type: "array",
                minItems: 1,
                maxItems: MAX_READ_PATHS,
                items: { type: "string" },
                description: "Workspace-relative paths, or exact uploaded file paths.",
              },
              startLine: {
                type: "integer",
                minimum: 1,
                description: "Optional inclusive first line for every requested file.",
              },
              endLine: {
                type: "integer",
                minimum: 1,
                description: "Optional inclusive last line for every requested file.",
              },
              byteOffset: {
                type: "integer",
                minimum: 0,
                description: "Optional UTF-8 byte offset. Use nextByteOffset from a truncated result to continue through a very large file without losing content.",
              },
              maxBytes: {
                type: "integer",
                minimum: 1,
                maximum: DEFAULT_READ_FILE_CHARS,
                description: "Optional maximum bytes to return for each file in byte-offset mode.",
              },
            },
            required: ["paths"],
            additionalProperties: false,
          },
        },
      },
    ];
  }

  async execute(toolCall) {
    const name = String(
      toolCall?.function?.name || toolCall?.name || "",
    ).trim();
    const args = parseToolArguments(
      toolCall?.function?.arguments ?? toolCall?.arguments,
    );
    switch (name) {
      case "haolo_workspace_list":
        return this.list(args);
      case "haolo_workspace_search":
        return this.search(args);
      case "haolo_workspace_read":
        return this.read(args);
      default:
        return {
          ok: false,
          error: {
            code: "UNKNOWN_READ_ONLY_TOOL",
            message: `Unknown Haolo read-only workspace tool: ${name || "(empty)"}`,
          },
          newEvidence: false,
        };
    }
  }

  async list({ path: relativePrefix = "", offset = 0, limit } = {}) {
    const inventory = await this.inventory();
    const normalizedPrefix = normalizeRelativePrefix(relativePrefix);
    const filtered = normalizedPrefix
      ? inventory.filter((item) => (
          item.relativePath === normalizedPrefix
          || item.relativePath.startsWith(`${normalizedPrefix}/`)
        ))
      : inventory;
    const start = nonNegativeInteger(offset, 0);
    const pageSize = Math.min(
      MAX_LIST_PAGE_SIZE,
      positiveInteger(limit, DEFAULT_LIST_PAGE_SIZE),
    );
    const items = filtered.slice(start, start + pageSize).map(publicInventoryItem);
    const evidenceKey = `list:${normalizedPrefix}:${start}:${pageSize}`;
    const newEvidence = this.rememberEvidence(evidenceKey);
    return {
      ok: true,
      root: this.root,
      path: normalizedPrefix,
      offset: start,
      limit: pageSize,
      total: filtered.length,
      nextOffset: start + items.length < filtered.length
        ? start + items.length
        : null,
      items,
      newEvidence,
    };
  }

  async search({ query, path: relativePrefix = "", limit } = {}) {
    const needle = String(query || "").trim();
    if (!needle) {
      return {
        ok: false,
        error: {
          code: "SEARCH_QUERY_REQUIRED",
          message: "A non-empty literal search query is required.",
        },
        newEvidence: false,
      };
    }
    const normalizedNeedle = needle.toLowerCase();
    const normalizedPrefix = normalizeRelativePrefix(relativePrefix);
    const resultLimit = Math.min(
      MAX_SEARCH_RESULTS,
      positiveInteger(limit, DEFAULT_SEARCH_RESULTS),
    );
    const inventory = await this.inventory();
    const matches = [];
    for (const item of inventory) {
      if (
        normalizedPrefix
        && item.relativePath !== normalizedPrefix
        && !item.relativePath.startsWith(`${normalizedPrefix}/`)
      ) {
        continue;
      }
      if (item.relativePath.toLowerCase().includes(normalizedNeedle)) {
        matches.push({
          path: item.relativePath,
          line: null,
          excerpt: item.relativePath,
          match: "path",
        });
      }
      if (matches.length >= resultLimit) break;
      const contentMatches = await searchTextFile(
        item.absolutePath,
        needle,
        resultLimit - matches.length,
      );
      matches.push(...contentMatches.map((match) => ({
        path: item.relativePath,
        ...match,
      })));
      if (matches.length >= resultLimit) break;
    }
    const evidenceKey = `search:${normalizedPrefix}:${normalizedNeedle}:${resultLimit}`;
    const newEvidence = this.rememberEvidence(evidenceKey);
    return {
      ok: true,
      query: needle,
      path: normalizedPrefix,
      total: matches.length,
      truncated: matches.length >= resultLimit,
      matches,
      newEvidence,
    };
  }

  async read({
    paths,
    startLine,
    endLine,
    byteOffset,
    maxBytes,
  } = {}) {
    const requestedPaths = uniqueStrings(paths).slice(0, MAX_READ_PATHS);
    if (!requestedPaths.length) {
      return {
        ok: false,
        error: {
          code: "READ_PATHS_REQUIRED",
          message: "At least one file path is required.",
        },
        newEvidence: false,
      };
    }
    const firstLine = positiveInteger(startLine, 1);
    const lastLine = Number.isSafeInteger(Number(endLine)) && Number(endLine) >= firstLine
      ? Number(endLine)
      : null;
    const files = [];
    let remainingChars = this.maxReadTotalChars;
    let anyNewEvidence = false;
    for (const requestedPath of requestedPaths) {
      if (remainingChars <= 0) break;
      const resolved = await this.resolveReadableFile(requestedPath);
      if (!resolved) {
        files.push({
          path: requestedPath,
          error: {
            code: "FILE_OUTSIDE_READ_SCOPE",
            message: "The path is not a readable file in the current group or upload scope.",
          },
        });
        continue;
      }
      const readLimit = Math.min(this.maxReadFileChars, remainingChars);
      const useByteOffset = Number.isSafeInteger(Number(byteOffset))
        && Number(byteOffset) >= 0;
      const page = useByteOffset
        ? await readUtf8BytePage(resolved.absolutePath, {
            byteOffset: Number(byteOffset),
            maxBytes: Math.min(
              readLimit,
              positiveInteger(maxBytes, readLimit),
            ),
          })
        : await readUtf8LinePage(resolved.absolutePath, {
            startLine: firstLine,
            endLine: lastLine,
            maxChars: readLimit,
          });
      remainingChars -= page.content.length;
      const evidenceKey = [
        "read",
        resolved.absolutePath.toLowerCase(),
        useByteOffset ? `byte:${page.byteOffset}:${page.nextByteOffset}` : `line:${page.startLine}:${page.endLine}`,
      ].join(":");
      const isNew = this.rememberEvidence(evidenceKey);
      anyNewEvidence ||= isNew;
      files.push({
        path: resolved.relativePath,
        absolutePath: resolved.isUpload ? resolved.absolutePath : undefined,
        ...page,
      });
    }
    return {
      ok: true,
      files,
      truncated: requestedPaths.length > files.length || remainingChars <= 0,
      newEvidence: anyNewEvidence,
    };
  }

  async inventory() {
    if (!this.inventoryPromise) {
      this.inventoryPromise = enumerateInventory(
        this.root,
        this.explicitPathValues,
        this.maxEnumeratedFiles,
      );
    }
    return this.inventoryPromise;
  }

  async resolveReadableFile(requestedPath) {
    const value = String(requestedPath || "").trim();
    if (!value) return null;
    const resolved = path.isAbsolute(value)
      ? path.resolve(value)
      : path.resolve(this.root, value);
    const isUpload = this.explicitPaths.has(resolved.toLowerCase());
    if (!isUpload && !isInside(this.root, resolved)) return null;
    if (!isReadableTextPath(resolved)) return null;
    try {
      const stat = await fs.promises.stat(resolved);
      if (!stat.isFile()) return null;
    } catch {
      return null;
    }
    return {
      absolutePath: resolved,
      relativePath: isUpload && !isInside(this.root, resolved)
        ? resolved
        : toPosixPath(path.relative(this.root, resolved) || path.basename(resolved)),
      isUpload,
    };
  }

  rememberEvidence(key) {
    if (this.evidenceKeys.has(key)) return false;
    this.evidenceKeys.add(key);
    return true;
  }
}

export function questionAnswerToolMessage(toolCall, result) {
  return {
    role: "tool",
    tool_call_id: String(toolCall?.id || toolCall?.toolCallId || "").trim(),
    name: String(toolCall?.function?.name || toolCall?.name || "").trim(),
    content: JSON.stringify(result),
  };
}

async function enumerateInventory(root, explicitPaths, limit) {
  const inventory = [];
  const seen = new Set();
  const queue = [root];
  while (queue.length && inventory.length < limit) {
    const directory = queue.shift();
    let entries = [];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (inventory.length >= limit) break;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          !IGNORED_DIRECTORIES.has(entry.name.toLowerCase())
          && !entry.name.startsWith(".codex-")
        ) {
          queue.push(absolutePath);
        }
        continue;
      }
      if (!entry.isFile() || !isReadableTextPath(absolutePath)) continue;
      const key = absolutePath.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      inventory.push({
        absolutePath,
        relativePath: toPosixPath(
          path.relative(root, absolutePath) || path.basename(absolutePath),
        ),
        isUpload: false,
      });
    }
  }
  for (const explicitPath of explicitPaths) {
    const absolutePath = path.resolve(explicitPath);
    const key = absolutePath.toLowerCase();
    if (seen.has(key) || !isReadableTextPath(absolutePath)) continue;
    try {
      const stat = await fs.promises.stat(absolutePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    seen.add(key);
    inventory.push({
      absolutePath,
      relativePath: isInside(root, absolutePath)
        ? toPosixPath(path.relative(root, absolutePath) || path.basename(absolutePath))
        : absolutePath,
      isUpload: true,
    });
  }
  return inventory;
}

function publicInventoryItem(item) {
  return {
    path: item.relativePath,
    source: item.isUpload ? "upload" : "current_group",
  };
}

function parseToolArguments(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const text = String(value || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

async function searchTextFile(filePath, query, limit) {
  if (limit <= 0 || await hasBinaryMarker(filePath)) return [];
  const normalizedNeedle = query.toLowerCase();
  const matches = [];
  let lineNumber = 0;
  let input;
  try {
    input = fs.createReadStream(filePath, { encoding: "utf8" });
    const lines = readline.createInterface({
      input,
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      lineNumber += 1;
      const hit = line.toLowerCase().indexOf(normalizedNeedle);
      if (hit < 0) continue;
      matches.push({
        line: lineNumber,
        excerpt: line.slice(
          Math.max(0, hit - 160),
          hit + query.length + 320,
        ),
        match: "content",
      });
      if (matches.length >= limit) {
        lines.close();
        input.destroy();
        break;
      }
    }
  } catch {
    input?.destroy();
    return [];
  }
  return matches;
}

async function readUtf8LinePage(filePath, {
  startLine,
  endLine,
  maxChars,
}) {
  if (await hasBinaryMarker(filePath)) {
    return emptyReadPage({
      error: {
        code: "BINARY_FILE_NOT_READABLE",
        message: "The file appears to be binary and was not exposed as text.",
      },
    });
  }
  let input;
  let content = "";
  let lineNumber = 0;
  let lastReturnedLine = null;
  let nextStartLine = null;
  let nextByteOffset = null;
  let bytesBeforeLine = 0;
  let reachedEndOfFile = true;
  try {
    input = fs.createReadStream(filePath, { encoding: "utf8" });
    const lines = readline.createInterface({
      input,
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      lineNumber += 1;
      const lineBytes = Buffer.byteLength(`${line}\n`, "utf8");
      if (lineNumber < startLine) {
        bytesBeforeLine += lineBytes;
        continue;
      }
      if (endLine && lineNumber > endLine) {
        reachedEndOfFile = false;
        nextStartLine = lineNumber;
        nextByteOffset = bytesBeforeLine;
        lines.close();
        input.destroy();
        break;
      }
      const separator = content ? "\n" : "";
      const availableChars = maxChars - content.length - separator.length;
      if (availableChars <= 0) {
        reachedEndOfFile = false;
        nextStartLine = lineNumber;
        nextByteOffset = bytesBeforeLine;
        lines.close();
        input.destroy();
        break;
      }
      if (line.length > availableChars) {
        const fragment = line.slice(0, availableChars);
        content += separator + fragment;
        lastReturnedLine = lineNumber;
        reachedEndOfFile = false;
        nextStartLine = lineNumber;
        nextByteOffset = bytesBeforeLine + Buffer.byteLength(fragment, "utf8");
        lines.close();
        input.destroy();
        break;
      }
      content += separator + line;
      lastReturnedLine = lineNumber;
      bytesBeforeLine += lineBytes;
    }
  } catch {
    input?.destroy();
    return emptyReadPage({
      error: {
        code: "FILE_READ_FAILED",
        message: "The file could not be read as UTF-8 text.",
      },
    });
  }
  return {
    startLine,
    endLine: lastReturnedLine,
    totalLines: reachedEndOfFile ? lineNumber : null,
    byteOffset: null,
    nextStartLine,
    nextByteOffset,
    truncated: !reachedEndOfFile,
    content,
  };
}

async function readUtf8BytePage(filePath, { byteOffset, maxBytes }) {
  if (await hasBinaryMarker(filePath)) {
    return emptyReadPage({
      byteOffset,
      error: {
        code: "BINARY_FILE_NOT_READABLE",
        message: "The file appears to be binary and was not exposed as text.",
      },
    });
  }
  let handle;
  try {
    handle = await fs.promises.open(filePath, "r");
    const stat = await handle.stat();
    const safeOffset = Math.min(byteOffset, stat.size);
    const byteLimit = Math.max(1, Math.min(maxBytes, stat.size - safeOffset));
    const buffer = Buffer.alloc(byteLimit);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      buffer.length,
      safeOffset,
    );
    const nextByteOffset = safeOffset + bytesRead < stat.size
      ? safeOffset + bytesRead
      : null;
    return {
      startLine: null,
      endLine: null,
      totalLines: null,
      byteOffset: safeOffset,
      nextStartLine: null,
      nextByteOffset,
      sizeBytes: stat.size,
      truncated: nextByteOffset !== null,
      content: buffer.subarray(0, bytesRead).toString("utf8"),
    };
  } catch {
    return emptyReadPage({
      byteOffset,
      error: {
        code: "FILE_READ_FAILED",
        message: "The file could not be read as UTF-8 text.",
      },
    });
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function hasBinaryMarker(filePath) {
  let handle;
  try {
    handle = await fs.promises.open(filePath, "r");
    const buffer = Buffer.alloc(4_096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } catch {
    return true;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function emptyReadPage({ byteOffset = null, error } = {}) {
  return {
    startLine: null,
    endLine: null,
    totalLines: null,
    byteOffset,
    nextStartLine: null,
    nextByteOffset: null,
    truncated: false,
    content: "",
    error,
  };
}

function isReadableTextPath(filePath) {
  const name = path.basename(filePath);
  if (SENSITIVE_FILE_PATTERN.test(name)) return false;
  const extension = path.extname(name).toLowerCase();
  return READABLE_EXTENSIONS.has(extension)
    || /^(dockerfile|makefile|readme|license|agents\.md)$/i.test(name);
}

function normalizeRelativePrefix(value) {
  const text = toPosixPath(String(value || "").trim())
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
  if (!text || text === ".." || text.startsWith("../")) return "";
  return text;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === ""
    || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toPosixPath(value) {
  return String(value || "").split(path.sep).join("/");
}

function uniqueStrings(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.floor(number)
    : fallback;
}
