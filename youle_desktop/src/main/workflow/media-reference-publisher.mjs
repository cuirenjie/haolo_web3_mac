import fs from "node:fs";
import path from "node:path";

import { workflowArtifactMediaType } from "./agent-artifacts.mjs";

const MAX_PUBLISHED_MEDIA_CACHE_ENTRIES = 256;

export async function publishWorkflowMediaReferences(attachments = [], options = {}) {
  const uploadFile = options.uploadFile;
  const cwd = path.resolve(String(options.cwd || process.cwd()));
  const signal = options.signal;
  const cache = options.cache instanceof Map ? options.cache : null;
  const cacheKeyPrefix = String(options.cacheKeyPrefix || "").trim();
  const references = [];

  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    assertNotAborted(signal);
    const normalized = normalizeWorkflowMediaAttachment(attachment, cwd);
    if (!normalized) continue;
    if (normalized.url) {
      references.push(publicWorkflowMediaReference(normalized));
      continue;
    }
    if (!normalized.localPath || typeof uploadFile !== "function") continue;

    const published = await publishLocalWorkflowMediaReference(normalized, {
      uploadFile,
      signal,
      cache,
      cacheKeyPrefix,
    });
    references.push(publicWorkflowMediaReference({ ...normalized, ...published }));
  }

  return references;
}

export function appendWorkflowMediaReferencesToPrompt(prompt, references = []) {
  const values = Array.isArray(references) ? references.filter((reference) => reference?.url) : [];
  if (!values.length) return String(prompt || "");
  return [
    String(prompt || ""),
    [
      "Haolo 已将本节点显式上游媒体输入发布为视频网关可访问的 HTTP(S) URL。",
      "这些 URL 是当前节点的真实输入，与上游文件及槽位一一对应；调用视频生成脚本时必须按类型逐项传入 --image-url 或 --video-url。",
      "不得忽略这些引用、改用本地路径/data URI，或退化成不带参考媒体的纯文本生成。",
      `<haolo_workflow_media_references_json>${JSON.stringify(values)}</haolo_workflow_media_references_json>`,
    ].join("\n"),
  ].filter(Boolean).join("\n\n");
}

function normalizeWorkflowMediaAttachment(attachment, cwd) {
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return null;
  const rawReference = firstText(
    attachment.url,
    attachment.download_url,
    attachment.downloadUrl,
    attachment.uri,
    attachment.local_path,
    attachment.localPath,
    attachment.path,
  );
  const name = firstText(attachment.name, rawReference && path.basename(rawReference));
  const mime = firstText(
    attachment.mime,
    attachment.mediaType,
    attachment.content_type,
    workflowArtifactMediaType(rawReference || name),
  ).toLowerCase();
  const kind = workflowMediaKind(attachment.kind, mime, rawReference || name);
  if (!kind) return null;
  const url = firstPublicHttpUrl(
    attachment.url,
    attachment.download_url,
    attachment.downloadUrl,
    attachment.uri,
  );
  const localReference = firstText(
    attachment.local_path,
    attachment.localPath,
    attachment.path,
    !url ? attachment.uri : "",
  );
  const localPath = localReference
    ? path.resolve(path.isAbsolute(localReference) ? localReference : path.join(cwd, localReference))
    : null;
  return {
    id: firstText(attachment.id, attachment.resourceId, `${kind}-${name || rawReference}`),
    name: name || `${kind}-reference`,
    mime: mime || `${kind}/*`,
    kind,
    url,
    localPath,
    slotId: firstText(attachment.slotId, attachment.slot_id) || null,
    sourceNodeId: firstText(attachment.sourceNodeId, attachment.source_node_id) || null,
    sourceSlotId: firstText(attachment.sourceSlotId, attachment.source_slot_id) || null,
    objectKey: firstText(attachment.object_key, attachment.objectKey) || null,
    materialId: firstText(attachment.material_id, attachment.materialId) || null,
  };
}

async function publishLocalWorkflowMediaReference(reference, {
  uploadFile,
  signal,
  cache,
  cacheKeyPrefix,
}) {
  const stats = await fs.promises.stat(reference.localPath);
  if (!stats.isFile() || stats.size <= 0) {
    throw workflowMediaPublishError(
      "WORKFLOW_MEDIA_REFERENCE_FILE_INVALID",
      `工作流上游媒体不是可上传的文件：${reference.localPath}`,
    );
  }
  const cacheKey = `${cacheKeyPrefix}|${reference.localPath.toLowerCase()}|${stats.size}|${stats.mtimeMs}`;
  let publishedPromise = cache?.get(cacheKey);
  if (!publishedPromise) {
    publishedPromise = (async () => {
      assertNotAborted(signal);
      const bytes = await fs.promises.readFile(reference.localPath);
      assertNotAborted(signal);
      const uploaded = await uploadFile({
        name: reference.name || path.basename(reference.localPath),
        mime: reference.mime || workflowArtifactMediaType(reference.localPath) || null,
        size: stats.size,
        bytes,
        folder: "默认",
        purpose: "material",
      });
      const url = firstPublicHttpUrl(
        uploaded?.attachment?.url,
        uploaded?.url,
        uploaded?.material?.url,
      );
      if (!url) {
        throw workflowMediaPublishError(
          "WORKFLOW_MEDIA_REFERENCE_URL_MISSING",
          `上游媒体已上传，但服务未返回视频网关可访问的 HTTPS URL：${reference.name}`,
        );
      }
      return {
        url,
        objectKey: firstText(
          uploaded?.attachment?.object_key,
          uploaded?.object_key,
          uploaded?.material?.object_key,
          uploaded?.material?.oss_key,
        ) || null,
        materialId: firstText(
          uploaded?.attachment?.material_id,
          uploaded?.material?.id,
        ) || null,
      };
    })();
    if (cache) {
      cache.set(cacheKey, publishedPromise);
      trimPublishedMediaCache(cache);
    }
  }
  try {
    return await publishedPromise;
  } catch (error) {
    if (cache?.get(cacheKey) === publishedPromise) cache.delete(cacheKey);
    throw error;
  }
}

function publicWorkflowMediaReference(reference) {
  return {
    id: reference.id,
    name: reference.name,
    type: reference.kind,
    mime: reference.mime,
    url: reference.url,
    slotId: reference.slotId,
    sourceNodeId: reference.sourceNodeId,
    sourceSlotId: reference.sourceSlotId,
    objectKey: reference.objectKey,
    materialId: reference.materialId,
  };
}

function workflowMediaKind(value, mime, reference) {
  const explicit = String(value || "").trim().toLowerCase();
  if (explicit === "image" || explicit === "video") return explicit;
  if (String(mime || "").startsWith("image/")) return "image";
  if (String(mime || "").startsWith("video/")) return "video";
  const inferred = workflowArtifactMediaType(reference);
  if (inferred.startsWith("image/")) return "image";
  if (inferred.startsWith("video/")) return "video";
  return null;
}

function firstPublicHttpUrl(...values) {
  return values
    .map((value) => String(value || "").trim())
    .find((value) => /^https?:\/\//i.test(value)) || null;
}

function firstText(...values) {
  return values
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
}

function assertNotAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Workflow cancelled.", "AbortError");
}

function workflowMediaPublishError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.category = "media_input";
  error.retryable = true;
  return error;
}

function trimPublishedMediaCache(cache) {
  while (cache.size > MAX_PUBLISHED_MEDIA_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
