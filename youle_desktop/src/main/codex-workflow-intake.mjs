// Keep frozen canvas topology immutable while ensuring its user input reaches
// root Codex before any provider or canvas node starts.
export function workflowCodexIntakeHooks({ run, release }, params) {
  return {
    beforeExecution: async ({ signal }) => {
      const result = await run({
        signal,
        params: {
          ...params, provider: "workflow-intake",
          visibleQuestion: params.visibleQuestion || params.prompt,
          text: [
            "Process this user input before its selected Haolo workflow starts.",
            "For trading requests, load trading-expert and perform the required business analysis/workflow using Host tools. Preserve all user constraints.",
            "For other requests, prepare a concise handoff without executing the canvas task here.",
            "Do not rewrite the selected canvas or run its nodes. Its existing executor will run after you finish.",
            "If a business tool asks for clarification or approval, stop and return ready=false. Never invent approval.",
            'Return only JSON: {"ready":true,"context":"Verified results and constraints for downstream nodes"}. Use ready=false with the question/reason in context when input is required.',
            `User input:\n${params.prompt || ""}`,
          ].join("\n\n"),
        },
      });
      const value = JSON.parse(String(result?.text || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
      if (value.ready !== true) throw new Error(value.context || "Codex requires more input before starting this workflow.");
      return { text: String(value.context || "") };
    },
    onExecutionFinished: release,
  };
}
