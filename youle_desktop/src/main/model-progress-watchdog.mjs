import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export const MODEL_IDLE_TIMEOUT_MS = 20_000;
export const MODEL_GENERATION_TIMEOUT_MS = 90_000;

export function meaningfulModelProgress(event) {
  if (!event || typeof event !== "object") return false;
  if (["response.output_text.delta", "response.reasoning_text.delta",
    "response.reasoning_summary_text.delta", "response.reasoning.delta",
    "response.function_call_arguments.delta"].includes(event.type)) {
    return typeof event.delta === "string" && Boolean(event.delta.trim());
  }
  return ["response.output_item.added", "response.output_item.done"].includes(event.type)
    && event.item?.type === "function_call" && Boolean(event.item.name || event.item.arguments);
}

// Only active during an upstream inference request. Local tools do not own a
// timer, and keep-alives cannot renew either deadline.
export function createModelProgressWatchdog(controller, {
  idleMs = MODEL_IDLE_TIMEOUT_MS, totalMs = MODEL_GENERATION_TIMEOUT_MS,
} = {}) {
  let pending = "";
  let data = [];
  let dataLength = 0;
  let idleTimer;
  let disposed = false;
  const decoder = new StringDecoder("utf8");
  const expire = (code) => {
    controller.abort(Object.assign(new Error("Model response timed out"), { code, category: "timeout", retryable: true }));
  };
  const progress = () => {
    clearTimeout(idleTimer);
    if (!disposed) idleTimer = setTimeout(() => expire("MODEL_NO_PROGRESS_TIMEOUT"), idleMs);
    idleTimer?.unref?.();
  };
  const totalTimer = setTimeout(() => expire("MODEL_GENERATION_TIMEOUT"), totalMs);
  totalTimer.unref?.();
  progress();
  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      pending += decoder.write(chunk);
      if (pending.length > 2 * 1024 * 1024) return callback(new Error("Model stream event too large"));
      let end;
      while ((end = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, end).replace(/\r$/, "");
        pending = pending.slice(end + 1);
        if (line.startsWith("data:")) {
          dataLength += line.length;
          if (dataLength > 2 * 1024 * 1024) return callback(new Error("Model stream event too large"));
          data.push(line.slice(5).trimStart());
        }
        else if (!line && data.length) {
          try { if (meaningfulModelProgress(JSON.parse(data.join("\n")))) progress(); } catch { /* Runtime validates malformed events. */ }
          data = [];
          dataLength = 0;
        }
      }
      callback(null, chunk);
    },
  });
  return { stream, dispose() { disposed = true; clearTimeout(idleTimer); clearTimeout(totalTimer); } };
}
