type Point = { x: number; y: number };

export function tradingTrendAngleGeometry(first: Point, second: Point) {
  const dx = second.x - first.x, dy = second.y - first.y;
  const length = Math.hypot(dx, dy);
  // Measure from the first anchor's rightward horizontal ray. Screen Y points
  // down, so clockwise angles are negative, including the lower-left quadrant.
  const radians = length === 0 ? 0 : Math.atan2(-dy, dx);
  const angle = Number((radians * 180 / Math.PI).toFixed(2));
  const radius = Math.min(56, length);
  const baselineEnd = { x: first.x + radius, y: first.y };
  const arcEnd = length === 0 ? { ...first }
    : { x: first.x + radius * dx / length, y: first.y + radius * dy / length };
  const arcPath = radius > 0 && (dy !== 0 || dx < 0)
    ? `M ${baselineEnd.x} ${baselineEnd.y} A ${radius} ${radius} 0 0 ${radians < 0 ? 1 : 0} ${arcEnd.x} ${arcEnd.y}`
    : '';
  return { angle, radius, baselineEnd, arcEnd, arcPath,
    label: `${Object.is(angle, -0) ? '0.00' : angle.toFixed(2)}°`,
    labelPosition: { x: baselineEnd.x + 10, y: first.y },
  };
}

export function renderTradingTrendAngleAnnotation(first: Point, second: Point, color: string, opacity: number) {
  const geometry = tradingTrendAngleGeometry(first, second);
  return `<g class="trading-trend-angle-annotation" opacity="${opacity}">`
    + `<g fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="1 2">`
    + `<line class="trading-trend-angle-baseline" x1="${first.x}" y1="${first.y}" x2="${geometry.baselineEnd.x}" y2="${geometry.baselineEnd.y}" />`
    + (geometry.arcPath ? `<path class="trading-trend-angle-arc" d="${geometry.arcPath}" />` : '')
    + `</g><text class="trading-trend-angle-label" x="${geometry.labelPosition.x}" y="${geometry.labelPosition.y}" dominant-baseline="central" fill="${color}" font-size="12" font-weight="400">${geometry.label}</text></g>`;
}
