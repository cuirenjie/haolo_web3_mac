const VIDEO_GENERATION_COMPLETION_PATTERN =
  /(?:视频(?:已|已经)?生成(?:完成|成功)?|视频生成(?:已)?(?:完成|成功)|成品视频|video\s+(?:has\s+been\s+)?(?:generated|created)(?:\s+successfully)?|generated\s+video)/iu;

const VIDEO_GENERATION_METADATA_LABEL_PATTERN =
  /^(?:(?:(?:使用|实际|视频)\s*)?模型(?:名称)?|(?:(?:used|actual|video)\s+)?model(?:\s+name)?|(?:(?:视频|生成|上游)\s*)?任务\s*(?:id|编号)|(?:(?:video|generation|provider)\s+)?task\s*id)\s*[:：]/iu;

export function redactVideoGenerationCompletionMetadata(text: string) {
  const value = String(text || "");
  if (!VIDEO_GENERATION_COMPLETION_PATTERN.test(value)) return value;

  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !isVideoGenerationMetadataLine(line))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isVideoGenerationMetadataLine(line: string) {
  const normalized = line
    .replace(/^\s*(?:(?:[-*+]|\d+[.)])\s+|>\s*)/, "")
    .replace(/[*_`]/g, "")
    .trim();
  return VIDEO_GENERATION_METADATA_LABEL_PATTERN.test(normalized);
}
