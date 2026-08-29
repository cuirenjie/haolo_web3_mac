export function questionAnswerVideoFrameExtractionRequest(prepared) {
  const plan = prepared?.decision?.sourcePlan;
  const operation = plan?.derivedMedia;
  if (operation?.operation !== "extract_video_frames") return null;
  const attachmentId = String(operation.attachmentId || "").trim().toLowerCase();
  const attachment = (Array.isArray(prepared?.providerAttachments)
    ? prepared.providerAttachments
    : []
  ).find((item) => (
    String(item?.id || item?.attachmentId || item?.attachment_id || "").trim().toLowerCase()
      === attachmentId
  ));
  if (!attachment) return null;
  const localPath = firstString(
    attachment.local_path,
    attachment.localPath,
    attachment.file_path,
    attachment.filePath,
    attachment.path,
  );
  if (!localPath) return null;
  const timestampsSeconds = uniqueFiniteTimestamps(operation.timestampsSeconds);
  if (!timestampsSeconds.length) return null;
  const requestedLabels = stringList(operation.labels);
  return {
    operation: "extract_video_frames",
    attachmentId: firstString(attachment.id, operation.attachmentId),
    name: firstString(attachment.name, "video.mp4"),
    localPath,
    timestampsSeconds,
    labels: timestampsSeconds.map((timestamp, index) => (
      requestedLabels[index] || `视频帧 ${formatTimestampSeconds(timestamp)}`
    )),
  };
}

export function videoFrameExtractionResponseText(request) {
  const timestamps = Array.isArray(request?.timestampsSeconds)
    ? request.timestampsSeconds
    : [];
  const labels = Array.isArray(request?.labels) ? request.labels : [];
  if (!timestamps.length) return "已从所选视频中提取画面。";
  return [
    `已从《${String(request?.name || "所选视频")}》中提取 ${timestamps.length} 张真实画面：`,
    ...timestamps.map((timestamp, index) => (
      `- ${labels[index] || `视频帧 ${index + 1}`}：${formatTimestampSeconds(timestamp)}`
    )),
  ].join("\n");
}

export function formatTimestampSeconds(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  const normalizedSeconds = remainder
    .toFixed(3)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  const [wholeSeconds, fraction] = normalizedSeconds.split(".");
  const secondsText = `${wholeSeconds.padStart(2, "0")}${fraction ? `.${fraction}` : ""}`;
  return `${minutes}:${secondsText}`;
}

function uniqueFiniteTimestamps(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= 86_400)
        .map((value) => Math.round(value * 1_000) / 1_000),
    ),
  ].slice(0, 8);
}

function stringList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}
