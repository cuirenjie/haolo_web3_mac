const MARKDOWN_THEMATIC_BREAK = /^(?:(?:-\s*){3,}|(?:_\s*){3,}|(?:\*\s*){3,})$/;

export function stripLeadingMarkdownThematicBreak(value: string) {
  const lines = value.split("\n");
  let breakIndex = 0;
  while (breakIndex < lines.length && !lines[breakIndex].trim()) breakIndex += 1;
  if (!MARKDOWN_THEMATIC_BREAK.test(lines[breakIndex]?.trim() || "")) return value;

  let contentIndex = breakIndex + 1;
  while (contentIndex < lines.length && !lines[contentIndex].trim()) contentIndex += 1;
  return lines.slice(contentIndex).join("\n");
}
