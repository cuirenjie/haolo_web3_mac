import { parentPort, workerData } from "node:worker_threads";
import { planAlertSimulation } from "./simulation-planner.mjs";

function serializeError(error) {
  return {
    name: String(error?.name || "Error"),
    message: String(error?.message || error || "预警模拟失败").slice(0, 1_000),
    code: String(error?.code || "TRADING_ALERT_SIMULATION_FAILED"),
    category: String(error?.category || "simulation"),
    retryable: Boolean(error?.retryable),
    details: error?.details && typeof error.details === "object"
      ? structuredClone(error.details)
      : null,
    stack: typeof error?.stack === "string" ? error.stack.slice(0, 8_000) : null,
  };
}

if (!parentPort) throw new Error("Trading alert simulation worker requires a parent port");

try {
  const result = await planAlertSimulation(workerData || {});
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  parentPort.postMessage({ ok: false, error: serializeError(error) });
}
