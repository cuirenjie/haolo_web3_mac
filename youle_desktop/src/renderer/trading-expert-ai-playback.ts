import type {
  TradingDrawingLineStyle,
  TradingDrawingPoint,
  TradingDrawingToolId,
} from "./trading-expert-drawing";

export type TradingAiDrawingColorToken =
  | "chan-pen"
  | "chan-center"
  | "chan-top"
  | "chan-bottom"
  | "chan-note"
  | "order-flow-buy"
  | "order-flow-sell"
  | "order-flow-poc"
  | "order-flow-note"
  | "order-flow-structure-bull"
  | "order-flow-structure-bear"
  | "order-flow-ob-bull"
  | "order-flow-ob-bear"
  | "order-flow-fvg-bull"
  | "order-flow-fvg-bear"
  | "order-flow-liquidity"
  | "order-flow-equilibrium"
  | "order-flow-ote"
  | "wave-primary"
  | "wave-correction"
  | "wave-alternative"
  | "wave-fibonacci"
  | "wave-note"
  | "wyckoff-range"
  | "wyckoff-demand"
  | "wyckoff-supply"
  | "wyckoff-phase"
  | "wyckoff-event-bull"
  | "wyckoff-event-bear"
  | "wyckoff-projection"
  | "wyckoff-note"
  | "price-action-trend"
  | "price-action-support"
  | "price-action-resistance"
  | "price-action-note"
  | "strategy-primary"
  | "strategy-support"
  | "strategy-resistance"
  | "strategy-entry"
  | "strategy-stop"
  | "strategy-target"
  | "strategy-note";

export interface TradingAiDrawing {
  planLevel?: import('../shared/execution-plan-drawings.mjs').PlanLevel;
  entryConditionRef?: {conditionId:string;revision:number;conditionHash:string};
  id: string;
  strategyId?: string;
  symbol: string;
  interval?: string;
  theory: "chan" | "order-flow" | "wave" | "wyckoff" | "price-action" | "strategy";
  layer: "ai/chan" | "ai/order-flow" | "ai/wave" | "ai/wyckoff" | "ai/price-action" | `ai/strategy/${string}`;
  tool: TradingDrawingToolId;
  points: TradingDrawingPoint[];
  text?: string;
  colorToken: TradingAiDrawingColorToken;
  lineStyle?: TradingDrawingLineStyle;
  lineWidth?: number;
  fontSize?: number;
  bold?: boolean;
  locked: true;
  status: "tentative" | "confirmed";
  evidenceIds: string[];
}
export interface TradingAiDrawingPatch {
  /** Renderer-owned chat turn identity; independent of each analysis job. */
  drawingTurnId?: string;
  resultPolicy?: 'entry-v2';
  entryConditionRef?: {conditionId:string;revision:number;conditionHash:string};
  schemaVersion: 1;
  analysisId: string;
  baseRevision: number;
  marketId: string;
  interval: string;
  operations: Array<{ op: "upsert"; drawing: TradingAiDrawing }>;
}

export interface TradingIndicatorAiDrawingPoint {
  time: number;
  value: number;
}

export interface TradingIndicatorAiDrawing {
  id: string;
  strategyId: string;
  theory: "strategy";
  layer: `ai/strategy/${string}`;
  tool: "path" | "note" | "text";
  points: TradingIndicatorAiDrawingPoint[];
  text?: string;
  colorToken: TradingAiDrawingColorToken;
  lineStyle?: TradingDrawingLineStyle;
  lineWidth?: number;
  fontSize?: number;
  bold?: boolean;
  markerSize?: number;
  locked: true;
  status: "tentative" | "confirmed";
  evidenceIds: string[];
}

export interface TradingIndicatorAiDrawingPatch {
  schemaVersion: 1;
  analysisId: string;
  baseRevision: number;
  marketId: string;
  interval: string;
  indicatorId: string;
  entryConditionRef?: {conditionId:string;revision:number;conditionHash:string};
  operations: Array<{ op: "upsert"; drawing: TradingIndicatorAiDrawing }>;
}

export type TradingAiPlaybackPhase = "moving" | "drawing" | "committing" | "completed" | "cancelled";

interface TradingAiPlaybackControllerOptions {
  // Opacity belongs only to the transient display, never to the accepted patch.
  setDraft: (drawing: TradingAiDrawing | null, opacity?: number) => void;
  commit: (drawing: TradingAiDrawing) => void;
  setCursor: (point: TradingDrawingPoint | null, pulse?: boolean) => void;
}

function playbackAbortError() {
  const error = new Error("AI drawing playback cancelled");
  error.name = "AbortError";
  return error;
}

export function interpolateTradingDrawingPoint(
  first: TradingDrawingPoint,
  second: TradingDrawingPoint,
  progress: number,
): TradingDrawingPoint {
  const ratio = Math.min(1, Math.max(0, progress));
  return {
    time: first.time + (second.time - first.time) * ratio,
    price: first.price + (second.price - first.price) * ratio,
  };
}

