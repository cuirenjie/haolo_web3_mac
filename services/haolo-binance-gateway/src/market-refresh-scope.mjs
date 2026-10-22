// A deadline must settle the caller even when a dependency ignores AbortSignal.
// Each continuation also checks the signal before it may publish a result.
export class MarketRefreshScope {
  constructor(timeoutMs, { signal } = {}) {
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.deadlineMs = Date.now() + Math.max(1, Number(timeoutMs) || 15_000);
    this.stage = "refresh";
    this.closed = false;
    this.parent = signal;
    this.forwardAbort = () => this.controller.abort(signal.reason);
    if (signal?.aborted) this.forwardAbort();
    else signal?.addEventListener("abort", this.forwardAbort, { once: true });
    this.timer = setTimeout(() => this.expire(), Math.max(1, this.deadlineMs - Date.now()));
    this.timer.unref?.();
  }

  expire() {
    if (!this.signal.aborted) this.controller.abort(Object.assign(new Error("Market refresh timed out"), {
      statusCode: 503, code: "MARKET_REFRESH_TIMEOUT", retryAfterMs: 1_000, stage: this.stage,
    }));
  }

  check(stage) {
    if (stage) this.stage = stage;
    if (Date.now() >= this.deadlineMs) this.expire();
    this.signal.throwIfAborted();
  }

  run(operation, stage, onLateResult) {
    try { this.check(stage); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        this.signal.removeEventListener("abort", abort);
        callback(value);
      };
      const abort = () => finish(reject, this.signal.reason);
      this.signal.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(() => { this.check(); return operation(); }).then(value => {
        // Cleanup has its own lifetime; a stuck cleanup must not block callers.
        if (settled || this.signal.aborted || Date.now() >= this.deadlineMs) {
          try { Promise.resolve(onLateResult?.(value)).catch(() => {}); } catch {}
          if (!settled) { this.expire(); abort(); }
          return;
        }
        finish(resolve, value);
      }, error => finish(reject, error));
    });
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.parent?.removeEventListener("abort", this.forwardAbort);
  }
}

export function discardMarketResponse(response) {
  try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch {}
}
