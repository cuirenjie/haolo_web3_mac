import { vietnameseText } from './vietnamese.mjs';
// Protocol-looking assistant text is never executable tool authority.
export const MODEL_TOOL_PROTOCOL_ERROR = "MODEL_TOOL_PROTOCOL_ERROR";
export function leakedToolProtocolIndex(text) {
  return String(text || "").search(/<[|｜\s]*DSML[|｜\s]*(?:calls|invoke|parameter)\b/iu);
}
export function modelProtocolErrorText(language = "en") {
  if (language === "vi") return vietnameseText("モデルの応答形式に問題があるため、分析を完了できませんでした。分析を再開してください。");
if (language === "ja") return "モデルの応答形式に問題があるため、分析を完了できませんでした。分析を再開してください。";
  if (language === "ko") return "모델 응답 형식에 오류가 있어 분석을 완료하지 못했습니다. 분석을 다시 시작하세요.";
  if (language === "zh-TW" || language === "zh-Hant") return "模型回覆格式異常，本次分析未完成。請重新發起分析。";
  if (language === "zh-CN") return "模型回复格式异常，本次分析未完成。请重新发起分析。";
  return "The model returned an invalid response format. This analysis did not complete. Please start a new analysis.";
}
export function redactLeakedToolProtocol(text, language = "en") {
  const value = String(text || ""), index = leakedToolProtocolIndex(value);
  return index < 0 ? value : [value.slice(0, index).trimEnd(), modelProtocolErrorText(language)].filter(Boolean).join("\n\n");
}
