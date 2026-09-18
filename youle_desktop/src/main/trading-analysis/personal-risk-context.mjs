// An unreadable profile is different from an account with no saved rules.
// Keep the encrypted store fail-closed while allowing market-only analysis.
const RECOVERABLE_MEMORY_CODES = new Set([
  "SECURE_STORAGE_UNAVAILABLE", "MEMORY_DECRYPT_FAILED", "MEMORY_STORE_INVALID",
]);
const readOnlyRegistries = new WeakSet();

export function personalRiskUnavailable(params) {
  return params?.userRiskProfile?.availability === "unavailable";
}

export function personalRiskUnavailableNotice(language = "zh-CN") {
  return language === "en"
    ? "Saved trading preferences could not be read. Market analysis and chart annotations remain available; personal position sizing and executable plans are paused. Check system secure-storage access, restart the app, then analyze again. Your saved preferences have not been changed."
    : "暂时无法读取已保存的交易偏好。本次继续分析盘面和绘图，暂停个人仓位测算与可执行计划。请检查系统安全存储访问权限，重启应用后重新分析；原有偏好未被修改。";
}

export async function withPersonalTradingRisk(params, { ownerId, memoryStore, onUnavailable } = {}) {
  try {
    const userRiskProfile = await memoryStore.tradingRiskProfile(ownerId);
    return { ...params, userRiskProfile };
  } catch (error) {
    if (!RECOVERABLE_MEMORY_CODES.has(String(error?.code || ""))) throw error;
    // Do not reuse another turn/account's profile or persist an empty one.
    const userRiskProfile = Object.freeze({ availability: "unavailable", entries: Object.freeze([]) });
    try { await onUnavailable?.(error); } catch { /* Optional diagnostics must not block analysis. */ }
    return { ...params, userRiskProfile };
  }
}

export function personalRiskModelRegistry(registry, params) {
  if (!personalRiskUnavailable(params) || readOnlyRegistries.has(registry)) return registry;
  const wrapped = {
    ...registry,
    analyze(providerId, request, options) {
      return registry.analyze(providerId, {
        ...request,
        prompt: `${request.prompt}\n\nHOST PERSONAL-RISK AVAILABILITY: unavailable. Saved user risk constraints could not be read; this is NOT an empty profile. Review the supplied market evidence and conditional price levels normally. Do not claim a saved/default risk rule applies, recommend personal order quantities, leverage or account position changes, or present a plan as executable. Answer position-management questions with market evidence and explain that personal risk validation is unavailable. Keep the required response schema and language.`,
      }, options);
    },
  };
  readOnlyRegistries.add(wrapped);
  return wrapped;
}

export function withPersonalRiskNotice(result, params) {
  if (!personalRiskUnavailable(params) || result?.ok === false || !result?.analysisPlan) return result;
  const notice = personalRiskUnavailableNotice(params.language);
  const prefix = value => String(value || "").startsWith(notice) ? value : `${notice}\n\n${String(value || "")}`.trim();
  return {
    ...result,
    personalRiskStatus: "unavailable",
    analysisPlan: {
      ...result.analysisPlan,
      report: prefix(marketOnlyReport(result.analysisPlan.report)),
      narrative: prefix(result.analysisPlan.narrative),
    },
  };
}

function marketOnlyReport(value) {
  // Existing strategy reports contain host-authored execution sections with
  // default budgets. They cannot survive a missing personal-risk check.
  // Keep the other strategy/evidence sections, including nested headings.
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let skippedLevel = 0;
  for (const line of lines) {
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/u);
    if (heading) {
      if (skippedLevel && heading[1].length <= skippedLevel) skippedLevel = 0;
      if (!skippedLevel && /^(?:新手执行清单|(?:标准|当前)执行方案|条件(?:式执行|交易计划)|(?:Standard |Current )?Execution (?:plan|checklist)|Conditional (?:execution|trading plan))$/iu.test(heading[2])) {
        skippedLevel = heading[1].length;
      }
    }
    if (skippedLevel) continue;
    if (/^\s*(?:[-*]|\d+\.)\s*.*(?:仓位与风险|仓位：|单笔预设亏损|小仓位试多)/u.test(line)) continue;
    output.push(heading ? line.replace(/(?:条件)?交易计划/u, "盘面分析") : line);
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
