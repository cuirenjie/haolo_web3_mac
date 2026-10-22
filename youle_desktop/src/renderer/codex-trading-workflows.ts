type Dependencies = {
  api: any;
  alertData: (response: any) => any;
  isForeground: (thread: string) => boolean;
  presentSimulation?: (thread: string) => Promise<boolean>;
  showSimulation: (simulation: any, anchor: string, rule?: any) => void;
  clearSimulation: () => void;
  setPending: (thread: string, kind: string, pending: any) => void;
  append: (thread: string, text: string) => Promise<unknown>;
  prepare: (thread: string, kind: string, text: string, context: any) => Promise<any>;
  confirm: (thread: string, kind: string, text: string, context: any) => Promise<any>;
  confirmDelete: (kind: string) => Promise<boolean>;
  refreshAlerts: () => Promise<unknown>;
  refreshPlans: () => Promise<unknown>;
};

// Artifacts here come only from the authenticated Host reference store.
// No raw draft, simulation or plan content is accepted from Codex arguments.
export class CodexTradingWorkflowSteps {
  constructor(private deps: Dependencies) {}

  async run(thread: string, args: any, text: string, context: any, signal: AbortSignal) {
    const active = () => { if (signal.aborted) throw new Error("Trading workflow cancelled."); };
    const { api } = this.deps;
    active();
    if (args.action === "draft_prepare") return this.deps.prepare(thread, args.kind, text, context);
    if (args.action === "draft_confirm") {
      this.deps.setPending(thread, args.kind, args.simulation.pending);
      return this.deps.confirm(thread, args.kind, text, context);
    }
    if (args.action === "draft_cancel") {
      this.deps.setPending(thread, args.kind, null);
      if (this.deps.isForeground(thread)) this.deps.clearSimulation();
      await this.deps.append(thread, "已清除本次待确认草稿和模拟图层。");
      return { cancelled: true };
    }
    if (args.action === "simulate") {
      const prepared = args.artifact;
      if (!prepared?.prepared || prepared.kind !== args.kind) throw new Error("Invalid prepared draft.");
      const result = args.kind === "alert"
        ? this.deps.alertData(await api.tradingAlertsSimulate(prepared.simulationInput))
        : await api.simulatePersonalStrategy(prepared.simulationInput);
      active();
      if (result?.ok === false || !result?.simulation?.simulationId) throw new Error(result?.error?.message || "Simulation failed.");
      const simulation = result.simulation;
      const summary = args.kind === "alert"
        ? String(result.question || "模拟已完成，是否按这种情况创建预警？")
        : `${prepared.summary}\n\n预演结果：\n${String(simulation.report || "已完成规则预演")}\n\n这是规则理解演示，不代表收益回测或未来预测。`;
      const pending = { ...prepared.pending, stage: "confirmation", simulationId: simulation.simulationId,
        ...(args.kind === "alert" ? { confirmationId: simulation.confirmation?.confirmationId } : {}),
        conversation: [...prepared.pending.conversation, { role: "assistant", text: summary }].slice(-32) };
      // The pending confirmation becomes available only after the preview step.
      return { simulation, pending, summary };
    }
    if (args.action === "simulation_draw") {
      if (!this.deps.isForeground(thread)) return { previewed: false, reason: "Open the originating conversation to view its simulation before confirming." };
      const prepared = args.artifact;
      this.deps.showSimulation(args.simulation.simulation,
        args.kind === "alert" ? prepared.rule.evaluationPolicy.anchorContextId : "primary",
        args.kind === "alert" ? prepared.rule : undefined);
      active();
      if (this.deps.presentSimulation && !await this.deps.presentSimulation(thread)) {
        return { previewed: false, reason: "Simulation image is unavailable; retry the preview before confirming." };
      }
      active();
      const question = `${args.simulation.summary}\n\n请核对模拟 K 线与文字条件。明确表示接受当前模拟后才会${args.kind === "alert" ? "创建监控" : "启用策略"}；也可以取消，或直接说明需要修改的条件。`;
      await this.deps.append(thread, question);
      active();
      this.deps.setPending(thread, args.kind, args.simulation.pending);
      return { previewed: true, question };
    }
    if (args.action === "alert_step") {
      const snapshot = this.deps.alertData(await api.tradingAlertsSnapshot());
      active();
      if (args.operation === "list") return snapshot;
      if (!snapshot?.alerts?.some((alert: any) => alert.alertId === args.alertId)) throw new Error("Alert is unavailable in the current account.");
      if (args.operation === "delete" && !await this.deps.confirmDelete("alert")) return { cancelled: true };
      active();
      const call = args.operation === "pause" ? api.tradingAlertsPause : args.operation === "resume" ? api.tradingAlertsResume : api.tradingAlertsDelete;
      if (!call) throw new Error("Alert operation unavailable.");
      const result = this.deps.alertData(await call({ alertId: args.alertId }));
      active();
      await this.deps.refreshAlerts();
      return result;
    }
    if (args.action === "personal_step" && args.operation === "list") {
      const result = await api.listPersonalStrategies({ includeDrafts: false });
      active();
      if (result?.ok === false) throw new Error(result.error?.message || "Unable to read strategies.");
      return result;
    }
    if (args.action === "plan_manage") {
      if (!api.tradingCloudPlans) throw new Error("Cloud plans unavailable.");
      if (args.operation === "list") return api.tradingCloudPlans("list");
      const read = await api.tradingCloudPlans("read", { planId: args.planId });
      active();
      if (read?.ok === false || !read?.plan || read.plan.id !== args.planId) throw new Error(read?.error?.message || "Owned plan unavailable.");
      if (args.operation === "read") return read;
      if (args.operation === "delete" && !await this.deps.confirmDelete("plan")) return { cancelled: true };
      active();
      const mutate = async (action: string, plan: any) => {
        active();
        const result = await api.tradingCloudPlans(action, {
          planId: plan.id, runId: plan.runId, version: plan.version,
          confirmationHash: plan.confirmationHash, conditionHash: plan.scenario?.conditionHash,
          ...(action === "lifecycle" ? { status: "ended", endReason: args.endReason || "cancelled" } : {}),
        });
        active();
        if (result?.ok === false) throw new Error(result.error?.message || "Plan operation failed.");
        return result;
      };
      let result = await mutate(args.operation === "add" ? "save" : args.operation === "end" ? "lifecycle" : args.operation, read.plan);
      if (args.operation === "add") {
        if (!result?.plan) throw new Error("Missing saved plan receipt; activation stopped.");
        result = await mutate("activate", result.plan);
      }
      await this.deps.refreshPlans();
      return result;
    }
    throw new Error("Unsupported trading capability.");
  }
}
