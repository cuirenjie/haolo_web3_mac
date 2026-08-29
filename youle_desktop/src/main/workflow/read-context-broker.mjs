import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git", ".svn", ".hg", "node_modules", "dist", "build", "release", "coverage",
  ".next", ".nuxt", ".cache", ".idea", ".vscode", "__pycache__", ".pytest_cache",
]);

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".mdx", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg",
  ".csv", ".tsv", ".xml", ".html", ".css", ".scss", ".less", ".svg",
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".svelte",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".swift", ".cs", ".cpp", ".cc", ".c", ".h",
  ".sql", ".graphql", ".gql", ".sh", ".ps1", ".bat", ".cmd", ".dockerfile", ".gitignore",
]);

const SENSITIVE_FILE_PATTERN = /(^|[._-])(\.env|credentials?|secrets?|private[_-]?key|id_rsa|tokens?|cookies?|passwords?)([._-]|$)/i;
const MAX_ENUMERATED_FILES = 5_000;
const MAX_SELECTED_FILES = 32;
const MAX_FILE_CHARS = 24_000;
const MAX_CONTEXT_CHARS = 320_000;

export class ReadOnlyContextBroker {
  constructor(options = {}) {
    this.maxEnumeratedFiles = positiveInteger(options.maxEnumeratedFiles, MAX_ENUMERATED_FILES);
    this.maxSelectedFiles = positiveInteger(options.maxSelectedFiles, MAX_SELECTED_FILES);
    this.maxFileChars = positiveInteger(options.maxFileChars, MAX_FILE_CHARS);
    this.maxContextChars = positiveInteger(options.maxContextChars, MAX_CONTEXT_CHARS);
    this.minimumCandidateScore = nonNegativeNumber(options.minimumCandidateScore, 0);
  }

  async buildPackage({
    cwd,
    prompt,
    explicitPaths = [],
    searchHints = [],
    authorizationMode = "host_read_through",
    capabilityGrant = null,
    nodeId = null,
    maxEnumeratedFiles,
    maxSelectedFiles,
    maxFileChars,
    maxContextChars,
    minimumCandidateScore,
    extractPromptPaths = true,
    includeWorkspace = true,
    signal,
  } = {}) {
    throwIfReadContextAborted(signal);
    const root = path.resolve(String(cwd || process.cwd()));
    if (authorizationMode === "capability_grant") {
      assertLocalFileReviewGrant(capabilityGrant, { root, explicitPaths, nodeId });
    }
    const query = String(prompt || "");
    const requestedPaths = uniquePaths([
      ...explicitPaths,
      ...(extractPromptPaths ? extractLocalPaths(query) : []),
    ], root);
    const effectiveMaxEnumeratedFiles = positiveInteger(
      maxEnumeratedFiles,
      this.maxEnumeratedFiles,
    );
    const effectiveMaxSelectedFiles = positiveInteger(
      maxSelectedFiles,
      this.maxSelectedFiles,
    );
    const effectiveMaxFileChars = positiveInteger(
      maxFileChars,
      this.maxFileChars,
    );
    const effectiveMaxContextChars = positiveInteger(
      maxContextChars,
      this.maxContextChars,
    );
    const effectiveMinimumCandidateScore = nonNegativeNumber(
      minimumCandidateScore,
      this.minimumCandidateScore,
    );
    const candidates = includeWorkspace
      ? await enumerateTextFiles(
          root,
          effectiveMaxEnumeratedFiles,
          signal,
        )
      : [];
    for (const requestedPath of requestedPaths) {
      throwIfReadContextAborted(signal);
      const stat = await safeStat(requestedPath);
      if (stat?.isFile() && isReadableTextPath(requestedPath) && !candidates.includes(requestedPath)) {
        candidates.unshift(requestedPath);
      }
    }
    const terms = promptTerms([
      query,
      ...uniqueStringValues(searchHints),
    ].join("\n"));
    const ranked = await rankCandidates(candidates, terms, requestedPaths, signal);
    const eligible = ranked.filter((candidate) => (
      candidate.requested || candidate.score > effectiveMinimumCandidateScore
    ));
    const selected = eligible.slice(0, effectiveMaxSelectedFiles);
    const items = [];
    let totalChars = 0;
    for (const candidate of selected) {
      throwIfReadContextAborted(signal);
      if (totalChars >= effectiveMaxContextChars) break;
      const remaining = effectiveMaxContextChars - totalChars;
      const text = await readTextExcerpt(
        candidate.path,
        Math.min(effectiveMaxFileChars, remaining),
        terms,
      );
      throwIfReadContextAborted(signal);
      if (!text.trim()) continue;
      const stat = await safeStat(candidate.path);
      const relativePath = isInside(root, candidate.path) ? path.relative(root, candidate.path) || path.basename(candidate.path) : candidate.path;
      const item = {
        id: `artifact_${crypto.createHash("sha256").update(candidate.path).digest("hex").slice(0, 16)}`,
        type: "local_text",
        path: candidate.path,
        relativePath,
        mime: mimeForPath(candidate.path),
        size: stat?.size || Buffer.byteLength(text, "utf8"),
        modifiedAt: stat?.mtime?.toISOString?.() || null,
        score: candidate.score,
        excerpt: text,
        sha256: crypto.createHash("sha256").update(text).digest("hex"),
      };
      items.push(item);
      totalChars += text.length;
    }
    return {
      protocolVersion: 1,
      id: `context_${crypto.randomUUID()}`,
      root,
      intent: query,
      selectionPolicy: "quality_optimal_read_only",
      createdAt: new Date().toISOString(),
      totalChars,
      candidateCount: candidates.length,
      eligibleCandidateCount: eligible.length,
      minimumCandidateScore: effectiveMinimumCandidateScore,
      catalog: selected.map((candidate) => (
        isInside(root, candidate.path)
          ? path.relative(root, candidate.path) || path.basename(candidate.path)
          : candidate.path
      )),
      items,
      manifest: items.map(({ id, path: absolutePath, relativePath, mime, size, modifiedAt, sha256 }) => ({
        id,
        path: absolutePath,
        relativePath,
        mime,
        size,
        modifiedAt,
        sha256,
      })),
    };
  }
}

