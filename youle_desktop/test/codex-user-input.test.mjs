import assert from "node:assert/strict";
import test from "node:test";

import { buildToolRequestUserInputAnswers, isToolRequestUserInputMethod } from "../src/renderer/codex-user-input.ts";

test("recognizes current and legacy request-user-input methods", () => {
  assert.equal(isToolRequestUserInputMethod("item/tool/requestUserInput"), true);
  assert.equal(isToolRequestUserInputMethod("tool/requestUserInput"), true);
  assert.equal(isToolRequestUserInputMethod("item/tool/call"), false);
});

test("encodes answers using the app-server string-array contract", () => {
  const values = new Map([
    ["first", "alpha"],
    ["second", "beta"],
  ]);
  assert.deepEqual(
    buildToolRequestUserInputAnswers(
      [{ id: "first" }, { id: "second" }, { id: null }],
      (id) => values.get(id),
    ),
    {
      first: { answers: ["alpha"] },
      second: { answers: ["beta"] },
    },
  );
});
