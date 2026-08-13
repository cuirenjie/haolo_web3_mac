import { Worker } from "node:worker_threads";
import { TradingAlertError } from "./errors.mjs";

export const TRADING_ALERT_SIMULATION_TIMEOUT_MS = 30_000;

function simulationError(message, options = {}) {
  return new TradingAlertError(message, {
    code: options.code || "TRADING_ALERT_SIMULATION_FAILED",
    category: options.category || "simulation",
    retryable: options.retryable,
    details: options.details,
    cause: options.cause,
  });
}

function deserializeWorkerError(value) {
  const error = simulationError(value?.message || "预警模拟失败", {
    code: value?.code,
    category: value?.category,
    retryable: value?.retryable,
    details: value?.details,
  });
  if (value?.stack) error.stack = String(value.stack);
  return error;
}

export function planAlertSimulationIsolated(options = {}) {
  const {
    signal,
    timeoutMs = TRADING_ALERT_SIMULATION_TIMEOUT_MS,
    ...workerOptions
  } = options;
  if (signal?.aborted) {
    return Promise.reject(simulationError("预警模拟已取消", {
      code: "TRADING_ALERT_SIMULATION_CANCELLED",
      category: "cancelled",
      retryable: true,
    }));
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./simulation-worker.mjs", import.meta.url), {
      workerData: workerOptions,
      resourceLimits: {
        maxOldGenerationSizeMb: 512,
        maxYoungGenerationSizeMb: 128,
        stackSizeMb: 8,
      },
    });
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener?.("abort", handleAbort);
      worker.removeAllListeners();
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate().catch(() => undefined);
      callback(value);
    };
    const handleAbort = () => finish(reject, simulationError("预警模拟已取消", {
      code: "TRADING_ALERT_SIMULATION_CANCELLED",
      category: "cancelled",
      retryable: true,
    }));

    worker.once("message", (message) => {
      if (message?.ok === true) finish(resolve, message.result);
      else finish(reject, deserializeWorkerError(message?.error));
    });
    worker.once("error", (error) => {
      console.error("[trading-alert] simulation worker failed", error);
      finish(reject, simulationError(`预警模拟工作线程异常：${String(error?.message || error || "未知错误")}`, {
      code: "TRADING_ALERT_SIMULATION_WORKER_FAILED",
      retryable: true,
      details: { reason: String(error?.message || error || "unknown") },
      cause: error,
      }));
    });
    worker.once("exit", (code) => {
      if (!settled) finish(reject, simulationError(`预警模拟工作线程意外退出（${code}）`, {
        code: "TRADING_ALERT_SIMULATION_WORKER_EXITED",
        retryable: true,
      }));
    });
    signal?.addEventListener?.("abort", handleAbort, { once: true });
    timer = setTimeout(() => finish(reject, simulationError("预警模拟耗时过长，已安全终止，请稍后重试", {
      code: "TRADING_ALERT_SIMULATION_TIMEOUT",
      retryable: true,
      details: { timeoutMs },
    })), Math.max(1, Number(timeoutMs) || TRADING_ALERT_SIMULATION_TIMEOUT_MS));
    timer.unref?.();
  });
}
