const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u;

export function normalizeAssistantOutputLanguage(value) {
  if (value === "ko" || value === "ko-KR" || value === "ko_KR") return "ko";
  return value === "zh-CN" || value === "zh-TW" ? value : "en";
}

export function containsHanCharacters(value) {
  return HAN_CHARACTER_PATTERN.test(String(value || ""));
}

export function assistantOutputLanguageInstruction(language) {
  const normalized = normalizeAssistantOutputLanguage(language);
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
