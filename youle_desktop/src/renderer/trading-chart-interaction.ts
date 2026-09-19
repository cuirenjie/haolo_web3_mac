// Keep background shell renders from detaching/reinserting a chart while its
// native mouse gesture is in progress. Market updates continue independently.
const activeGestures = new Set<object>();
let pendingRender: (() => void) | null = null;

export function beginTradingChartInteraction(owner: object) {
  activeGestures.add(owner);
}

export function endTradingChartInteraction(owner: object) {
  activeGestures.delete(owner);
  if (activeGestures.size || !pendingRender) return;
  const render = pendingRender;
  pendingRender = null;
  render();
}

export function deferTradingChartShellRender(render: () => void) {
  if (!activeGestures.size) return false;
  pendingRender = render;
  return true;
}
