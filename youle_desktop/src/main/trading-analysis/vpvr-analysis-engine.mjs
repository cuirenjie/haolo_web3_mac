export const VPVR_ANALYSIS_ENGINE_ID = "vpvr-analysis-deterministic-v1";
export const VPVR_ROW_COUNT = 96;
export const VPVR_VALUE_AREA_RATIO = 0.7;

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((first, second) => first - second);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function intervalSeconds(interval, candles) {
  const source = String(interval || "").toUpperCase();
  if (source === "1D") return 86_400;
  if (source === "1W") return 604_800;
  if (/^\d+$/.test(source)) return Number(source) * 60;
  return median(candles.slice(1).map((candle, index) => candle.time - candles[index].time).filter((value) => value > 0)) || 3_600;
}

function quantile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((first, second) => first - second);
  if (!sorted.length) return 0;
  const position = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * ratio));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function normalizedRowCount(value) {
  const numeric = Number(value);
  return Math.min(96, Math.max(8, Number.isFinite(numeric) ? Math.round(numeric) : VPVR_ROW_COUNT));
}

export function calculateVpvrProfile(candles, requestedRowCount = VPVR_ROW_COUNT, requestedValueAreaRatio = VPVR_VALUE_AREA_RATIO) {
  const usableCandles = candles.flatMap((candle) => {
    const high = Number(candle.high);
    const low = Number(candle.low);
    const volume = Number(candle.volume || 0);
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(volume) || volume <= 0) return [];
    return [{ high: Math.max(high, low), low: Math.min(high, low), volume }];
  });
  if (!usableCandles.length) throw new TypeError("VPVR analysis requires positive candle volume");

  const profileLow = Math.min(...usableCandles.map((candle) => candle.low));
  const profileHigh = Math.max(...usableCandles.map((candle) => candle.high));
  const fallbackSpan = Math.max(Math.abs(profileHigh) * 1e-6, 1e-8);
  const priceSpan = profileHigh > profileLow ? profileHigh - profileLow : fallbackSpan;
  const rowCount = normalizedRowCount(requestedRowCount);
  const rowSize = priceSpan / rowCount;
  const volumes = new Array(rowCount).fill(0);

  for (const candle of usableCandles) {
    const candleSpan = candle.high - candle.low;
    if (candleSpan <= 0) {
      const rowIndex = Math.min(rowCount - 1, Math.max(0, Math.floor((candle.low - profileLow) / rowSize)));
      volumes[rowIndex] += candle.volume;
      continue;
    }
    const firstRow = Math.min(rowCount - 1, Math.max(0, Math.floor((candle.low - profileLow) / rowSize)));
    const lastRow = Math.min(rowCount - 1, Math.max(0, Math.floor((candle.high - profileLow) / rowSize)));
    const overlaps = [];
    for (let index = firstRow; index <= lastRow; index += 1) {
      const priceLow = profileLow + index * rowSize;
      const priceHigh = index === rowCount - 1 ? profileHigh : priceLow + rowSize;
      const overlap = Math.max(0, Math.min(candle.high, priceHigh) - Math.max(candle.low, priceLow));
      if (overlap > 0) overlaps.push({ index, amount: overlap });
    }
    const overlapTotal = overlaps.reduce((sum, overlap) => sum + overlap.amount, 0);
    if (overlapTotal <= 0) continue;
    for (const overlap of overlaps) volumes[overlap.index] += candle.volume * (overlap.amount / overlapTotal);
  }

  const totalVolume = volumes.reduce((sum, volume) => sum + volume, 0);
  const maxVolume = Math.max(...volumes);
  if (!Number.isFinite(totalVolume) || totalVolume <= 0 || !Number.isFinite(maxVolume) || maxVolume <= 0) {
    throw new TypeError("VPVR analysis could not build a usable volume profile");
  }
  const pocIndex = volumes.indexOf(maxVolume);
  const valueAreaRatio = Math.min(1, Math.max(0, Number(requestedValueAreaRatio) || VPVR_VALUE_AREA_RATIO));
  const valueAreaTarget = totalVolume * valueAreaRatio;
  let valueAreaFrom = pocIndex;
  let valueAreaTo = pocIndex;
  let valueAreaVolume = volumes[pocIndex];
  while (valueAreaVolume < valueAreaTarget && (valueAreaFrom > 0 || valueAreaTo < rowCount - 1)) {
    const lowerVolume = valueAreaFrom > 0 ? volumes[valueAreaFrom - 1] : -1;
    const upperVolume = valueAreaTo < rowCount - 1 ? volumes[valueAreaTo + 1] : -1;
    if (upperVolume >= lowerVolume && valueAreaTo < rowCount - 1) {
      valueAreaTo += 1;
      valueAreaVolume += volumes[valueAreaTo];
    } else if (valueAreaFrom > 0) {
      valueAreaFrom -= 1;
      valueAreaVolume += volumes[valueAreaFrom];
    }
  }

  const rows = volumes.map((volume, index) => {
    const priceLow = profileLow + index * rowSize;
    const priceHigh = index === rowCount - 1 ? profileHigh : profileLow + (index + 1) * rowSize;
    return Object.freeze({
      index,
      priceLow,
      priceHigh,
      price: (priceLow + priceHigh) / 2,
      volume,
      volumeShare: volume / totalVolume,
      relativeVolume: volume / maxVolume,
      valueArea: index >= valueAreaFrom && index <= valueAreaTo,
      poc: index === pocIndex,
    });
  });
  const poc = rows[pocIndex];
  return Object.freeze({
    rowCount,
    rowSize,
    rows: Object.freeze(rows),
    totalVolume,
    maxVolume,
    profileLow,
    profileHigh,
    pocIndex,
    pocPrice: poc.price,
    valueAreaFrom,
    valueAreaTo,
    valueAreaLow: rows[valueAreaFrom].priceLow,
    valueAreaHigh: rows[valueAreaTo].priceHigh,
    valueAreaVolume,
    valueAreaShare: valueAreaVolume / totalVolume,
    usableCandleCount: usableCandles.length,
  });
}

