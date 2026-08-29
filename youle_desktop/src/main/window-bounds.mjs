function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function constrainWindowMoveBoundsToWorkArea(bounds = {}, workArea = {}) {
  const areaX = Math.round(finiteNumber(workArea.x));
  const areaY = Math.round(finiteNumber(workArea.y));
  const areaWidth = Math.max(1, Math.round(finiteNumber(workArea.width, 1)));
  const areaHeight = Math.max(1, Math.round(finiteNumber(workArea.height, 1)));
  const width = Math.max(1, Math.round(finiteNumber(bounds.width, 1)));
  const height = Math.max(1, Math.round(finiteNumber(bounds.height, 1)));
  const requestedX = Math.round(finiteNumber(bounds.x, areaX));
  const requestedY = Math.round(finiteNumber(bounds.y, areaY));
  const minimumVisibleWidth = Math.min(areaWidth, Math.max(1, Math.ceil(width / 5)));
  const minimumVisibleHeight = Math.min(areaHeight, Math.max(1, Math.ceil(height / 5)));
  const minX = areaX - width + minimumVisibleWidth;
  const maxX = areaX + areaWidth - minimumVisibleWidth;
  const minY = areaY - height + minimumVisibleHeight;
  const maxY = areaY + areaHeight - minimumVisibleHeight;

  return {
    x: clamp(requestedX, minX, maxX),
    y: clamp(requestedY, minY, maxY),
    width,
    height,
  };
}
