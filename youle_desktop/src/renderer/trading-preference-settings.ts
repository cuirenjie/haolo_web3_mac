import {
  TRADING_PREFERENCE_CHOICE_FIELDS,
  buildTradingPreferenceChoiceAnswer,
  createTradingPreferenceChoiceDraft,
  updateTradingPreferenceChoice,
  type TradingPreferenceAnswers,
  type TradingPreferenceChoiceDraft,
  type TradingPreferenceStage,
} from "./trading-preference-choices.ts";

export const TRADING_PREFERENCE_REQUIRED_SECTIONS = "仓位健康度、风险校验、关键价位、入场条件、止损、止盈、仓位大小和失效条件";
export const NO_CUSTOM_TRADING_RULES = "暂无补充，沿用基础交易纪律";
export const NO_CUSTOM_TRADING_NOTES = "无自定义补充说明";
const stages: TradingPreferenceStage[] = [1, 2, 3];
const groups = [
  ["单笔风险控制", "按止损后的实际亏损计算，包含手续费和预估滑点，不是保证金比例。"],
  ["浮盈保护和盈亏比", "1R 代表最初承担的风险。保本位置包含交易成本，净盈亏比 1:0.4 表示盈利空间至少是止损风险的 0.4 倍。"],
  ["分析方式和交易纪律", `完整分析栏目包括：${TRADING_PREFERENCE_REQUIRED_SECTIONS}。`],
];
type EntryMode = "left" | "right" | "auto";
const entryModes: Array<{ value: EntryMode; label: string; detail: string }> = [
  { value: "left", label: "左侧入场", detail: "在结构反应区提前参与，仍须满足结构证据与风险要求。" },
  { value: "right", label: "右侧入场", detail: "等待执行周期的确认条件成立后再考虑入场。" },
  { value: "auto", label: "自动判断", detail: "根据本次行情证据选择左侧、右侧或等待。" },
];
const entryMode = (value: unknown): EntryMode => value === "left" || value === "right" ? value : "auto";
type MemoryEntry = { scope: string; key: string; value: string | number | boolean; kind: "preference" | "constraint" | "fact" | "goal"; strength?: "normal" | "hard" };
type Profile = {
  entryMode?: EntryMode;
  fieldSources?: Record<string, string>;
  maxLossPerTradePercent?: number | null;
  moveStopToBreakEven?: boolean | null;
  breakEvenTriggerR?: number | null;
  minimumRiskRewardRatio?: number | null;
  analysisStyle?: string | null;
  requiredAnalysisSections?: string | null;
  onboardingCompleted?: boolean;
  entries?: MemoryEntry[];
  preferenceForm?: { choices: TradingPreferenceChoiceDraft; extraNotes: string; entryMode?: EntryMode } | null;
};
type Migration = { code: string; fields: Array<{ fieldId: string; local: unknown; cloud: unknown }>; localEntries?: Array<{ key: string; value: unknown }> };
type ProfileResult = { ok?: boolean; completed?: boolean; profile?: Profile; migration?: Migration | null; error?: { fieldId?: string; message?: string } };
type SettingsDraft = { choices: TradingPreferenceChoiceDraft; extraNotes: string; entryMode: EntryMode; changedFields?: string[] };
const html = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function tradingPreferenceSettingsDraft(profile: Profile = {}): SettingsDraft {
  if (profile.preferenceForm) return { ...structuredClone(profile.preferenceForm), entryMode: entryMode(profile.preferenceForm.entryMode ?? profile.entryMode) };
  const choices = Object.assign({}, ...stages.map(createTradingPreferenceChoiceDraft)) as TradingPreferenceChoiceDraft;
  const fields = stages.flatMap(stage => TRADING_PREFERENCE_CHOICE_FIELDS[stage]);
  const set = (id: string, value: unknown, custom: string) => {
    if (value === null || value === undefined || value === "") return;
    const field = fields.find(field => field.id === id)!;
    choices[id] = field.options.some(option => option.value === String(value))
      ? { selected: [String(value)], custom: "" }
      : { selected: ["custom"], custom };
  };
  set("risk", profile.maxLossPerTradePercent, `${profile.maxLossPerTradePercent}%`);
  set("breakEven", profile.moveStopToBreakEven === false ? "off" : profile.breakEvenTriggerR, `${profile.breakEvenTriggerR}R`);
  set("ratio", profile.minimumRiskRewardRatio, `1:${profile.minimumRiskRewardRatio}`);
  set("style", profile.analysisStyle, profile.analysisStyle || "");
  const sections = profile.requiredAnalysisSections;
  set("sections", sections === TRADING_PREFERENCE_REQUIRED_SECTIONS ? "fixed" : sections === "根据问题按需选择栏目" ? "adaptive" : sections, sections || "");
  const memory = (scope: string, key: string) => [...(profile.entries || [])].reverse().find(entry => entry.scope === scope && entry.key === key)?.value;
  const rules = memory("trading.discipline", "user_custom_rules");
  if (typeof rules === "string" && rules && rules !== NO_CUSTOM_TRADING_RULES) {
    const selected: string[] = [];
    const custom: string[] = [];
    for (const rule of rules.split("；")) {
      const option = fields.find(field => field.id === "discipline")!.options.find(option => option.value !== "none" && option.label === rule.trim());
      if (option) selected.push(option.value);
      else custom.push(rule);
    }
    if (custom.length) selected.push("custom");
    choices.discipline = { selected: [...new Set(selected)], custom: custom.join("；") };
  }
  // Earlier onboarding stores custom explanations as titled notes, so recover
  // those alongside the numeric values instead of reducing them to a number.
  const notes = memory("trading.profile", "user_preference_notes");
  const extraNotes: string[] = [];
  if (typeof notes === "string" && notes !== NO_CUSTOM_TRADING_NOTES) {
    const chunks: string[] = [];
    for (const line of notes.split("\n")) {
      if (fields.some(field => line.startsWith(`${field.title}：`)) || !chunks.length) chunks.push(line);
      else chunks[chunks.length - 1] += `\n${line}`;
    }
    for (const chunk of chunks) {
      const field = fields.find(field => chunk.startsWith(`${field.title}：`));
      if (field && field.id !== "discipline") {
        const custom = chunk.slice(field.title.length + 1);
        const stage = stages.find(stage => TRADING_PREFERENCE_CHOICE_FIELDS[stage].includes(field))!;
        const current = buildTradingPreferenceChoiceAnswer(stage, choices);
        const candidate = buildTradingPreferenceChoiceAnswer(stage, { ...choices, [field.id]: { selected: ["custom"], custom } });
        // A later chat may have changed the value while leaving older notes.
        const keys: Record<string, keyof TradingPreferenceAnswers> = { risk: "maxLossPerTradePercent", breakEven: "moveStopToBreakEven", ratio: "minimumRiskRewardRatio", style: "analysisStyle", sections: "requiredSections" };
        if (current.ok && candidate.ok && current.answers[keys[field.id]] === candidate.answers[keys[field.id]]
          && (field.id !== "breakEven" || current.answers.breakEvenTriggerR === candidate.answers.breakEvenTriggerR)) {
          choices[field.id] = { selected: ["custom"], custom };
          continue;
        }
      }
      extraNotes.push(chunk);
    }
  }
  return { choices, extraNotes: extraNotes.join("\n"), entryMode: entryMode(profile.entryMode) };
}