export function assertLocalFileReviewGrant(grant, { root, explicitPaths = [], nodeId } = {}) {
  if (!grant || typeof grant !== "object") throw new Error("A local file review CapabilityGrant is required.");
  if (grant.capability !== "local.files.review" || grant.effect !== "allow" || grant.access !== "read_only") {
    throw new Error("The CapabilityGrant does not allow read-only local file review.");
  }
  if (grant.delegation !== false) throw new Error("The local file review CapabilityGrant must prohibit delegation.");
  const operations = Array.isArray(grant.operations) ? grant.operations : [];
  if (!operations.includes("read")) throw new Error("The CapabilityGrant does not include file read access.");
  const subjectNodeId = String(grant.subjectNodeId || grant.scope?.nodeId || "").trim();
  if (!subjectNodeId || subjectNodeId !== String(nodeId || "").trim()) {
    throw new Error("The CapabilityGrant subject does not match the current workflow node.");
  }
  const resolvedRoot = path.resolve(String(root || process.cwd()));
  const grantedRoot = path.resolve(String(grant.scope?.root || ""));
  if (grantedRoot.toLowerCase() !== resolvedRoot.toLowerCase()) {
    throw new Error("The CapabilityGrant root does not match the current workflow root.");
  }
  const grantedPaths = new Set(
    (Array.isArray(grant.scope?.explicitPaths) ? grant.scope.explicitPaths : [])
      .map((value) => path.resolve(resolvedRoot, String(value || "")).toLowerCase()),
  );
  for (const requestedPath of Array.isArray(explicitPaths) ? explicitPaths : []) {
    const normalized = path.resolve(resolvedRoot, String(requestedPath || "")).toLowerCase();
    if (!grantedPaths.has(normalized)) {
      throw new Error("The requested explicit path is outside the CapabilityGrant.");
    }
  }
}

export async function summarizeReadOnlyWorkspace({
  cwd,
  explicitPaths = [],
  maxEnumeratedFiles = MAX_ENUMERATED_FILES,
  includeWorkspace = true,
  signal,
} = {}) {
  throwIfReadContextAborted(signal);
  const root = path.resolve(String(cwd || process.cwd()));
  const candidates = includeWorkspace
    ? await enumerateTextFiles(
        root,
        positiveInteger(maxEnumeratedFiles, MAX_ENUMERATED_FILES),
        signal,
      )
    : [];
  throwIfReadContextAborted(signal);
  const uploads = uniquePaths(explicitPaths, root);
  const topLevel = [];
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    for (const entry of entries.slice(0, 200)) {
      if (
        entry.isDirectory()
        && (
          DEFAULT_IGNORED_DIRECTORIES.has(entry.name.toLowerCase())
          || entry.name.startsWith(".codex-")
        )
      ) {
        continue;
      }
      topLevel.push({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      });
    }
  } catch {
    // The semantic resolver is fail-open. An unavailable summary must not
    // prevent the host from trying the actual read-through path.
  }
  return {
    available: candidates.length > 0 || uploads.length > 0,
    readableFileCount: candidates.length,
    uploadCount: uploads.length,
    topLevel,
  };
}

