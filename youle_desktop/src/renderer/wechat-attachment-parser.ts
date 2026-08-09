import type { MessageAttachment } from "./domain";

const WECHAT_CHANNEL_FILE_EXTENSIONS = "[a-z0-9][a-z0-9+-]{0,15}";
const WECHAT_CHANNEL_FILE_REFERENCE_BOUNDARY = "\\s`\"'<>\\]\\)\\}\\uFF0C\\u3002\\uFF1B\\uFF1A\\u3001,.!?";
const WECHAT_CHANNEL_ATTACHMENT_COLLECTION_KEYS = [
  "attachments",
  "files",
  "file_list",
  "fileList",
  "media",
  "medias",
  "media_list",
  "mediaList",
  "documents",
  "images",
  "videos",
  "attachment_list",
  "attachmentList",
  "file_infos",
  "fileInfos",
  "resource_list",
  "resourceList",
  "resources",
];
const WECHAT_CHANNEL_ATTACHMENT_SINGLE_KEYS = ["attachment", "file", "file_info", "fileInfo", "document", "image", "video", "resource"];
const WECHAT_CHANNEL_NESTED_MESSAGE_KEYS = ["payload", "data", "body", "content"];

export function wechatChannelTextFileAttachments(text: string): MessageAttachment[] {
  if (!text.trim()) return [];
  const attachments: MessageAttachment[] = [];
  const markdownLinkPattern = new RegExp(`\\[([^\\]\\r\\n]+?\\.(${WECHAT_CHANNEL_FILE_EXTENSIONS}))\\]\\(([^\\)\\r\\n]+)\\)`, "gi");
  for (const match of text.matchAll(markdownLinkPattern)) {
    const name = firstString(match[1]);
    const pathText = firstString(match[3]);
    if (!pathText) continue;
    const attachment = wechatChannelAttachmentFromPath(pathText, name || "");
    if (attachment) attachments.push(attachment);
  }
  const windowsPathPattern = new RegExp(
    "[a-zA-Z]:[\\\\/][^\\r\\n<>\"'`\\|?*]+?\\.(" +
      WECHAT_CHANNEL_FILE_EXTENSIONS +
      ")(?=$|[" +
      WECHAT_CHANNEL_FILE_REFERENCE_BOUNDARY +
      "])",
    "gi",
  );
  for (const match of text.matchAll(windowsPathPattern)) {
    const attachment = wechatChannelAttachmentFromPath(match[0]);
    if (attachment) attachments.push(attachment);
  }
  const fileUrlPattern = new RegExp(
    "file:\\/\\/\\/[^\\s`\"'<>\\]\\)\\}]+?\\.(" +
      WECHAT_CHANNEL_FILE_EXTENSIONS +
      ")(?=$|[" +
      WECHAT_CHANNEL_FILE_REFERENCE_BOUNDARY +
      "])",
    "gi",
  );
  for (const match of text.matchAll(fileUrlPattern)) {
    const attachment = wechatChannelAttachmentFromPath(match[0]);
    if (attachment) attachments.push(attachment);
  }
  return dedupeMessageAttachments(attachments);
}

export function wechatChannelMessageText(message: unknown): string {
  const text = textFromWechatMessageObject(message, 0);
  return text?.trim() || "";
}

export function wechatChannelMessageFileAttachments(message: unknown): MessageAttachment[] {
  const attachments: MessageAttachment[] = [];
  const text = wechatChannelMessageText(message);
  if (text) attachments.push(...wechatChannelTextFileAttachments(text));
  collectWechatChannelMessageAttachments(message, attachments, 0);
  return dedupeMessageAttachments(attachments);
}

export function wechatChannelAgentTextWithAttachments(text: string, attachments: MessageAttachment[]): string {
  const cleanText = String(text || "").trim();
  const lines = dedupeMessageAttachments(attachments).map(formatWechatChannelAttachmentLine).filter(Boolean);
  if (!lines.length) return cleanText;
  if (!cleanText) {
    return [
      "用户只发送了附件，没有输入文字说明。请用一句话简短确认收到，并询问用户想怎么处理。",
      "不要在回复中列出、复述、嵌入这些附件，也不要输出附件路径、URL 或 Markdown 图片/文件链接。",
      "",
      "附件信息（仅供理解与后续处理，不要直接复述）：",
      lines.join("\n"),
    ].join("\n");
  }
  return `${cleanText ? `${cleanText}\n\n` : ""}\u9644\u4ef6:\n${lines.join("\n")}`.trim();
}

