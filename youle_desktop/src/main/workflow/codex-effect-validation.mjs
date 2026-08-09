export function unresolvedWorkflowEffectFailures(effects = []) {
  const list = Array.isArray(effects) ? effects.filter((effect) => effect && typeof effect === "object") : [];
  const unresolved = [];

  for (let index = 0; index < list.length; index += 1) {
    const effect = list[index];
    if (!effectFailed(effect)) continue;
    if (effect.type === "fileChange" && !laterFileChangeRecovered(list, index, effect)) {
      unresolved.push(effect);
    }
  }

  const lastEffect = list.at(-1);
  if (lastEffect && effectFailed(lastEffect) && !unresolved.includes(lastEffect)) {
    unresolved.push(lastEffect);
  }
  return unresolved;
}

export function workflowEffectFailureEnvelope(effects = []) {
  const unresolved = unresolvedWorkflowEffectFailures(effects);
  if (!unresolved.length) return null;
  const first = unresolved[0];
  const detail = first.summary || first.command || first.type || "未知操作";
  return {
    code: "CODEX_SUBAGENT_EFFECT_FAILED",
    category: "execution",
    retryable: false,
    message: `Haolo 子 Agent 存在未恢复的失败操作：${boundedText(detail, 300)}`,
    failedEffects: unresolved,
  };
}

function laterFileChangeRecovered(effects, failedIndex, failedEffect) {
  const failedPaths = normalizedPaths(failedEffect.paths);
  return effects.slice(failedIndex + 1).some((effect) => {
    if (effect?.type !== "fileChange" || effectFailed(effect)) return false;
    if (!failedPaths.length) return true;
    const succeededPaths = new Set(normalizedPaths(effect.paths));
    return failedPaths.every((filePath) => succeededPaths.has(filePath));
  });
}

function effectFailed(effect) {
  return String(effect?.status || "").trim().toLowerCase() === "failed";
}

function normalizedPaths(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);
}

function boundedText(value, limit) {
  const text = String(value || "").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
