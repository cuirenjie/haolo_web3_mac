import fs from "node:fs";
import path from "node:path";

const RESULT_PREFIX = "HAOLO_CONTEXT_RESULT:";
const BODY_BEGIN = "HAOLO_CONTEXT_BODY_BEGIN";
const BODY_END = "HAOLO_CONTEXT_BODY_END";

export function parseHaoloContextEnvelope({
  text,
  workspace,
  authorizedPaths = [],
  maxContextChars = 640_000,
} = {}) {
  const raw = String(text || "").trim();
  const headerMatch = raw.match(/^HAOLO_CONTEXT_RESULT:\s*(\{[^\r\n]*\})\s*$/m);
  if (!headerMatch) {
    throw contextError(
      "HAOLO_CONTEXT_PROTOCOL_MISSING",
      "Haolo 未返回可验证的资料读取结果，已阻止把不完整内容交给外部模型。",
    );
  }

  let result;
  try {
    result = JSON.parse(headerMatch[1]);
  } catch {
    throw contextError(
      "HAOLO_CONTEXT_PROTOCOL_INVALID",
      "Haolo 返回的资料读取结果格式无效，已阻止把不完整内容交给外部模型。",
    );
  }

  const status = String(result?.status || "").trim().toLowerCase();
  if (status !== "complete") {
    throw contextError(
      "HAOLO_CONTEXT_READ_INCOMPLETE",
      firstString(
        result?.error,
        result?.summary,
        "Haolo 未能完整读取所需资料，外部模型不会基于不完整上下文作答。",
      ),
    );
  }

  const failedSources = Array.isArray(result?.failedSources)
    ? result.failedSources.filter(Boolean)
    : [];
  if (failedSources.length) {
    throw contextError(
      "HAOLO_CONTEXT_SOURCE_FAILED",
      `Haolo 未能读取 ${failedSources.length} 个任务所需文件，外部模型不会基于不完整上下文作答。`,
    );
  }

  const resolvedWorkspace = path.resolve(String(workspace || process.cwd()));
  const normalizedAuthorizedPaths = uniqueResolvedPaths(authorizedPaths, resolvedWorkspace);
  if (!normalizedAuthorizedPaths.length) {
    throw contextError(
      "HAOLO_CONTEXT_SCOPE_EMPTY",
      "Haolo 资料读取范围为空。",
    );
  }

  const sources = normalizeReadableSources(result?.sources, resolvedWorkspace);
  if (!sources.length) {
    throw contextError(
      "HAOLO_CONTEXT_NO_READABLE_SOURCE",
      "Haolo 没有证明已从任何文件提取出正文，外部模型不会继续作答。",
    );
  }

  for (const source of sources) {
    if (!pathIsAuthorized(source.path, normalizedAuthorizedPaths)) {
      throw contextError(
        "HAOLO_CONTEXT_SOURCE_OUT_OF_SCOPE",
        "Haolo 返回了授权范围之外的资料，已阻止继续传递。",
      );
    }
    if (!fs.existsSync(source.path) || !fs.statSync(source.path).isFile()) {
      throw contextError(
        "HAOLO_CONTEXT_SOURCE_NOT_FOUND",
        `Haolo 声明已读取的文件不存在：${source.path}`,
      );
    }
  }

  for (const authorizedPath of normalizedAuthorizedPaths) {
    if (!fs.existsSync(authorizedPath) || !fs.statSync(authorizedPath).isFile()) continue;
    if (!sources.some((source) => samePath(source.path, authorizedPath))) {
      throw contextError(
        "HAOLO_CONTEXT_EXPLICIT_FILE_MISSING",
        `Haolo 未能从明确指定的文件提取正文：${authorizedPath}`,
      );
    }
  }

  const bodyStart = raw.indexOf(BODY_BEGIN);
  const bodyEnd = raw.lastIndexOf(BODY_END);
  if (bodyStart < 0 || bodyEnd <= bodyStart) {
    throw contextError(
      "HAOLO_CONTEXT_BODY_MISSING",
      "Haolo 没有返回可供模型分析的资料正文。",
    );
  }
  const body = raw
    .slice(bodyStart + BODY_BEGIN.length, bodyEnd)
    .trim()
    .slice(0, Math.max(1, Number(maxContextChars) || 640_000));
  if (!body) {
    throw contextError(
      "HAOLO_CONTEXT_BODY_EMPTY",
      "Haolo 没有从所选资料中提取出正文。",
    );
  }

  return {
    status,
    body,
    sources,
    skillsUsed: uniqueStrings(result?.skillsUsed),
    summary: String(result?.summary || "").trim(),
  };
}

export function haoloContextEnvelopeInstructions() {
  return [
    "Return the result using this exact protocol:",
    'HAOLO_CONTEXT_RESULT: {"status":"complete","sources":[{"path":"ABSOLUTE_SOURCE_PATH","kind":"presentation|document|spreadsheet|pdf|text|code|other","status":"read","contentUnits":1,"extractedCharacters":1,"skill":"Presentations|documents|spreadsheets|pdf|filesystem"}],"failedSources":[],"skillsUsed":["Presentations"],"summary":"short factual summary"}',
    BODY_BEGIN,
    "Faithful source content with clear absolute-path and slide/page/sheet/section headings.",
    BODY_END,
    "The JSON header must occupy exactly one line.",
    "Use status=complete only after actual task-relevant body text or structured data was extracted from every explicitly requested file.",
    "For a selected folder, list each task-relevant file actually read; ignore unrelated operating-system cache files.",
    "For PPT/PPTX, contentUnits is the number of inspected slides and extractedCharacters is the number of characters extracted from slide text, notes, tables, and charts—not ZIP filenames or package metadata.",
    "If a required file cannot be parsed, use status=failed, put it in failedSources, explain the concrete tool failure in summary, and do not pretend that ZIP structure or filenames are document content.",
  ].join("\n");
}

function normalizeReadableSources(value, workspace) {
  const sources = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== "object") continue;
    if (String(item.status || "").trim().toLowerCase() !== "read") continue;
    const rawPath = String(item.path || "").trim();
    if (!rawPath) continue;
    const extractedCharacters = nonNegativeInteger(item.extractedCharacters);
    const contentUnits = nonNegativeInteger(item.contentUnits);
    if (extractedCharacters < 1 || contentUnits < 1) continue;
    sources.push({
      path: path.resolve(workspace, rawPath),
      kind: String(item.kind || "other").trim().toLowerCase() || "other",
      status: "read",
      contentUnits,
      extractedCharacters,
      skill: String(item.skill || "").trim(),
    });
  }
  const byPath = new Map();
  for (const source of sources) byPath.set(normalizedPathKey(source.path), source);
  return [...byPath.values()];
}

function uniqueResolvedPaths(values, workspace) {
  const byPath = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const rawPath = String(value || "").trim();
    if (!rawPath) continue;
    const resolved = path.resolve(workspace, rawPath);
    byPath.set(normalizedPathKey(resolved), resolved);
  }
  return [...byPath.values()];
}

function pathIsAuthorized(candidate, authorizedPaths) {
  return authorizedPaths.some((authorizedPath) => {
    if (samePath(candidate, authorizedPath)) return true;
    try {
      if (!fs.statSync(authorizedPath).isDirectory()) return false;
    } catch {
      return false;
    }
    const relative = path.relative(authorizedPath, candidate);
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
}

function samePath(left, right) {
  return normalizedPathKey(left) === normalizedPathKey(right);
}

function normalizedPathKey(value) {
  const resolved = path.resolve(String(value || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function uniqueStrings(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function contextError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
