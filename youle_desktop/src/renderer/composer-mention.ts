export type ComposerMentionMatch = {
  start: number;
  end: number;
  query: string;
};

export function findComposerMentionMatch(
  text: string,
  selectionStart: number,
): ComposerMentionMatch | null {
  const cursor = Math.max(0, Math.min(selectionStart, text.length));
  const beforeSelection = text.slice(0, cursor);
  const atIndex = beforeSelection.lastIndexOf("@");
  if (atIndex < 0) return null;
  const query = beforeSelection.slice(atIndex + 1);
  if (/[\r\n]/.test(query) || /\s/.test(query)) return null;
  return {
    start: atIndex,
    end: cursor,
    query: query.trim().toLowerCase(),
  };
}

export function wasComposerMentionTriggerInserted(
  previousText: string,
  nextText: string,
  selectionStart: number,
) {
  const match = findComposerMentionMatch(nextText, selectionStart);
  if (!match || previousText === nextText) return false;

  let unchangedPrefixLength = 0;
  const sharedLength = Math.min(previousText.length, nextText.length);
  while (
    unchangedPrefixLength < sharedLength &&
    previousText[unchangedPrefixLength] === nextText[unchangedPrefixLength]
  ) {
    unchangedPrefixLength += 1;
  }

  let previousSuffixStart = previousText.length;
  let nextSuffixStart = nextText.length;
  while (
    previousSuffixStart > unchangedPrefixLength &&
    nextSuffixStart > unchangedPrefixLength &&
    previousText[previousSuffixStart - 1] === nextText[nextSuffixStart - 1]
  ) {
    previousSuffixStart -= 1;
    nextSuffixStart -= 1;
  }

  return match.start >= unchangedPrefixLength && match.start < nextSuffixStart;
}

export function shouldOpenComposerMention(
  match: ComposerMentionMatch | null,
  options: { wasOpen: boolean; triggerInserted: boolean },
) {
  return Boolean(match && (options.wasOpen || options.triggerInserted));
}

export function composerMentionLeadingSpacer(text: string, atIndex: number) {
  const index = Math.max(0, Math.min(atIndex, text.length));
  const precedingCharacter = index > 0 ? text[index - 1] : "";
  return precedingCharacter && !/\s/.test(precedingCharacter) ? " " : "";
}

export function composerMentionTrailingSpacer(textAfterMention: string) {
  return /^\s/.test(textAfterMention) ? "" : " ";
}
