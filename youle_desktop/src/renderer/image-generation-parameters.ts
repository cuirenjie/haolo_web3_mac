export type ImageGenerationSizeField = "size" | "aspect_ratio";

export type ImageGenerationSizeOption = {
  value: string;
  label: string;
  compactLabel: string;
};

export type ImageGenerationParameterCapability = {
  sizeField: ImageGenerationSizeField;
  sizeOptions: readonly ImageGenerationSizeOption[];
  defaultSize: string;
  requiredReferenceImages: number;
  maxReferenceImages: number;
  maxReferenceBytesTotal: number;
  maxReferenceLongEdge: number;
};

const OFFICIAL_CAPABILITY: ImageGenerationParameterCapability = {
  sizeField: "size",
  sizeOptions: [{ value: "auto", label: "自动", compactLabel: "自动" }],
  defaultSize: "auto",
  requiredReferenceImages: 0,
  maxReferenceImages: 4,
  maxReferenceBytesTotal: 20 * 1024 * 1024,
  maxReferenceLongEdge: 0,
};

export function imageGenerationParameterCapability(
  modelId: unknown,
): ImageGenerationParameterCapability {
  if (String(modelId ?? "").trim() === "codex/gpt-image-2") return OFFICIAL_CAPABILITY;
  return { ...OFFICIAL_CAPABILITY, maxReferenceImages: 0 };
}

export function normalizeImageGenerationSize(value: unknown) {
  const size = String(value ?? "")
    .trim()
    .toLowerCase();
  return /^(?:auto|\d{1,4}x\d{1,4}|\d{1,2}:\d{1,2})$/.test(size) ? size : "";
}

export function requestedImageGenerationAspectRatio(value: unknown) {
  const text = String(value ?? "");
  const matches: Array<{ index: number; ratio: string }> = [];
  const patterns = [
    /(^|[^\d])(\d{1,4})\s*[:：比]\s*(\d{1,4})(?=$|[^\d])/g,
    /(^|[^\d])(\d{1,4})\s*[xX×✕]\s*(\d{1,4})(?=$|[^\d])/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const ratio = reducedAspectRatio(match[2], match[3]);
      if (!ratio) continue;
      matches.push({
        index: (match.index || 0) + match[1].length,
        ratio,
      });
    }
  }
  return matches.sort((left, right) => left.index - right.index).at(-1)?.ratio || "";
}

export function imageGenerationSizeForAspectRatio(
  modelId: unknown,
  aspectRatio: unknown,
) {
  const requestedRatio = normalizedAspectRatio(aspectRatio);
  if (!requestedRatio) return "";
  const capability = imageGenerationParameterCapability(modelId);
  return (
    capability.sizeOptions.find(
      (option) => normalizedAspectRatio(option.value) === requestedRatio,
    )?.value || ""
  );
}

function normalizedAspectRatio(value: unknown) {
  const match = /^(\d{1,4})\s*(?::|x)\s*(\d{1,4})$/i.exec(
    String(value ?? "").trim(),
  );
  return match ? reducedAspectRatio(match[1], match[2]) : "";
}

function reducedAspectRatio(widthValue: unknown, heightValue: unknown) {
  const width = Number(widthValue);
  const height = Number(heightValue);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "";
  }
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function greatestCommonDivisor(leftValue: number, rightValue: number) {
  let left = Math.abs(leftValue);
  let right = Math.abs(rightValue);
  while (right > 0) {
    [left, right] = [right, left % right];
  }
  return left || 1;
}