export function createTradingPreferenceSettings(deps: {
  load: () => Promise<ProfileResult>;
  save: (payload: SettingsDraft) => Promise<ProfileResult>;
  resolveMigration?: (resolutions: Record<string, string | boolean>) => Promise<ProfileResult>;
  render: () => void;
  localize?: (element: HTMLElement) => void;
  onSaved: () => void;
}) {
  let generation = 0;
  let status: "idle" | "loading" | "ready" | "error" = "idle";
  let draft = tradingPreferenceSettingsDraft();
  let saving = false;
  let saved = false;
  let dirty = false;
  let completed = false;
  let error = "";
  let invalidField = "";
  let migration: Migration | null = null;
  let resolutions: Record<string, string> = {};
  let fieldSources: Record<string, string> = {};
  const editedFields = new Set<string>();

  const reset = () => {
    generation++;
    status = "idle";
    draft = tradingPreferenceSettingsDraft();
    saving = saved = dirty = completed = false;
    error = invalidField = "";
    migration = null;
    resolutions = {};
    fieldSources = {};
    editedFields.clear();
  };
  const load = async () => {
    if (status === "loading" || status === "ready" || saving) return;
    const token = ++generation;
    status = "loading";
    error = "";
    deps.render();
    try {
      const result = await deps.load();
      if (token !== generation) return;
      if (result?.ok !== true || !result.profile) throw new Error();
      draft = tradingPreferenceSettingsDraft(result.profile);
      fieldSources = result.profile.fieldSources || {};
      editedFields.clear();
      completed = result.completed === true || result.profile.onboardingCompleted === true;
      migration = result.migration || null;
      resolutions = {};
      status = "ready";
    } catch {
      if (token !== generation) return;
      status = "error";
      error = "交易偏好读取失败，请重试。";
    }
    if (token === generation) deps.render();
  };
  const save = async () => {
    if (saving || status !== "ready" || migration) return;
    error = invalidField = "";
    for (const field of stages.flatMap(stage => TRADING_PREFERENCE_CHOICE_FIELDS[stage])) {
      const choice = draft.choices[field.id];
      if (!choice.selected.length || (choice.selected.includes("custom") && (!choice.custom.trim() || choice.custom.length > 280))) {
        error = "请填写自定义内容，或选择其他选项。";
        invalidField = field.id;
        deps.render();
        return;
      }
    }
    if (draft.extraNotes.length > 2000) {
      error = "自定义说明合计请控制在 2000 字以内。";
      deps.render();
      return;
    }
    const token = generation;
    saving = true;
    saved = false;
    deps.render();
    try {
      const result = await deps.save({ ...structuredClone(draft), ...(editedFields.size ? { changedFields: [...editedFields] } : {}) });
      if (token !== generation) return;
      if (result?.ok !== true || result.completed !== true) {
        error = result?.error?.message || "交易偏好保存失败，已保留你的修改，请重试。";
        invalidField = [...Object.keys(draft.choices), "entryMode", "extraNotes"].includes(result?.error?.fieldId || "") ? result!.error!.fieldId! : "";
        return;
      }
      if (result.profile) { draft = tradingPreferenceSettingsDraft(result.profile); fieldSources = result.profile.fieldSources || {}; }
      editedFields.clear();
      saved = completed = true;
      dirty = false;
      deps.onSaved();
    } catch {
      if (token !== generation) return;
      error = "交易偏好保存失败，已保留你的修改，请重试。";
    } finally {
      if (token === generation) { saving = false; deps.render(); }
    }
  };
  const resolveMigration = async (selection: Record<string, string | boolean>) => {
    if (saving || !migration || !deps.resolveMigration) return;
    const token = generation;
    saving = true;
    error = "";
    deps.render();
    try {
      const resolved = await deps.resolveMigration(selection);
      if (token !== generation) return;
      if (!resolved.ok || !resolved.profile) {
        error = resolved.error?.message || "交易偏好保存失败，已保留你的修改，请重试。";
        return;
      }
      draft = tradingPreferenceSettingsDraft(resolved.profile);
      fieldSources = resolved.profile.fieldSources || {};
      editedFields.clear();
      completed = resolved.completed === true;
      migration = resolved.migration || null;
      resolutions = {};
      dirty = false;
      saved = true;
      deps.onSaved();
    } catch {
      if (token === generation) error = "交易偏好保存失败，已保留你的修改，请重试。";
    } finally {
      if (token === generation) { saving = false; deps.render(); }
    }
  };
  const answerText = (id: string, answer: unknown) => {
    if (typeof answer === "string") return answer;
    const choice = answer as { selected?: string[]; custom?: string } | null;
    const field = stages.flatMap(stage => TRADING_PREFERENCE_CHOICE_FIELDS[stage]).find(f => f.id === id);
    return choice?.selected?.map(value => value === "custom" ? choice.custom || "" : field?.options.find(option => option.value === value)?.label || value).join("；") || "";
  };
  const sourceText = (id: string) => editedFields.has(id) ? "未保存的修改" : fieldSources[id] === "user_saved" ? "已保存的偏好" : "产品默认值";
  const renderMigration = () => !migration ? "" : `<section class="settings-trading-group" data-preference-migration>
    <h4>核对本地与云端的交易偏好</h4>
    <p class="settings-trading-hint">请选择需要保留的答案。核对完成后，新分析才会使用云端配置。</p>
    ${migration.fields.map(item => `<fieldset ${saving ? "disabled" : ""}>
      <legend>${html(stages.flatMap(stage => TRADING_PREFERENCE_CHOICE_FIELDS[stage]).find(f => f.id === item.fieldId)?.title || "补充偏好说明")}</legend>
      <div class="trading-preference-choice-options">${["local", "cloud"].map(source => `<label class="trading-preference-choice-option">
        <input type="radio" name="migration-${html(item.fieldId)}" data-migration-field="${html(item.fieldId)}" value="${source}" ${resolutions[item.fieldId] === source ? "checked" : ""}>
        <span>${source === "local" ? "本地保存的答案" : "云端保存的答案"}</span><span>${html(answerText(item.fieldId, item[source as "local" | "cloud"]))}</span>
      </label>`).join("")}</div></fieldset>`).join("")}
    ${!migration.fields.length ? `<p class="settings-trading-hint">部分旧设置需要重新核对。原始记录仍保留在本机。</p>
      <details><summary>查看本地原始记录</summary>${(migration.localEntries || []).map(entry => `<p>${html(entry.key)}：${html(typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value))}</p>`).join("")}</details>` : ""}
    <div class="settings-trading-actions">
      ${migration.fields.length ? `<button type="button" class="trading-preference-onboarding-start" data-migration-resolve ${saving || !migration.fields.every(item => resolutions[item.fieldId]) ? "disabled" : ""}>使用选中的答案</button>` : ""}
      <button type="button" class="secondary-button" data-migration-keep-cloud ${saving ? "disabled" : ""}>使用云端配置，保留本地记录</button>
    </div></section>`;
  const render = () => {
    if (status === "idle" || status === "loading") return '<div class="settings-trading-loading" role="status">正在读取交易偏好…</div>';
    if (status === "error") return `<div class="settings-trading-loading"><p role="alert">${html(error)}</p><button type="button" class="secondary-button" data-preference-retry>重新加载</button></div>`;
    return `<div class="trading-preference-choices settings-trading-preferences" data-trading-settings aria-busy="${saving}">
      ${renderMigration()}
      <p class="settings-trading-intro">${completed ? "已选中你保存的答案，修改后点击下方保存。" : "未设置的项目已按默认交易偏好生效，修改后点击保存。"}</p>
      <p class="settings-trading-hint">自定义内容会先由 AI 理解并校验，全部通过后才会保存生效；无法理解或与题目无关时将提示保存失败。</p>
      <section class="settings-trading-group"><h4>1. 入场方式</h4>
        <fieldset data-preference-field="entryMode" ${saving || migration ? "disabled" : ""}>
          <legend>你倾向于哪种入场方式？ <span>单选</span></legend>
          <p class="settings-trading-hint" data-preference-source="entryMode">${sourceText("entryMode")}</p>
          <div class="trading-preference-choice-options">${entryModes.map(option => `<label class="trading-preference-choice-option">
            <input type="radio" name="settings-preference-entryMode" value="${option.value}" ${draft.entryMode === option.value ? "checked" : ""}>
            <span>${option.label}</span></label>`).join("")}</div>
          ${entryModes.map(option => `<p class="settings-trading-hint">${option.detail}</p>`).join("")}
          <p class="settings-trading-hint">左侧和右侧以执行周期为准，与做多做空无关。手动选择不会自动切换；修改仅用于新分析。</p>
        </fieldset></section>
      ${stages.map(stage => `<section class="settings-trading-group"><h4>${stage + 1}. ${groups[stage - 1][0]}</h4><p class="settings-trading-hint">${groups[stage - 1][1]}</p>
        ${TRADING_PREFERENCE_CHOICE_FIELDS[stage].map(field => {
          const choice = draft.choices[field.id];
          const custom = choice.selected.includes("custom");
          return `<fieldset data-preference-field="${field.id}" ${saving || migration ? "disabled" : ""}>
            <legend>${html(field.title)} <span>${field.multiple ? "可多选" : "单选"}</span></legend>
            <p class="settings-trading-hint" data-preference-source="${field.id}">${sourceText(field.id)}</p>
            <div class="trading-preference-choice-options">${[...field.options, { value: "custom", label: "自定义" }].map(option => `<label class="trading-preference-choice-option">
              <input type="${field.multiple ? "checkbox" : "radio"}" name="settings-preference-${field.id}" value="${option.value}" ${choice.selected.includes(option.value) ? "checked" : ""}>
              <span>${html(option.label)}</span></label>`).join("")}</div>
            <textarea class="trading-preference-choice-custom" data-preference-custom="${field.id}" aria-label="${html(field.title)}：自定义" maxlength="280" rows="3" placeholder="${html(field.placeholder)}" ${custom ? "" : "hidden disabled"}>${html(choice.custom)}</textarea>
          </fieldset>`;
        }).join("")}</section>`).join("")}
      ${draft.extraNotes ? `<label class="settings-trading-extra">补充偏好说明<textarea class="trading-preference-choice-custom" data-preference-extra maxlength="2000" rows="3" ${saving || migration ? "disabled" : ""}>${html(draft.extraNotes)}</textarea></label>` : ""}
      <div class="settings-trading-actions">
        <div class="trading-preference-choice-error" role="alert" ${error ? "" : "hidden"}><span>保存失败</span>：<span>${invalidField === "entryMode" ? "你倾向于哪种入场方式？" : invalidField ? html(stages.flatMap(stage => TRADING_PREFERENCE_CHOICE_FIELDS[stage]).find(field => field.id === invalidField)?.title || "补充偏好说明") : ""}</span> <span>${html(error)}</span></div>
        <span class="settings-trading-status" role="status">${saved ? "交易偏好已保存" : dirty ? "有未保存的修改" : ""}</span>
        <button type="button" class="trading-preference-onboarding-start" data-preference-save ${saving || !dirty || migration ? "disabled" : ""}>${saving ? "正在校验并保存…" : error ? "重试保存" : "保存修改"}</button>
      </div>
    </div>`;
  };
  const bind = (root: ParentNode) => {
    root.querySelector<HTMLButtonElement>("[data-preference-retry]")?.addEventListener("click", () => { void load(); });
    const panel = root.querySelector<HTMLElement>("[data-trading-settings]");
    if (!panel || panel.dataset.bound === "true") return;
    panel.dataset.bound = "true";
    const token = generation;
    const canEdit = () => token === generation && !saving && status === "ready" && panel.isConnected;
    panel.querySelectorAll<HTMLInputElement>("[data-migration-field]").forEach(input => input.addEventListener("change", () => {
      if (!canEdit() || !input.checked || !migration?.fields.some(item => item.fieldId === input.dataset.migrationField)) return;
      resolutions[input.dataset.migrationField!] = input.value;
      deps.render();
    }));
    panel.querySelector("[data-migration-resolve]")?.addEventListener("click", () => {
      if (canEdit() && migration?.fields.every(item => resolutions[item.fieldId])) void resolveMigration({ ...resolutions });
    });
    panel.querySelector("[data-migration-keep-cloud]")?.addEventListener("click", () => {
      if (canEdit()) void resolveMigration({ keepCloud: true });
    });
    const changed = (fieldId: string) => {
      editedFields.add(fieldId);
      const source = panel.querySelector<HTMLElement>(`[data-preference-source="${fieldId}"]`);
      if (source) source.textContent = sourceText(fieldId);
      dirty = true;
      saved = false;
      error = invalidField = "";
      const alert = panel.querySelector<HTMLElement>('[role="alert"]');
      if (alert) { alert.hidden = true; alert.textContent = ""; }
      const message = panel.querySelector<HTMLElement>(".settings-trading-status");
      if (message) message.textContent = "有未保存的修改";
      panel.querySelectorAll('[aria-invalid="true"]').forEach(input => input.removeAttribute("aria-invalid"));
      const button = panel.querySelector<HTMLButtonElement>("[data-preference-save]");
      if (button) { button.textContent = "保存修改"; button.disabled = false; }
      deps.localize?.(panel);
    };
    panel.addEventListener("change", event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !canEdit()) return;
      const fieldset = input.closest<HTMLFieldSetElement>("[data-preference-field]");
      if (fieldset?.dataset.preferenceField === "entryMode") {
        if (input.checked && entryModes.some(option => option.value === input.value)) { draft.entryMode = entryMode(input.value); changed("entryMode"); }
        return;
      }
      const field = stages.flatMap(stage => TRADING_PREFERENCE_CHOICE_FIELDS[stage]).find(field => field.id === fieldset?.dataset.preferenceField);
      if (!field || !fieldset) return;
      updateTradingPreferenceChoice(draft.choices, field, input.value, input.checked);
      fieldset.querySelectorAll<HTMLInputElement>("input").forEach(control => { control.checked = draft.choices[field.id].selected.includes(control.value); });
      const custom = fieldset.querySelector<HTMLTextAreaElement>("textarea");
      if (custom) {
        custom.hidden = custom.disabled = !draft.choices[field.id].selected.includes("custom");
        if (!custom.hidden && input.value === "custom") custom.focus();
      }
      changed(field.id);
    });
    panel.addEventListener("input", event => {
      const input = event.target;
      if (!(input instanceof HTMLTextAreaElement) || !canEdit()) return;
      const fieldId = input.dataset.preferenceCustom;
      if (fieldId && draft.choices[fieldId]) draft.choices[fieldId].custom = input.value;
      if (input.hasAttribute("data-preference-extra")) draft.extraNotes = input.value;
      changed(fieldId || "extraNotes");
    });
    panel.querySelector("[data-preference-save]")?.addEventListener("click", () => { if (canEdit()) void save(); });
    if (invalidField) {
      const field = panel.querySelector(`[data-preference-field="${invalidField}"]`);
      const control = invalidField === "extraNotes" ? panel.querySelector<HTMLElement>("[data-preference-extra]") : field?.querySelector<HTMLElement>("textarea:not([hidden])") || field?.querySelector<HTMLElement>("input");
      control?.setAttribute("aria-invalid", "true");
      control?.focus();
    }
  };
  const captureView = (root: ParentNode) => {
    const panel = root.querySelector<HTMLElement>("[data-trading-settings]");
    const scroller = panel?.closest<HTMLElement>(".settings-main");
    const scrollTop = scroller?.scrollTop ?? 0;
    const active = panel?.ownerDocument.activeElement;
    let selector = "";
    let selection: [number, number] | null = null;
    if (panel && active && panel.contains(active)) {
      if (active instanceof HTMLTextAreaElement) {
        selector = active.hasAttribute("data-preference-extra") ? "[data-preference-extra]" : `[data-preference-custom="${active.dataset.preferenceCustom}"]`;
        selection = [active.selectionStart, active.selectionEnd];
      } else if (active instanceof HTMLInputElement) {
        selector = `input[name="${active.name}"][value="${active.value}"]`;
      } else if (active.hasAttribute("data-preference-save")) selector = "[data-preference-save]";
    }
    return (nextRoot: ParentNode) => {
      if (!panel) return;
      const nextPanel = nextRoot.querySelector<HTMLElement>("[data-trading-settings]");
      const nextScroller = nextPanel?.closest<HTMLElement>(".settings-main");
      if (nextScroller) nextScroller.scrollTop = scrollTop;
      const control = selector ? nextPanel?.querySelector<HTMLElement>(selector) : null;
      if (control && !control.hasAttribute("disabled")) {
        control.focus({ preventScroll: true });
        if (selection && control instanceof HTMLTextAreaElement) control.setSelectionRange(...selection);
      }
    };
  };
  return { render, bind, load, save, reset, captureView, beginSession: () => { if (!saving) reset(); } };
}