export function contextPackageText(contextPackage) {
  const items = Array.isArray(contextPackage?.items) ? contextPackage.items : [];
  if (!items.length) return "未选择到与当前任务直接相关的本地文本材料。";
  return items.map((item) => [
    `<<<LOCAL_CONTEXT path=${JSON.stringify(item.path)} sha256=${item.sha256}>>>`,
    item.excerpt,
    "<<<END_LOCAL_CONTEXT>>>",
  ].join("\n")).join("\n\n");
}

async function enumerateTextFiles(root, limit, signal = null) {
  const results = [];
  const queue = [root];
  while (queue.length && results.length < limit) {
    throwIfReadContextAborted(signal);
    const directory = queue.shift();
    let entries = [];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      throwIfReadContextAborted(signal);
      if (results.length >= limit) break;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORED_DIRECTORIES.has(entry.name.toLowerCase()) && !entry.name.startsWith(".codex-")) queue.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !isReadableTextPath(fullPath)) continue;
      results.push(fullPath);
    }
  }
  return results;
}

async function rankCandidates(paths, terms, requestedPaths, signal = null) {
  const requested = new Set(requestedPaths.map((item) => path.resolve(item).toLowerCase()));
  const ranked = [];
  for (const filePath of paths) {
    throwIfReadContextAborted(signal);
    const normalized = path.resolve(filePath).toLowerCase();
    const name = path.basename(filePath).toLowerCase();
    const relativeDepth = filePath.split(path.sep).length;
    let score = requested.has(normalized) ? 10_000 : 0;
    for (const term of terms) {
      if (name.includes(term)) score += 120;
      if (normalized.includes(term)) score += 18;
    }
    if (/^(readme|agents|package|pyproject|cargo|go\.mod|requirements)/i.test(name)) score += 18;
    score -= relativeDepth * 0.05;
    if (score < 10 && terms.length) {
      const preview = await readTextHead(filePath, 8_000);
      const lower = preview.toLowerCase();
      for (const term of terms) if (lower.includes(term)) score += 8;
    }
    ranked.push({
      path: filePath,
      score,
      requested: requested.has(normalized),
    });
  }
  return ranked.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
}

function throwIfReadContextAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Read-only context preparation was cancelled.");
  error.name = "AbortError";
  throw error;
}

async function readTextExcerpt(filePath, limit, terms) {
  const text = await readTextHead(filePath, Math.max(limit * 3, limit));
  if (text.length <= limit) return text;
  const lower = text.toLowerCase();
  const hit = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (Number.isFinite(hit)) {
    const headSize = Math.floor(limit * 0.25);
    const focusSize = Math.floor(limit * 0.5);
    const tailSize = limit - headSize - focusSize;
    const focusStart = Math.max(0, hit - Math.floor(focusSize / 3));
    return [
      text.slice(0, headSize),
      "\n[...中间内容按任务相关性截取...]\n",
      text.slice(focusStart, focusStart + focusSize),
      "\n[...中间内容按任务相关性截取...]\n",
      text.slice(-tailSize),
    ].join("");
  }
  const headSize = Math.floor(limit * 0.6);
  return `${text.slice(0, headSize)}\n[...内容过长，保留首尾...]\n${text.slice(-(limit - headSize))}`;
}

async function readTextHead(filePath, limit) {
  let handle;
  try {
    handle = await fs.promises.open(filePath, "r");
    const buffer = Buffer.alloc(Math.max(1, limit));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (buffer.subarray(0, bytesRead).includes(0)) return "";
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => {});
  }
}

function extractLocalPaths(text) {
  const matches = String(text || "").match(/[A-Za-z]:[\\/][^\s\n\r"'<>|]+/g) || [];
  return matches.map((item) => item.replace(/[),.;，。；）]+$/, ""));
}

function promptTerms(text) {
  const matches = String(text || "").toLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,8}/g) || [];
  const stop = new Set(["这个", "那个", "需要", "可以", "进行", "当前", "用户", "任务", "文件", "工作流", "模型", "分析", "实现", "已经", "一个"]);
  return [...new Set(matches.filter((item) => !stop.has(item)))].slice(0, 80);
}

function isReadableTextPath(filePath) {
  const name = path.basename(filePath);
  if (SENSITIVE_FILE_PATTERN.test(name)) return false;
  const extension = path.extname(name).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || /^(dockerfile|makefile|readme|license|agents\.md)$/i.test(name);
}

function uniquePaths(values, root) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (!value) continue;
    const resolved = path.resolve(root, String(value));
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(resolved);
  }
  return output;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function mimeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if ([".json", ".jsonc"].includes(extension)) return "application/json";
  if ([".html", ".htm"].includes(extension)) return "text/html";
  if (extension === ".css") return "text/css";
  if (extension === ".csv") return "text/csv";
  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"].includes(extension)) return "text/javascript";
  return "text/plain";
}

async function safeStat(target) {
  try {
    return await fs.promises.stat(target);
  } catch {
    return null;
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function uniqueStringValues(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
}
