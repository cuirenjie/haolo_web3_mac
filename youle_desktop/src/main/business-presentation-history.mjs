import { businessPresentationItems } from "../shared/codex-business-presentation.mjs";

// Tool output is model context: code-mode can wrap/truncate it and thread/read
// can omit it entirely. Delivered artifacts are the independent UI source of
// truth. Reading history must never rerun analysis, drawing or plan activation.
export async function withBusinessPresentationHistory(result, { artifacts, owner, currentOwner = () => owner } = {}) {
  const thread = result?.thread;
  if (!thread?.id || !Array.isArray(thread.turns) || !owner || owner === "anonymous") return result;
  const presentations = await artifacts.presentations(owner, thread.id);
  if (currentOwner() !== owner || !presentations.length) return result;
  const seen = new Set(thread.turns.flatMap(turn => (turn.items || [])
    .flatMap(item => [item, ...businessPresentationItems(item)]).map(item => item.id)));
  const missing = presentations.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).sort((a, b) => timestamp(a.createdAt || a.created_at) - timestamp(b.createdAt || b.created_at));
  if (!missing.length) return result;
  const turns = thread.turns.map(turn => ({ ...turn, items: [...(turn.items || [])] }));
  for (const item of missing) {
    const turnId = item.turnId || item.turn_id || `haolo-business-presentation-${item.id}`;
    let turn = turns.find(candidate => (candidate.id || candidate.turnId || candidate.turn_id) === turnId);
    if (!turn) {
      turn = { id: turnId, status: "completed", startedAt: item.createdAt || item.created_at,
        items: [], __haoloBusinessPresentation: true };
      const next = turns.findIndex(candidate => timestamp(candidate.startedAt || candidate.createdAt) > timestamp(turn.startedAt));
      turns.splice(next < 0 ? turns.length : next, 0, turn);
    }
    // Keep the actual final answer after its card. NativeResponseComplete=false
    // is preserved: a displayed plan does not finish the root assistant turn.
    const next = turn.items.findIndex(candidate => candidate.type === "agentMessage"
      && !candidate.__youleExecutionPlanPresentation && candidate.phase === "final_answer");
    turn.items.splice(next < 0 ? turn.items.length : next, 0, { ...item, turnId });
  }
  return { ...result, thread: { ...thread, turns } };
}

function timestamp(value) {
  const parsed = typeof value === "number" ? value : Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}