function separatedNodes(candidates, limit, minimumIndexDistance = 3) {
  const selected = [];
  for (const candidate of candidates.sort((first, second) => second.score - first.score)) {
    if (selected.some((item) => Math.abs(item.index - candidate.index) < minimumIndexDistance)) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected.sort((first, second) => first.price - second.price);
}

export function detectVpvrNodes(profile) {
  const smoothed = profile.rows.map((row, index, rows) => {
    const previous = rows[Math.max(0, index - 1)].volume;
    const next = rows[Math.min(rows.length - 1, index + 1)].volume;
    return previous * 0.25 + row.volume * 0.5 + next * 0.25;
  });
  const highThreshold = quantile(smoothed, 0.68);
  const lowThreshold = quantile(smoothed, 0.32);
  const highs = profile.rows.flatMap((row, index) => {
    const previous = smoothed[Math.max(0, index - 1)];
    const next = smoothed[Math.min(smoothed.length - 1, index + 1)];
    const current = smoothed[index];
    if (index === 0 || index === profile.rows.length - 1 || current < highThreshold || current < previous || current < next) return [];
    return [{ ...row, kind: row.poc ? "poc" : "hvn", score: current / profile.maxVolume }];
  });
  if (!highs.some((item) => item.index === profile.pocIndex)) {
    highs.push({ ...profile.rows[profile.pocIndex], kind: "poc", score: 1 });
  }
  const lows = profile.rows.flatMap((row, index) => {
    if (index === 0 || index === profile.rows.length - 1 || row.valueArea) return [];
    const previous = smoothed[index - 1];
    const next = smoothed[index + 1];
    const current = smoothed[index];
    if (current > lowThreshold || current > previous || current > next) return [];
    return [{ ...row, kind: "lvn", score: 1 - current / profile.maxVolume }];
  });
  return Object.freeze({
    highVolumeNodes: Object.freeze(separatedNodes(highs, 6)),
    lowVolumeNodes: Object.freeze(separatedNodes(lows, 6)),
  });
}

function levelCandidate(profile, kind, price, score, row = null) {
  const halfWidth = profile.rowSize * 0.5;
  return {
    kind,
    price,
    priceLow: row?.priceLow ?? price - halfWidth,
    priceHigh: row?.priceHigh ?? price + halfWidth,
    relativeVolume: row?.relativeVolume ?? 0,
    score,
  };
}

function mergeNearbyLevels(levels, rowSize) {
  const merged = [];
  for (const level of levels.sort((first, second) => second.score - first.score)) {
    const existing = merged.find((item) => Math.abs(item.price - level.price) <= rowSize * 1.25);
    if (!existing) {
      merged.push({ ...level, kinds: [level.kind] });
      continue;
    }
    existing.priceLow = Math.min(existing.priceLow, level.priceLow);
    existing.priceHigh = Math.max(existing.priceHigh, level.priceHigh);
    existing.kinds = [...new Set([...existing.kinds, level.kind])];
    if (level.score > existing.score) {
      existing.price = level.price;
      existing.score = level.score;
      existing.relativeVolume = Math.max(existing.relativeVolume, level.relativeVolume);
    }
  }
  return merged;
}

export function classifyVpvrLevels(profile, nodes, currentPrice) {
  const rows = profile.rows;
  const candidates = [
    levelCandidate(profile, "POC", profile.pocPrice, 1.25, rows[profile.pocIndex]),
    levelCandidate(profile, "VAH", profile.valueAreaHigh, 1.05, rows[profile.valueAreaTo]),
    levelCandidate(profile, "VAL", profile.valueAreaLow, 1.05, rows[profile.valueAreaFrom]),
    levelCandidate(profile, "Profile High", profile.profileHigh, 0.42, rows.at(-1)),
    levelCandidate(profile, "Profile Low", profile.profileLow, 0.42, rows[0]),
    ...nodes.highVolumeNodes.filter((node) => node.index !== profile.pocIndex)
      .map((node) => levelCandidate(profile, "HVN", node.price, 0.72 + node.relativeVolume * 0.35, node)),
  ];
  const merged = mergeNearbyLevels(candidates, profile.rowSize).map((level) => ({
    ...level,
    distance: Math.abs(level.price - currentPrice),
    relation: currentPrice > level.priceHigh ? "support" : currentPrice < level.priceLow ? "resistance" : "current",
  }));
  const choose = (relation) => merged.filter((level) => level.relation === relation)
    .sort((first, second) => second.score - first.score || first.distance - second.distance)
    .slice(0, 3)
    .sort((first, second) => first.distance - second.distance)
    .map((level) => Object.freeze(level));
  return Object.freeze({
    supports: Object.freeze(choose("support")),
    resistances: Object.freeze(choose("resistance")),
    currentZones: Object.freeze(merged.filter((level) => level.relation === "current").map((level) => Object.freeze(level))),
  });
}

function nearestNode(nodes, price) {
  return [...nodes].sort((first, second) => Math.abs(first.price - price) - Math.abs(second.price - price))[0] || null;
}

function buildMarketInsights(profile, nodes, levels, currentPrice) {
  const tolerance = profile.rowSize * 1.5;
  const location = currentPrice > profile.valueAreaHigh
    ? "above-value-area"
    : currentPrice < profile.valueAreaLow
      ? "below-value-area"
      : Math.abs(currentPrice - profile.pocPrice) <= tolerance
        ? "near-poc"
        : currentPrice > profile.pocPrice
          ? "inside-upper-value-area"
          : "inside-lower-value-area";
  const nearestHvn = nearestNode(nodes.highVolumeNodes, currentPrice);
  const nearestLvn = nearestNode(nodes.lowVolumeNodes, currentPrice);
  const nearHvn = nearestHvn && Math.abs(currentPrice - nearestHvn.price) <= profile.rowSize * 2;
  const nearLvn = nearestLvn && Math.abs(currentPrice - nearestLvn.price) <= profile.rowSize * 2;
  const acceptance = levels.currentZones.length || nearHvn || location === "near-poc"
    ? "accepted"
    : nearLvn || location === "above-value-area" || location === "below-value-area"
      ? "low-acceptance"
      : "transition";
  const belowVolume = profile.rows.filter((row) => row.price < currentPrice).reduce((sum, row) => sum + row.volume, 0);
  const aboveVolume = profile.rows.filter((row) => row.price >= currentPrice).reduce((sum, row) => sum + row.volume, 0);
  const valueAreaWidth = profile.valueAreaHigh - profile.valueAreaLow;
  return Object.freeze({
    currentPrice,
    location,
    acceptance,
    nearestHvn: nearestHvn ? Object.freeze(nearestHvn) : null,
    nearestLvn: nearestLvn ? Object.freeze(nearestLvn) : null,
    belowVolumeShare: belowVolume / profile.totalVolume,
    aboveVolumeShare: aboveVolume / profile.totalVolume,
    valueAreaWidth,
    valueAreaWidthShare: valueAreaWidth / Math.max(profile.profileHigh - profile.profileLow, Number.EPSILON),
    pocVolumeShare: profile.rows[profile.pocIndex].volumeShare,
  });
}

export function runVpvrAnalysisEngine(snapshot) {
  if (!Array.isArray(snapshot.candles) || snapshot.candles.length < 8) {
    throw new TypeError("VPVR analysis requires at least 8 visible candles");
  }
  const candles = snapshot.candles.slice(-600);
  const profile = calculateVpvrProfile(candles);
  const nodes = detectVpvrNodes(profile);
  const currentPrice = Number(candles.at(-1).close);
  const levels = classifyVpvrLevels(profile, nodes, currentPrice);
  const marketInsights = buildMarketInsights(profile, nodes, levels, currentPrice);
  const seconds = intervalSeconds(snapshot.interval, candles);
  const now = Number(snapshot.snapshotTime) > 100_000_000_000 ? Number(snapshot.snapshotTime) / 1_000 : Number(snapshot.snapshotTime);
  const closedCandles = candles.filter((candle) => candle.time + seconds <= now + 1);
  const developingCandleCount = candles.length - closedCandles.length;
  const evidence = [
    { id: `vpvr-poc-${candles.at(-1).time}`, summary: `POC ${profile.pocPrice}` },
    { id: `vpvr-value-area-${candles.at(-1).time}`, summary: `VAL ${profile.valueAreaLow}; VAH ${profile.valueAreaHigh}; volume share ${profile.valueAreaShare}` },
    ...levels.supports.map((level, index) => ({ id: `vpvr-support-${index}-${candles.at(-1).time}`, summary: `${level.kinds.join("/")} support ${level.priceLow}-${level.priceHigh}` })),
    ...levels.resistances.map((level, index) => ({ id: `vpvr-resistance-${index}-${candles.at(-1).time}`, summary: `${level.kinds.join("/")} resistance ${level.priceLow}-${level.priceHigh}` })),
  ];
  return Object.freeze({
    engineId: VPVR_ANALYSIS_ENGINE_ID,
    version: "1.0.0",
    status: "completed",
    rowCount: profile.rowCount,
    valueAreaRatio: VPVR_VALUE_AREA_RATIO,
    candleCount: candles.length,
    usableVolumeCandleCount: profile.usableCandleCount,
    developingCandleCount,
    lastProfileBarTime: candles.at(-1).time,
    lastClosedBarTime: closedCandles.at(-1)?.time ?? candles.at(-1).time,
    profile,
    nodes,
    levels,
    marketInsights,
    evidence: Object.freeze(evidence.map(Object.freeze)),
    coverage: Object.freeze({ candles: "available", volume: "available", lowerTimeframe: "unavailable" }),
    actionPlan: Object.freeze({
      primaryBias: "neutral",
      disposition: "wait",
      validityBars: 1,
      confirmation: "VPVR 只描述可见范围的成交量分布，不生成方向、入场、止损或止盈条件",
      observeTrigger: "观察价格接近支撑、阻力、POC、VAH、VAL、HVN 与 LVN 时，成交量分布是否随可见范围和新成交发生变化",
    }),
  });
}
