import fs from "node:fs";
import path from "node:path";
import {
  extractDeliveredArtifactPaths,
  isPathInsideDirectory,
  normalizeArtifactPathKey,
} from "../local-artifact-index.mjs";

const IMAGE_ARTIFACT_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".tif", ".tiff", ".avif",
]);
const VIDEO_ARTIFACT_EXTENSIONS = new Set([
  ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv", ".mpeg", ".mpg",
]);
const TEXT_ARTIFACT_EXTENSIONS = new Set([
  ".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".yml", ".yaml", ".log",
  ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".scss", ".less",
  ".sql", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".sh", ".bat", ".ps1", ".tex",
]);
const MIME_TYPE_BY_EXTENSION = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".bmp", "image/bmp"], [".webp", "image/webp"],
  [".svg", "image/svg+xml"], [".tif", "image/tiff"], [".tiff", "image/tiff"],
  [".avif", "image/avif"], [".mp4", "video/mp4"], [".webm", "video/webm"],
  [".mov", "video/quicktime"], [".m4v", "video/x-m4v"], [".avi", "video/x-msvideo"],
  [".mkv", "video/x-matroska"], [".mpeg", "video/mpeg"], [".mpg", "video/mpeg"],
  [".pdf", "application/pdf"], [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".zip", "application/zip"], [".json", "application/json"], [".xml", "application/xml"],
  [".csv", "text/csv"], [".txt", "text/plain"], [".md", "text/markdown"],
  [".html", "text/html"], [".htm", "text/html"], [".yaml", "application/yaml"],
  [".yml", "application/yaml"], [".mp3", "audio/mpeg"], [".wav", "audio/wav"],
  [".m4a", "audio/mp4"], [".aac", "audio/aac"], [".ogg", "audio/ogg"],
  [".flac", "audio/flac"], [".tsv", "text/tab-separated-values"],
  [".ipynb", "application/x-ipynb+json"], [".epub", "application/epub+zip"],
  [".parquet", "application/vnd.apache.parquet"], [".sqlite", "application/vnd.sqlite3"],
  [".db", "application/octet-stream"], [".rar", "application/vnd.rar"],
  [".7z", "application/x-7z-compressed"], [".tar", "application/x-tar"],
  [".gz", "application/gzip"], [".tgz", "application/gzip"],
]);

export function workflowArtifactMediaType(value) {
  const reference = value && typeof value === "object"
    ? value.uri || value.path || value.url || value.name
    : value;
  return MIME_TYPE_BY_EXTENSION.get(path.extname(String(reference || "")).toLowerCase()) || "";
}

export async function collectWorkflowAgentArtifacts(effects = [], options = {}) {
  const paths = (Array.isArray(effects) ? effects : [])
    .filter((effect) => String(effect?.status || "").trim().toLowerCase() !== "failed")
    .flatMap((effect) => Array.isArray(effect?.paths) ? effect.paths : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const cwd = path.resolve(String(options.cwd || process.cwd()));
  const outputRoot = path.resolve(String(options.outputRoot || path.join(cwd, "outputs")));
  const recoveryRules = workflowArtifactRecoveryRules(options);
  if (recoveryRules.length) {
    const deliveredPaths = extractDeliveredArtifactPaths(options.text, {
      cwd,
      outputRoot,
      allowAnyExtension: true,
    });
    const recoverablePaths = [];
    for (const filePath of deliveredPaths) {
      const recovered = await recoverExistingOutputFile(filePath, outputRoot, options.sinceMs);
      if (recovered) recoverablePaths.push(recovered);
    }
    paths.push(...selectRecoveredPaths(recoverablePaths, recoveryRules));
  }

  const seen = new Set();
  return paths.flatMap((filePath) => {
    const key = normalizeArtifactPathKey(filePath);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      type: "file",
      uri: filePath,
      name: path.basename(filePath),
    }];
  });
}

