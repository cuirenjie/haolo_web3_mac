export const RESTORED_QUESTION_ANSWER_INTERRUPTED_TEXT: string;

export function settleRestoredQuestionAnswerItems<T extends Record<string, any>>(
  items: T[],
  options?: {
    timestamp?: string;
    failureText?: string;
  },
): {
  items: T[];
  changed: boolean;
};
