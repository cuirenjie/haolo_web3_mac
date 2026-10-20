export interface CodexChartTarget { marketId: string; symbol: string; interval: string }
export function resolveCodexChartTarget(
  args?: { marketId?: string; symbol?: string; interval?: string },
  current?: CodexChartTarget | null,
  options?: { reuseOpenedInterval?: boolean },
): CodexChartTarget;
