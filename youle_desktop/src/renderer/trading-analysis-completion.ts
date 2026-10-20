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

// A final native report is the analysis deliverable. Codex may still be
// acknowledging the tool result or writing a short closing sentence.
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

// Project the transcript without deleting the underlying model messages. Once
// the native response is delivered, its same-turn closing text must not replace
// it with another streaming answer. Explicit remaining work and attachments
// still surface, but cannot be parsed into a second plan from model prose.
export function tradingAnalysisDeliveryItems<T extends AnalysisItem>(items: T[]): T[] {
  const reports = new Map<string, { index: number; complete: boolean }>();
  items.forEach((item, index) => {
    const turnId = item.turnId || item.turn_id;
    if (turnId && isCompletedTradingAnalysisReport(item)) {
      reports.set(turnId, { index, complete: item.__youleNativeResponseComplete !== false });
    }
  });
  return items.flatMap((item, index) => {
    const report = reports.get(item.turnId || item.turn_id || "");
    if (!report || item.type !== "agentMessage" || item.__youleExecutionPlanPresentation) return [item];
    const phase = item.phase || item.message_phase || item.messagePhase;
    if (report.complete && index > report.index && phase !== "commentary"
      && !item.attachments?.length && !item.actions?.length) return [];
    return [{ ...item, __youleExecutionPlanPresentation: "plain" }];
  });
}
