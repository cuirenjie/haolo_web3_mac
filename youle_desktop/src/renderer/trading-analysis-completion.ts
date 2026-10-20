type AnalysisItem = {
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
    if (isCompletedTradingAnalysisReport(item) && (item?.turnId || item?.turn_id) === responseId) return item!;
  }
  return null;
}
