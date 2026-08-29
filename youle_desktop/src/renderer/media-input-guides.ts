export type MediaInputKind = "image" | "video" | "audio";

export type MediaInputGuideLimit = {
  min: number;
  max: number;
  labels?: readonly string[];
};

export type MediaInputGuideCapability = {
  image: MediaInputGuideLimit;
  video: MediaInputGuideLimit;
  audio: MediaInputGuideLimit;
  videosRequireImages?: number;
  audiosRequireImages?: number;
};

export type MediaInputCounts = Record<MediaInputKind, number>;

export type MediaInputGuideSlot = {
  kind: MediaInputKind;
  index: number;
  label: string;
  required: boolean;
  disabled: boolean;
  disabledReason: string;
};

const DEFAULT_LABELS: Record<MediaInputKind, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

export function buildMediaInputGuideSlots(
  capability: MediaInputGuideCapability,
  counts: MediaInputCounts,
): MediaInputGuideSlot[] {
  return (["image", "video", "audio"] as const).flatMap((kind) => {
    const limit = capability[kind];
    const currentCount = boundedCount(counts[kind]);
    const dependency =
      kind === "video"
        ? boundedCount(capability.videosRequireImages)
        : kind === "audio"
          ? boundedCount(capability.audiosRequireImages)
          : 0;
    const disabled = dependency > 0 && counts.image < dependency;
    const disabledReason = disabled
      ? `请先上传至少${dependency}张主图`
      : "";
    return Array.from(
      { length: Math.max(0, boundedCount(limit.max) - currentCount) },
      (_, offset) => {
        const index = currentCount + offset;
        return {
          kind,
          index,
          label: limit.labels?.[index] || DEFAULT_LABELS[kind],
          required: index < boundedCount(limit.min),
          disabled,
          disabledReason,
        };
      },
    );
  });
}

export function mediaInputAccept(kind: MediaInputKind) {
  if (kind === "image") return "image/jpeg,image/png,image/webp";
  if (kind === "video") return "video/*";
  return "audio/*";
}

function boundedCount(value: unknown) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}
