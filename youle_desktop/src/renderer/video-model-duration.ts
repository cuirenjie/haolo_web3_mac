export type VideoModelDurationOption = {
  value: unknown;
};

export function longestVideoModelDuration(
  options: readonly VideoModelDurationOption[],
  fallback = "10",
) {
  let longestValue = "";
  let longestSeconds = Number.NEGATIVE_INFINITY;

  for (const option of options) {
    const value = String(option?.value ?? "").trim();
    const seconds = Number(value);
    if (!value || !Number.isFinite(seconds) || seconds <= longestSeconds) {
      continue;
    }
    longestValue = value;
    longestSeconds = seconds;
  }

  return longestValue || fallback;
}
