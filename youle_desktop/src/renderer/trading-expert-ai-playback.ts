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
  operations: Array<{ op: "upsert"; drawing: TradingIndicatorAiDrawing }>;
}

export type TradingAiPlaybackPhase = "moving" | "drawing" | "committing" | "completed" | "cancelled";

interface TradingAiPlaybackControllerOptions {
  setDraft: (drawing: TradingAiDrawing | null) => void;
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
    options: { onPhase?: (phase: TradingAiPlaybackPhase, drawing?: TradingAiDrawing) => void } = {},
  ) {
    const generation = ++this.generation;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const duration = (normal: number) => reducedMotion ? 0 : normal;
    try {
      for (const drawing of drawings) {
        this.assertCurrent(generation);
        const first = drawing.points[0];
        if (!first) continue;
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
        options.onPhase?.("drawing", drawing);
        if (drawing.tool === "note" && drawing.text) {
          await this.playText(drawing, generation, duration(420));
        } else if (drawing.points.length === 1) {
          this.options.setDraft(drawing);
          await this.wait(duration(150), generation);
        } else {
          await this.playSegments(drawing, generation, duration(235));
        }
        this.assertCurrent(generation);
        options.onPhase?.("committing", drawing);
        this.options.setDraft(null);
        this.options.commit(drawing);
        this.currentCursor = drawing.points.at(-1) ?? first;
        this.options.setCursor(this.currentCursor, true);
        await this.wait(duration(105), generation);
      }
      this.assertCurrent(generation);
      options.onPhase?.("completed");
      await this.wait(duration(260), generation);
      this.currentCursor = null;
      this.options.setCursor(null);
    } catch (error) {
      if (String((error as Error)?.name || "") === "AbortError") {
        options.onPhase?.("cancelled");
        return;
      }
      throw error;
    }
  }

  private async playSegments(drawing: TradingAiDrawing, generation: number, segmentDuration: number) {
    const completed = [drawing.points[0]];
    for (let index = 1; index < drawing.points.length; index += 1) {
      const first = drawing.points[index - 1];
      const second = drawing.points[index];
      await this.animate(segmentDuration, generation, (progress) => {
        const current = interpolateTradingDrawingPoint(first, second, easeInOutCubic(progress));
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
      let startedAt: number | null = null;
      const frame = (now: number) => {
        if (generation !== this.generation) {
          reject(playbackAbortError());
          return;
        }
        startedAt ??= now;
        const progress = Math.min(1, (now - startedAt) / duration);
        onFrame(progress);
        if (progress >= 1) resolve();
        else window.requestAnimationFrame(frame);
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
        if (generation !== this.generation) reject(playbackAbortError());
        else resolve();
      }, duration);
    });
  }

  private assertCurrent(generation: number) {
    if (generation !== this.generation) throw playbackAbortError();
  }
}
