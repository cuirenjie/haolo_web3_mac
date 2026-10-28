import { isVietnameseProse } from '../../shared/vietnamese.mjs';
import { isJapaneseProse } from '../../shared/japanese.mjs';
const PROSE_KEYS = new Set(["summary", "report", "answer", "rationale", "strategyRationale", "text", "narrative", "description", "riskWarning", "confirmation", "observeTrigger", "title", "label", "reason"]);

// Model prose is a conclusion, not a fixed-width label. Reject oversized output
// through the existing repair loop instead of cutting words or risk conditions.
export function completeTradingModelProse(value, field, maximum = 2_000) {
  const text = String(value || "").replace(/\u0000/g, "").trim();
  if (text.length > maximum) throw new TypeError(`Model response ${field} exceeds ${maximum} characters; return a shorter complete explanation.`);
  return text;
}

export function boundedTradingAnnotation(value, maximum = 120) {
  const text = String(value || "");
  if (text.length <= maximum) return text;
  const prefix = text.slice(0, maximum - 1);
  const boundary = prefix.lastIndexOf(" ");
  return (boundary > maximum / 2 ? prefix.slice(0, boundary) : prefix).trimEnd() + "…";
}

export function tradingModelLanguageInstruction(language) {
  if (/^vi(?:[-_]VN)?$/i.test(String(language))) return [
    "OUTPUT LANGUAGE REQUIREMENT (overrides prose-language examples):",
    "Write every user-visible heading, analysis, summary, rationale, answer, risk condition and chart annotation in natural professional Vietnamese (Tiếng Việt), with full diacritics and consistent financial terminology.",
    "long=mua (Long); short=bán (Short); entry=vào lệnh; stop loss=cắt lỗ; take profit=chốt lời; margin=ký quỹ; leverage=đòn bẩy; position=vị thế; perpetual futures=hợp đồng tương lai vĩnh cửu.",
    "Translate source evidence. Preserve JSON keys, enum values, evidence IDs, instrument symbols, all numbers, units, negation, uncertainty and confirmation/invalidation conditions exactly. Keep complete explanations; never invent facts, actions or guarantees. Keep an empty report if required by the schema.",
  ].join("\n");
  if (/^ja(?:[-_]JP)?$/i.test(String(language))) return [
    "OUTPUT LANGUAGE REQUIREMENT (overrides earlier prose-language examples):",
    "Write every user-visible analysis, heading, summary, rationale, answer, risk condition and chart annotation in professional Japanese (日本語), using natural financial terminology and polite Japanese sentences.",
    "Translate source evidence and examples; preserve JSON keys, enum values, evidence IDs, instrument symbols, all numbers, units, uncertainty and confirmation/invalidation conditions exactly.",
    "Use Japanese kanji and kana. Do not substitute Chinese, English or Korean prose. Keep complete explanations and an empty report where the schema requires it.",
    "Japanese glossary: credits=クレジット; recharge=チャージ; referral channel=招待チャネル; commission sharing=報酬分配; submit=送信; stop loss=損切り; take profit=利確; perpetual futures=無期限先物. Do not copy Chinese terms into Japanese explanations or parenthetical glosses. State only supported facts; do not invent approval steps, changed rules, completed actions or guarantees.",
  ].join("\n");
  if (language === "ko" || language === "ko-KR") return [
    "OUTPUT LANGUAGE REQUIREMENT (overrides earlier prose-language examples):",
    "Write every user-visible analysis, heading, summary, rationale, answer, risk condition and chart annotation in professional Korean (한국어). Use natural Hangul financial terminology and polite Korean sentences.",
    "Translate source evidence and examples; preserve JSON keys, enum values, evidence IDs, instrument symbols, all numbers, units, uncertainty and confirmation/invalidation conditions exactly.",
    "Do not omit findings or truncate an explanation to satisfy a Chinese-character limit. Use complete, concise Korean sentences; retain an empty report when required by the schema.",
  ].join("\n");
  if (language === "en") return [
    "OUTPUT LANGUAGE REQUIREMENT (overrides earlier prose-language examples):",
    "The application language is English. Write all user-visible analysis, summaries, rationale, direct answers and annotation text in professional financial English.",
    "Translate Chinese source evidence and terminology; do not repeat Chinese prose from the request or examples. Preserve prices, units, uncertainty, risk conditions, JSON keys, enum values and evidence IDs exactly.",
    "Do not abbreviate or omit substantive findings to satisfy the language requirement. Preserve an empty report when the schema requires it.",
    "English summaries should use one or two complete sentences (up to 50 words); this replaces any Chinese-character limit in the example schema. Keep all confirmation and invalidation qualifications intact.",
  ].join("\n");
  if (language === "zh-TW" || language === "zh-Hant") return "OUTPUT LANGUAGE REQUIREMENT: Write all user-visible analysis, summaries, rationale and annotations in Traditional Chinese. Preserve JSON keys, IDs, enum values and numbers.";
  return "";
}

export function validateTradingModelLanguage(review, language, allowedLiterals = []) {
  const vietnamese = /^vi(?:[-_]VN)?$/i.test(String(language));
  const japanese = /^ja(?:[-_]JP)?$/i.test(String(language));
  if (language !== "en" && language !== "ko" && language !== "ko-KR" && !japanese && !vietnamese) return review;
  const korean = language === "ko" || language === "ko-KR";
  const literals = allowedLiterals.filter((value) => typeof value === "string" && /\p{Script=Han}/u.test(value));
  function visit(value, key = "") {
    if (typeof value === "string" && PROSE_KEYS.has(key)) {
      const prose = literals.reduce((text, literal) => text.split(literal).join(""), value);
      if (vietnamese ? !isVietnameseProse(prose) : japanese ? !isJapaneseProse(prose) : /\p{Script=Han}/u.test(prose) || (korean && /[A-Za-z]{3}/.test(prose) && !/\p{Script=Hangul}/u.test(prose) && prose.trim().split(/\s+/).length > 4))
        throw new TypeError(`Output language mismatch in ${key}: rewrite the complete analysis in professional ${vietnamese ? 'Vietnamese' : japanese ? 'Japanese' : korean ? 'Korean' : 'English'}; preserve all facts and numbers.`);
    } else if (Array.isArray(value)) value.forEach((entry) => visit(entry, key));
    else if (value && typeof value === "object") Object.entries(value).forEach(([name, entry]) => visit(entry, name));
  }
  visit(review);
  return review;
}
