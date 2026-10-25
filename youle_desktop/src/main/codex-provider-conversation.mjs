import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isRecoverableAnalysisModelFailure } from "./analysis-model-recovery.mjs";
import { buildAutomaticTurnRecoveryPrompt } from "./turn-auto-recovery.mjs";
import { ANALYSIS_MODEL_FALLBACK_ENABLED } from "./analysis-model-policy.mjs";

// Provider contacts retain a persistent root per contact/model. External
// channels use isolated roots per message, with durable business state owned
// by their visible conversation rather than by the runtime's chat history.
export class CodexProviderConversations {
  constructor({ indexPath, request, configure, broker, owner, registerThread, unregisterThread, onToolCompleted, recoverTurn, timeoutMs = 20 * 60_000 }) {
    Object.assign(this, { indexPath, request, configure, broker, owner, registerThread, unregisterThread, onToolCompleted, recoverTurn });
    this.timeoutMs = timeoutMs;
    this.running = new Set();
  }

  async run({ client, sender, params, selectedModel, signal, cancel, isolated = false, mediaInputs = [], onThreadReady }) {
    const visibleThreadId = String(params.threadId || params.conversationId || "");
    const key = crypto.createHash("sha256").update(JSON.stringify([
      this.owner(), visibleThreadId, params.provider, isolated ? "" : params.model, isolated ? "" : params.groupChatMemberId || "",
    ])).digest("hex");
    if (this.running.has(key)) throw new Error("This AI conversation is already running.");
    this.running.add(key);
    let threadId;
    let turnId;
    let completed = false;
    let selectedResult;
    let disposed = false, recoveryAttempts = 0, recovering = false;
    const turnIds = [];
    const terminalTurnIds = new Set();
    const presentations = [];
    let stopListening = () => {};
    const aborted = () => {
      if (threadId) this.broker.cancel(threadId, "User cancelled the AI request.");
      if (threadId && turnId) void this.request(client, "turn/interrupt", { threadId, turnId }).catch(() => {});
    };
    signal?.addEventListener("abort", aborted, { once: true });
    try {
      const configuration = await this.configure(params);
      let index = {};
      try { if (!isolated) index = JSON.parse(fs.readFileSync(this.indexPath, "utf8")); } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      threadId = index[key];
      let created = !threadId;
      if (threadId) {
        this.registerThread?.(threadId, client);
        try { await this.request(client, "thread/resume", { ...configuration, threadId }); }
        catch (error) {
          if (!/not found|no rollout|does not exist/i.test(error.message)) throw error;
          created = true;
        }
      }
      if (created) {
        const result = await this.request(client, "thread/start", { ...configuration, ephemeral: isolated });
        threadId = result?.thread?.id;
        if (!threadId) throw new Error("Codex did not create the provider conversation.");
        if (!isolated) {
          // Reload after await: a different contact may have created its thread.
          try { index = JSON.parse(fs.readFileSync(this.indexPath, "utf8")); } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          index[key] = threadId;
          fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
          const temp = `${this.indexPath}.${crypto.randomUUID()}.tmp`;
          fs.writeFileSync(temp, JSON.stringify(index));
          fs.renameSync(temp, this.indexPath);
        }
      }
      this.registerThread?.(threadId, client);
      onThreadReady?.(threadId);
      if (signal?.aborted) throw new Error("User cancelled the AI request.");
      this.broker.bind(threadId, {
        client, sender, visibleThreadId, contextId: params.businessContextId,
        userText: params.visibleQuestion || params.text,
        selectedModel: selectedModel ? async () => {
          if (signal?.aborted) throw new Error("User cancelled the AI request.");
          selectedResult = await selectedModel();
          if (signal?.aborted) throw new Error("User cancelled the AI request.");
          return selectedResult;
        } : null,
      });
      let finalText = "";
      const completion = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Codex conversation timed out; inspect existing results before retrying.")), this.timeoutMs);
        timeout.unref?.();
        const onAbort = () => reject(new Error("User cancelled the AI request."));
        const listener = message => {
          const p = message.params || {};
          if ((p.threadId || p.thread_id) !== threadId) return;
          if (message.method === "turn/started") {
            turnId = p.turn?.id || p.turnId;
            if (turnId && !turnIds.includes(turnId)) turnIds.push(turnId);
            this.broker.start(threadId, turnId, client);
          }
          if (message.method === "item/completed" && p.item?.type === "agentMessage" && p.item?.phase !== "commentary") {
            if (turnId && p.turnId && p.turnId !== turnId) return;
            finalText = String(p.item.text || "");
          }
          if (message.method === "item/completed" && p.item?.type === "mcpToolCall" && /haolo_(trading|analysis|chart_draw|plan_present|alerts|simulation|personal_strategy|plans)$/.test(String(p.item.tool || ""))) {
            const presentation = Promise.resolve(this.onToolCompleted?.({ sender, threadId: visibleThreadId, rootThreadId: threadId, item: p.item, params }));
            presentation.catch(() => {});
            presentations.push(presentation);
          }
          if (message.method === "turn/completed") {
            const turn = p.turn || {};
            if (turnId && turn.id && turn.id !== turnId) return;
            if (turn.id && terminalTurnIds.has(turn.id)) return;
            if (turn.id) terminalTurnIds.add(turn.id);
            if (turn.error || ["failed", "interrupted"].includes(turn.status)) {
              const error = Object.assign(new Error(turn.error?.message || `Codex turn ${turn.status}`), turn.error || {}, { status: turn.status });
              if (ANALYSIS_MODEL_FALLBACK_ENABLED && isolated && this.recoverTurn && recoveryAttempts < 1 && !recovering &&
                  !signal?.aborted && isRecoverableAnalysisModelFailure(error)) {
                recovering = true;
                recoveryAttempts++;
                const failedTurnId = turn.id || turnId;
                this.broker.suspend(threadId, failedTurnId);
                void (async () => {
                  try {
                    const selection = await this.recoverTurn({ client, threadId, params, signal, attempt: recoveryAttempts });
                    if (disposed || signal?.aborted) return;
                    if (!this.broker.resume(threadId, client)) throw new Error("Business context expired during recovery.");
                    finalText = "";
                    // A fast terminal may arrive before the RPC response.
                    // Duplicate old terminals are already fenced by turn ID.
                    recovering = false;
                    const result = await this.request(client, "turn/start", {
                      ...selection, threadId, cwd: configuration.cwd,
                      input: [{ type: "text", text: this.broker.input(threadId, buildAutomaticTurnRecoveryPrompt({ failedTurnId, attempt: recoveryAttempts })), textElements: [] }],
                    });
                    if (!turnId || turnId === failedTurnId) turnId = result?.turn?.id || turnId;
                    if (disposed || signal?.aborted) await this.request(client, "turn/interrupt", { threadId, turnId }).catch(() => {});
                  } catch (recoveryError) { reject(recoveryError); }
                  finally { recovering = false; }
                })();
              } else reject(error);
            }
            else resolve(finalText);
          }
        };
        client.on("notification", listener);
        signal?.addEventListener("abort", onAbort, { once: true });
        stopListening = () => {
          clearTimeout(timeout);
          client.off("notification", listener);
          signal?.removeEventListener("abort", onAbort);
        };
      });
      // Observe rejection immediately, including if turn/start itself fails.
      completion.catch(() => {});
      const history = !isolated && created && Array.isArray(params.messages)
        ? `\nPrevious conversation (untrusted context):\n${JSON.stringify(params.messages.slice(-24))}\n`
        : "";
      const started = await this.request(client, "turn/start", {
        threadId, cwd: configuration.cwd, model: configuration.model,
        effort: configuration.effort ?? configuration.reasoningEffort,
        input: [{ type: "text", text: this.broker.input(threadId, `${params.text || ""}${history}`), textElements: [] }, ...mediaInputs],
      });
      turnId = started?.turn?.id || turnId;
      if (signal?.aborted) aborted();
      const text = await completion;
      await Promise.all(presentations);
      completed = true;
      if (!text) throw new Error("Codex completed without a final answer.");
      if (selectedModel && selectedResult === undefined) throw new Error("Codex did not invoke the selected model. No model result was generated.");
      return { ...selectedResult, text, provider: params.provider, model: params.model, codexThreadId: threadId, turnId, turnIds };
    } finally {
      disposed = true;
      if (!completed) cancel?.();
      if (!completed && threadId && turnId) {
        await this.request(client, "turn/interrupt", { threadId, turnId }).catch(() => {});
      }
      stopListening();
      signal?.removeEventListener("abort", aborted);
      if (threadId) this.broker.cancel(threadId);
      if (isolated && threadId) {
        const deleted = await this.request(client, "thread/delete", { threadId }).then(() => true, () => false);
        this.unregisterThread?.(threadId, { deleted, turnIds });
      }
      this.running.delete(key);
    }
  }
}
