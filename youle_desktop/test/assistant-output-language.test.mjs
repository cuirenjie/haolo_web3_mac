import assert from "node:assert/strict";
import test from "node:test";

import {
  assistantOutputLanguageInstruction,
  containsHanCharacters,
  normalizeAssistantOutputLanguage,
  withAssistantOutputLanguageMessage,
} from "../src/main/assistant-output-language.mjs";

test("English app mode requires every assistant-visible surface to be English only", () => {
  const instruction = assistantOutputLanguageInstruction("en");
  assert.match(instruction, /commentary and progress updates/);
  assert.match(instruction, /reasoning or thinking summaries/);
  assert.match(instruction, /execution-card copy/);
  assert.match(instruction, /chart annotations/);
  assert.match(instruction, /final answer/);
  assert.match(instruction, /Do not emit Chinese Han characters/);
  assert.equal(containsHanCharacters(instruction), false);
  assert.equal(containsHanCharacters("English with 𠀀"), true);
});

test("English output policy is prepended without changing user content", () => {
  const messages = [{ role: "user", content: "请解释 RSI" }];
  const result = withAssistantOutputLanguageMessage(messages, "en");
  assert.deepEqual(result.map((message) => message.role), ["developer", "user"]);
  assert.equal(result[1], messages[0]);
  assert.equal(containsHanCharacters(result[0].content), false);
  assert.equal(normalizeAssistantOutputLanguage("unknown"), "en");
  assert.equal(withAssistantOutputLanguageMessage(messages, "zh-CN"), messages);
});
