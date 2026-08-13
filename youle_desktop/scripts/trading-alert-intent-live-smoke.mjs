import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AppServerClient, resolveCodexCommand } from "../src/main/app-server-client.mjs";
import { stableHash } from "../src/main/trading-alerts/protocol.mjs";
import { TradingAlertService } from "../src/main/trading-alerts/service.mjs";

const workspace = path.resolve(process.cwd());
const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-alert-intent-live-"));
const codexHome = path.join(probeRoot, "agent-home");
const authPath = process.env.HAOLO_LIVE_SMOKE_AUTH_PATH
  || path.join(process.env.APPDATA || "", "haolo_desktop", "default-haolo-ai", "auth.json");
const client = new AppServerClient({
  cwd: workspace,
  codexCommand: resolveCodexCommand(workspace),
  codexHome,
  authPath,
});
const liveThreadIds = new Set();
const rawModelResponses = [];
let service = null;

function captureTurn(targetThreadId, timeoutMs = 180_000) {
  let expectedTurnId = "";
  let text = "";
  let timer;
  let resolvePromise;
  let rejectPromise;
  const cleanup = () => {
    clearTimeout(timer);
    client.off("notification", onNotification);
  };
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const onNotification = (message) => {
    const incomingThreadId = String(message?.params?.threadId || message?.params?.thread?.id || "");
    const incomingTurnId = String(message?.params?.turnId || message?.params?.turn?.id || "");
    if (incomingThreadId !== targetThreadId && (!expectedTurnId || incomingTurnId !== expectedTurnId)) return;
    if (expectedTurnId && incomingTurnId && incomingTurnId !== expectedTurnId) return;
    if (message.method === "item/agentMessage/delta") text += String(message.params?.delta || "");
    if (["item/started", "item/completed"].includes(message.method)) {
      const item = message.params?.item;
      if (item?.type === "agentMessage" && item.text) text = String(item.text);
    }
    if (message.method === "turn/completed") {
      cleanup();
      resolvePromise(text.trim());
    }
    if (message.method === "turn/failed") {
      cleanup();
      rejectPromise(new Error(String(message.params?.error?.message || "live intent turn failed")));
    }
  };
  client.on("notification", onNotification);
  timer = setTimeout(() => {
    cleanup();
    rejectPromise(new Error(`live intent turn timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  return {
    promise,
    expectTurn(turnId) { expectedTurnId = String(turnId || ""); },
  };
}

async function invokeLiveIntentModel({ modelId, request }) {
  const started = await client.request("thread/start", {
    cwd: workspace,
    model: modelId || "gpt-5.6-sol",
    reasoningEffort: "medium",
    approvalPolicy: "never",
    sandbox: "read-only",
    developerInstructions: [
      "You are the read-only natural-language compiler for Haolo trading alerts.",
      "Never call tools or create side effects.",
      "Return exactly one JSON object requested by the prompt.",
    ].join("\n"),
    ephemeral: true,
  });
  const threadId = String(started?.thread?.id || "");
  if (!threadId) throw new Error("live intent thread/start returned no id");
  liveThreadIds.add(threadId);
  try {
    const capture = captureTurn(threadId);
    const turn = await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: request.prompt, textElements: [] }],
      cwd: workspace,
      model: modelId || "gpt-5.6-sol",
      effort: "medium",
      serviceTier: null,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly" },
    });
    capture.expectTurn(turn?.turn?.id || turn?.turnId || turn?.id);
    const text = await capture.promise;
    rawModelResponses.push({ requestId: request.requestId, text });
    return { status: "success", text, modelId: modelId || "gpt-5.6-sol" };
  } finally {
    liveThreadIds.delete(threadId);
    await client.request("thread/delete", { threadId }).catch(() => {});
  }
}

const smokeScenario = String(process.env.HAOLO_ALERT_INTENT_SMOKE_SCENARIO || "drawing").trim().toLowerCase();
if (!["drawing", "ma-death-cross", "ma-macd", "volume-spike"].includes(smokeScenario)) {
  throw new Error(`Unsupported HAOLO_ALERT_INTENT_SMOKE_SCENARIO: ${smokeScenario}`);
}
const chartInterval = smokeScenario === "ma-death-cross" ? "4h" : ["ma-macd", "volume-spike"].includes(smokeScenario) ? "1h" : "15m";
const sourceText = smokeScenario === "ma-death-cross"
  ? "当MA5和MA20死叉的时候预警"
  : smokeScenario === "ma-macd"
    ? "当MA5和MA20死叉，同时MACD DIF下穿0轴的时候预警"
    : smokeScenario === "volume-spike"
      ? "当当前量能比前3根K线每一根的量能都大于3倍时预警"
    : "当K线触碰或者突破我画的趋势线的时候预警";
const intervalMs = smokeScenario === "ma-death-cross" ? 4 * 60 * 60_000 : ["ma-macd", "volume-spike"].includes(smokeScenario) ? 60 * 60_000 : 15 * 60_000;
const lastCloseTime = Math.floor(Date.now() / intervalMs) * intervalMs;
const historyLength = smokeScenario === "ma-macd" ? 160 : smokeScenario === "ma-death-cross" ? 120 : 80;
const history = Array.from({ length: historyLength }, (_, index) => {
  const close = 100 + index * 0.05;
  return {
    time: lastCloseTime - (historyLength - index) * intervalMs,
    closeTime: lastCloseTime - (historyLength - 1 - index) * intervalMs,
    open: close - 0.02,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 1_000,
  };
});
const drawing = {
  drawingId: "line-live-smoke",
  revision: 1,
  geometryMode: "extended",
  points: [
    { time: lastCloseTime - intervalMs, price: 106 },
    { time: lastCloseTime, price: 104 },
  ],
};

function expressionContainsTemporalVolume(expression) {
  if (!expression || typeof expression !== "object") return false;
  if (["lag", "rolling"].includes(expression.type)) {
    const source = expression.expr;
    if (source?.type === "field" && source.field === "volume") return true;
    return expressionContainsTemporalVolume(source);
  }
  return (expression.args || []).some(expressionContainsTemporalVolume);
}

function ruleContainsTemporalVolume(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "condition") {
    const { left, right } = node.condition;
    const currentVolume = [left, right].some((expression) => expression?.type === "field" && expression.field === "volume");
    return currentVolume && [left, right].some(expressionContainsTemporalVolume);
  }
  return Boolean(
    (node.child && ruleContainsTemporalVolume(node.child))
    || (node.children || node.steps || []).some(ruleContainsTemporalVolume)
  );
}

function isExactPriorThreeMaxTripled(expression) {
  if (expression?.type !== "math" || expression.op !== "mul" || expression.args?.length !== 2) return false;
  const constant = expression.args.find((argument) => argument?.type === "constant");
  const rolling = expression.args.find((argument) => argument?.type === "rolling");
  return Number(constant?.value) === 3
    && rolling?.op === "max"
    && Number(rolling?.period) === 3
    && Number(rolling?.offset) === 1
    && rolling?.expr?.type === "field"
    && rolling.expr.field === "volume";
}

function ruleContainsExactVolumeSpike(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "condition") {
    const { operator, left, right } = node.condition;
    return operator === "gt"
      && left?.type === "field"
      && left.field === "volume"
      && isExactPriorThreeMaxTripled(right);
  }
  return Boolean(
    (node.child && ruleContainsExactVolumeSpike(node.child))
    || (node.children || node.steps || []).some(ruleContainsExactVolumeSpike)
  );
}
let physicalSubscriptions = 0;
const marketAdapter = {
  providerId: "binance-public",
  async loadHistory() { return history; },
  async subscribe() {
    physicalSubscriptions += 1;
    return async () => { physicalSubscriptions -= 1; };
  },
};

try {
  await client.start();
  service = new TradingAlertService({
    dataDir: path.join(probeRoot, "service-data"),
    enabled: true,
    marketAdapter,
    invokeIntentModel: invokeLiveIntentModel,
  });
  await service.start();
  if (smokeScenario === "drawing") {
    await service.syncDrawings({
      marketId: "BINANCE:FUTURES:BTCUSDT",
      interval: chartInterval,
      drawings: [drawing],
    });
  }
  const compiled = await service.compile({
    threadId: "thread-live-intent-smoke",
    sourceText,
    conversation: [{ role: "user", text: sourceText }],
    currentChart: { marketId: "BINANCE:FUTURES:BTCUSDT", interval: chartInterval },
    drawings: smokeScenario === "drawing" ? [drawing] : [],
  });
  if (compiled.draft.status !== "ready_to_simulate" || !compiled.draft.rule) {
    throw new Error(`live intent did not produce an executable draft: ${compiled.draft.status}`);
  }
  const volumeTemporalRule = smokeScenario !== "volume-spike" || ruleContainsTemporalVolume(compiled.draft.rule.root);
  if (!volumeTemporalRule) throw new Error("live intent volume scenario did not preserve the historical volume window");
  const exactVolumeSemantics = smokeScenario !== "volume-spike" || ruleContainsExactVolumeSpike(compiled.draft.rule.root);
  if (!exactVolumeSemantics) throw new Error("live intent volume scenario did not preserve the exact previous-three maximum times three semantics");
  const simulated = await service.simulate({
    draftId: compiled.draft.draftId,
    frames: {
      primary: {
        interval: chartInterval,
        candles: history,
        closed: true,
        coverage: "available",
        drawings: smokeScenario === "drawing" ? { [drawing.drawingId]: drawing } : {},
      },
    },
    maxBars: smokeScenario === "ma-macd" ? 24 : smokeScenario === "ma-death-cross" ? 12 : smokeScenario === "volume-spike" ? 8 : 4,
    beamWidth: smokeScenario === "ma-macd" ? 128 : smokeScenario === "ma-death-cross" ? 96 : smokeScenario === "volume-spike" ? 32 : 48,
  });
  const confirmed = await service.confirm({
    draftId: compiled.draft.draftId,
    simulationId: simulated.simulation.simulationId,
    confirmationId: simulated.simulation.confirmation.confirmationId,
    alertId: "alert-live-intent-smoke",
  });
  const snapshot = await service.snapshot();
  const passed = simulated.simulation.proof.triggered === true
    && rawModelResponses.length >= 1
    && compiled.provider.modelId !== "local-deterministic"
    && confirmed.alert.status === "monitoring"
    && snapshot.engine.running === true
    && snapshot.engine.alerts === 1
    && snapshot.engine.subscriptions === 1
    && physicalSubscriptions === 1
    && volumeTemporalRule
    && exactVolumeSemantics;
  process.stdout.write(`${JSON.stringify({
    passed,
    modelResponses: rawModelResponses.map((entry) => ({
      requestId: entry.requestId,
      length: entry.text.length,
      sha256: stableHash(entry.text),
    })),
    chain: {
      scenario: smokeScenario,
      compilerPath: compiled.provider.modelId,
      modelAttempts: rawModelResponses.length,
      draftStatus: compiled.draft.status,
      ruleHash: compiled.draft.rule.ruleHash,
      drawingBinding: compiled.draft.rule.contexts[0].drawingBinding || null,
      simulationTriggered: simulated.simulation.proof.triggered,
      volumeTemporalRule,
      exactVolumeSemantics,
      confirmationId: simulated.simulation.confirmation.confirmationId,
      alertStatus: confirmed.alert.status,
      engine: snapshot.engine,
      physicalSubscriptions,
    },
  }, null, 2)}\n`);
  if (!passed) process.exitCode = 2;
} finally {
  await service?.shutdown().catch(() => {});
  for (const threadId of liveThreadIds) await client.request("thread/delete", { threadId }).catch(() => {});
  await client.stop().catch(() => {});
  let cleanupError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.promises.rm(probeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      cleanupError = null;
      break;
    } catch (error) {
      cleanupError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (cleanupError) process.stderr.write(`live smoke temporary cleanup deferred: ${cleanupError.message}\n`);
}
