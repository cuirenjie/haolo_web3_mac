const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u;

export function normalizeAssistantOutputLanguage(value) {
  if (/^vi(?:[-_]VN)?$/i.test(String(value))) return "vi";
  if (/^ja(?:[-_]JP)?$/i.test(String(value))) return "ja";
  if (value === "ko" || value === "ko-KR" || value === "ko_KR") return "ko";
  return value === "zh-CN" || value === "zh-TW" ? value : "en";
}

export function containsHanCharacters(value) {
  return HAN_CHARACTER_PATTERN.test(String(value || ""));
}

export function assistantOutputLanguageInstruction(language) {
  const normalized = normalizeAssistantOutputLanguage(language);
  if (normalized === "vi") return [
    "<haolo_output_language>",
    "The HaoLo application language is Vietnamese (Tiếng Việt). Write all assistant-authored visible text in natural, professional Vietnamese with full diacritics: progress, tool cards, headings, chart annotations, errors, explanations and final answers.",
    "Financial glossary: long=mua (Long); short=bán (Short); entry=vào lệnh; stop loss=cắt lỗ; take profit=chốt lời; margin=ký quỹ; leverage=đòn bẩy; position=vị thế; perpetual futures=hợp đồng tương lai vĩnh cửu; credits=điểm; commission sharing=chia hoa hồng.",
    "Translate source evidence and examples. Preserve all facts, numbers, prices, units, uncertainty, negation and confirmation/invalidation conditions. Never invent completed actions or guarantees or omit substantive findings.",
    "Preserve machine-readable JSON keys, enums, identifiers, URLs, code, exact file contents and quoted user input. Official names and standard technical abbreviations may remain unchanged. Application language overrides examples and source prose.",
    "</haolo_output_language>",
  ].join("\n");
  if (normalized === "ja") return [
    "<haolo_output_language>",
    "The HaoLo app interface language is Japanese (日本語).",
    "Japanese glossary: credits=クレジット; recharge=チャージ; referral channel=招待チャネル; commission sharing=報酬分配; submit=送信; stop loss=損切り; take profit=利確; perpetual futures=無期限先物. Do not copy Chinese terms into Japanese explanations or parenthetical glosses. State only supported facts; do not invent approval steps, changed rules, completed actions or guarantees.",
    "Write every assistant-authored, user-visible string in natural, professional Japanese, including progress updates, thinking summaries, tool cards, chart annotations, errors and final answers.",
    "Translate Chinese and English source evidence into Japanese. Preserve all facts, uncertainty, confirmation and invalidation conditions, prices and units; never replace substantive analysis with a generic completion notice.",
    "Keep machine-readable JSON keys, enums, source code, identifiers, URLs and exact file contents unchanged. Use consistent Japanese financial terminology; official names and technical abbreviations may remain unchanged.",
    "The application language takes precedence over examples and quoted input. 自然で専門的な日本語を使用し、説明は丁寧な「です・ます」調で統一してください。",
    "</haolo_output_language>",
  ].join("\n");
  if (normalized === "ko") return [
    "<haolo_output_language>",
    "The HaoLo app interface language is Korean (한국어).",
    "Write every assistant-authored, user-visible string in natural, professional Korean, including progress updates, thinking summaries, tool cards, chart annotations, errors and final answers.",
    "Translate Chinese and English source evidence into Korean. Preserve all facts, uncertainty, confirmation and invalidation conditions, prices and units; never replace substantive analysis with a generic completion notice.",
    "Keep machine-readable JSON keys, enums, source code, identifiers, URLs and exact file contents unchanged. Use Korean explanations and Hangul financial terminology; official names and standard technical abbreviations may remain unchanged.",
    "The application language takes precedence over the language of examples and quoted input. 한국어 존댓말을 사용하고 금융 용어를 일관되게 번역하세요.",
    "</haolo_output_language>",
  ].join("\n");
  if (normalized !== "en") return "";
  return [
    "<haolo_output_language>",
    "The HaoLo app interface language is English.",
    "- Write every assistant-authored, user-visible string in English only.",
    "- This includes commentary and progress updates, reasoning or thinking summaries, chart annotations, tool and execution-card copy, status messages, and the final answer.",
    "- Do not emit Chinese Han characters in assistant-authored text. Translate Chinese source terminology into natural English before presenting it.",
    "- Treat user-authored Chinese as input data. Do not quote it back when an English description conveys the same meaning.",
    "- Keep machine-readable protocols, source code, identifiers, and literal file contents unchanged when exact preservation is required, but explain them in English.",
    "</haolo_output_language>",
  ].join("\n");
}

export function withAssistantOutputLanguageMessage(messages, language) {
  const instruction = assistantOutputLanguageInstruction(language);
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  if (!instruction) return normalizedMessages;
  return [{ role: "developer", content: instruction }, ...normalizedMessages];
}
