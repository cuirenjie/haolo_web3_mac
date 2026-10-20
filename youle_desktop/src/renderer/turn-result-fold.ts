type TurnOutputItem = {
  phase?: string;
  message_phase?: string;
  messagePhase?: string;
  attachments?: unknown[];
  actions?: unknown[];
  __youleExecutionPlanPresentation?: string | null;
};

const phaseOf = (item?: TurnOutputItem) => item?.phase || item?.message_phase || item?.messagePhase;

// History hydration can append an earlier tool's progress after the report.
// Arrival order must not promote that commentary into the final deliverable.
export function turnResultFoldTargets(
  outputIndexes: number[],
  itemAt: (index: number) => TurnOutputItem | undefined,
) {
  const finalIndex = [...outputIndexes].reverse().find(index => phaseOf(itemAt(index)) === "final_answer")
    ?? outputIndexes.at(-1)!;
  const lateProcessIndexes = outputIndexes.filter(index => {
    if (index <= finalIndex) return false;
    const item = itemAt(index);
    return phaseOf(item) === "commentary"
      && !["execution-plan", "position-plan"].includes(item?.__youleExecutionPlanPresentation || "")
      && !item?.attachments?.length && !item?.actions?.length;
  });
  return { finalIndex, lateProcessIndexes };
}
