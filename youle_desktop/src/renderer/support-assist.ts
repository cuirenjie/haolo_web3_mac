export type SupportAction = { kind: string; theme?: "light" | "dark"; indicator?: string; parameters?: Record<string, number>; up_color?: string; down_color?: string };
export type SupportProposal = { id: string; epoch: number; title: string; plan: SupportAction[]; status: string; device_id: string; next_step: number; reply_locale?: string; context_binding?: Record<string, any> };
export type SupportAI = { mode: "ai" | "human" | "closed"; phase: string; epoch: number; actions: SupportProposal[]; reply_locale?: string; protocol_version?: number; copy?: Record<string, string> };
export const SUPPORT_EXECUTOR_VERSIONS: Record<string, number> = { open_settings: 1, set_theme: 1, open_usage: 1, open_indicators: 1, set_indicator: 1, open_candle_settings: 1, set_candle_colors: 1 };
export function validateSupportProposal(proposal: SupportProposal, context: Record<string, any>) {
  if (!proposal.plan.length || proposal.plan.length > 12 || proposal.plan.some(a => !SUPPORT_EXECUTOR_VERSIONS[a.kind])) throw new Error("support_action_not_allowed");
  const binding = proposal.context_binding;
  if (binding?.support_protocol === 2) {
    for (const key of ["version", "contract_id", "channel"]) if (binding[key] !== context[key]) throw new Error("support_operation_context_changed");
    if (proposal.plan.some(a => binding.action_versions?.[a.kind] !== SUPPORT_EXECUTOR_VERSIONS[a.kind])) throw new Error("support_action_version_changed");
  }
}
const text = {
  ko: { typing: "haolo가 입력 중입니다...", identity: "haolo AI 고객지원", consent: "haolo 고객지원이 앱 조작을 도와드리려고 합니다. 허용하시겠습니까?", accept: "허용", decline: "거절", operating: "haolo 고객지원이 앱을 조작하고 있습니다", failed: "작업이 완료되지 않았습니다. 고객지원에 계속 문의해 주세요.", return: "고객지원 대화로 돌아가기" },
  "zh-CN": { typing: "haolo 输入中...", identity: "智能客服 haolo", consent: "客服 haolo 请求帮您操作，是否同意？", accept: "同意", decline: "拒绝", operating: "客服 haolo 正在为您操作", failed: "操作未完成，请继续联系客服。", return: "返回客服会话" },
  "zh-TW": { typing: "haolo 輸入中...", identity: "智能客服 haolo", consent: "客服 haolo 請求幫您操作，是否同意？", accept: "同意", decline: "拒絕", operating: "客服 haolo 正在為您操作", failed: "操作未完成，請繼續聯繫客服。", return: "返回客服會話" },
  en: { typing: "haolo is typing...", identity: "Intelligent support haolo", consent: "Support haolo requests permission to help you operate the app. Allow?", accept: "Allow", decline: "Decline", operating: "Support haolo is operating the app for you", failed: "The operation was not completed. Please continue with support.", return: "Return to support" },
};
export const assistText = (locale: string, key: keyof typeof text.en) => (text[(locale === "zh-Hant" ? "zh-TW" : locale) as keyof typeof text] || text["zh-CN"])[key];
export const supportIsTyping = (ai?: SupportAI | null) => ai?.mode === "ai" && ["queued", "thinking", "retrying"].includes(ai.phase);
export function describeSupportAction(action: SupportAction, locale: string) {
  const labels = locale === "ko" ? ["설정 열기", "테마 변경", "사용 내역 열기", "지표 설정 열기", "지표 설정", "캔들 색상 설정 열기", "캔들 색상 변경", "밝게", "어둡게", "상승", "하락", "매개변수"] : locale === "en"
    ? ["Open Settings", "Set appearance", "Open usage details", "Open indicator settings", "Set indicator", "Open candle color settings", "Set candle colors", "Light", "Dark", "Rising", "Falling", "Parameter"]
    : ["zh-TW", "zh-Hant"].includes(locale)
      ? ["開啟設定", "切換主題外觀", "開啟積分消耗", "開啟指標設定", "設定指標", "開啟 K 線漲跌顏色設定", "設定 K 線顏色", "明亮", "黑暗", "上漲", "下跌", "參數"]
      : ["打开设置", "切换主题外观", "打开积分消耗", "打开指标设置", "设置指标", "打开 K 线涨跌颜色设置", "设置 K 线颜色", "明亮", "黑暗", "上涨", "下跌", "参数"];
  const index = ["open_settings", "set_theme", "open_usage", "open_indicators", "set_indicator", "open_candle_settings", "set_candle_colors"].indexOf(action.kind);
  const suffix = action.kind === "set_theme" ? labels[action.theme === "dark" ? 8 : 7]
    : action.kind === "set_indicator" ? `${(action.indicator || "").split(":").pop()?.toUpperCase()} · ${Object.entries(action.parameters || {}).map(([key, value]) => `${labels[11]} ${Number(key) + 1} → ${value}`).join(", ")}`
    : action.kind === "set_candle_colors" ? `${labels[9]} ${action.up_color} / ${labels[10]} ${action.down_color}` : "";
  return `${labels[index] || ""}${suffix ? ": " + suffix : ""}`;
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Only trusted human input is blocked. All generated actions use local, typed controls. */
export class SupportAssist {
  running = false;
  private controller?: AbortController;
  private overlay?: HTMLElement;
  private cursor?: HTMLElement;
  private x = 120;
  private y = 120;
  private stopInput = (event: Event) => { if (event.isTrusted && this.running) { event.preventDefault(); event.stopImmediatePropagation(); } };
  constructor(private options: { locale: () => string; authorize: () => Promise<void>; theme: () => string; themePersisted: () => string | null }) {}
  abort() { this.controller?.abort(); }
  private async checkpoint() {
    this.controller?.signal.throwIfAborted();
    await this.options.authorize();
    this.controller?.signal.throwIfAborted();
  }
  async run(plan: SupportAction[], step: (index: number, stage: "begin" | "complete" | "failed", result?: string) => Promise<unknown>) {
    if (this.running) throw new Error("support_operation_busy");
    this.running = true; this.controller = new AbortController();
    const timeout = setTimeout(() => this.abort(), 90_000);
    this.overlay = document.createElement("div"); this.overlay.className = "support-assist-overlay";
    this.overlay.setAttribute("role", "status"); this.overlay.setAttribute("aria-live", "polite");
    const caption = document.createElement("div"); caption.className = "support-assist-caption"; caption.textContent = assistText(this.options.locale(), "operating");
    this.cursor = document.createElement("div"); this.cursor.className = "support-assist-cursor";
    this.cursor.innerHTML = '<svg width="30" height="34" viewBox="0 0 30 34" aria-hidden="true"><path d="M3 2 L3 27 L10 21 L16 32 L21 29 L15 19 L25 18Z" fill="#2575ef" stroke="white" stroke-width="2"/></svg><span>haolo</span>';
    this.overlay.append(caption, this.cursor); document.body.append(this.overlay);
    const events = ["pointerdown", "pointerup", "click", "dblclick", "wheel", "keydown", "keyup", "beforeinput", "paste", "drop", "contextmenu"];
    events.forEach(name => window.addEventListener(name, this.stopInput, { capture: true, passive: false }));
    let index = 0;
    try {
      for (; index < plan.length; index++) {
        await this.checkpoint(); await step(index, "begin");
        await this.execute(plan[index]);
        await step(index, "complete", "verified_and_persisted");
      }
    } catch (error) {
      // Unlock before a network result report: a dead server must never trap the UI.
      this.cleanup(events); clearTimeout(timeout);
      await step(index, "failed", this.controller?.signal.aborted ? "interrupted_or_timeout" : "verification_failed").catch(() => {});
      throw error;
    } finally { clearTimeout(timeout); this.cleanup(events); }
  }
  private cleanup(events: string[]) {
    this.running = false;
    events.forEach(name => window.removeEventListener(name, this.stopInput, true));
    document.querySelectorAll(".support-assist-target").forEach(el => el.classList.remove("support-assist-target"));
    this.overlay?.remove(); this.overlay = undefined;
  }
  private async find(selector: string): Promise<HTMLElement> {
    for (let i = 0; i < 30; i++) {
      this.controller?.signal.throwIfAborted();
      const el = [...document.querySelectorAll<HTMLElement>(selector)].find(el => el.checkVisibility() && !(el as HTMLButtonElement).disabled);
      if (el) return el;
      await delay(100);
    }
    throw new Error("support_control_unavailable");
  }
  private async move(el: HTMLElement) {
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const rect = el.getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    el.classList.add("support-assist-target");
    const animation = this.cursor?.animate([{ transform: `translate(${this.x}px,${this.y}px)` }, { transform: `translate(${x}px,${y}px)` }], { duration: 430, easing: "ease-in-out", fill: "forwards" });
    await animation?.finished; this.x = x; this.y = y;
    await this.checkpoint();
    return el.isConnected && el.checkVisibility();
  }
  private async target(selector: string) {
    // Polling and locale/theme renders can replace a control during cursor travel.
    // Resolve the same allowlisted control again; never click detached coordinates.
    for (let attempt = 0; attempt < 4; attempt++) {
      const el = await this.find(selector);
      if (await this.move(el)) return el;
      el.classList.remove("support-assist-target");
    }
    throw new Error("support_control_changed");
  }
  private async click(selector: string) {
    const el = await this.target(selector);
    el.click(); this.cursor?.classList.add("is-clicking"); await delay(180); this.cursor?.classList.remove("is-clicking");
    el.classList.remove("support-assist-target");
  }
  private async input(selector: string, value: string) {
    const el = await this.target(selector) as HTMLInputElement;
    el.focus(); el.value = value;
    if (el.type === "number" && !el.checkValidity()) throw new Error("support_parameter_out_of_range");
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    await delay(180); el.classList.remove("support-assist-target");
  }
  private async settings() {
    if (!document.querySelector('[data-settings-theme="dark"]')) await this.click('[data-action="open-settings"]');
    // Opening another settings tab is possible; select the General tab explicitly.
    const general = document.querySelector<HTMLElement>('[data-settings-tab="general"]');
    if (general && general.getAttribute("aria-selected") !== "true") await this.click('[data-settings-tab="general"]');
  }
  private async chartSettings(tab: string) {
    if (!document.querySelector('.trading-chart-settings-backdrop:not([hidden])')) await this.click('[data-market-action="open-chart-settings"]');
    await this.click(`[data-market-settings-tab="${tab}"]`);
  }
  private async indicators() {
    const opened = [...document.querySelectorAll<HTMLElement>('[data-market-action="save-indicator-settings"]')].some(el => el.checkVisibility());
    if (!opened) await this.click('[data-market-action="toggle-indicator-editor"]');
  }
  private async execute(action: SupportAction) {
    switch (action.kind) {
      case "open_settings": await this.settings(); await this.find('[data-settings-theme="dark"]'); return;
      case "set_theme":
        if (!["light", "dark"].includes(action.theme || "")) throw new Error("support_invalid_theme");
        await this.settings(); await this.click(`[data-settings-theme="${action.theme}"]`);
        if (this.options.theme() !== action.theme || this.options.themePersisted() !== action.theme) throw new Error("support_theme_not_persisted");
        return;
      case "open_usage": await this.settings(); await this.click('[data-action="open-consumption"]'); await this.find('[data-consumption-unit]'); return;
      case "open_indicators": await this.indicators(); await this.find('[data-market-action="save-indicator-settings"]'); return;
      case "set_indicator": {
        const key = action.indicator || "";
        if (!/^(main|sub):[a-z0-9]+$/.test(key) || !Object.keys(action.parameters || {}).length) throw new Error("support_invalid_indicator");
        await this.indicators(); await this.click(`[data-market-action="select-indicator-setting"][data-market-indicator-setting="${key}"]`);
        for (const [index, value] of Object.entries(action.parameters || {})) {
          if (!/^\d{1,2}$/.test(index) || typeof value !== "number" || !Number.isFinite(value)) throw new Error("support_invalid_parameter");
          await this.input(`[data-market-indicator-setting="${key}"][data-market-indicator-parameter="${index}"]`, String(value));
        }
        await this.click('[data-market-action="save-indicator-settings"]');
        const saved = JSON.parse(localStorage.getItem("haolo.trading-market.indicator-settings.v4") || "{}")[key];
        if (!saved || Object.entries(action.parameters || {}).some(([index, value]) => saved.parameters[Number(index)] !== value)) throw new Error("support_indicator_not_persisted");
        return;
      }
      case "open_candle_settings": await this.chartSettings("rise-fall"); await this.find('[data-chart-setting="riseFallPalette"]'); return;
      case "set_candle_colors": {
        if (![action.up_color, action.down_color].every(c => /^#[\da-f]{6}$/i.test(c || ""))) throw new Error("support_invalid_color");
        await this.chartSettings("main-style");
        for (const [key, value] of [["risingColor", action.up_color!], ["fallingColor", action.down_color!]]) {
          await this.click(`[data-chart-setting="${key}"]`);
          await this.click('[data-color-add]'); await this.input('[data-color-hex]', value); await this.click('[data-color-save]');
          // A control outside the popup closes it without touching a different preference.
          await this.click('[data-market-settings-tab="main-style"]');
        }
        const saved = JSON.parse(localStorage.getItem("haolo.trading-market.chart-settings.v1") || "{}");
        if (saved.risingColor?.toLowerCase() !== action.up_color?.toLowerCase() || saved.fallingColor?.toLowerCase() !== action.down_color?.toLowerCase()) throw new Error("support_colors_not_persisted");
        await this.click('[data-market-settings-tab="rise-fall"]'); return;
      }
      default: throw new Error("support_action_not_allowed");
    }
  }
}
