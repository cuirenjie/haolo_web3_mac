// Visibility describes a native window, not focus. Service consumers are
// separate from hidden windows; they must not be counted as removable UI work.
export function windowTrafficActivity(window) {
  try {
    if (!window || window.isDestroyed()) return "unknown";
    return window.isVisible() && !window.isMinimized() ? "foreground" : "background";
  } catch { return "unknown"; }
}
const windowWatches = new WeakMap();
const events = ["show", "hide", "minimize", "restore", "closed"];
export function watchTrafficWindow(window, refresh) {
  if (!window?.on || typeof refresh !== "function") return () => {};
  let watch = windowWatches.get(window);
  if (!watch) {
    watch = { callbacks: new Set(), listener: () => {
      for (const callback of watch.callbacks) { try { callback(); } catch {} }
    } };
    windowWatches.set(window, watch);
    for (const event of events) window.on(event, watch.listener);
  }
  const callback = () => refresh();
  watch.callbacks.add(callback);
  return () => {
    watch.callbacks.delete(callback);
    if (!watch.callbacks.size && windowWatches.get(window) === watch) {
      for (const event of events) window.removeListener?.(event, watch.listener);
      windowWatches.delete(window);
    }
  };
}
export function aggregateTrafficActivity(providers) {
  const values = new Set(providers.map(provider => {
    try { return provider ? provider() : "service"; } catch { return "unknown"; }
  }));
  if (!values.size || [...values].some(value => !["foreground", "background", "service", "mixed"].includes(value))) return "unknown";
  return values.size === 1 ? [...values][0] : "mixed";
}

// Observation must stay well below the gateway's 64 KiB inbound frame limit,
// including long UTF-8 symbols. Omitted streams remain unknown at the server.
export function encodeTrafficContext(rows) {
  const streams = [];
  let bytes = 128;
  for (const row of rows) {
    bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
    if (streams.length >= 500 || bytes > 48 * 1024) break;
    streams.push(row);
  }
  return JSON.stringify({ method: "HAOLO_TRAFFIC_CONTEXT", version: 1, streams });
}
