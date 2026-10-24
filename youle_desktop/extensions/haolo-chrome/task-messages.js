// Copy introduced by the desktop handoff and user-gesture permission flow.
const messages = {
  "Haolo 已开始处理，可在桌面端查看进度。": ["Haolo has started the task. Follow its progress in the desktop app.", "Haolo 已開始處理，可在桌面端查看進度。"],
  "Haolo 未能启动任务，请重试。": ["Haolo could not start the task. Please try again.", "Haolo 未能啟動任務，請重試。"],
  "你没有授予该 Chrome 权限。": ["You did not grant this Chrome permission.", "你沒有授予此 Chrome 權限。"],
  "你没有授予当前网站的访问权限。": ["You did not grant access to this site.", "你沒有授予目前網站的存取權限。"],
  "当前标签页已变化，请重新授权。": ["The current tab has changed. Please authorize it again.", "目前分頁已變更，請重新授權。"],
  "请在侧栏点击授权按钮以授予网站访问权限。": ["Use the permission button in the side panel to grant site access.", "請在側欄點擊授權按鈕以授予網站存取權限。"],
};
export function taskMessage(text, language = chrome.i18n.getUILanguage()) {
  const translated = messages[text];
  if (!translated) return text;
  if (/^zh[-_](?:TW|HK|MO|Hant)/i.test(language)) return translated[1];
  return /^zh/i.test(language) ? text : translated[0];
}
