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
    try { this.state = normalizeAnalysisModelRecoveryState(JSON.parse(fs.readFileSync(filePath, "utf8"))); }
    catch (error) { if (error?.code !== "ENOENT") this.reportError(error); }
  }

  snapshot() { return this.state ? { ...this.state } : null; }
  select(modelId) { return analysisModelPolicySelection(this.state, modelId, this.now()); }

  activate(failedModelId) {
    // Backup failures and ordinary backup traffic must not postpone the next
    // primary attempt. A new primary failure after expiry starts a new window.
    const model = String(failedModelId || "").toLowerCase();
    if (!model.startsWith("gpt-") || model === ANALYSIS_RECOVERY_MODEL) return false;
    const now = this.now();
    if (this.state && now < this.state.fallbackUntil) return false;
    this.state = { version: 1, activatedAt: now, fallbackUntil: now + ANALYSIS_RECOVERY_WINDOW_MS };
    const temporaryPath = `${this.filePath}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(temporaryPath, JSON.stringify(this.state), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) { this.reportError(error); }
    try { this.onChange(this.snapshot()); } catch { /* Observers cannot break recovery. */ }
    return true;
  }

  reportError(error) {
    try { this.onError(error); } catch { /* Logging cannot break recovery. */ }
  }
}
