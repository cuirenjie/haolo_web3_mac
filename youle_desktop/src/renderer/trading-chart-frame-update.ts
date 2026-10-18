/** Latest-value work for the next paint. Input can arrive much faster than the
 * display; computing intermediate legends only increases pointer latency. */
export class TradingChartFrameUpdate<T> {
  private frame: number | null = null;
  private pending: { value: T } | null = null;

  private readonly paint: (value: T) => void;

  constructor(paint: (value: T) => void) { this.paint = paint; }

  readonly schedule = (value: T) => {
    this.pending = { value };
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      const pending = this.pending;
      this.pending = null;
      if (pending) this.paint(pending.value);
    });
  };

  cancel() {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pending = null;
  }
}
