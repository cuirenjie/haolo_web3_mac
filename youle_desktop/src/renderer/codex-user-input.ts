export type ToolRequestUserInputQuestion = {
  id?: unknown;
};

export function isToolRequestUserInputMethod(method: unknown) {
  return method === "item/tool/requestUserInput" || method === "tool/requestUserInput";
}

export function buildToolRequestUserInputAnswers(
  questions: readonly ToolRequestUserInputQuestion[],
  readValue: (id: string) => unknown,
) {
  const answers: Record<string, { answers: string[] }> = {};
  for (const question of questions) {
    const id = typeof question?.id === "string" ? question.id : "";
    if (!id) continue;
    answers[id] = { answers: [String(readValue(id) ?? "")] };
  }
  return answers;
}
