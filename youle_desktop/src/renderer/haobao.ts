import { HAOBAO_COLORS, HAOBAO_CHARACTERS, HAOBAO_MOODS, haoBaoOutline, renderHaoBaoAvatar, type HaoBaoAppearance } from "./haobao-avatar";
import "./haobao.css";
import { renderTradingWatchlistHost } from "./trading-watchlist-ui";

type Profile = HaoBaoAppearance & { name: string; created: boolean; customized: boolean; createdAt: number; conversationStarted: boolean };
type MessageQuote = { text: string; sender: string };
type PreviewMessage = { id: string; text: string; from: "user" | "hao"; createdAt: number; files?: string[]; quote?: MessageQuote; favorite?: boolean };
const HAOBAO_NAME_MAX_LENGTH = 5;
const limitName = (value: string) => Array.from(value).slice(0, HAOBAO_NAME_MAX_LENGTH).join("");
const validName = (value: string) => Boolean(value.trim()) && Array.from(value.trim()).length <= HAOBAO_NAME_MAX_LENGTH;
const defaults = (): Profile => ({ name: "hao宝", color: "cloud", character: "classic", mood: "wink", created: false, customized: false, createdAt: 0, conversationStarted: false });
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
const paths = {
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7Z"/>',
  cloud: '<path d="M7 18a5 5 0 0 1-1-10 6 6 0 0 1 11-1 5.5 5.5 0 0 1 0 11ZM9 21h6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/>',
  user: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path d="M6 19a6 6 0 0 1 12 0"/>',
  right: '<path d="m9 5 7 7-7 7"/>', left: '<path d="m15 5-7 7 7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', plus: '<path d="M12 4v16M4 12h16"/>',
  send: '<path d="M12 20V4m-7 7 7-7 7 7"/>', check: '<path d="m5 12 4 4L19 6"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
};
const icon = (name: keyof typeof paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;

/** Renderer-only preview. No agent, cloud computer, monitoring or messaging API is called. */
export function createHaoBaoUi(onChange: () => void) {
  let profile = defaults();
  let scope: string | undefined;
  let draft: Profile | null = null;
  let messages: PreviewMessage[] = [];
  let composer = "";
  let files: string[] = [];
  let notice = "";
  let restoreFocus = "";
  let scrollTop = 0;
  let inputSelection: [number | null, number | null] = [null, null];
  let returnFocus = "haobao-identity";
  let scrollToEnd = false;
  let composing = false;
  let userName = "你";
  let quote: MessageQuote | undefined;
  let editingId: string | null = null;
  let beforeEdit: { text: string; files: string[]; quote?: MessageQuote } | null = null;

  function welcomeMessages(): PreviewMessage[] {
    return [
      `嘿！我是你的${profile.name}。`,
      "有想做的事，随时告诉我。你不在线时，我也会继续忙；有进展，或发现值得关注的行情，就来找你。",
      "先给我起个名字，选一个你喜欢的模样吧？",
    ].map((text, index) => ({ id: `welcome-${index}`, text, from: "hao", createdAt: profile.createdAt }));
  }

  function useAccount(accountId: string) {
    if (scope === accountId) return;
    scope = accountId;
    profile = defaults();
    draft = null; messages = []; composer = ""; files = []; notice = ""; restoreFocus = ""; scrollTop = 0;
    quote = undefined; editingId = null; beforeEdit = null; scrollToEnd = false;
    try {
      const saved = JSON.parse(localStorage.getItem(`haolo.haobao.preview.v1:${scope}`) || "null");
      if (!saved || typeof saved !== "object") return;
      profile = { ...profile,
        name: typeof saved.name === "string" && saved.name.trim() ? limitName(saved.name.trim()) : "hao宝",
        created: saved.created === true, customized: saved.customized === true,
        conversationStarted: saved.conversationStarted === true,
        createdAt: Number.isFinite(saved.createdAt) ? saved.createdAt : 0,
        color: HAOBAO_COLORS.find(item => item.id === saved.color)?.id || "cloud",
        character: HAOBAO_CHARACTERS.find(item => item.id === saved.character)?.id || "classic",
        mood: HAOBAO_MOODS.find(item => item.id === saved.mood)?.id || "wink",
      };
      if (Array.isArray(saved.messages)) {
        messages = saved.messages.slice(-200).filter((item: unknown) => item && typeof item === "object")
          .filter((item: Record<string, unknown>) => (item.from === "user" || item.from === "hao") && typeof item.text === "string")
          .map((item: Record<string, any>, index: number): PreviewMessage => ({
            id: `saved-${index}`, from: item.from, text: item.text.slice(0, 4000),
            createdAt: Number.isFinite(item.createdAt) ? item.createdAt : profile.createdAt,
            files: Array.isArray(item.files) ? item.files.filter((file: unknown) => typeof file === "string").slice(0, 20).map((file: string) => file.slice(0, 255)) : [],
            favorite: item.favorite === true,
            quote: item.quote && typeof item.quote.text === "string" && typeof item.quote.sender === "string"
              ? { text: item.quote.text.slice(0, 4000), sender: item.quote.sender.slice(0, 100) } : undefined,
          }));
      }
      profile.conversationStarted ||= messages.some(message => message.from === "user");
      if (profile.conversationStarted) profile.created = true;
    } catch { /* Corrupt or unavailable local storage must not block the preview. */ }
  }

  function persist() {
    try { localStorage.setItem(`haolo.haobao.preview.v1:${scope}`, JSON.stringify({ ...profile, messages: messages.slice(-200) })); }
    catch { notice = "本地存储不可用，本次更改将在重启后丢失。"; }
  }

  function capture(root: ParentNode) {
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (active?.id && active.closest(".haobao-page, .haobao-dialog")) {
      restoreFocus = active.id;
      inputSelection = [active.selectionStart, active.selectionEnd];
    }
    const scroller = root.querySelector(".haobao-conversation");
    if (scroller) scrollTop = scroller.scrollTop;
  }

  function sidebarIcon() {
    return profile.customized ? renderHaoBaoAvatar(profile, "haobao-sidebar-avatar") : haoBaoOutline();
  }

  function renderPage(user: { name: string; avatar: string }, headerActions = "") {
    userName = user.name;
    if (!profile.created) return `<main class="haobao-page haobao-intro-page" aria-label="创建你的 hao宝">
      <div class="haobao-intro">
        <div class="haobao-intro-avatar">${haoBaoOutline()}</div>
        <h1>创建你的 hao宝</h1>
        <p class="haobao-subtitle">始终在线，主动为你而来。</p>
        <div class="haobao-features">
          <section><span class="haobao-feature-icon">${icon("bolt")}</span><div><h2>你来交代，hao宝来行动</h2><p>把想做的事告诉它，完成后主动找你。比如盯住 BTC 1 小时行情，裸 K 与威科夫方向一致时提醒你。</p></div></section>
          <section><span class="haobao-feature-icon">${icon("cloud")}</span><div><h2>专属云电脑，24 小时待命</h2><p>每个 hao宝都有自己的云电脑。即使你离线，它也能在背后持续推进。</p></div></section>
          <section><span class="haobao-feature-icon">${icon("heart")}</span><div><h2>你的交易搭子，越用越懂你</h2><p>记住你的交易经验与偏好，在行情的关键位置，陪你一起思考、出谋划策。</p></div></section>
        </div>
        <button type="button" class="haobao-primary" data-haobao-action="create">继续</button>
      </div>
    </main>`;
    const date = new Date(profile.createdAt || Date.now());
    const dateLabel = date.toDateString() === new Date().toDateString() ? "今天" : `${date.getMonth() + 1}月${date.getDate()}日`;
    const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    const haoAvatar = (messageId?: string) => messageId
      ? `<button type="button" id="haobao-avatar-${escape(messageId)}" class="message-avatar haobao-message-avatar haobao-message-avatar-editable" data-haobao-action="customize" aria-label="编辑 ${escape(profile.name)} 的头像和昵称" aria-haspopup="dialog">${renderHaoBaoAvatar(profile)}<span class="haobao-edit-badge" aria-hidden="true">${icon("edit")}</span></button>`
      : `<span class="message-avatar haobao-message-avatar" role="img" aria-label="${escape(profile.name)}的头像">${renderHaoBaoAvatar(profile)}</span>`;
    const bubble = (message: PreviewMessage) => {
      const fromUser = message.from === "user";
      const sent = new Date(message.createdAt || profile.createdAt);
      const sentTime = `${String(sent.getHours()).padStart(2, "0")}:${String(sent.getMinutes()).padStart(2, "0")}`;
      const action = (name: string, label: string) => `<button type="button" class="bubble-copy" data-haobao-message-action="${name}" data-haobao-message-id="${escape(message.id)}"${name === "favorite" ? ` aria-pressed="${Boolean(message.favorite)}"` : ""}>${label}</button>`;
      return `<div class="haobao-bubble-wrap">
        <div class="message-bubble ${fromUser ? "user-bubble haobao-bubble-user" : "agent-bubble"} haobao-bubble">${message.quote ? `<blockquote class="haobao-message-quote"><strong>${escape(message.quote.sender)}</strong><span>${escape(message.quote.text)}</span></blockquote>` : ""}<div class="message-text">${escape(message.text)}</div>${message.files?.map(file => `<span class="haobao-message-file">${escape(file)}</span>`).join("") || ""}</div>
        <div class="haobao-bubble-actions" aria-label="消息操作"><time>${sentTime}</time>${fromUser ? action("favorite", message.favorite ? "已收藏" : "收藏") : ""}${action("copy", "复制")}${action("quote", "引用")}${fromUser ? action("edit", "编辑") : ""}</div>
      </div>`;
    };
    const messageRow = (message: PreviewMessage) => {
      const fromUser = message.from === "user";
      return `<article class="message-row haobao-message-row ${fromUser ? "from-user" : "from-agent"}">
        ${fromUser ? "" : haoAvatar(message.id)}
        <div class="message-stack haobao-message-stack"><div class="message-meta">${escape(fromUser ? user.name : profile.name)}</div>${bubble(message)}</div>
        ${fromUser ? user.avatar : ""}
      </article>`;
    };
    return `<main class="haobao-page haobao-chat-page ${profile.conversationStarted ? "haobao-chat-started trading-expert-panel" : ""}" aria-label="你的 hao宝">
      ${profile.conversationStarted ? `<header class="haobao-session-header trading-expert-panel-header"><div class="trading-expert-panel-heading"><button type="button" id="haobao-session-name" class="haobao-session-title" data-haobao-action="customize" aria-label="编辑 hao宝 头像和名称">${escape(profile.name)}</button></div><div class="trading-expert-panel-header-actions">${headerActions}</div></header>` : ""}
      ${profile.conversationStarted ? renderTradingWatchlistHost() : ""}
      <div class="haobao-conversation">
        ${!profile.conversationStarted ? `<header class="haobao-chat-header"><button type="button" id="haobao-identity" class="haobao-identity" data-haobao-action="customize" aria-label="编辑 hao宝 头像和名称">
          <span class="haobao-identity-picture">${renderHaoBaoAvatar(profile)}<span class="haobao-edit-badge">${icon("edit")}</span></span>
          <strong>${escape(profile.name)}</strong><span class="haobao-status"><i></i>随时待命</span>
        </button></header>` : ""}
        <div class="haobao-message-list" role="log" aria-label="与 hao宝 的对话" aria-live="polite">
          ${!profile.conversationStarted ? `<p class="haobao-time">${dateLabel} ${time}</p>
          <article class="message-row haobao-message-row from-agent">
            ${haoAvatar()}
            <div class="message-stack haobao-message-stack">
              <div class="message-meta">${escape(profile.name)}</div>
              ${welcomeMessages().map(bubble).join("")}
              <button type="button" id="haobao-customize" class="haobao-customize-link" data-haobao-action="customize">${icon("user")}<span>自定义你的 hao宝</span>${icon("right")}</button>
            </div>
          </article>` : ""}
          ${messages.map(messageRow).join("")}
        </div>
      </div>
      <footer class="haobao-chat-footer">
        ${notice ? `<div class="haobao-notice" role="status">${escape(notice)}</div>` : ""}
        ${files.length ? `<div class="haobao-pending-files">${files.map((file, index) => `<button type="button" data-haobao-remove-file="${index}" aria-label="移除附件 ${escape(file)}">${escape(file)}${icon("close")}</button>`).join("")}</div>` : ""}
        <form class="haobao-composer" aria-label="向 hao宝 发送消息">
          <input type="file" id="haobao-files" hidden multiple />
          ${editingId ? `<div class="haobao-composer-context"><span>编辑消息</span><button type="button" data-haobao-action="cancel-edit">取消编辑</button></div>` : ""}
          ${quote ? `<div class="haobao-composer-context haobao-quote-preview"><span><strong>引用 ${escape(quote.sender)}</strong>${escape(quote.text)}</span><button type="button" data-haobao-action="clear-quote" aria-label="取消引用">${icon("close")}</button></div>` : ""}
          <textarea id="haobao-message" rows="2" maxlength="4000" placeholder="发送消息" aria-label="给 hao宝 发送消息">${escape(composer)}</textarea>
          <div class="haobao-composer-actions">
            <button type="button" class="haobao-icon-button" data-haobao-action="attach" aria-label="添加附件">${icon("plus")}</button>
            <span class="haobao-composer-spacer"></span>
            <button type="button" class="haobao-icon-button" data-haobao-action="voice" aria-label="语音输入">${icon("mic")}</button>
            <button type="submit" class="haobao-send" aria-label="${editingId ? "保存修改" : "发送消息"}" ${composer.trim() || files.length ? "" : "disabled"}>${icon(editingId ? "check" : "send")}</button>
          </div>
        </form>
      </footer>
    </main>`;
  }

  function renderDialog() {
    if (!draft) return "";
    const row = (label: string, key: "color" | "character" | "mood", options: readonly { id: string; name: string }[]) => `<section class="haobao-option-section"><div class="haobao-option-heading"><h3>${label}</h3><div><button type="button" class="haobao-icon-button" data-haobao-scroll="${key}" data-direction="-1" aria-label="上一组${label}">${icon("left")}</button><button type="button" class="haobao-icon-button" data-haobao-scroll="${key}" data-direction="1" aria-label="下一组${label}">${icon("right")}</button></div></div>
      <div class="haobao-option-row" data-haobao-row="${key}" role="group" aria-label="${label}">${options.map(option => `<button type="button" id="haobao-${key}-${option.id}" class="haobao-option ${draft![key] === option.id ? "selected" : ""}" data-haobao-option="${key}" data-value="${option.id}" aria-label="${option.name}" aria-pressed="${draft![key] === option.id}">${renderHaoBaoAvatar({ ...draft!, [key]: option.id })}<span>${option.name}</span></button>`).join("")}</div></section>`;
    return `<div class="haobao-backdrop" data-haobao-backdrop><section class="haobao-dialog" role="dialog" aria-modal="true" aria-labelledby="haobao-dialog-title">
      <button type="button" class="haobao-dialog-close haobao-icon-button" data-haobao-action="cancel" aria-label="关闭自定义">${icon("close")}</button>
      <div class="haobao-options"><h2 id="haobao-dialog-title">自定义你的 hao宝</h2>${row("颜色", "color", HAOBAO_COLORS)}${row("角色", "character", HAOBAO_CHARACTERS)}${row("表情", "mood", HAOBAO_MOODS)}</div>
      <form class="haobao-preview" aria-label="保存 hao宝 设置"><label for="haobao-name">给它起个名字</label><input id="haobao-name" type="text" value="${escape(draft.name)}" placeholder="hao宝" autocomplete="off" spellcheck="false" aria-describedby="haobao-name-help"/><p id="haobao-name-help">1–${HAOBAO_NAME_MAX_LENGTH} 个字符</p>
        <div class="haobao-avatar-preview">${renderHaoBaoAvatar(draft)}</div>
        <button type="submit" class="haobao-primary" ${validName(draft.name) ? "" : "disabled"}>${icon("check")}保存</button>
      </form>
    </section></div>`;
  }

  function bind(root: HTMLElement) {
    if (!root.querySelector(".haobao-page")) draft = null;
    const refresh = (focus?: string) => { onChange(); if (focus) root.querySelector<HTMLElement>(`#${focus}`)?.focus(); };
    const close = () => { draft = null; restoreFocus = ""; refresh(returnFocus); };
    root.querySelectorAll<HTMLElement>("[data-haobao-action]").forEach(button => button.addEventListener("click", () => {
      switch (button.dataset.haobaoAction) {
        case "create": profile.created = true; profile.createdAt = Date.now(); notice = ""; persist(); refresh("haobao-identity"); break;
        case "customize": returnFocus = button.id || "haobao-identity"; draft = { ...profile }; refresh("haobao-name"); break;
        case "cancel": close(); break;
        case "attach": root.querySelector<HTMLInputElement>("#haobao-files")?.click(); break;
        case "voice": notice = "语音输入即将开放，先打字告诉我吧。"; refresh("haobao-message"); break;
        case "clear-quote": quote = undefined; refresh("haobao-message"); break;
        case "cancel-edit":
          composer = beforeEdit?.text || ""; files = beforeEdit?.files || []; quote = beforeEdit?.quote;
          editingId = null; beforeEdit = null; refresh("haobao-message"); break;
      }
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-haobao-message-action]").forEach(button => button.addEventListener("click", async event => {
      event.preventDefault(); event.stopPropagation();
      const message = [...messages, ...welcomeMessages()].find(item => item.id === button.dataset.haobaoMessageId);
      if (!message) return;
      const text = [message.text, ...(message.files || [])].filter(Boolean).join("\n");
      switch (button.dataset.haobaoMessageAction) {
        case "copy":
          try {
            await navigator.clipboard.writeText(text);
            if (button.isConnected) button.textContent = "已复制";
          } catch {
            if (button.isConnected) { notice = "复制失败，请手动选择消息文字。"; refresh(); }
          }
          break;
        case "quote":
          quote = { text, sender: message.from === "user" ? userName : profile.name };
          refresh("haobao-message"); break;
        case "favorite":
          if (message.from !== "user") return;
          message.favorite = !message.favorite; persist(); refresh(); break;
        case "edit":
          if (message.from !== "user") return;
          if (!editingId) beforeEdit = { text: composer, files: [...files], quote };
          editingId = message.id; composer = message.text; files = [...(message.files || [])]; quote = message.quote;
          refresh("haobao-message"); break;
      }
    }));
    const dialog = root.querySelector<HTMLElement>(".haobao-dialog");
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("#haobao-name, #haobao-message").forEach(input => {
      input.addEventListener("compositionstart", () => { composing = true; });
      input.addEventListener("compositionend", () => { composing = false; });
      input.addEventListener("blur", () => { composing = false; });
    });
    root.querySelector("[data-haobao-backdrop]")?.addEventListener("click", event => { if (event.target === event.currentTarget) close(); });
    dialog?.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Tab") {
        const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    const shell = root.querySelector<HTMLElement>(".desktop-shell");
    if (shell) shell.inert = Boolean(draft);
    root.querySelectorAll<HTMLElement>("[data-haobao-option]").forEach(button => button.addEventListener("click", () => {
      if (!draft) return;
      const key = button.dataset.haobaoOption as "color" | "character" | "mood";
      draft[key] = button.dataset.value!;
      // Keep the name field, carousel positions and keyboard focus stable while previewing.
      root.querySelectorAll<HTMLElement>(`[data-haobao-option="${key}"]`).forEach(item => {
        const selected = item === button;
        item.classList.toggle("selected", selected); item.setAttribute("aria-pressed", String(selected));
      });
      root.querySelector(".haobao-avatar-preview")!.innerHTML = renderHaoBaoAvatar(draft);
      root.querySelectorAll<HTMLElement>("[data-haobao-option]").forEach(item => {
        const optionKey = item.dataset.haobaoOption as "color" | "character" | "mood";
        item.querySelector("svg")!.outerHTML = renderHaoBaoAvatar({ ...draft!, [optionKey]: item.dataset.value! });
      });
    }));
    root.querySelectorAll<HTMLElement>("[data-haobao-scroll]").forEach(button => button.addEventListener("click", () => {
      root.querySelector(`[data-haobao-row="${button.dataset.haobaoScroll}"]`)?.scrollBy({ left: Number(button.dataset.direction) * 200, behavior: "smooth" });
    }));
    const nameInput = root.querySelector<HTMLInputElement>("#haobao-name");
    const updateName = () => {
      if (!draft || !nameInput) return;
      // Count Unicode characters instead of maxlength's UTF-16 units; keep IME candidates intact.
      if (!composing) {
        const limited = limitName(nameInput.value);
        if (limited !== nameInput.value) {
          const caret = nameInput.selectionStart ?? limited.length;
          nameInput.value = limited;
          nameInput.setSelectionRange(Math.min(caret, limited.length), Math.min(caret, limited.length));
        }
      }
      draft.name = nameInput.value;
      root.querySelector<HTMLButtonElement>(".haobao-preview button[type=submit]")!.disabled = composing || !validName(draft.name);
    };
    nameInput?.addEventListener("input", updateName);
    nameInput?.addEventListener("compositionend", updateName);
    root.querySelector(".haobao-preview")?.addEventListener("submit", event => {
      event.preventDefault(); if (composing || !draft || !validName(draft.name)) return;
      profile = { ...draft, name: draft.name.trim(), customized: true }; notice = ""; persist(); close();
    });
    const input = root.querySelector<HTMLTextAreaElement>("#haobao-message");
    input?.addEventListener("input", () => {
      composer = input.value;
      root.querySelector<HTMLButtonElement>(".haobao-send")!.disabled = !composer.trim() && !files.length;
      input.style.height = "auto"; input.style.height = `${Math.min(120, input.scrollHeight)}px`;
    });
    input?.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); root.querySelector<HTMLFormElement>(".haobao-composer")?.requestSubmit(); }
    });
    root.querySelector<HTMLInputElement>("#haobao-files")?.addEventListener("change", event => {
      // File names are previewed locally; files are never read or uploaded.
      files.push(...Array.from((event.target as HTMLInputElement).files || []).map(file => file.name)); refresh("haobao-message");
    });
    root.querySelectorAll<HTMLElement>("[data-haobao-remove-file]").forEach(button => button.addEventListener("click", () => {
      files.splice(Number(button.dataset.haobaoRemoveFile), 1); refresh("haobao-message");
    }));
    root.querySelector(".haobao-composer")?.addEventListener("submit", event => {
      event.preventDefault(); if (!composer.trim() && !files.length) return;
      if (editingId) {
        const message = messages.find(item => item.id === editingId && item.from === "user");
        if (!message) return;
        Object.assign(message, { text: composer.trim(), files: [...files], quote });
      } else {
        const createdAt = Date.now();
        messages.push({ id: crypto.randomUUID(), from: "user", text: composer.trim(), files: [...files], quote, createdAt });
        messages.push({ id: crypto.randomUUID(), from: "hao", text: "收到啦！这里先陪你体验对话。云端能力接入后，我就能持续帮你做事，并主动带来进展。", createdAt });
        profile.conversationStarted = true;
        scrollToEnd = true;
      }
      composer = ""; files = []; quote = undefined; editingId = null; beforeEdit = null; notice = "";
      persist(); refresh("haobao-message");
    });
    const scroller = root.querySelector(".haobao-conversation");
    if (scroller) { scroller.scrollTop = scrollToEnd ? scroller.scrollHeight : scrollTop; scrollToEnd = false; }
    if (restoreFocus) {
      const target = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${restoreFocus}`);
      target?.focus({ preventScroll: true });
      if (target && inputSelection[0] !== null && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) target.setSelectionRange(...inputSelection);
      restoreFocus = "";
    }
  }
  return { useAccount, capture, sidebarIcon, renderPage, renderDialog, bind, get name() { return profile.name; }, get composing() { return composing; }, get conversationStarted() { return profile.conversationStarted; } };
}
