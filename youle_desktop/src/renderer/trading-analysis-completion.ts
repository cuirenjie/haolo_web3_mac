type AnalysisItem = {
  id?: string;
  type?: string;
  phase?: string;
  message_phase?: string;
  messagePhase?: string;
  turnId?: string | null;
  turn_id?: string | null;
  text?: string;
  createdAt?: string | number | null;
  created_at?: string | number | null;
  __youleExecutionPlanPresentation?: string | null;
  __youleNativeResponseComplete?: boolean;
  attachments?: unknown[];
  actions?: unknown[];
};

export function isCompletedTradingAnalysisReport(item: AnalysisItem | undefined) {
  return Boolean(
    item?.type === "agentMessage"
    && (item.phase || item.message_phase || item.messagePhase) === "final_answer"
    && ["execution-plan", "position-plan"].includes(item.__youleExecutionPlanPresentation || "")
    && item.text?.trim(),
  );
}

// Legacy reports may have completed the response. New supporting artifacts
// carry complete=false and keep the root's substantive final answer visible.
export function completedTradingAnalysisReport(
  items: Array<AnalysisItem | undefined>,
  responseId: string | null | undefined,
) {
  if (!responseId) return null;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isCompletedTradingAnalysisReport(item) && (item?.turnId || item?.turn_id) === responseId) {
      return item!.__youleNativeResponseComplete === false ? null : item!;
    }
  }
  return null;
}

// Preserve legacy transcript projection without deleting underlying messages.
// New cards explicitly keep the root's answer visible as plain text, so model
// prose is not parsed into a second executable plan.
export function tradingAnalysisDeliveryItems<T extends AnalysisItem>(items: T[]): T[] {
  const reports = new Map<string, { index: number; complete: boolean }>();
  items.forEach((item, index) => {
    const turnId = item.turnId || item.turn_id;
    if (turnId && isCompletedTradingAnalysisReport(item)) {
      reports.set(turnId, { index, complete: item.__youleNativeResponseComplete !== false });
    }
  });
  const delivered = items.flatMap((item, index) => {
    const report = reports.get(item.turnId || item.turn_id || "");
    if (!report || item.type !== "agentMessage" || item.__youleExecutionPlanPresentation) return [item];
    const phase = item.phase || item.message_phase || item.messagePhase;
    if (report.complete && index > report.index && phase !== "commentary"
      && !item.attachments?.length && !item.actions?.length) return [];
    return [{ ...item, __youleExecutionPlanPresentation: "plain" }];
  });
  return answersAfterTradingPlans(delivered);
}

// Native cards can arrive after the root answer (including partial history
// hydration). Order the display, not the persisted transcript or timestamps.
function answersAfterTradingPlans<T extends AnalysisItem>(items: T[]): T[] {
  let segment = 0;
  let previousTurn: string | null = null;
  const segments = items.map(item => {
    const turn = item.turnId || item.turn_id || null;
    if (item.type === "userMessage" || (turn && previousTurn && turn !== previousTurn)) segment += 1;
    if (item.type === "userMessage") previousTurn = null;
    else if (turn) previousTurn = turn;
    return `${segment}:${turn || ""}`;
  });
  const lastReport = new Map<string, number>();
  items.forEach((item, index) => {
    if ((item.turnId || item.turn_id) && isCompletedTradingAnalysisReport(item)) {
      lastReport.set(segments[index], index);
    }
  });
  const deferred = new Map<number, T[]>();
  const ordered: T[] = [];
  items.forEach((item, index) => {
    const reportIndex = lastReport.get(segments[index]);
    const phase = item.phase || item.message_phase || item.messagePhase;
    if (reportIndex != null && index < reportIndex && item.type === "agentMessage"
      && phase === "final_answer" && !isCompletedTradingAnalysisReport(item)) {
      const answers = deferred.get(reportIndex) || [];
      answers.push(item);
      deferred.set(reportIndex, answers);
    } else {
      ordered.push(item);
    }
    ordered.push(...(deferred.get(index) || []));
  });
  return ordered;
}
