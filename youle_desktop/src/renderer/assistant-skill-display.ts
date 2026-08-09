const ASSISTANT_SKILL_DISPLAY_ALIASES = new Map([
  ["imagegen", "image-skill"],
]);

export function assistantSkillDisplayText(text: string) {
  return text.replace(/(^|[^\w-])imagegen(?=$|[^\w-])/gi, (_match, prefix: string) => {
    return `${prefix}${ASSISTANT_SKILL_DISPLAY_ALIASES.get("imagegen")}`;
  });
}

export function assistantSkillDisplayInlineCode(text: string) {
  const trimmed = text.trim();
  const displayName = ASSISTANT_SKILL_DISPLAY_ALIASES.get(trimmed.toLowerCase());
  if (!displayName) return text;
  const start = text.indexOf(trimmed);
  return `${text.slice(0, start)}${displayName}${text.slice(start + trimmed.length)}`;
}
