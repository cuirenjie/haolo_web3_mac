type Sample = { x: number; y: number; time: number };
type Delta = { x: number; y: number };

const DECAY_MS = 280;
const STOP_SPEED = 0.015; // CSS pixels/ms; independent of display refresh rate.

/** Only release motion is animated. Pointer movement itself stays synchronous. */
export class TradingChartMomentum {
  private samples: Sample[] = [];
  private velocity: Delta = { x: 0, y: 0 };
  private started = 0;
  private elapsed = 0;

  add(x: number, y: number, time: number) {
    if (![x, y, time].every(Number.isFinite)) return;
    const last = this.samples.at(-1);
    if (last && time < last.time) return;
    if (last?.time === time) this.samples.pop();
    this.samples.push({ x, y, time });
    while (this.samples.length > 64 || (this.samples.length > 2 && this.samples[1].time < time - 100)) this.samples.shift();
  }

  start(time: number, width: number, height: number, vertical: boolean) {
    const speed = (axis: 'x' | 'y', extent: number) => {
      const last = this.samples.at(-1);
      if (!last || !Number.isFinite(extent) || extent <= 0 || time - last.time > 65) return 0;
      let first = last, direction = 0, lastMotion = -Infinity;
      for (let i = this.samples.length - 2; i >= 0; i--) {
        const a = this.samples[i], b = this.samples[i + 1], delta = b[axis] - a[axis];
        if (last.time - a.time > 100) break;
        if (Math.abs(delta) > 0.1) {
          if (direction && Math.sign(delta) !== direction) break;
          direction = Math.sign(delta);
          lastMotion = Math.max(lastMotion, b.time);
        }
        first = a;
      }
      const duration = last.time - first.time;
      if (duration < 12 || time - lastMotion > 65) return 0;
      const velocity = (last[axis] - first[axis]) / duration;
      if (Math.abs(velocity) < 0.025 || Math.abs(last[axis] - first[axis]) < 2) return 0;
      // A fast flick never throws the chart more than about one viewport.
      const limit = Math.min(3, extent * 0.85 / DECAY_MS);
      return Math.sign(velocity) * Math.min(Math.abs(velocity), limit);
    };
    this.velocity = { x: speed('x', width), y: vertical ? speed('y', height) : 0 };
    if (Math.hypot(this.velocity.x, this.velocity.y) < 0.12) this.velocity = { x: 0, y: 0 };
    this.started = time;
    this.elapsed = 0;
    this.samples = [];
    return this.active;
  }

  get active() { return this.velocity.x !== 0 || this.velocity.y !== 0; }

  step(time: number): Delta | null {
    const elapsed = Math.max(0, time - this.started);
    if (!this.active || !Number.isFinite(elapsed) || elapsed - this.elapsed > 120 || elapsed > 1800) {
      this.stop(); return null;
    }
    const before = Math.exp(-this.elapsed / DECAY_MS), after = Math.exp(-elapsed / DECAY_MS);
    const delta = { x: this.velocity.x * DECAY_MS * (before - after), y: this.velocity.y * DECAY_MS * (before - after) };
    this.elapsed = elapsed;
    if (Math.abs(this.velocity.x * after) < STOP_SPEED) this.velocity.x = 0;
    if (Math.abs(this.velocity.y * after) < STOP_SPEED) this.velocity.y = 0;
    return delta;
  }

  block(axis: 'x' | 'y') { this.velocity[axis] = 0; }
  stop() { this.velocity = { x: 0, y: 0 }; this.samples = []; }
}