function easeInOutCubic(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

export class TradingAiDrawingPlaybackController {
  private readonly options: TradingAiPlaybackControllerOptions;
  private generation = 0;
  private currentCursor: TradingDrawingPoint | null = null;
  private shouldContinue: (() => boolean) | undefined;

  constructor(options: TradingAiPlaybackControllerOptions) {
    this.options = options;
  }

  cancel() {
    this.generation += 1;
    this.currentCursor = null;
    this.options.setDraft(null);
    this.options.setCursor(null);
  }

  async play(
    drawings: ReadonlyArray<TradingAiDrawing>,
    options: { onPhase?: (phase: TradingAiPlaybackPhase, drawing?: TradingAiDrawing) => void; shouldContinue?: () => boolean; speedMultiplier?: number } = {},
  ) {
    const generation = ++this.generation;
    this.shouldContinue = options.shouldContinue;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const requestedSpeed = options.speedMultiplier ?? 1;
    const speed = Number.isFinite(requestedSpeed) && requestedSpeed > 0 ? requestedSpeed : 1;
    const duration = (normal: number) => normal / speed;
    try {
      for (const drawing of drawings) {
        this.assertCurrent(generation);
        const first = drawing.points[0];
        if (!first) continue;
        if (!reducedMotion) {
          options.onPhase?.("moving", drawing);
          if (this.currentCursor) {
            const origin = this.currentCursor;
            await this.animate(duration(170), generation, (progress) => {
              const cursor = interpolateTradingDrawingPoint(origin, first, easeInOutCubic(progress));
              this.currentCursor = cursor;
              this.options.setCursor(cursor);
            });
          } else {
            this.currentCursor = first;
            this.options.setCursor(first);
          }
          this.options.setCursor(first, true);
          await this.wait(duration(90), generation);
        } else {
          // The cursor identifies the current stroke even when the OS disables
          // decorative animation. Only travel between objects and pulses stop.
          this.currentCursor = first;
          this.options.setCursor(first);
        }
        options.onPhase?.("drawing", drawing);
        if (!reducedMotion && drawing.tool === "note" && drawing.text) {
          await this.playText(drawing, generation, duration(420));
        } else if (drawing.points.length === 1) {
          await this.animate(Math.max(160, duration(180)), generation, (progress) => {
            this.options.setDraft(drawing, progress);
          });
        } else {
          // Keep the cursor and geometry progressing together in both modes.
          await this.playSegments(drawing, generation,
            reducedMotion ? Math.max(160, duration(180)) : duration(235), reducedMotion);
        }
        this.assertCurrent(generation);
        options.onPhase?.("committing", drawing);
        this.options.setDraft(null);
        this.options.commit(drawing);
        this.currentCursor = drawing.points.at(-1) ?? first;
        this.options.setCursor(this.currentCursor, !reducedMotion);
        if (!reducedMotion) {
          await this.wait(duration(105), generation);
        }
      }
      this.assertCurrent(generation);
      options.onPhase?.("completed");
      await this.wait(duration(260), generation);
      this.currentCursor = null;
      this.options.setCursor(null);
    } catch (error) {
      if (String((error as Error)?.name || "") === "AbortError") {
        if (generation === this.generation) {
          this.options.setDraft(null);
          this.options.setCursor(null);
        }
        options.onPhase?.("cancelled");
        return;
      }
      throw error;
    }
  }

  private async playSegments(drawing: TradingAiDrawing, generation: number, segmentDuration: number, reducedMotion: boolean) {
    const completed = [drawing.points[0]];
    for (let index = 1; index < drawing.points.length; index += 1) {
      const first = drawing.points[index - 1];
      const second = drawing.points[index];
      await this.animate(segmentDuration, generation, (progress) => {
        const current = interpolateTradingDrawingPoint(first, second, reducedMotion ? progress : easeInOutCubic(progress));
        this.currentCursor = current;
        this.options.setCursor(current);
        this.options.setDraft({ ...drawing, points: [...completed, current] });
      });
      completed.push(second);
    }
  }

  private async playText(drawing: TradingAiDrawing, generation: number, totalDuration: number) {
    const text = drawing.text || "";
    if (!text || totalDuration === 0) {
      this.options.setDraft(drawing);
      return;
    }
    await this.animate(totalDuration, generation, (progress) => {
      const length = Math.max(1, Math.ceil(text.length * progress));
      this.options.setDraft({ ...drawing, text: text.slice(0, length) });
    });
  }

  private animate(
    duration: number,
    generation: number,
    onFrame: (progress: number) => void,
  ) {
    if (duration <= 0) {
      this.assertCurrent(generation);
      onFrame(1);
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let previousFrame: number | null = null;
      let elapsed = 0;
      const frame = (now: number) => {
        try {
          this.assertCurrent(generation);
          if (window.document?.visibilityState === "hidden") {
            previousFrame = null;
            window.requestAnimationFrame(frame);
            return;
          }
          // Long tasks, throttled/remote sessions and background resume must not
          // consume a whole stroke between two paints. Keep at least six steps
          // even at accelerated speed; normal refresh rates keep their timing.
          const delta = previousFrame === null ? 0 : Math.max(0, now - previousFrame);
          previousFrame = now;
          elapsed = Math.min(duration, elapsed + Math.min(delta, 50, duration / 6));
          const progress = Math.min(1, elapsed / duration);
          onFrame(progress);
          this.assertCurrent(generation);
          if (progress >= 1) resolve();
          else window.requestAnimationFrame(frame);
        } catch (error) {
          reject(error);
        }
      };
      window.requestAnimationFrame(frame);
    });
  }

  private wait(duration: number, generation: number) {
    if (duration <= 0) {
      this.assertCurrent(generation);
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      window.setTimeout(() => {
        try { this.assertCurrent(generation); resolve(); }
        catch (error) { reject(error); }
      }, duration);
    });
  }

  private assertCurrent(generation: number) {
    if (generation !== this.generation || this.shouldContinue?.() === false) throw playbackAbortError();
  }
}
