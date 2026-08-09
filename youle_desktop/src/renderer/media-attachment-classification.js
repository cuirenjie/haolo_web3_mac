const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|bmp|svg)(?:$|[?#])/i;
const VIDEO_EXTENSION_PATTERN = /\.(?:mp4|webm|ogg|mov|m4v)(?:$|[?#])/i;
const GENERIC_BINARY_MIMES = new Set(["application/octet-stream", "binary/octet-stream"]);

function stringValue(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hasConflictingMediaType(attachment, mimePrefix, extensionPattern) {
  const mime = stringValue(attachment?.mime);
  if (mime && !GENERIC_BINARY_MIMES.has(mime) && !mime.startsWith(`${mimePrefix}/`)) return true;

  const name = stringValue(attachment?.name);
  const hasFileExtension = /\.[a-z0-9]{1,12}(?:$|[?#])/i.test(name);
  return hasFileExtension && !extensionPattern.test(name);
}

function markerValues(record, keys) {
  return keys.map((key) => stringValue(record?.[key])).filter(Boolean);
}

export function isFeishuImageAttachment(attachment) {
  if (!attachment || hasConflictingMediaType(attachment, "image", IMAGE_EXTENSION_PATTERN)) return false;
  const record = attachment;
  const name = stringValue(attachment.name);
  if (/^feishu-image[-_]/.test(name)) return true;
  if (stringValue(record.image_key) || stringValue(record.imageKey)) return true;
  return markerValues(record, ["object_key", "objectKey", "file_key", "fileKey"])
    .some((marker) => /^feishu-image[-_]/.test(marker) || /^(?:img|image)[_-]/.test(marker));
}

export function isFeishuVideoAttachment(attachment) {
  if (!attachment || hasConflictingMediaType(attachment, "video", VIDEO_EXTENSION_PATTERN)) return false;
  const record = attachment;
  const name = stringValue(attachment.name);
  if (/^feishu-video[-_]/.test(name)) return true;
  if (stringValue(record.video_key) || stringValue(record.videoKey)) return true;
  return markerValues(record, ["object_key", "objectKey", "file_key", "fileKey"])
    .some((marker) => /^feishu-video[-_]/.test(marker) || /^(?:media|video)[_-]/.test(marker));
}

export function isImageAttachment(attachment) {
  const mime = stringValue(attachment?.mime);
  const name = stringValue(attachment?.name);
  return mime.startsWith("image/") || IMAGE_EXTENSION_PATTERN.test(name) || isFeishuImageAttachment(attachment);
}

export function isVideoAttachment(attachment) {
  const mime = stringValue(attachment?.mime);
  const name = stringValue(attachment?.name);
  return mime.startsWith("video/") || VIDEO_EXTENSION_PATTERN.test(name) || isFeishuVideoAttachment(attachment);
}
