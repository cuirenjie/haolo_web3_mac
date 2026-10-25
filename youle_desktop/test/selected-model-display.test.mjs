import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { FIXED_CHAT_MODEL_OPTIONS, DEEPSEEK_EXECUTION_CHAT_MODEL_OPTION } from "../src/renderer/chat-model-catalog.ts";
import { normalizeRuntimeThreadModelSettings } from "../src/renderer/thread-model-settings.ts";
import { businessModelDisplayName, normalizeBusinessModelPoolsState } from "../src/renderer/business-model-pools.ts";
import { translateAppText } from "../src/renderer/app-language.mjs";

const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
function block(start, end) { return renderer.slice(renderer.indexOf(start), renderer.indexOf(end, renderer.indexOf(start))); }
const compiled = ts.transpileModule([
  block("function lockedExecutionModelForThread(", "type ExecutionModelFamily"),
  block("function threadModelSelection(", "function explicitModelSelectionForThread("),
  block("function selectedChatModelOption(", "function chatModelOptionsForThread("),
  block("function automaticTurnRecoveryDisplayModelName(", "function announceAutomaticTurnRecovery("),
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test("saved user choice survives runtime notifications, recovery and reopening in every locale", () => {
  for (const choice of ["gpt-5.6-sol", "gpt-6-sol", "gpt-6-astra", "deepseek-flash"]) {
    const options = [...FIXED_CHAT_MODEL_OPTIONS, DEEPSEEK_EXECUTION_CHAT_MODEL_OPTION];
    const context = vm.createContext({
      firstString: (...values) => values.find(v => typeof v === "string" && v.trim()) || "",
      threadModelSelectionsByThreadId: { thread: { model: choice, userSelected: true } },
      normalizeThreadModelSettings: normalizeRuntimeThreadModelSettings,
      threadModelSettings: () => ({ model: "deepseek-flash", modelProvider: "deepseek" }),
      isTradingExpertThreadId: () => false, isBlankNewThread: () => false,
      isLocalBlankThreadId: () => false, providerFromThreadId: () => null,
      executionModelAllowedForLockedThread: (locked, candidate) => locked.model === candidate.model,
      chatModelOptionsForThread: () => options, canonicalDeepSeekModel: value => value,
      isRetiredExecutionModel: () => false,
      DEEPSEEK_EXECUTION_MODEL_VALUE: "deepseek-flash", DEEPSEEK_EXECUTION_PROVIDER_ID: "deepseek",
      DEFAULT_EXECUTION_MODEL_PROVIDER_ID: "haolo_ai", executionModelProviderId: v => v || "haolo_ai",
    });
    vm.runInContext(compiled, context);
    assert.equal(context.selectedChatModelOption("thread").value, choice);
    const label = context.automaticTurnRecoveryDisplayModelName("thread");
    for (const language of ["zh-CN", "en", "zh-TW"]) assert.equal(translateAppText(label, language), label);
  }
});

test("a catalog fallback label cannot rename the selected consumption model", () => {
  const catalog = normalizeBusinessModelPoolsState({ pools: [{ id: "execution", models: [
    { id: "gpt-5.6-sol", displayName: "GPT-6 Astra" },
    { id: "gpt-6-astra", displayName: "GPT-5.6-Sol" },
  ] }] });
  assert.equal(businessModelDisplayName(catalog, "gpt-5.6-sol"), "GPT-5.6-Sol");
  assert.equal(businessModelDisplayName(catalog, "gpt-6-astra"), "GPT-6 Astra");
});
