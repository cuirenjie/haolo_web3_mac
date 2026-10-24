import fs from "node:fs";
import path from "node:path";
import {
  ANALYSIS_RECOVERY_MODEL, ANALYSIS_RECOVERY_WINDOW_MS,
  analysisModelPolicySelection, normalizeAnalysisModelRecoveryState,
} from "./analysis-model-policy.mjs";

export class AnalysisModelRecoveryStore {
  constructor({ filePath, now = Date.now, onChange = () => {}, onError = () => {} }) {
    this.filePath = filePath;
    this.now = now;
    this.onChange = onChange;
    this.onError = onError;
    this.state = null;
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
      this.state = normalizeAnalysisModelRecoveryState(saved);
      if (this.state && this.state.fallbackUntil !== saved.fallbackUntil) this.persistState();
    }
    catch (error) { if (error?.code !== "ENOENT") this.reportError(error); }
  }

  snapshot() { return this.state ? { ...this.state } : null; }
  select(modelId) { return analysisModelPolicySelection(this.state, modelId, this.now()); }

  activate(_failedModelId) {
    // A failed DeepSeek request never opens a GPT cooldown window.
    return false;
  }

  persistState() {
    const temporaryPath = `${this.filePath}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(temporaryPath, JSON.stringify(this.state), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) { this.reportError(error); }
  }

  reportError(error) {
    try { this.onError(error); } catch { /* Logging cannot break recovery. */ }
  }
}
