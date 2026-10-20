// Stateful business operations stay in Host. Skills may choose steps, but may
// neither supply drafts/results nor turn a model-authored approval into consent.
export async function executeTradingWorkflow({ args, context, thread, artifacts, execute, assertActive }) {
  const kind = args.action === "alert_step" ? "alert" : args.action === "personal_step" ? "personal" : null;
  if (args.action === "plan_manage") return execute(args);
  if (kind && args.operation === "list" || kind === "alert" && ["pause", "resume", "delete"].includes(args.operation)) {
    return execute({ ...args, kind });
  }
  if (kind && args.operation === "cancel" && !args.draftRef) {
    // Also works while a draft is still collecting information, or after a
    // failed revision invalidated its old reference.
    await artifacts.currentDraft(context.owner, thread, kind, null);
    assertActive();
    return execute({ action: "draft_cancel", kind });
  }
  if (kind && args.operation === "prepare") {
    await artifacts.currentDraft(context.owner, thread, kind, null);
    assertActive();
    const result = await execute({ action: "draft_prepare", kind });
    assertActive();
    if (result?.result?.kind !== kind || !result.result.prepared) return result;
    const draftRef = await artifacts.put(context.owner, thread, result.result, { kind, stage: "prepared" });
    assertActive();
    await artifacts.currentDraft(context.owner, thread, kind, draftRef);
    return { draftRef, stage: "prepared", summary: result.result.summary,
      presentationItems: result.presentationItems, next: ["haolo_simulation", "haolo_chart_draw"] };
  }
  const record = await artifacts.get(context.owner, thread, args.draftRef);
  assertActive();
  const draftKind = record.metadata.kind;
  if (!["alert", "personal"].includes(draftKind) || kind && kind !== draftKind) throw new Error("Draft type does not match this tool.");
  const current = await artifacts.currentDraft(context.owner, thread, draftKind);
  if (record.effects.confirm && args.operation === "confirm" && (!current || current === record.ref)) return record.effects.confirm;
  if (current !== record.ref) throw new Error("This draft was replaced or cancelled. Prepare and simulate the current conditions again.");
  assertActive();
  if (args.operation === "cancel") {
    await artifacts.currentDraft(context.owner, thread, draftKind, null);
    assertActive();
    return execute({ action: "draft_cancel", kind: draftKind });
  }
  if (args.action === "simulate") {
    if (record.simulation) return { draftRef: record.ref, stage: "simulated", next: ["haolo_chart_draw"] };
    const result = await execute({ action: "simulate", kind: draftKind, artifact: record.result });
    assertActive();
    if (!result?.result?.simulation?.simulationId) throw new Error("Simulation did not complete; confirmation is unavailable.");
    record.simulation = result.result;
    record.metadata.stage = "simulated";
    await artifacts.save(record);
    return { draftRef: record.ref, stage: "simulated", summary: result.result.summary,
      presentationItems: result.presentationItems, next: ["haolo_chart_draw"] };
  }
  if (args.action === "draw") {
    if (!record.simulation) throw new Error("Run haolo_simulation before drawing this draft.");
    const result = await execute({ action: "simulation_draw", kind: draftKind, artifact: record.result, simulation: record.simulation });
    assertActive();
    if (result?.result?.previewed !== true) return result;
    if (!record.effects.preview) {
      record.metadata.previewTurn = context.userTurnId;
      record.metadata.previewText = context.userText;
    }
    record.effects.preview = result;
    record.metadata.stage = "awaiting_confirmation";
    await artifacts.save(record);
    return { ...result, draftRef: record.ref, stage: "awaiting_confirmation", waitForUser: true };
  }
  if (args.operation === "confirm") {
    if (!record.simulation || !record.effects.preview) throw new Error("Simulate and show the current draft before requesting user confirmation.");
    if (record.metadata.previewTurn === context.userTurnId || record.metadata.previewText === context.userText) {
      throw new Error("Wait for a new user reply after the simulation preview. Approval cannot be supplied by a model.");
    }
    const result = await execute({ action: "draft_confirm", kind: draftKind, artifact: record.result, simulation: record.simulation });
    assertActive();
    if (result?.result?.confirmed === true) {
      record.effects.confirm = result;
      record.metadata.stage = "completed";
      await artifacts.save(record);
      await artifacts.currentDraft(context.owner, thread, draftKind, null);
    } else if (result?.result?.cancelled === true || result?.result?.needsRevision === true) {
      // Semantic rejection/revision is authoritative even if Codex selected
      // confirm. A later reply must never revive the cancelled/old simulation.
      record.metadata.stage = result.result.cancelled ? "cancelled" : "revision_required";
      await artifacts.save(record);
      await artifacts.currentDraft(context.owner, thread, draftKind, null);
    }
    return result;
  }
  throw new Error("Unsupported draft operation.");
}
