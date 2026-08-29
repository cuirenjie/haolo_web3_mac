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

const BASE_SIZE_OPTIONS: readonly ImageGenerationSizeOption[] = [
  {
    value: "1024x1024",
    label: "1:1",
    compactLabel: "1:1",
  },
  {
    value: "1536x1024",
    label: "3:2",
    compactLabel: "3:2",
  },
  {
    value: "1024x1536",
    label: "2:3",
    compactLabel: "2:3",
  },
];

function ratioOption(value: string, label: string): ImageGenerationSizeOption {
  return {
    value,
    label: `${label} · ${value}`,
    compactLabel: value,
  };
}

const ASPECT_RATIO_OPTIONS: readonly ImageGenerationSizeOption[] = [
  ratioOption("1:1", "方形"),
  ratioOption("16:9", "横版"),
  ratioOption("9:16", "竖版"),
  ratioOption("4:3", "横版"),
  ratioOption("3:4", "竖版"),
  ratioOption("3:2", "横版"),
  ratioOption("2:3", "竖版"),
  ratioOption("5:4", "横版"),
  ratioOption("4:5", "竖版"),
];

const BASE_CAPABILITY: ImageGenerationParameterCapability = {
  sizeField: "size",
  sizeOptions: BASE_SIZE_OPTIONS,
  defaultSize: "1024x1024",
  requiredReferenceImages: 0,
  maxReferenceImages: 1,
  maxReferenceBytesTotal: 0,
  maxReferenceLongEdge: 2048,
};

const ONE_K_CAPABILITY: ImageGenerationParameterCapability = {
  sizeField: "aspect_ratio",
  sizeOptions: ASPECT_RATIO_OPTIONS,
  defaultSize: "1:1",
  requiredReferenceImages: 0,
  maxReferenceImages: 6,
  maxReferenceBytesTotal: 5 * 1024 * 1024,
  maxReferenceLongEdge: 0,
};

const ASPECT_RATIO_CAPABILITY: ImageGenerationParameterCapability = {
  sizeField: "aspect_ratio",
  sizeOptions: ASPECT_RATIO_OPTIONS,
  defaultSize: "1:1",
  requiredReferenceImages: 0,
  maxReferenceImages: 6,
  maxReferenceBytesTotal: 5 * 1024 * 1024,
  maxReferenceLongEdge: 0,
};

const FALLBACK_CAPABILITY: ImageGenerationParameterCapability = {
  sizeField: "size",
  sizeOptions: [BASE_SIZE_OPTIONS[0]],
  defaultSize: "1024x1024",
  requiredReferenceImages: 0,
  maxReferenceImages: 0,
  maxReferenceBytesTotal: 0,
  maxReferenceLongEdge: 0,
};

export function imageGenerationParameterCapability(
  modelId: unknown,
): ImageGenerationParameterCapability {
  const model = imageGenerationModelKey(modelId);
  if (model === "gpt-image-2" || model === "image-2") {
    return BASE_CAPABILITY;
  }
  if (
    model === "gpt-image-2-1k" ||
    model === "image-2-1k" ||
    model === "gpt-image-2-1k-async" ||
    model === "image-2-1k-async"
  ) {
    return ONE_K_CAPABILITY;
  }
  if (
    model === "gpt-image-2-2k" ||
    model === "image-2-2k" ||
    model === "gpt-image-2-3.5k" ||
    model === "image-2-3.5k"
  ) {
    return ASPECT_RATIO_CAPABILITY;
  }
  return FALLBACK_CAPABILITY;
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

function imageGenerationModelKey(modelId: unknown) {
  return (
    String(modelId ?? "")
      .trim()
      .toLowerCase()
      .split("/")
      .at(-1) || ""
  );
}
