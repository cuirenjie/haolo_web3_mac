import { tradingResolutionFromAlertInterval } from "../src/renderer/trading-expert-market.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { ExternalChannelRecoveryTurns } from "../src/renderer/external-channel-recovery.mjs";

const source = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = name => {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name);
  return node.getText(ast);
};
function load(names, globals) {
  const exports = {};
  const js = ts.transpileModule(names.map(declaration).join("\n") +
    `\nObject.assign(exports,{${names.join(",")}});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { exports, crypto, ...globals });
  return exports;
}

for (const [channel, title] of [["wechat", "Wechat"], ["feishu", "Feishu"], ["telegram", "Telegram"]]) {
  test(`${channel}: every inbound message reaches Codex before business dispatch`, () => {
    const handler = declaration(`handle${title}ChannelMessage`);
    assert.doesNotMatch(handler, /classify|handleExternalTradingChannelMessage|runExternalTradingStrategyAnalysis/);
    assert.match(handler, new RegExp(`await run${title}ChannelAgent\\(`));
  });

  for (const foreground of [true, false]) {
    test(`${channel}: Codex receives attachments and only its own chart (${foreground})`, async () => {
      const calls = [], released = [];
      const state = { currentThreadId: foreground ? "channel-thread" : "another-thread", itemOrder: {}, items: { "channel-thread": {} } };
      const target = { storageSessionId: "channel-thread", symbol: "ETHUSDT" };
      const globals = {
        state, WECHAT_CHANNEL_IDLE_WAIT_TIMEOUT_MS: 1, WECHAT_CHANNEL_REPLY_WAIT_TIMEOUT_MS: 1,
        DESKTOP_APPROVAL_POLICY: "never", DESKTOP_SANDBOX_POLICY: {},
        threadsAwaitingAgentReply: new Set(),
        activeChannelCodexInteractions: new Map(),
        externalChannelRecoveryTurns: new ExternalChannelRecoveryTurns(),
        waitForWechatThreadIdle: async () => {}, setCodexThreadBusy: () => {}, setMembersWorking: () => {},
        beginCodexSend: () => 1, endCodexSend: () => {}, confirmInsufficientAvailableBalanceBeforeSend: async () => false,
        rememberHiddenExternalChannelAgentPrompt: () => {}, captureTradingExpertAnalysisTarget: () => target,
        codexTradingTools: {
          capture: (attachments, chart) => { calls.push({ attachments, chart }); return "context"; },
          release: id => released.push(id),
        },
        api: {
          sendMessage: async () => { throw new Error("Historical native thread must not receive a new channel turn"); },
          sendChannelCodexMessage: async params => { calls.push(params); return { text: "root reply", turnIds: ["turn"] }; },
        },
        persistTradingExpertTranscriptItems: async () => {}, upsertItem: () => {},
        newAgentReplyText: () => "root reply",
        threadWorkspaceCwd: () => "workspace", selectedChatModelRequestOptions: () => ({ model: "selected" }),
        firstString: (...args) => args.find(v => typeof v === "string" && v),
        waitForNewAgentReply: async () => "root reply",
        isInsufficientQuotaError: () => false, addSystemItem: () => {}, errorMessage: e => e.message,
      };
      const fn = load([`run${title}ChannelAgent`, "runIsolatedChannelAgent"], globals)[`run${title}ChannelAgent`];
      const attachments = [{ path: "rules.pdf" }];
      const reply = await fn("channel-thread", "prompt", new Set(), "actual user words", attachments);
      assert.equal(calls[0].attachments, attachments);
      assert.equal(calls[0].chart, foreground ? target : null);
      assert.equal(calls[1].businessContextId, "context");
      assert.equal(calls[1].channel, channel);
      assert.equal(calls[1].visibleQuestion, "actual user words");
      assert.equal(calls[1].attachments, attachments);
      assert.equal(calls[1].messages, undefined);
      assert.equal(reply.text, "root reply");
      assert.deepEqual(released, ["context"]);
      released.length = 0;
      globals.api.sendChannelCodexMessage = async () => { throw new Error("transport failed"); };
      await assert.rejects(fn("channel-thread", "prompt", new Set(), "actual words", attachments), /transport failed/);
      assert.deepEqual(released, ["context"]);
      state.items["channel-thread"][`${channel}-user-current`] = { type: "userMessage", id: "current", text: "current" };
      state.items["channel-thread"].future = { type: "userMessage", id: "future", text: "future queued message" };
      globals.persistTradingExpertTranscriptItems = async (_id, items) => {
        assert.notEqual(items[0].id, "future");
        return { threadId: "replacement" };
      };
      // The VM holds the original bindings; use a new instance for persistence recovery.
      globals.api.sendChannelCodexMessage = async params => {
        assert.equal(params.threadId, "replacement");
        return { text: "answer", turnIds: ["replacement-turn"] };
      };
      const replacementFn = load([`run${title}ChannelAgent`, "runIsolatedChannelAgent"], globals)[`run${title}ChannelAgent`];
      const replaced = await replacementFn("channel-thread", "current", new Set([`${channel}-user-current`, "future"]), "current", attachments, "current");
      assert.equal(replaced.threadId, "replacement");
      assert.equal(globals.activeChannelCodexInteractions.size, 0);
      assert.equal(globals.threadsAwaitingAgentReply.size, 0);
    });
  }
}

test("stop targets the active isolated request and marks it cancelled before awaiting IPC", async () => {
  const record = { id: "channel-request", cancelled: false }, calls = [], cancelledPreludes = [];
  const { interruptCurrentTurn } = load(["interruptCurrentTurn"], {
    state: {}, currentComposerThreadId: () => null,
    isCloudTaskThread: () => false,
    tradingPreludePacer: { cancelThread: id => cancelledPreludes.push(id) },
    firstString: (...values) => values.find(v => typeof v === "string" && v),
    activeChannelCodexInteractions: new Map([["visible", record]]),
    api: { interruptChannelCodexMessage: async params => {
      assert.equal(record.cancelled, true);
      calls.push(params);
    } },
    finishInterruptedTurnLocally: (...args) => calls.push(args),
  });
  await interruptCurrentTurn("visible", "test");
  assert.deepEqual(cancelledPreludes, ["visible"]);
  assert.equal(calls[0].interactionId, "channel-request");
  assert.equal(calls[0].threadId, "visible");
  assert.deepEqual(Array.from(calls[1]), ["visible", "channel-request", "test"]);
});

test("busy channel messages queue as separate requests instead of steering prior context", async () => {
  for (const [channel, title] of [["wechat", "Wechat"], ["feishu", "Feishu"], ["telegram", "Telegram"]]) {
    let release;
    const queued = new Promise(resolve => { release = resolve; }), handled = [], stopped = [];
    const globals = {
      firstString: (...values) => values.find(v => typeof v === "string" && v),
      wechatChannelMessageText: m => m.text, wechatChannelMessageFileAttachments: () => [],
      hasThreadCodexWork: () => true, wechatChannelMessageRequestsStop: text => text === "停止",
      render() {}, addSystemItem() {}, errorMessage: error => error.message,
      wechatDebugLog() {}, wechatMessageDebugSummary: value => value,
      interruptedWechatChannelThreadIds: new Set(),
      handleWechatChannelBusyMessage: async m => stopped.push(m.id),
      stopExternalChannelBusyMessage: async (_channel, m) => stopped.push(m.id),
      [`handled${title}ChannelMessageIds`]: new Set(),
      [`inFlight${title}ChannelMessageIds`]: new Set(),
      [`active${title}ChannelMessageId`]: "in-progress",
      [`${channel}ChannelThreadId`]: "visible",
      [`${channel}ChannelRequestQueue`]: queued,
      [`show${title}ChannelMessageAttention`]: () => {},
      [`showQueued${title}ChannelMessage`]: async () => {},
      [`handle${title}ChannelMessage`]: async m => handled.push(m.id),
    };
    const queue = load([`queue${title}ChannelMessage`], globals)[`queue${title}ChannelMessage`];
    queue({ id: "first", text: "new current text" });
    queue({ id: "second", text: "another current text" });
    queue({ id: "stop", text: "停止" });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(handled, []);
    assert.deepEqual(stopped, ["stop"]);
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(handled, ["first", "second"]);
  }
});

test("a new request waits for cancelled runtime cleanup even after the UI becomes idle", async () => {
  const running = new Map([["visible", { cancelled: true }]]);
  let waits = 0;
  const { waitForWechatThreadIdle } = load(["waitForWechatThreadIdle"], {
    hasThreadCodexWork: () => false, activeChannelCodexInteractions: running,
    waitMs: async () => { waits++; running.delete("visible"); },
  });
  await waitForWechatThreadIdle("visible", 1000);
  assert.equal(waits, 1);
  running.set("visible", {});
  await assert.rejects(waitForWechatThreadIdle("visible", 0), /previous channel request/);
});

test("channel reply includes native plan and position reports from this turn only", () => {
  const item = (text, turnId, presentation = "execution-plan") =>
    ({ type: "agentMessage", text, turnId, __youleExecutionPlanPresentation: presentation });
  const state = { itemOrder: { t: ["old", "foreign", "plan", "position"] }, items: { t: {
    old: item("old plan", "turn"), foreign: item("other turn", "prior"),
    plan: item("verified plan", "turn"), position: item("position adjustment", "turn", "position-plan"),
  } } };
  const { newAgentReplyText } = load(["newAgentReplyText"], {
    state, wechatChannelReplyCandidates: () => [],
    wechatChannelFinalExternalReply: () => ({ text: "See the cards" }),
    wechatChannelAgentItemMatchesReplyScope: (item, scope) => item.turnId === scope.turnId,
    itemText: item => item.text, assistantVisibleText: text => text,
  });
  assert.equal(newAgentReplyText("t", new Set(["old"]), { turnId: "turn" }),
    "verified plan\n\nposition adjustment\n\nSee the cards");
});

test("channel reply accepts the Host-linked recovery turn and rejects unrelated turns", () => {
  const { wechatChannelAgentItemMatchesReplyScope, externalChannelArtifactMatchesReplyScope } = load([
    "wechatChannelAgentItemMatchesReplyScope", "externalChannelArtifactMatchesReplyScope",
  ], {
    firstString: (...values) => values.find(v => typeof v === "string" && v),
    itemTurnId: item => item.turnId,
    isVisibleLibraryArtifact: () => true,
    parseLibraryTimeMs: value => Date.parse(value) || 0,
    externalChannelRecoveryTurns: {
      matches: (thread, original, candidate) => thread === "channel" && original === "initial" && candidate === "recovered",
    },
  });
  const scope = { turnId: "initial", startedAtMs: 100 };
  assert.equal(wechatChannelAgentItemMatchesReplyScope({ turnId: "recovered" }, scope, "channel"), true);
  assert.equal(wechatChannelAgentItemMatchesReplyScope({ turnId: "next-user-turn" }, scope, "channel"), false);
  assert.equal(wechatChannelAgentItemMatchesReplyScope({ turnId: "recovered" }, scope, "other-channel"), false);
  assert.equal(externalChannelArtifactMatchesReplyScope({ turnId: "recovered" }, scope, 100, "channel"), true);
  assert.equal(externalChannelArtifactMatchesReplyScope({ turnId: "next-user-turn" }, scope, 100, "channel"), false);
});

test("all channels collect recovered answers and native cards while excluding a later user task", () => {
  const recovery = new ExternalChannelRecoveryTurns();
  const names = ["newAgentReplyText", "wechatChannelReplyCandidates", "wechatChannelCanUseAgentItemForExternalReply",
    "wechatChannelAgentItemMatchesReplyScope", "wechatChannelAgentItemPhase"];
  for (const channel of ["wechat", "feishu", "telegram"]) {
    recovery.note(channel, "initial", { status: "scheduled", chainId: channel });
    recovery.note(channel, "recovered", { status: "started", chainId: channel, failedTurnId: "initial" });
    const item = (text, turnId, extra = {}) => ({ type: "agentMessage", text, turnId, phase: "final_answer", ...extra });
    const items = {
      plan: item("verified plan", "initial", { __youleExecutionPlanPresentation: "execution-plan" }),
      answer: item("recovered final answer", "recovered"),
      chart: item("verified chart", "recovered", { __youleExecutionPlanPresentation: "chart" }),
      foreign: item("next request must stay private", "future"),
      progress: item("still working", "recovered", { phase: "commentary" }),
    };
    const { newAgentReplyText } = load(names, {
      state: { itemOrder: { [channel]: Object.keys(items) }, items: { [channel]: items } },
      firstString: (...values) => values.find(v => typeof v === "string" && v),
      itemTurnId: value => value.turnId, itemText: value => value.text, assistantVisibleText: value => value,
      externalChannelRecoveryTurns: recovery,
      wechatChannelFinalExternalReplySegment: text => text,
      wechatChannelFinalExternalReply: candidates => ({ text: candidates.map(c => c.text).join("\n") }),
    });
    const text = newAgentReplyText(channel, new Set(), { turnId: "initial" });
    assert.match(text, /verified plan/);
    assert.match(text, /recovered final answer/);
    assert.match(text, /verified chart/);
    assert.doesNotMatch(text, /next request|still working/);
  }
});

test("Host recovery notifications include the failed turn used to bind channel artifacts", () => {
  const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const tree = ts.createSourceFile("main.mjs", main, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "handleAutomaticTurnRecoveryEvent");
  const output = [];
  const handler = new Function("codexBusinessTools", "appendAppServerLogLine", "safeLogToken", "sendToRenderer",
    `${fn.getText(tree)};return handleAutomaticTurnRecoveryEvent;`)(
    { cancel() {} }, () => {}, value => value, (_channel, message) => output.push(message),
  );
  handler({ event: "started", threadId: "channel", turnId: "recovered", failedTurnId: "initial", chainId: "chain", attempt: 1 });
  assert.equal(output[0].params.turnId, "recovered");
  assert.equal(output[0].params.haoloAutoRecovery.failedTurnId, "initial");
});

test("chart image is collected as a native tool artifact; ordinary chats never capture another chart", async () => {
  const captures = [], collected = [];
  const { presentExternalTradingChart } = load(["presentExternalTradingChart"], {
    isExternalTradingWorkspaceThreadId: id => id === "channel",
    captureExternalTradingChartAttachment: async (...args) => { captures.push(args); return { path: "chart.png" }; },
    codexTradingTools: { collect: (id, items) => { collected.push([id, items]); return true; } },
  });
  await presentExternalTradingChart("ordinary");
  assert.equal(captures.length, 0);
  await presentExternalTradingChart("channel", true);
  assert.deepEqual(Array.from(captures[0]), ["channel", true, undefined]);
  assert.equal(collected[0][1][0].attachments[0].path, "chart.png");
});

test("capture rejects another market, interval and changes during rendering or IPC", async () => {
  for (const changeAt of ["before-market", "before-interval", "frame", "capture", "indicator-only", "none"]) {
    let chart = { marketId: "ETH", interval: "60" }, captures = 0;
    const expected = { ...chart };
    const state = { currentThreadId: "channel", tradingExpertChartFocusMode: true };
    if (changeAt === "before-market") chart = { ...chart, marketId: "BTC" };
    if (changeAt === "before-interval") chart = { ...chart, interval: "15" };
    const { captureExternalTradingChartAttachment } = load(["captureExternalTradingChartAttachment"], {
      state, tradingResolutionFromAlertInterval, isExternalTradingWorkspaceThreadId: () => true, wechatDebugLog() {},
      hasTradingExpertCurrentAnalysis: () => changeAt !== "indicator-only",
      tradingExpertAlertContextSnapshot: () => chart,
      root: { querySelector: () => ({ getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width: 100, height: 80 }) }) },
      window: {
        requestAnimationFrame: callback => { if (changeAt === "frame") chart = { ...chart, interval: "15" }; callback(); },
        codexDesktop: { captureTradingChart: async () => { captures++; if (changeAt === "capture") state.currentThreadId = "other"; return { path: "chart.png" }; } },
      },
      prepareTradingExpertMarketForExternalCapture: () => true, waitMs: async () => {},
      externalTradingChartCaptureAttachment: result => result,
    });
    const result = await captureExternalTradingChartAttachment("channel", false, expected);
    assert.equal(Boolean(result), ["indicator-only", "none"].includes(changeAt), changeAt);
    assert.equal(captures, ["capture", "indicator-only", "none"].includes(changeAt) ? 1 : 0, changeAt);
  }
});

test("drawing reports missing channel images as retryable errors and skips capture for empty patches", async () => {
  const declaration = ast.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(d => d.name.getText(ast) === "codexTradingTools"));
  const initializer = declaration.declarationList.declarations.find(d => d.name.getText(ast) === "codexTradingTools").initializer;
  const draw = initializer.arguments[0].properties.find(p => p.name?.getText(ast) === "draw").initializer;
  const js = ts.transpileModule(`exports.draw = ${draw.getText(ast)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}, calls = [];
  let count = 1, captured = false;
  vm.runInNewContext(js, {
    exports, beginTradingExpertAnalysisJob: () => "job",
    applyDeferredTradingDrawings: async () => ({ status: count ? "drawn" : "no-drawings", count }),
    presentExternalTradingChart: async (...args) => { calls.push(args); return captured; },
    finishTradingExpertAnalysisJob: () => calls.push("finished"),
  });
  const artifact = { result: { drawingArtifacts: [], marketId: "ETH", interval: "60" } };
  await assert.rejects(exports.draw("channel", artifact), /Drawings were saved/);
  assert.equal(calls[0][2], artifact.result);
  assert.equal(calls.at(-1), "finished");
  captured = true;
  assert.equal((await exports.draw("channel", artifact)).status, "drawn");
  calls.length = 0; count = 0;
  assert.equal((await exports.draw("channel", artifact)).status, "no-drawings");
  assert.deepEqual(calls, ["finished"]);
});