function workflowArtifactRecoveryRules(options) {
  const mediaMode = String(options.mediaMode || "").trim().toLowerCase();
  const contract = options.nodeContract && typeof options.nodeContract === "object"
    ? options.nodeContract
    : null;
  const compiledSlots = contract?.compiled === true && Array.isArray(contract?.outputContract?.slots)
    ? contract.outputContract.slots
    : null;
  if (compiledSlots) {
    const rules = compiledSlots
      .filter((slot) => !slot?.passThroughFromSlotId && String(slot?.type || "file").toLowerCase() !== "text")
      .map(workflowArtifactRecoveryRuleFromSlot);
    if (rules.length) return rules;
    if (!mediaMode) return [];
  }

  const outputContract = options.outputContract && typeof options.outputContract === "object"
    ? options.outputContract
    : {};
  const requiredTypes = Array.isArray(outputContract.requiredArtifactTypes)
    ? outputContract.requiredArtifactTypes.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (requiredTypes.length) {
    return requiredTypes.map((constraint) => ({
      type: artifactTypeFromConstraint(constraint),
      accept: [constraint],
      maxCount: Number.POSITIVE_INFINITY,
    }));
  }

  if (mediaMode === "image-generation") {
    return [{ type: "image", accept: ["image/*"], maxCount: Number.POSITIVE_INFINITY }];
  }
  if (mediaMode === "video-generation") {
    return [{ type: "video", accept: ["video/*"], maxCount: Number.POSITIVE_INFINITY }];
  }

  const format = String(outputContract.format || "auto").trim().toLowerCase();
  if (format === "text" || format === "structured_data") return [];
  return [{ type: "file", accept: [], maxCount: Number.POSITIVE_INFINITY }];
}

function workflowArtifactRecoveryRuleFromSlot(slot) {
  const maxCount = Math.max(0, Number(slot?.maxCount ?? slot?.max_count ?? 1) || 0);
  return {
    type: String(slot?.type || "file").trim().toLowerCase(),
    accept: Array.isArray(slot?.accept) ? slot.accept : [],
    maxCount,
  };
}

function artifactTypeFromConstraint(constraint) {
  const normalized = String(constraint || "").trim().toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  return "file";
}

function selectRecoveredPaths(filePaths, rules) {
  const selected = [];
  const used = new Set();
  for (const rule of rules) {
    let count = 0;
    for (const filePath of filePaths) {
      if (count >= rule.maxCount) break;
      const key = normalizeArtifactPathKey(filePath);
      if (used.has(key) || !workflowPathMatchesRecoveryRule(filePath, rule)) continue;
      used.add(key);
      selected.push(filePath);
      count += 1;
    }
  }
  return selected;
}

function workflowPathMatchesRecoveryRule(filePath, rule) {
  const extension = path.extname(filePath).toLowerCase();
  if (rule.type === "image" && !IMAGE_ARTIFACT_EXTENSIONS.has(extension)) return false;
  if (rule.type === "video" && !VIDEO_ARTIFACT_EXTENSIONS.has(extension)) return false;
  const accept = Array.isArray(rule.accept)
    ? rule.accept.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    : [];
  if (!accept.length) return true;
  const mimeType = workflowArtifactMediaType(filePath) || "application/octet-stream";
  const extensionName = extension.replace(/^\./, "");
  return accept.some((constraint) => {
    const expected = constraint.replace(/^\./, "");
    if (!expected || expected === "*" || expected === "*/*" || expected === "file") return true;
    if (expected === "image/*") return IMAGE_ARTIFACT_EXTENSIONS.has(extension);
    if (expected === "video/*") return VIDEO_ARTIFACT_EXTENSIONS.has(extension);
    if (expected === "audio/*") return mimeType.startsWith("audio/");
    if (expected === "text/*") return mimeType.startsWith("text/") || TEXT_ARTIFACT_EXTENSIONS.has(extension);
    if (expected.endsWith("/*")) return mimeType.startsWith(expected.slice(0, -1));
    return expected === extensionName || expected === mimeType || mimeType.includes(`/${expected}`);
  });
}

async function recoverExistingOutputFile(filePath, outputRoot, sinceMs) {
  try {
    const [resolvedOutputRoot, resolvedFile, stats] = await Promise.all([
      fs.promises.realpath(outputRoot),
      fs.promises.realpath(filePath),
      fs.promises.stat(filePath),
    ]);
    if (!stats.isFile() || stats.size <= 0) return null;
    if (!isPathInsideDirectory(resolvedFile, resolvedOutputRoot)) return null;
    const minimumTime = Number(sinceMs || 0);
    const fileTime = Math.max(stats.mtimeMs || 0, stats.birthtimeMs || 0);
    if (minimumTime > 0 && fileTime + 2_000 < minimumTime) return null;
    return path.resolve(filePath);
  } catch {
    return null;
  }
}
