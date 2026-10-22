import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { channelCodexInput } from "../src/main/channel-codex-input.mjs";

for (const channel of ["wechat", "feishu", "telegram"]) test(`${channel}: only current content and images enter the fresh Codex request`, () => {
  const value = channelCodexInput({ channel, threadId: "visible", interactionId: "request", businessContextId: "capture",
    text: "current message with attached rules.pdf", visibleQuestion: "current",
    messages: [{ role: "user", content: "secret old transcript" }], summary: "old summary",
    attachments: [{ name: "chart.png", path: "current.png", mime: "image/png" }, { name: "rules.pdf", path: "rules.pdf", mime: "application/pdf" }],
    priorAttachments: [{ path: "old.png" }],
  });
  assert.equal(value.params.text, "current message with attached rules.pdf");
  assert.equal(value.params.messages, undefined);
  assert.doesNotMatch(JSON.stringify(value), /secret|old\.png|old summary/);
  assert.deepEqual(value.mediaInputs, [{ type: "localImage", path: "current.png" }]);
});

test("channel request identity is mandatory and unrelated providers are rejected", () => {
  assert.throws(() => channelCodexInput({ channel: "other" }), /Unsupported/);
  assert.throws(() => channelCodexInput({ channel: "wechat", threadId: "visible" }), /identity/);
});

const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.mjs", main, ts.ScriptTarget.Latest, true);
function hostFunction(name, globals) {
  const declaration = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  const context = { ...globals };
  vm.runInNewContext(`${declaration.getText(ast)}\nresult = ${name};`, context);
  return context.result;
}

test("channel roots keep desktop execution settings while disabling automatic conversation memory", async () => {
  const policies = [];
  const create = hostFunction("getCodexProviderConversations", {
    codexProviderConversations: null,
    CodexProviderConversations: class { constructor(options) { Object.assign(this, options); } },
    path, app: { getPath: () => "user-data" }, codexBusinessTools: {},
    ANALYSIS_PRIMARY_MODEL: "primary", CHANNEL_CODEX_INSTRUCTIONS: "current message only",
    refreshSkillsDeveloperInstructions: async (...args) => { policies.push(args.at(-1)); return "skills"; },
    threadConfigurationParams: (params, options) => ({ ...params, ...options }),
  });
  const runner = create();
  const channel = await runner.configure({ provider: "channel-codex", cwd: "workspace", model: "chosen", reasoningEffort: "high" });
  assert.equal(channel.model, "chosen");
  assert.equal(channel.reasoningEffort, "high");
  assert.equal(channel.approvalPolicy, "never");
  assert.equal(channel.sandboxPolicy, "danger-full-access");
  assert.equal(policies[0].includeConversationMemory, false);
  assert.match(channel.developerInstructions, /current message only/);
  await runner.configure({ provider: "external", cwd: "workspace" });
  assert.equal(policies[1].includeConversationMemory, true);
});

test("disabled history policy does not read any group sessions and still supplies Skills", () => {
  let reads = 0;
  const build = hostFunction("buildDesktopDeveloperInstructions", {
    path, fs: { mkdirSync() {} }, desktopWorkspace: () => "workspace", desktopCodexHome: () => "runtime",
    appLanguage: () => "zh-CN", assistantOutputLanguageInstruction: () => "",
    buildThreadGroupContextInstructions: () => null,
    buildThreadGroupMemoryInstructions: () => { reads++; return "private prior chat"; },
    buildHaoloMediaDeveloperInstructions: () => "", buildConversationModeDeveloperInstructions: () => "",
    windowsUtf8DesktopInstruction: () => "",
  });
  const current = build("workspace", "available Skills", null, null, null, null, null, {}, { includeConversationMemory: false });
  assert.equal(reads, 0);
  assert.match(current, /available Skills/);
  assert.doesNotMatch(current, /private prior chat/);
  assert.match(build("workspace", "available Skills"), /private prior chat/);
  assert.equal(reads, 1);
});

test("all channels retain consumption attribution and generated-file delivery on their visible conversation", async () => {
  for (const channel of ["wechat", "feishu", "telegram"]) for (const status of ["complete", "failed", "canceled"]) {
    const requests = new Map(), facts = [], completions = [], snapshots = [], indexed = [], children = [];
    const send = hostFunction("sendChannelCodexMessage", {
      AbortController, activeChannelCodexRequests: requests, channelCodexInput,
      assertExternalModelsIpcSender: () => {},
      rememberConsumptionInteraction: fact => facts.push(fact),
      reportConsumptionFact: () => {},
      rememberConsumptionChildInteraction: (fact, id) => children.push([fact.interactionId, id]),
      completeConsumptionChildInteraction: (id, completion) => completions.push({ id, ...completion }),
      completeConsumptionInteraction: completion => completions.push(completion),
      snapshotThreadArtifacts: async (...args) => snapshots.push(args),
      notifyThreadArtifactsChanged: async (...args) => indexed.push(args),
      getClientForCwd: () => ({}),
      getCodexProviderConversations: () => ({ run: async options => {
        assert.equal(snapshots.length, 1);
        assert.equal(options.isolated, true);
        assert.equal(options.params.sourceType, channel);
        options.onThreadReady("hidden-root");
        if (status === "canceled") requests.get("interaction").cancelled = true;
        if (status !== "complete") throw new Error(status);
        return { text: "Created current-file.txt", turnIds: ["runtime-turn"] };
      } }),
    });
    const pending = send({ sender: {} }, { channel, cwd: "workspace", threadId: "visible",
      interactionId: "interaction", businessContextId: "capture", text: "current", visibleQuestion: "current" });
    if (status === "complete") await pending;
    else await assert.rejects(pending, new RegExp(status));
    assert.equal(facts[0].sourceType, channel);
    assert.equal(facts[0].conversationId, "visible");
    assert.equal(facts[0].question, "current");
    assert.deepEqual(children, [["interaction", "hidden-root"]]);
    assert.equal(completions.length, 2);
    assert.equal(completions[1].status, status);
    assert.equal(completions[1].turnId, "interaction");
    assert.equal(requests.size, 0);
    assert.equal(indexed.length, status === "complete" ? 1 : 0);
    if (indexed.length) {
      assert.equal(indexed[0][0], "visible");
      assert.equal(indexed[0][2].turnId, "interaction");
      assert.equal(indexed[0][2].finalMessage, "Created current-file.txt");
    }
  }
});
