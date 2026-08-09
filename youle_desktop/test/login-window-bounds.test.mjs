import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");

test("registration and login windows use 90% of their previous dimensions", async () => {
  const source = await mainSource;

  assert.match(
    source,
    /const LOGIN_WINDOW_BOUNDS = \{\s*width: 346,\s*height: 481,\s*minWidth: 346,\s*minHeight: 481,\s*\};/,
  );
  assert.match(
    source,
    /const LOGIN_ERROR_WINDOW_BOUNDS = \{\s*\.\.\.LOGIN_WINDOW_BOUNDS,\s*height: 481,\s*minHeight: 481,\s*\};/,
  );
  assert.match(
    source,
    /const LOGIN_REGISTER_WINDOW_BOUNDS = \{\s*\.\.\.LOGIN_WINDOW_BOUNDS,\s*height: 481,\s*minHeight: 481,\s*\};/,
  );
  assert.match(
    source,
    /const LOGIN_WECHAT_WINDOW_BOUNDS = \{\s*\.\.\.LOGIN_WINDOW_BOUNDS,\s*height: 603,\s*minHeight: 603,\s*\};/,
  );
});
