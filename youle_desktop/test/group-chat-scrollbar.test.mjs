import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("group chat picker scrollbar stays hidden until the pointer enters the left panel", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.group-chat-options\s*\{[\s\S]*scrollbar-color:\s*var\(--scrollbar-thumb-hidden\) transparent;/,
  );
  assert.match(
    styles,
    /\.group-chat-options::-webkit-scrollbar-thumb\s*\{[\s\S]*background-color:\s*transparent;/,
  );
  assert.match(
    styles,
    /\.group-chat-picker:hover \.group-chat-options\s*\{[\s\S]*scrollbar-color:\s*var\(--scrollbar-thumb\) transparent;/,
  );
  assert.match(
    styles,
    /\.group-chat-picker:hover \.group-chat-options::-webkit-scrollbar-thumb\s*\{[\s\S]*background-color:\s*var\(--scrollbar-thumb\);/,
  );
});

test("group chat picker scrollbar reuses the conversation list geometry and theme colors", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.group-chat-options::-webkit-scrollbar\s*\{[\s\S]*width:\s*var\(--scrollbar-size\);/,
  );
  assert.match(
    styles,
    /\.group-chat-options::-webkit-scrollbar-thumb\s*\{[\s\S]*border:\s*var\(--scrollbar-thumb-inset\) solid transparent;[\s\S]*border-radius:\s*999px;[\s\S]*background-clip:\s*content-box;/,
  );
  assert.match(
    styles,
    /\.group-chat-options::-webkit-scrollbar-thumb:hover\s*\{[\s\S]*background-color:\s*var\(--scrollbar-thumb-hover\);/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\]\s*\{[\s\S]*--scrollbar-thumb-hidden:\s*rgba\(133,\s*139,\s*150,\s*0\);[\s\S]*--scrollbar-thumb:\s*rgba\(133,\s*139,\s*150,\s*0\.42\);[\s\S]*--scrollbar-thumb-hover:\s*rgba\(183,\s*188,\s*197,\s*0\.62\);/,
  );
  assert.match(
    styles,
    /\.group-chat-options::-webkit-scrollbar-button\s*\{[\s\S]*display:\s*none;[\s\S]*width:\s*0;[\s\S]*height:\s*0;/,
  );
});
