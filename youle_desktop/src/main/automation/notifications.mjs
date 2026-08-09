export function shouldNotifyRun(run, job) {
  if (!run || job?.deliveryMode !== "notification") return false;
  return isActionableRun(run);
}

export function isActionableRun(run) {
  if (!run) return false;
  if (["failed", "timed_out", "needs_attention"].includes(run.status)) return true;
  return run.status === "success" && (Boolean(run.hasPatch) || Boolean(run.hasFindings));
}

export function notificationTitleForRun(run, job) {
  const name = job?.name || "Automation";
  if (run.status === "failed") return `${name} failed`;
  if (run.status === "timed_out") return `${name} timed out`;
  if (run.hasPatch) return `${name} produced changes`;
  return `${name} needs review`;
}

export function notificationBodyForRun(run) {
  return run.summary || run.errorMessage || "Open Automations to review this run.";
}
