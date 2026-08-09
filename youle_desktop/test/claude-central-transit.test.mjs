import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");

test("provider contacts require both a transit key and a relay-reported model", async () => {
  const source = await rendererSource;
  assert.match(source, /modelProviders: string\[\]/);
  assert.match(source, /state\.auth\.modelProviders = Array\.isArray\(session\?\.modelProviders\)/);
  assert.match(source, /function authenticatedProviderAvailable\(provider: ProviderChatProvider\)/);
  assert.match(source, /case "claude":[\s\S]*\["claude", "anthropic"\]/);
  assert.match(source, /case "codex":[\s\S]*\["codex", "gpt", "openai", "chatgpt"\]/);
  assert.match(source, /case "kimi":[\s\S]*\["kimi", "moonshot"\]/);
  assert.match(source, /case "deepseek":[\s\S]*\["deepseek", "deepseek-chat"\]/);
  assert.match(source, /case "gemini":[\s\S]*\["gemini", "google", "google-ai"\]/);
  assert.match(source, /case "mimo":[\s\S]*\["mimo", "xiaomi", "xiaomi-mimo"\]/);
  assert.match(source, /case "perplexity":[\s\S]*\["perplexity", "pplx", "sonar"\]/);
  assert.match(source, /case "doubao":[\s\S]*\["doubao", "bytedance", "volcengine", "ark"\]/);
  assert.match(source, /case "qwen":[\s\S]*\["qwen", "tongyi", "dashscope", "alibaba"\]/);
  assert.match(source, /contactStatusTone\(effectiveContactStatus\(contact\)\)/);
  assert.match(
    source,
    /function effectiveContactStatus[\s\S]*!providerSessionKeyAvailable\(mapped\.provider\)[\s\S]*return "待机"/,
  );
  assert.match(
    source,
    /entry\.status === "error"[\s\S]*entry\.models\.length > 0 \? "在线" : "待机"/,
  );
  assert.doesNotMatch(
    source,
    /function effectiveContactStatus[\s\S]*?return contact\?\.status \|\| "";/,
  );
  assert.doesNotMatch(source, /状态可能已过期/);
  assert.match(source, /entry\.models\.length > 0 \? "在线" : "待机"/);
  assert.match(
    source,
    /providerSessionKeyAvailable\(provider\)[\s\S]*providerModelOptions\(state\.providerModelCatalog, provider\)\.length > 0/,
  );
  assert.match(
    source,
    /function availableQuestionAnswerModelGroups\(\)[\s\S]*authenticatedProviderAvailable\(group\.provider\)/,
  );
});

test("provider model catalog is exposed through a main-process-only IPC bridge", async () => {
  const [main, preload, renderer] = await Promise.all([
    mainSource,
    preloadSource,
    rendererSource,
  ]);
  assert.match(
    main,
    /ipcMain\.handle\("youle:listProviderModelCatalog", async \(event, params = \{\}\) => \{[\s\S]*assertExternalModelsIpcSender\(event\)[\s\S]*listProviderModelCatalog\(params\)/,
  );
  assert.match(
    preload,
    /listProviderModelCatalog: \(params\) =>\s*ipcRenderer\.invoke\("youle:listProviderModelCatalog", params\)/,
  );
  assert.match(renderer, /listProviderModelCatalog\?\(params\?: \{ force\?: boolean \}\): Promise<any>/);
});

test("supported model contacts stay mapped while Perplexity is hidden from the large-model directory group", async () => {
  const source = await rendererSource;
  assert.match(
    source,
    /function isVisibleAgentDirectoryContact\(contact: ContactProfile\) \{\s*return contact\.section === "agents" \|\| contact\.section === "models";\s*\}/,
  );
  assert.match(
    source,
    /contact\.id === PROVIDER_CHAT_META\.perplexity\.id\) return false/,
  );
  for (const contactId of ["agent-claude", "agent-gpt", "agent-kimi", "agent-deepseek", "agent-gemini", "agent-grok", "agent-mimo", "agent-doubao", "agent-qwen"]) {
    assert.match(source, new RegExp(`id: "${contactId}"`));
    assert.match(source, new RegExp(`"${contactId}": \\{ provider:`));
  }
  assert.match(source, /"agent-perplexity": \{ provider: "perplexity"/);
});

test("Claude contact uses its own provider route and identifies Anthropic as the developer", async () => {
  const source = await rendererSource;
  const claudeMeta = source.match(/claude: \{ id: "agent-claude"[^\n]+/u)?.[0] || "";
  assert.ok(claudeMeta, "Claude provider metadata should exist");
  assert.doesNotMatch(claudeMeta, /apiProvider: "codex"/);
  assert.match(source, /agent: "Claude（不鸣 AI 中转）"/u);
  assert.match(source, /developer: "Anthropic"/u);
});

test("Gemini contact uses a dedicated Gemini provider route", async () => {
  const source = await rendererSource;
  const geminiMeta = source.match(/gemini: \{ id: "agent-gemini"[^\n]+/u)?.[0] || "";
  assert.ok(geminiMeta, "Gemini provider metadata should exist");
  assert.doesNotMatch(geminiMeta, /apiProvider: "codex"/);

  const grokMeta = source.match(/grok: \{ id: "agent-grok"[^\n]+/u)?.[0] || "";
  assert.ok(grokMeta, "Grok provider metadata should exist");
  assert.doesNotMatch(grokMeta, /apiProvider: "codex"/);
  assert.match(source, /case "grok":[\s\S]*\["grok", "xai", "x-ai"\]/);

  const mimoMeta = source.match(/mimo: \{ id: "agent-mimo"[^\n]+/u)?.[0] || "";
  assert.ok(mimoMeta, "MiMo provider metadata should exist");
  assert.doesNotMatch(mimoMeta, /apiProvider: "codex"/);

  const perplexityMeta = source.match(/perplexity: \{ id: "agent-perplexity"[^\n]+/u)?.[0] || "";
  assert.ok(perplexityMeta, "Perplexity provider metadata should exist");
  assert.doesNotMatch(perplexityMeta, /apiProvider: "codex"/);

  const doubaoMeta = source.match(/doubao: \{ id: "agent-doubao"[^\n]+/u)?.[0] || "";
  assert.ok(doubaoMeta, "Doubao provider metadata should exist");
  assert.doesNotMatch(doubaoMeta, /apiProvider: "codex"/);

  const qwenMeta = source.match(/qwen: \{ id: "agent-qwen"[^\n]+/u)?.[0] || "";
  assert.ok(qwenMeta, "Qwen provider metadata should exist");
  assert.doesNotMatch(qwenMeta, /apiProvider: "codex"/);
});
