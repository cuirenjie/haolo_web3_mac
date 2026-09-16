export type CompactionStatus = "requesting" | "compacting" | "completed" | "failed";
type CompactionItem = Record<string, unknown>;

export function explicitCompactionStatus(value: unknown): CompactionStatus | null {
  const status = String(value || "").replace(/[_-]/g, "").toLowerCase();
  if (["requesting", "queued"].includes(status)) return "requesting";
  if (["compacting", "inprogress", "running", "started"].includes(status)) return "compacting";
  if (["failed", "error", "interrupted", "cancelled", "canceled"].includes(status)) return "failed";
  if (["completed", "succeeded", "success"].includes(status)) return "completed";
  return null;
}

export function compactionItemStatus(item: CompactionItem): CompactionStatus {
  return explicitCompactionStatus(item.__youleContextCompactionStatus)
    || explicitCompactionStatus(item.status)
    || explicitCompactionStatus(item.__youleTurnStatus)
    || "completed";
}

export function isPendingCompaction(status: unknown) {
  return status === "requesting" || status === "compacting";
}

// A turn can fail after successfully compacting. Only unfinished compactions
// inherit the turn's outcome; a confirmed item outcome remains authoritative.
export function reconcileCompactionItem<T extends CompactionItem>(
  item: T,
  { turnStatus, error, hasLiveOwner }: { turnStatus?: unknown; error?: string | null; hasLiveOwner: boolean },
): T {
  const explicit = explicitCompactionStatus(item.__youleContextCompactionStatus)
    || explicitCompactionStatus(item.status);
  if (explicit === "completed" || explicit === "failed") return item;
  const terminal = explicitCompactionStatus(turnStatus ?? item.__youleTurnStatus);
  const status = terminal === "completed" || terminal === "failed"
    ? terminal
    : isPendingCompaction(explicit) && !hasLiveOwner ? "failed" : null;
  if (!status) return item;
  return {
    ...item,
    __youleContextCompactionStatus: status,
    __youleContextCompactionError: status === "failed"
      ? error || "上下文压缩已中断，请重试。"
      : null,
  };
}

// Read/resume snapshots often omit local UI metadata, and started notifications
// can arrive late. Neither may reopen an item with a confirmed terminal state.
export function mergeCompactionItem<T extends CompactionItem>(previous: T | undefined, incoming: T): T {
  const status = previous && (explicitCompactionStatus(previous.__youleContextCompactionStatus)
    || explicitCompactionStatus(previous.status));
  if (status !== "completed" && status !== "failed") return incoming;
  return {
    ...incoming,
    __youleContextCompactionStatus: status,
    __youleContextCompactionError: previous?.__youleContextCompactionError ?? null,
  };
}
