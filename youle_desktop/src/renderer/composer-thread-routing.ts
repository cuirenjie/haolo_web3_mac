export function resolveComposerThreadIdForSend({
  candidateThreadId,
  activeThreadId,
  resolveThreadId,
  isVisibleThreadId,
}: {
  candidateThreadId?: string | null;
  activeThreadId?: string | null;
  resolveThreadId: (threadId: string) => string;
  isVisibleThreadId: (threadId: string) => boolean;
}) {
  const candidate = String(candidateThreadId || "").trim();
  const active = String(activeThreadId || "").trim();
  if (!candidate) return active || null;

  const resolvedCandidate = resolveThreadId(candidate) || candidate;
  const resolvedActive = active ? resolveThreadId(active) || active : "";
  if (active && resolvedCandidate === resolvedActive) return active;
  if (isVisibleThreadId(resolvedCandidate)) return resolvedCandidate;
  if (isVisibleThreadId(candidate)) return candidate;

  // A renderer patch can briefly leave a retired local id on the visible
  // composer after its task has been promoted. Falling back to the active task
  // prevents that retired id from being promoted into a second task.
  return active || candidate;
}
