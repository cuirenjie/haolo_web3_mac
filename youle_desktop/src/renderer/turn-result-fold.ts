type TurnOutputItem = {
  phase?: string;
  message_phase?: string;
  messagePhase?: string;
  attachments?: unknown[];
  actions?: unknown[];
  __youleExecutionPlanPresentation?: string | null;
};

const phaseOf = (item?: TurnOutputItem) => item?.phase || item?.message_phase || item?.messagePhase;
const isPlan = (item?: TurnOutputItem) => ["execution-plan", "position-plan"].includes(item?.__youleExecutionPlanPresentation || "");

// History hydration can append an earlier tool's progress after the report.
// Arrival order must not promote that commentary into the final deliverable.
export function turnResultFoldTargets(
  outputIndexes: number[],
  itemAt: (index: number) => TurnOutputItem | undefined,
) {
  const finalAnswers = outputIndexes.filter(index => phaseOf(itemAt(index)) === "final_answer");
  const finalIndex = [...finalAnswers].reverse().find(index => !isPlan(itemAt(index)))
    ?? finalAnswers.at(-1)
    ?? outputIndexes.at(-1)!;
  // The processed entry precedes every answer in a trading response. The
  // direct root answer remains the last deliverable, below reports and cards.
  const headerIndex = finalAnswers.some(index => isPlan(itemAt(index)))
    ? finalAnswers[0] : finalIndex;
  const lateProcessIndexes = outputIndexes.filter(index => {
    if (index <= finalIndex) return false;
    const item = itemAt(index);
    return phaseOf(item) === "commentary"
      && !["execution-plan", "position-plan"].includes(item?.__youleExecutionPlanPresentation || "")
      && !item?.attachments?.length && !item?.actions?.length;
  });
  return { finalIndex, headerIndex, lateProcessIndexes };
}
