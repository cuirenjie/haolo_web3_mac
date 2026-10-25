import { withKoreanVariants } from '../shared/korean.mjs';
import { NativeSupport, SUPPORT_ACCEPT, supportMediaUrl, supportFileType, supportDisplayMessages, type SupportMessage, type SupportRecord } from "./native-support.ts";
import "./native-support.css";
import "./support-assist.css";
import { assistText, describeSupportAction, supportIsTyping } from "./support-assist.ts";

const COPY = withKoreanVariants({
  "zh-CN": { conversation: "客服会话", title: "HaoLo 客服", exit: "退出客服", placeholder: "您可以描述任何问题", you: "您", send: "发送", sending: "发送中…", loading: "正在连接客服…", welcome: "请问您在使用 HaoLo 过程中遇到了什么问题？", waiting: "等待客服接入", online: "客服在线", offline: "客服暂时离线，您可以留言", ended: "本次咨询已结束", continue: "继续咨询", retry: "重试", failed: "暂时无法连接客服，请重试。", expired: "登录已过期，请重新登录后连接客服。", missing: "此客服会话已不可用，请重新连接客服。", rateLimit: "发送过于频繁，请稍后重试。", attach: "发送图片、视频或文件", remove: "移除待发送文件", help: "支持粘贴、拖放图片、视频、文件及安装包，单个最大 1 GB", oneFile: "请每次添加一个文件。", emptyFile: "不能发送空文件。", tooLarge: "文件不能超过 1 GB。", badType: "不支持此文件类型。", tooLong: "消息不能超过 4000 个字符。", upload: "正在上传文件…", saving: "正在发送文件…", file: "附件", unread: "未读", enter: "Enter 发送，Shift + Enter 换行", history: "客服咨询" },
  en: { conversation: "Support conversation", title: "HaoLo Support", exit: "Exit support", placeholder: "You can describe any issue", you: "You", send: "Send", sending: "Sending…", loading: "Connecting to support…", welcome: "What issue have you encountered while using HaoLo?", waiting: "Waiting for support", online: "Support is online", offline: "Support is offline. You can leave a message", ended: "This conversation has ended", continue: "Continue with support", retry: "Retry", failed: "Unable to connect to support. Please try again.", expired: "Your sign-in has expired. Sign in again to contact support.", missing: "This support conversation is unavailable. Please reconnect.", rateLimit: "You are sending too frequently. Please try again shortly.", attach: "Send an image, video or file", remove: "Remove selected file", help: "Paste or drop images, videos, files and installers, up to 1 GB each", oneFile: "Please add one file at a time.", emptyFile: "Empty files cannot be sent.", tooLarge: "Files cannot exceed 1 GB.", badType: "This file type is not supported.", tooLong: "Messages cannot exceed 4000 characters.", upload: "Uploading file…", saving: "Sending file…", file: "Attachment", unread: "unread", enter: "Enter to send, Shift + Enter for a new line", history: "Support conversation" },
  "zh-TW": { conversation: "客服會話", title: "HaoLo 客服", exit: "退出客服", placeholder: "您可以描述任何問題", you: "您", send: "傳送", sending: "傳送中…", loading: "正在連接客服…", welcome: "請問您在使用 HaoLo 過程中遇到了什麼問題？", waiting: "等待客服接入", online: "客服在線", offline: "客服暫時離線，您可以留言", ended: "本次諮詢已結束", continue: "繼續諮詢", retry: "重試", failed: "暫時無法連接客服，請重試。", expired: "登入已過期，請重新登入後連接客服。", missing: "此客服會話已無法使用，請重新連接客服。", rateLimit: "傳送過於頻繁，請稍後重試。", attach: "傳送圖片、影片或檔案", remove: "移除待傳送檔案", help: "支援貼上、拖放圖片、影片、檔案及安裝包，單個最大 1 GB", oneFile: "請每次新增一個檔案。", emptyFile: "不能傳送空檔案。", tooLarge: "檔案不能超過 1 GB。", badType: "不支援此檔案類型。", tooLong: "訊息不能超過 4000 個字元。", upload: "正在上傳檔案…", saving: "正在傳送檔案…", file: "附件", unread: "未讀", enter: "Enter 傳送，Shift + Enter 換行", history: "客服諮詢" },
});
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const icon = (path: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
export class NativeSupportView {
  private element?: HTMLElement;
  private signature = "";
  private renderedId = "";
  private messagesSignature = "";
  private scroll = { top: 0, bottom: true };
  private resizeObserver?: ResizeObserver;
  private scrollFrame = 0;
  composing = false;
  private focus?: { start: number; end: number };
  constructor(private support: NativeSupport, private options: { language: () => string; openExternal: (url: string) => Promise<unknown>; requestRender: () => void }) {}
  captureFocus() {
    // The main renderer removes our host next. Read geometry while attached.
    this.captureScroll();
    const input = this.element?.querySelector("textarea");
    if (input && input === document.activeElement) this.focus = { start: input.selectionStart, end: input.selectionEnd };
  }
  private captureScroll() {
    const scroller = this.element?.querySelector<HTMLElement>(".native-support-messages");
    if (!scroller?.isConnected || !scroller.clientHeight) return;
    this.scroll = { top: scroller.scrollTop, bottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 64 };
  }
  private restoreScroll() {
    const scroller = this.element?.querySelector<HTMLElement>(".native-support-messages");
    if (!scroller?.isConnected || !scroller.clientHeight) return;
    scroller.scrollTop = this.scroll.bottom ? scroller.scrollHeight : this.scroll.top;
  }
  text(key: string) {
    if (key === "conversation" && supportIsTyping(this.support.entry().payload?.ai)) return assistText(this.support.replyLocale(), "typing");
    if (key === "title") return this.options.language() === "en" ? "Support haolo" : "客服 haolo";
    return (COPY[this.options.language() as keyof typeof COPY] || COPY["zh-CN"])[key as keyof typeof COPY["zh-CN"]] || key;
  }
  historyRow(record: SupportRecord) {
    const title = `${this.text("history")}${record.title ? ` · ${record.title}` : ""}`;
    const active = this.support.active && this.support.currentId === record.id;
    return `<div class="conversation-row-wrap conversation-row-minimal ${active ? "active" : ""}"><button type="button" class="conversation-row native-support-history" data-support-session="${escape(record.id)}" title="${escape(title)}" ${active ? 'aria-current="page"' : ""}><span class="conversation-copy conversation-copy-minimal"><span class="row-title"><span class="row-name"><span class="row-name-text">${escape(title)}</span></span></span></span>${record.unread ? `<span class="unread-dot" aria-label="${record.unread} ${this.text("unread")}">${record.unread > 99 ? "99+" : record.unread}</span>` : ""}</button></div>`;
  }
  mount(host: HTMLElement | null) {
    if (!host) return;
    if (!this.element) { this.element = document.createElement("section"); this.element.className = "native-support"; }
    if (this.element.parentElement !== host) {
      this.captureScroll();
      host.replaceChildren(this.element);
      // Reattaching can reset scrollTop even when update() skips identical data.
      this.restoreScroll();
    }
    this.update();
    this.restoreScroll();
    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = requestAnimationFrame(() => this.restoreScroll());
    if (this.focus) {
      const input = this.element.querySelector<HTMLTextAreaElement>("textarea");
      if (input && !input.disabled) { input.focus({ preventScroll: true }); input.setSelectionRange(this.focus.start, this.focus.end); }
      this.focus = undefined;
    }
  }
  reset() { cancelAnimationFrame(this.scrollFrame); this.resizeObserver?.disconnect(); this.element?.remove(); this.element = undefined; this.signature = ""; this.renderedId = ""; this.messagesSignature = ""; this.scroll = { top: 0, bottom: true }; this.focus = undefined; this.composing = false; }
  update() {
    const element = this.element;
    if (!element || !this.support.active || this.composing) return;
    const entry = this.support.entry();
    const payload = entry.payload;
    const signature = JSON.stringify([this.options.language(), this.support.currentId, payload, this.support.assisting, this.support.opening, this.support.error, entry.error, entry.sending, entry.file?.name, entry.preview, entry.progress]);
    if (signature === this.signature) return;
    this.signature = signature;
    const input = element.querySelector<HTMLTextAreaElement>("textarea");
    const focused = input === document.activeElement;
    const start = input?.selectionStart || 0, end = input?.selectionEnd || 0;
    this.captureScroll();
    const messages = supportDisplayMessages(payload?.messages || []);
    const messagesSignature = JSON.stringify(messages);
    if (this.renderedId !== this.support.currentId || this.messagesSignature !== messagesSignature) this.scroll = { top: 0, bottom: true };
    this.messagesSignature = messagesSignature;
    this.renderedId = this.support.currentId;
    const closed = ["resolved", "closed"].includes(payload?.session.status || "");
    const error = entry.error || this.support.error;
    const disabled = !this.support.canSend();
    const proposal = payload?.ai?.mode === "ai" ? payload.ai.actions.find(a => a.status === "proposed" && a.device_id === this.support.deviceId) : undefined;
    element.setAttribute("aria-label", this.text("conversation"));
    element.innerHTML = `
      ${payload?.ai?.mode === "ai" ? `<div class="support-ai-identity">${assistText(this.support.replyLocale(), "identity")}</div>` : ""}
      <div class="native-support-messages" role="log" aria-live="polite" aria-relevant="additions text"><div class="native-support-message-content">${messages.length ? messages.map((message) => this.message(message)).join("") : `<p class="native-support-welcome">${this.text(this.support.opening ? "loading" : "welcome")}</p>`}</div></div>
      ${proposal ? `<div class="support-consent"><strong>${assistText(this.support.replyLocale(), "consent")}</strong><p data-i18n-skip>${escape(proposal.title)}</p><ol>${proposal.plan.map(action => `<li>${escape(describeSupportAction(action, proposal.reply_locale || this.support.replyLocale()))}</li>`).join("")}</ol><button type="button" data-support-consent="accept" ${this.support.assisting ? "disabled" : ""}>${assistText(this.support.replyLocale(), "accept")}</button><button type="button" data-support-consent="decline" ${this.support.assisting ? "disabled" : ""}>${assistText(this.support.replyLocale(), "decline")}</button></div>` : ""}
      ${error ? `<div class="native-support-error" role="alert">${this.text(error)} <button type="button" data-support-retry>${this.text("retry")}</button></div>` : ""}
      ${closed ? `<div class="native-support-ended">${this.text("ended")} <button type="button" data-support-continue>${this.text("continue")}</button></div>` : ""}
      <form class="composer native-support-composer">
        ${entry.file ? `<div class="native-support-attachment">${entry.preview ? supportFileType(entry.file).startsWith("image/") ? `<img src="${escape(entry.preview)}" alt="${escape(entry.file.name)}">` : `<video src="${escape(entry.preview)}" muted preload="metadata"></video>` : icon("M14 2H6v20h12V6z M14 2v5h5")}<span><strong>${escape(entry.file.name)}</strong><small>${(entry.file.size / 1024 ** 2).toFixed(1)} MB${entry.sending ? ` · ${this.text(entry.progress === 100 ? "saving" : "upload")} ${entry.progress}%` : ""}</small></span><button type="button" data-support-remove aria-label="${this.text("remove")}" ${entry.sending ? "disabled" : ""}>×</button></div>` : ""}
        <div class="composer-input-wrap"><textarea data-support-input rows="3" maxlength="4000" placeholder="${this.text("placeholder")}" aria-label="${this.text("placeholder")}" ${disabled ? "disabled" : ""}>${escape(entry.draft)}</textarea></div>
        <div class="composer-tools"><input type="file" data-support-file accept="${SUPPORT_ACCEPT}" hidden><button type="button" class="composer-icon-btn composer-upload-button" data-support-attach title="${this.text("help")}" aria-label="${this.text("attach")}" draggable="false" ${disabled ? "disabled" : ""}><svg class="composer-upload-plus" viewBox="0 0 24 24" aria-hidden="true" draggable="false"><path d="M12 5V19M5 12H19"/></svg></button></div>
        <button type="submit" class="send-button native-support-send" title="${this.text("enter")}" aria-label="${this.text(entry.sending ? "sending" : "send")}" ${disabled || (!entry.draft.trim() && !entry.file) ? "disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg></button>
      </form>`;
    const nextInput = element.querySelector<HTMLTextAreaElement>("textarea")!;
    element.querySelectorAll<HTMLButtonElement>("[data-support-consent]").forEach(button => button.addEventListener("click", () => { if (proposal) { element.querySelectorAll<HTMLButtonElement>("[data-support-consent]").forEach(b => b.disabled = true); void this.support.decide(proposal, button.dataset.supportConsent === "accept"); } }));
    nextInput.addEventListener("compositionstart", () => { this.composing = true; });
    nextInput.addEventListener("compositionend", () => { this.composing = false; entry.draft = nextInput.value; this.update(); this.options.requestRender(); });
    nextInput.addEventListener("input", () => {
      entry.draft = nextInput.value;
      element.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = !this.support.canSend() || (!entry.draft.trim() && !entry.file);
    });
    nextInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); void this.support.send(); }
    });
    element.querySelector("form")!.addEventListener("submit", (event) => { event.preventDefault(); void this.support.send(); });
    element.querySelector("[data-support-attach]")!.addEventListener("click", () => element.querySelector<HTMLInputElement>("[data-support-file]")!.click());
    element.querySelector<HTMLInputElement>("[data-support-file]")!.addEventListener("change", (event) => this.support.chooseFile((event.target as HTMLInputElement).files?.[0]));
    element.querySelector("[data-support-remove]")?.addEventListener("click", () => this.support.removeFile());
    element.querySelector("[data-support-continue]")?.addEventListener("click", () => { void this.support.open(); });
    element.querySelector("[data-support-retry]")?.addEventListener("click", () => {
      if (entry.error && this.support.canSend() && (entry.draft.trim() || entry.file)) void this.support.send();
      else void this.support.open(this.support.error === "missing" ? "" : this.support.currentId);
    });
    element.querySelectorAll<HTMLAnchorElement>("a[data-support-media]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); void this.options.openExternal(link.href).catch(() => { entry.error = "failed"; this.update(); }); }));
    // These handlers belong to the persistent support surface, not the model composer.
    element.onpaste = (event) => {
      const files = [...(event.clipboardData?.files || [])];
      if (!files.length) return;
      event.preventDefault(); event.stopPropagation(); this.files(files);
    };
    element.ondragover = (event) => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); element.classList.add("is-file-drag"); } };
    element.ondragleave = (event) => { if (!element.contains(event.relatedTarget as Node)) element.classList.remove("is-file-drag"); };
    element.ondrop = (event) => { event.preventDefault(); event.stopPropagation(); element.classList.remove("is-file-drag"); this.files([...(event.dataTransfer?.files || [])]); };
    if (focused && !disabled) { nextInput.focus({ preventScroll: true }); nextInput.setSelectionRange(start, end); }
    const nextScroller = element.querySelector<HTMLElement>(".native-support-messages")!;
    nextScroller.addEventListener("scroll", () => this.captureScroll(), { passive: true });
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.restoreScroll());
    this.resizeObserver.observe(nextScroller);
    this.resizeObserver.observe(element.querySelector(".native-support-message-content")!);
    this.restoreScroll();
  }
  private files(files: File[]) {
    if (files.length > 1) { this.support.entry().error = "oneFile"; this.update(); }
    else this.support.chooseFile(files[0]);
  }
  private message(message: SupportMessage) {
    if (message.support_event === "joined") return `<article class="native-support-message is-system" data-i18n-skip>${escape(this.support.entry().payload?.ai?.copy?.joined || message.text)}</article>`;
    const attachments = (message.attachments || []).map((attachment) => {
      const url = supportMediaUrl(attachment.url), name = attachment.name || attachment.file_name || this.text("file");
      if (!url) return "";
      if (attachment.kind === "image") return `<a href="${escape(url)}" data-support-media><img src="${escape(url)}" alt="${escape(name)}" loading="lazy"></a>`;
      if (attachment.kind === "video") return `<video src="${escape(url)}" controls preload="metadata" aria-label="${escape(name)}"></video>`;
      return `<a class="native-support-file" href="${escape(url)}" data-support-media>${escape(name)}</a>`;
    }).join("");
    const time = new Date(message.created_at || "");
    return `<article class="native-support-message ${message.role === "user" ? "is-user" : "is-agent"}"><small>${this.text(message.role === "user" ? "you" : "title")}</small><div class="native-support-bubble" data-i18n-skip>${attachments}${message.text ? `<div>${escape(message.text)}</div>` : ""}</div><time>${Number.isFinite(time.getTime()) ? escape(time.toLocaleString(this.options.language(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })) : ""}</time></article>`;
  }
}
