import { TRADING_PREFERENCE_CHOICE_FIELDS as sharedFields } from "../shared/trading-preference-fields.mjs";
export type TradingPreferenceStage = 1 | 2 | 3;
export type TradingPreferenceChoiceDraft = Record<string, { selected: string[]; custom: string }>;
export type TradingPreferenceChoiceField = {
  id: string;
  title: string;
  multiple?: boolean;
  options: Array<{ value: string; label: string }>;
  defaultValue: string;
  placeholder: string;
};

export type TradingPreferenceAnswers = {
  maxLossPerTradePercent?: number;
  moveStopToBreakEven?: boolean;
  breakEvenTriggerR?: number;
  minimumRiskRewardRatio?: number;
  analysisStyle?: string;
  requiredSections?: string;
  customRules?: string;
  customPreferences?: string;
};

export const TRADING_PREFERENCE_CHOICE_FIELDS = sharedFields as Record<TradingPreferenceStage, TradingPreferenceChoiceField[]>;

export function createTradingPreferenceChoiceDraft(stage: TradingPreferenceStage): TradingPreferenceChoiceDraft {
  return Object.fromEntries(TRADING_PREFERENCE_CHOICE_FIELDS[stage].map((field) => [field.id, {
    selected: [field.defaultValue], custom: "",
  }]));
}

export function updateTradingPreferenceChoice(draft: TradingPreferenceChoiceDraft, field: TradingPreferenceChoiceField, value: string, checked: boolean) {
  const current = draft[field.id] ??= { selected: [], custom: "" };
  if (!field.multiple) {
    current.selected = checked ? [value] : [];
  } else if (checked) {
    current.selected = value === "none" ? ["none"] : [...new Set([...current.selected.filter((id) => id !== "none"), value])];
  } else {
    current.selected = current.selected.filter((id) => id !== value);
  }
}

// Custom numeric answers start with an explicit value; text after a separator is
// preserved as a preference instead of silently being discarded by a regex.
function customPositiveNumber(text: string, kind: "risk" | "breakEven" | "ratio") {
  const number = "(\\d+(?:\\.\\d+)?)";
  const prefix = kind === "ratio" ? "1\\s*[:：]\\s*" : kind === "risk" ? /(?:百分之\s*)?/.source : "";
  const suffix = kind === "breakEven" ? "\\s*[rR]" : kind === "risk" ? "\\s*[%％]?" : "";
  const match = text.match(new RegExp(`^${prefix}${number}${suffix}(?=$|[\\s，,。；;])`));
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function buildTradingPreferenceChoiceAnswer(stage: TradingPreferenceStage, draft: TradingPreferenceChoiceDraft):
  { ok: true; answers: TradingPreferenceAnswers; text: string } | { ok: false; fieldId: string; error: string } {
  const values: Record<string, string> = {};
  const lines: string[] = [];
  const notes: string[] = [];
  const fail = (fieldId: string, error: string) => ({ ok: false as const, fieldId, error });
  for (const field of TRADING_PREFERENCE_CHOICE_FIELDS[stage]) {
    const selection = draft[field.id];
    if (!selection?.selected.length || (!field.multiple && selection.selected.length !== 1)) return fail(field.id, "请选择一个选项后继续。");
    const labels: string[] = [];
    for (const selected of selection.selected) {
      if (selected === "custom") {
        const custom = selection.custom.replace(/\u0000/g, "").trim();
        if (!custom) return fail(field.id, "请填写自定义内容，或选择其他选项。");
        if (custom.length > 280) return fail(field.id, "自定义内容请控制在 280 字以内。");
        values[field.id] = custom;
        labels.push(custom);
        if (field.id !== "discipline") notes.push(`${field.title}：${custom}`);
      } else {
        const option = field.options.find((option) => option.value === selected);
        if (!option) return fail(field.id, "请选择有效选项。");
        values[field.id] = selected;
        labels.push(option.label);
      }
    }
    if (field.multiple && selection.selected.includes("none") && selection.selected.length > 1) return fail(field.id, "暂无补充不能与其他纪律同时选择。");
    lines.push(`${field.title}：${labels.join("；")}`);
  }
  const answers: TradingPreferenceAnswers = {};
  if (stage === 1) {
    const percent = draft.risk.selected.includes("custom") ? customPositiveNumber(values.risk, "risk") : Number(values.risk);
    if (percent === null || percent < 0.01 || percent > 100) return fail("risk", "请以 0.01%–100% 的比例开头，说明写在逗号后，例如：1.5%，仅在信号充分时交易。");
    answers.maxLossPerTradePercent = percent;
  } else if (stage === 2) {
    const customBreakEven = draft.breakEven.selected.includes("custom");
    const noBreakEven = values.breakEven === "off" || (customBreakEven && /^(?:不(?:自动)?移动保本|不保本|无需保本)(?=$|[\s，,。；;])/.test(values.breakEven));
    const trigger = noBreakEven ? 1 : customBreakEven ? customPositiveNumber(values.breakEven, "breakEven") : Number(values.breakEven);
    if (trigger === null || trigger < 0.01 || trigger > 100) return fail("breakEven", "请以 0.01R–100R 开头，例如：1.2R，说明写在逗号后；也可以填写“不移动保本”。");
    const ratio = draft.ratio.selected.includes("custom") ? customPositiveNumber(values.ratio, "ratio") : Number(values.ratio);
    if (ratio === null || ratio > 100) return fail("ratio", "请以 1:正数 开头，收益倍数不超过 100，例如：1:1.8，说明写在逗号后。");
    Object.assign(answers, { moveStopToBreakEven: !noBreakEven, breakEvenTriggerR: trigger, minimumRiskRewardRatio: ratio });
  } else {
    answers.analysisStyle = values.style;
    answers.requiredSections = values.sections;
    answers.customRules = draft.discipline.selected.filter((id) => id !== "none").map((id) => id === "custom"
      ? draft.discipline.custom.replace(/\u0000/g, "").trim()
      : TRADING_PREFERENCE_CHOICE_FIELDS[3][2].options.find((option) => option.value === id)!.label).join("；");
  }
  if (notes.length) answers.customPreferences = notes.join("\n");
  return { ok: true, answers, text: lines.join("\n") };
}
