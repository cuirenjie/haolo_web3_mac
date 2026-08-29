import assert from "node:assert/strict";
import test from "node:test";

import {
  composerMentionLeadingSpacer,
  composerMentionTrailingSpacer,
  findComposerMentionMatch,
  shouldOpenComposerMention,
  wasComposerMentionTriggerInserted,
} from "../src/renderer/composer-mention.ts";

test("composer mention opens after @ regardless of the preceding character", () => {
  assert.deepEqual(findComposerMentionMatch("@", 1), {
    start: 0,
    end: 1,
    query: "",
  });
  assert.deepEqual(findComposerMentionMatch("你好@", 3), {
    start: 2,
    end: 3,
    query: "",
  });
  assert.deepEqual(findComposerMentionMatch("hello@Skill", 11), {
    start: 5,
    end: 11,
    query: "skill",
  });
});

test("composer mention still closes once the active query contains whitespace", () => {
  assert.equal(findComposerMentionMatch("你好@引用 会话", 7), null);
  assert.deepEqual(findComposerMentionMatch("你好@引用 会话@", 9), {
    start: 8,
    end: 9,
    query: "",
  });
});

test("a dismissed mention stays closed until another @ is inserted", () => {
  const initialText = "我知道@";
  const initialMatch = findComposerMentionMatch(initialText, initialText.length);
  assert.equal(
    wasComposerMentionTriggerInserted("我知道", initialText, initialText.length),
    true,
  );
  assert.equal(
    shouldOpenComposerMention(initialMatch, {
      wasOpen: false,
      triggerInserted: true,
    }),
    true,
  );

  const continuedText = `${initialText}一下`;
  const continuedMatch = findComposerMentionMatch(
    continuedText,
    continuedText.length,
  );
  assert.equal(
    wasComposerMentionTriggerInserted(
      initialText,
      continuedText,
      continuedText.length,
    ),
    false,
  );
  assert.equal(
    shouldOpenComposerMention(continuedMatch, {
      wasOpen: false,
      triggerInserted: false,
    }),
    false,
  );

  const retriggeredText = `${continuedText}@`;
  const retriggeredMatch = findComposerMentionMatch(
    retriggeredText,
    retriggeredText.length,
  );
  assert.equal(
    wasComposerMentionTriggerInserted(
      continuedText,
      retriggeredText,
      retriggeredText.length,
    ),
    true,
  );
  assert.equal(
    shouldOpenComposerMention(retriggeredMatch, {
      wasOpen: false,
      triggerInserted: true,
    }),
    true,
  );
});

test("an open mention remains open while its query is typed", () => {
  const text = "@skill";
  assert.equal(
    wasComposerMentionTriggerInserted("@skil", text, text.length),
    false,
  );
  assert.equal(
    shouldOpenComposerMention(findComposerMentionMatch(text, text.length), {
      wasOpen: true,
      triggerInserted: false,
    }),
    true,
  );
});

test("selected mentions get a leading boundary only when adjacent to text", () => {
  assert.equal(composerMentionLeadingSpacer("", 0), "");
  assert.equal(composerMentionLeadingSpacer("正文@", 2), " ");
  assert.equal(composerMentionLeadingSpacer("正文 @", 3), "");
  assert.equal(composerMentionLeadingSpacer("正文\n@", 3), "");
});

test("selected mentions get exactly one trailing boundary before following text", () => {
  assert.equal(composerMentionTrailingSpacer(""), " ");
  assert.equal(composerMentionTrailingSpacer("正文"), " ");
  assert.equal(composerMentionTrailingSpacer(" 正文"), "");
  assert.equal(composerMentionTrailingSpacer("\n正文"), "");
});
