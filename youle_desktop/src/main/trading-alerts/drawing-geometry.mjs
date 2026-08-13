export function drawingPriceAtTime(drawing, time) {
  if (!drawing || !Array.isArray(drawing.points) || drawing.points.length < 2) return { value: "unknown", reason: "drawing_missing" };
  const [first, second] = drawing.points;
  const t1 = Number(first.time), t2 = Number(second.time), p1 = Number(first.price), p2 = Number(second.price), target = Number(time);
  if (![t1, t2, p1, p2, target].every(Number.isFinite) || t1 === t2) return { value: "unknown", reason: "drawing_invalid" };
  const mode = drawing.geometryMode || "segment";
  if (mode === "segment" && (target < Math.min(t1, t2) || target > Math.max(t1, t2))) return { value: "unknown", reason: "outside_drawing_domain" };
  if (mode === "ray" && target < t1) return { value: "unknown", reason: "outside_drawing_domain" };
  return { value: p1 + (target - t1) / (t2 - t1) * (p2 - p1) };
}

export function drawingTolerance(tolerance, { tickSize = 0, atr = 0, reference = 0 } = {}) {
  if (!tolerance) return Math.max(Number(tickSize) || 0, Math.abs(Number(reference) || 0) * 1e-9);
  if (tolerance.mode === "absolute") return tolerance.value;
  if (tolerance.mode === "percent") return Math.abs(reference) * tolerance.value / 100;
  if (tolerance.mode === "ticks") return tolerance.value * tickSize;
  if (tolerance.mode === "atr") return tolerance.value * atr;
  return 0;
}