function wechatChannelAttachmentFromPath(pathText: string, displayName = ""): MessageAttachment | null {
  const cleanPath = cleanGeneratedPathReference(pathText);
  if (!cleanPath || isRemoteLikeUrlReference(cleanPath)) return null;
  const normalizedPath = localPathPreviewUrl(cleanPath);
  const name = firstString(displayName, fileNameFromReference(normalizedPath));
  if (!name || !normalizedPath) return null;
  return {
    name,
    mime: generatedFileMimeFromPath(name || normalizedPath),
    size: null,
    object_key: null,
    url: normalizedPath,
    local_path: normalizedPath,
    path: normalizedPath,
    preview_url: null,
    download_url: null,
  };
}

function collectWechatChannelMessageAttachments(value: unknown, attachments: MessageAttachment[], depth: number) {
  if (!value || depth > 4) return;
  if (Array.isArray(value)) {
    for (const item of value) collectWechatChannelMessageAttachments(item, attachments, depth + 1);
    return;
  }
  if (typeof value === "string") {
    const attachment = wechatChannelAttachmentFromReference(value);
    if (attachment) attachments.push(attachment);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const directAttachment = wechatChannelAttachmentFromObject(record);
  if (directAttachment) attachments.push(directAttachment);

  for (const key of WECHAT_CHANNEL_ATTACHMENT_SINGLE_KEYS) {
    collectWechatChannelMessageAttachments(record[key], attachments, depth + 1);
  }
  for (const key of WECHAT_CHANNEL_ATTACHMENT_COLLECTION_KEYS) {
    if (directAttachment && key === "media" && isWechatChannelMediaMetadataObject(record[key])) continue;
    collectWechatChannelMessageAttachments(record[key], attachments, depth + 1);
  }
  for (const key of WECHAT_CHANNEL_NESTED_MESSAGE_KEYS) {
    const nested = record[key];
    if (nested && nested !== value && typeof nested === "object") {
      collectWechatChannelMessageAttachments(nested, attachments, depth + 1);
    }
  }
}

function wechatChannelAttachmentFromObject(record: Record<string, unknown>): MessageAttachment | null {
  if (!looksLikeWechatAttachmentObject(record)) return null;
  const media = recordValue(record.media);
  const objectKey = firstString(
    record.telegram_file_unique_id,
    record.telegramFileUniqueId,
    record.object_key,
    record.objectKey,
    record.oss_key,
    record.ossKey,
    record.telegram_file_id,
    record.telegramFileId,
    record.file_id,
    record.fileId,
    record.media_id,
    record.mediaId,
    record.key,
    media?.encrypt_query_param,
    media?.encryptQueryParam,
  );
  const previewUrl = firstString(record.preview_url, record.previewUrl, media?.preview_url, media?.previewUrl, media?.thumb_url, media?.thumbUrl);
  const downloadUrl = firstString(record.download_url, record.downloadUrl, record.download, record.downloadLink, media?.download_url, media?.downloadUrl);
  const rawUrl = firstString(
    record.url,
    record.full_url,
    record.fullUrl,
    record.fullurl,
    record.file_url,
    record.fileUrl,
    record.media_url,
    record.mediaUrl,
    record.cdn_url,
    record.cdnUrl,
    record.cdnurl,
    record.thumb_url,
    record.thumbUrl,
    media?.full_url,
    media?.fullUrl,
    media?.fullurl,
    media?.url,
    media?.file_url,
    media?.fileUrl,
    media?.media_url,
    media?.mediaUrl,
    media?.cdn_url,
    media?.cdnUrl,
    media?.thumb_url,
    media?.thumbUrl,
    previewUrl,
    downloadUrl,
  );
  const rawPath = firstString(record.local_path, record.localPath, record.file_path, record.filePath, record.localFilePath, record.path);
  const remoteUrl = rawUrl && isRemoteLikeUrlReference(rawUrl) ? rawUrl : null;
  const localUrl = rawUrl && !remoteUrl ? localPathPreviewUrl(rawUrl) : null;
  const remotePathUrl = rawPath && isRemoteLikeUrlReference(rawPath) ? rawPath : null;
  const localPath = rawPath && !remotePathUrl ? localPathPreviewUrl(rawPath) : null;
  const url = firstString(remoteUrl, localUrl, remotePathUrl);
  const normalizedPreviewUrl = previewUrl && !isRemoteLikeUrlReference(previewUrl) ? localPathPreviewUrl(previewUrl) : previewUrl;
  const normalizedDownloadUrl = downloadUrl && !isRemoteLikeUrlReference(downloadUrl) ? localPathPreviewUrl(downloadUrl) : downloadUrl;
  const reference = firstString(url, normalizedDownloadUrl, normalizedPreviewUrl, localPath, objectKey);
  const name = firstString(
    record.name,
    record.file_name,
    record.fileName,
    record.filename,
    record.title,
    reference ? fileNameFromReference(reference) : "",
  );
  if (!name && !reference) return null;
  const inferredImage = isLikelyWechatImageAttachment(record, media, name || "", reference || "");
  const normalizedName = normalizeWechatAttachmentDisplayName(name || "wechat-file", inferredImage);
  const explicitMime = firstString(record.mime, record.content_type, record.contentType, record.mime_type, record.mimeType);
  const generatedMime = generatedFileMimeFromPath(normalizedName || reference || "");
  const inferredMime = inferredImage && generatedMime === "application/octet-stream" ? "image/jpeg" : generatedMime;
  return {
    name: normalizedName,
    mime: explicitMime || inferredMime,
    size: numericValue(record.size ?? record.size_bytes ?? record.sizeBytes ?? record.file_size ?? record.fileSize),
    object_key: objectKey || null,
    url: url || null,
    local_path: localPath || null,
    path: localPath || null,
    preview_url: normalizedPreviewUrl || null,
    download_url: normalizedDownloadUrl || null,
  };
}

function looksLikeWechatAttachmentObject(record: Record<string, unknown>) {
  return Boolean(
    firstString(
      record.object_key,
      record.objectKey,
      record.oss_key,
      record.ossKey,
      record.file_name,
      record.fileName,
      record.filename,
      record.telegram_file_unique_id,
      record.telegramFileUniqueId,
      record.telegram_file_id,
      record.telegramFileId,
      record.file_id,
      record.fileId,
      record.media_id,
      record.mediaId,
      record.full_url,
      record.fullUrl,
      record.fullurl,
      record.file_url,
      record.fileUrl,
      record.media_url,
      record.mediaUrl,
      record.cdn_url,
      record.cdnUrl,
      record.cdnurl,
      record.thumb_url,
      record.thumbUrl,
      record.download_url,
      record.downloadUrl,
      record.local_path,
      record.localPath,
      record.file_path,
      record.filePath,
      recordValue(record.media)?.full_url,
      recordValue(record.media)?.fullUrl,
      recordValue(record.media)?.encrypt_query_param,
      recordValue(record.media)?.encryptQueryParam,
    ) || (firstString(record.name, record.title) && firstString(record.url, record.path, record.preview_url, record.previewUrl)),
  );
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isWechatChannelMediaMetadataObject(value: unknown) {
  const record = recordValue(value);
  if (!record) return false;
  return Boolean(firstString(record.encrypt_query_param, record.encryptQueryParam, record.aes_key, record.aesKey) && firstString(record.full_url, record.fullUrl, record.fullurl));
}

function isLikelyWechatImageAttachment(record: Record<string, unknown>, media: Record<string, unknown> | null, name: string, reference: string) {
  const type = firstString(record.type, record.kind, record.media_type, record.mediaType, record.telegram_download_type, record.telegramDownloadType)?.toLowerCase() || "";
  const mime = firstString(record.mime, record.content_type, record.contentType, record.mime_type, record.mimeType)?.toLowerCase() || "";
  return (
    mime.startsWith("image/") ||
    type === "image" ||
    type === "photo" ||
    name === "wechat-image" ||
    /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name) ||
    /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(reference.split(/[?#]/)[0] || "") ||
    Boolean(media && firstString(media.full_url, media.fullUrl, media.fullurl) && firstString(media.encrypt_query_param, media.encryptQueryParam))
  );
}

function normalizeWechatAttachmentDisplayName(name: string, image: boolean) {
  const cleanName = firstString(name) || "wechat-file";
  if (!image || /\.[a-z0-9][a-z0-9+-]{0,15}$/i.test(cleanName)) return cleanName;
  return cleanName === "wechat-image" ? "wechat-image.jpg" : `${cleanName}.jpg`;
}

function wechatChannelAttachmentFromReference(value: string): MessageAttachment | null {
  const cleanReference = cleanGeneratedPathReference(value);
  if (!cleanReference) return null;
  const remoteUrl = isRemoteLikeUrlReference(cleanReference) ? cleanReference : null;
  const localPath = remoteUrl ? null : localPathPreviewUrl(cleanReference);
  const reference = remoteUrl || localPath;
  const name = fileNameFromReference(reference);
  if (!name || !/\.[a-z0-9][a-z0-9+-]{0,15}$/i.test(name)) return null;
  return {
    name,
    mime: generatedFileMimeFromPath(name),
    size: null,
    object_key: null,
    url: remoteUrl || null,
    local_path: localPath || null,
    path: localPath || null,
    preview_url: null,
    download_url: null,
  };
}

function formatWechatChannelAttachmentLine(attachment: MessageAttachment) {
  const record = attachment as unknown as Record<string, unknown>;
  const name = firstString(attachment.name, fileNameFromReference(firstString(attachment.url, attachmentLocalPath(attachment), attachment.object_key) || ""));
  if (!name) return "";
  const localPath = attachmentLocalPath(attachment);
  const objectKey = firstString(attachment.object_key, record.objectKey);
  const url = firstString(attachment.url);
  const downloadUrl = firstString(attachment.download_url, record.downloadUrl);
  const previewUrl = firstString(attachment.preview_url, record.previewUrl);
  const refs = [
    objectKey ? `object_key: ${objectKey}` : "",
    url ? `url: ${url}` : "",
    downloadUrl && downloadUrl !== url ? `download_url: ${downloadUrl}` : "",
    localPath ? `local_path: ${localPath}` : "",
    previewUrl && previewUrl !== url && previewUrl !== downloadUrl ? `preview_url: ${previewUrl}` : "",
  ].filter(Boolean);
  return refs.length ? `- ${name} (${refs.join(", ")})` : `- ${name}`;
}

function cleanGeneratedPathReference(value: string) {
  let text = value.trim().replace(/^[`"'\u201C\u201D\u2018\u2019]+|[`"'\u201C\u201D\u2018\u2019]+$/g, "");
  text = text.replace(/^<+|>+$/g, "");
  text = text.replace(/[\uFF0C\u3002\uFF1B\uFF1A\u3001]+$/g, "");
  while (/[)\]}]+$/.test(text) && closingPathPunctuationIsExtra(text)) {
    text = text.slice(0, -1);
  }
  return text;
}

function closingPathPunctuationIsExtra(value: string) {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const closing = value.at(-1) || "";
  const opening = pairs[closing];
  if (!opening) return false;
  return value.split(closing).length > value.split(opening).length;
}

function localPathPreviewUrl(pathText: string) {
  if (isRemoteLikeUrlReference(pathText)) return pathText.trim();
  const normalized = normalizeGeneratedLocalPath(pathText);
  if (/^file:\/\//i.test(normalized)) return normalized;
  return normalized.replace(/^\/([a-z]:\/)/i, "$1");
}

function normalizeGeneratedLocalPath(pathText: string) {
  let normalized = pathText.trim().replace(/^["'`<]+|["'`>]+$/g, "").replace(/\\/g, "/");
  const fileUrlIndex = normalized.toLowerCase().lastIndexOf("file:///");
  if (fileUrlIndex > 0) normalized = normalized.slice(fileUrlIndex);
  if (!/^file:\/\//i.test(normalized)) {
    const driveMatches = [...normalized.matchAll(/[a-z]:\//gi)];
    const lastDrive = driveMatches.at(-1);
    if (lastDrive?.index != null && lastDrive.index > 0) {
      normalized = normalized.slice(lastDrive.index);
    }
  }
  return normalized.replace(/^\/([a-z]:\/)/i, "$1");
}

function isRemoteLikeUrlReference(value: string) {
  const text = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^file:\/\//i.test(text)) return true;
  return /^\/\/[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(text);
}

function attachmentLocalPath(attachment: Partial<MessageAttachment> | null | undefined) {
  const record = attachment as Record<string, unknown> | null | undefined;
  return firstString(record?.local_path, record?.localPath, record?.file_path, record?.filePath, record?.path);
}

function generatedFileMimeFromPath(pathText: string) {
  const lower = pathText.toLowerCase().split(/[?#]/)[0] || "";
  if (/\.(png|jpe?g)$/.test(lower)) return lower.endsWith(".png") ? "image/png" : "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".ogg")) return "video/ogg";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (/\.(doc|docx|wps)$/.test(lower)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".rtf")) return "application/rtf";
  if (/\.(xls|xlsx)$/.test(lower)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (/\.(ppt|pptx)$/.test(lower)) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain";
  if (/\.(zip|rar|7z)$/.test(lower)) return "application/zip";
  return "application/octet-stream";
}

function dedupeMessageAttachments(attachments: MessageAttachment[]) {
  const seen = new Set<string>();
  return attachments.filter((attachment) => {
    const keys = wechatAttachmentIdentityKeys(attachment);
    if (!keys.length || keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

function wechatAttachmentIdentityKeys(attachment: MessageAttachment) {
  const keys = new Set<string>();
  const objectKey = normalizeWechatAttachmentIdentity(attachment.object_key);
  if (objectKey) keys.add(`object:${objectKey}`);
  const references = [
    attachmentLocalPath(attachment),
    attachment.url,
    attachment.preview_url,
    attachment.previewUrl,
    attachment.download_url,
    attachment.downloadUrl,
  ]
    .map(normalizeWechatAttachmentIdentity)
    .filter(Boolean);
  references.forEach((reference) => {
    keys.add(`ref:${reference}`);
    if (isNormalizedWechatLocalFileReference(reference)) keys.add(`file:${reference}`);
  });
  const name = normalizeWechatAttachmentIdentity(attachment.name);
  if (name && !objectKey && !references.length) keys.add(`name:${name}`);
  return [...keys];
}

function normalizeWechatAttachmentIdentity(value: unknown) {
  let text = cleanGeneratedPathReference(firstString(value) || "");
  if (!text) return "";
  const isWindowsPath = /^[a-z]:[\\/]/i.test(text);
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  if (hasScheme && !isWindowsPath && !/^file:/i.test(text)) return text.toLowerCase();
  if (/^file:/i.test(text)) {
    try {
      text = decodeURIComponent(new URL(text).pathname);
    } catch {
      text = text.replace(/^file:\/+/i, "");
    }
  }
  return text
    .replace(/^\/([a-z]:[\\/])/i, "$1")
    .replace(/[\\/]+/g, "/")
    .replace(/[?#].*$/, "")
    .toLowerCase();
}

function isNormalizedWechatLocalFileReference(value: string) {
  return /^[a-z]:\//i.test(value) || value.startsWith("/") || value.startsWith("//");
}

function fileNameFromReference(value: unknown) {
  const text = cleanGeneratedPathReference(firstString(value) || "");
  if (!text) return "";
  const withoutQuery = text.split(/[?#]/)[0] || "";
  const normalized = withoutQuery.replace(/\\/g, "/").replace(/\/+$/g, "");
  const name = normalized.split("/").pop() || "";
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function textFromWechatMessageObject(value: unknown, depth: number): string | null {
  if (!value || depth > 4) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((item) => textFromWechatMessageObject(item, depth + 1)).filter(Boolean);
    return parts.length ? parts.join("\n") : null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const direct = firstString(
    record.text,
    record.content_text,
    record.contentText,
    record.message,
    record.msg,
    record.raw_text,
    record.rawText,
    record.caption,
    record.description,
  );
  if (direct) return direct;
  const content = record.content;
  if (content && content !== value && (typeof content === "object" || Array.isArray(content))) {
    const contentText = textFromWechatMessageObject(content, depth + 1);
    if (contentText) return contentText;
  }
  for (const key of ["payload", "data", "body"]) {
    const nested = record[key];
    if (!nested || nested === value || typeof nested !== "object") continue;
    const nestedText = textFromWechatMessageObject(nested, depth + 1);
    if (nestedText) return nestedText;
  }
  return null;
}

function numericValue(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}
