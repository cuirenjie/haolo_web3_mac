// One daily fallback per renderer; no per-resource polling or offline queues.
// Server hints only trigger reads. Local edits retain their existing durable outbox.
type Topic = 'settings' | 'drawings' | 'plans' | 'alerts';
export const SYNC_DAY_MS = 24 * 60 * 60 * 1000;
const listeners = new Map<Topic, Set<() => void>>();
let timer: ReturnType<typeof setTimeout> | undefined;
let initialized = false;
let due = 0;
let overdue = false;
function dispatch(topics: Topic[]) {
  for (const topic of topics) for (const run of listeners.get(topic) || []) run();
}
function daily() {
  if (timer) clearTimeout(timer);
  due = Date.now() + SYNC_DAY_MS + Math.random() * 30 * 60 * 1000;
  timer = setTimeout(() => {
    overdue = document.hidden || navigator.onLine === false;
    if (!overdue) dispatch(['settings','drawings','plans','alerts']);
    daily();
  }, due - Date.now());
  (timer as any)?.unref?.();
}
export function onBackgroundSync(topic: Topic, run: () => void) {
  if (typeof window === 'undefined') return () => {};
  if (!initialized) {
    initialized = true;
    window.addEventListener('haolo:sync-changed', event => {
      const topics = (event as CustomEvent).detail?.topics;
      if (Array.isArray(topics)) dispatch(topics.filter(t => ['settings','drawings','plans','alerts'].includes(t)));
    });
    // A resumed/offline client catches up from the server's current snapshot.
    window.addEventListener('online', () => dispatch(['settings','drawings','plans','alerts']));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && (overdue || Date.now() >= due)) { overdue=false; dispatch(['settings','drawings','plans','alerts']); daily(); }
    });
    daily();
  }
  let set = listeners.get(topic);
  if (!set) listeners.set(topic, set = new Set());
  set.add(run);
  return () => set!.delete(run);
}
