// Opt-in: real bundled CLI and authenticated model, production MCP/Host, synthetic
// business data. Does not contact exchanges, cloud strategy engines or channels.
// Run from the repository root: node youle_desktop/scripts/codex-routing-live-audit.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { deflateSync } from "node:zlib";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";
import { CodexBusinessTools, CODEX_BUSINESS_TOOLS, CODEX_TRADING_INSTRUCTIONS } from "../src/main/codex-business-tools.mjs";
import { PersonalContextMcpBridge } from "../src/main/personal-context/mcp-bridge.mjs";
import { OFFICIAL_TRADING_CATALOG } from "../src/shared/official-trading-catalog.mjs";
import { DEFAULT_TRADING_PREFERENCE_ENTRIES } from "../src/main/personal-context/trading-preference-defaults.mjs";
import { CHANNEL_CODEX_INSTRUCTIONS } from "../src/main/channel-codex-input.mjs";
import { CodexProviderConversations } from "../src/main/codex-provider-conversation.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = path.join(root, "output", "route-scenario-audit-20261020", `live-${Date.now()}`);
const home = path.join(directory, "home"), cwd = path.join(directory, "workspace");
fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(cwd);
fs.writeFileSync(path.join(cwd, "expenses.json"), JSON.stringify({ expenses: [17, 29, 41] }));
// An isolated, deterministic image attachment for the native multimodal input.
const chunk = (name, data) => {
  const body = Buffer.concat([Buffer.from(name), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, body, checksum]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(128); ihdr.writeUInt32BE(128, 4); ihdr[8] = 8; ihdr[9] = 2;
const pixels = Buffer.alloc(128 * (128 * 3 + 1));
for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
  const offset = y * 385 + 1 + x * 3; pixels[offset] = 140; pixels[offset + 1] = 40; pixels[offset + 2] = 190;
}
const imagePath = path.join(cwd, "current-attachment.png");
fs.writeFileSync(imagePath, Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]));
for (const name of fs.readdirSync(path.join(root, "resources/default-haolo-ai/skills")).filter(n => n.startsWith("trading-") || n === "personal-context")) {
  fs.cpSync(path.join(root, "resources/default-haolo-ai/skills", name), path.join(home, "skills", name), { recursive: true });
}
const sessionPath = path.join(process.env.APPDATA, "haolo_desktop", "haolo-session.json");
const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
const apiKey = session.modelKeys?.find(k => k.provider === "codex")?.apiKey || session.modelApiKey;
assert.ok(apiKey, "An authenticated Haolo model session is required");
assert.equal(new URL(session.modelBaseUrl).origin, "https://haolo.pro");
const redact = text => [apiKey, session.token].filter(Boolean).reduce((s, secret) => s.split(secret).join("[redacted]"), String(text || ""));
const model = process.env.HAOLO_AUDIT_MODEL || "gpt-5.6-sol";
const stateless = process.env.HAOLO_AUDIT_STATELESS === "1";
const als = new AsyncLocalStorage();
const rows = [], pending = new Map(), turns = new Map(), threadRows = new Map();
let child, nextId = 0, stderr = "";
const broker = new CodexBusinessTools({
  owner: () => "isolated-routing-audit",
  preferencesRead: async () => ({ maxLossPerTradePercent: als.getStore()?.positionContract ? 0.5 : 2, maxLeverage: 10 }),
  accountRead: async () => {
    const row = als.getStore();
    if (row?.positionContract) return {
      available: !row.unbound, fetchedAt: new Date(Date.now() - (row.stale ? 300_000 : 0)).toISOString(),
      sources: { futures: "server", openOrders: "unavailable", positionHistory: "unavailable" },
      summary: { marginBalance: 1000, availableBalance: 900 },
      positions: [{ symbol: "SUIUSDT", direction: "SHORT", amount: 200, entryPrice: 1,
        markPrice: 1.01, notionalValue: 202, leverage: 20, marginType: "cross", liquidationPrice: 0 },
        ...(row.multiPosition ? [{ symbol: "BTCUSDT", direction: "LONG", amount: 0.02, entryPrice: 80000,
          markPrice: 81000, notionalValue: 1620, leverage: 5, marginType: "isolated", liquidationPrice: 0 }] : [])],
      openOrders: [], warnings: row.stale ? ["使用上次成功读取的数据"] : [],
    };
    return row?.unbound ? { available: false, reason: "No Binance account is bound", positions: null, summary: null } : {
      available: true, fetchedAt: new Date().toISOString(),
      sources: { futures: "server", openOrders: "unavailable" },
      summary: { estimatedTotalAssets: 10000, marginBalance: 10000, availableBalance: 8000 },
      positions: [{ symbol: "BTCUSDT", direction: "long", amount: 0.02, entryPrice: 80000, markPrice: 81000 }],
    };
  },
});
const bridge = new PersonalContextMcpBridge({
  envPrefix: "HAOLO_BUSINESS",
  tools: CODEX_BUSINESS_TOOLS.map(tool => ({ ...tool, inputSchema: {
    ...tool.inputSchema, properties: { ...tool.inputSchema.properties, context_id: { type: "string" } },
    required: [...(tool.inputSchema.required || []), "context_id"],
  } })),
  invoke: async params => {
    const context = [...broker.contexts.values()].find(c => c.token === params.arguments?.context_id);
    const row = threadRows.get(context?.threadId);
    if (!row) throw new Error("No active isolated audit context");
    const { context_id, ...args } = params.arguments;
    const call = { tool: params.tool, args, at: Date.now() };
    row.calls.push(call);
    if (row.calls.length > 28) throw new Error("Audit tool-call budget exceeded");
    return als.run(row, async () => {
      try {
        const result = await broker.invokeBound(params);
        call.ok = true;
        call.analysisRef = result?.analysisRef; call.draftRef = result?.draftRef;
        call.stage = result?.stage;
        if (result?.positionReview) call.review = result.positionReview;
        if (result?.answerRequired) call.answerRequired = true;
        return result;
      } catch (error) { call.ok = false; call.error = redact(error.message); throw error; }
    });
  },
});
const personalBridge = new PersonalContextMcpBridge({ invoke: async ({ tool }) => {
  if (tool === "read_user_memory") return { schemaVersion: 1, entries: DEFAULT_TRADING_PREFERENCE_ENTRIES };
  if (tool === "list_user_context_sources") return { schemaVersion: 1, sources: [{ id: "user.memory", available: true }, { id: "binance.account", available: true }] };
  // This audit has per-scenario accounts, selected via the bound business context.
  if (tool === "read_binance_account_context") throw new Error("Use haolo_account_read with the current turn context for this isolated account.");
  throw new Error("Persistent memory writes are outside this isolated audit");
} });

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
function save() {
  fs.writeFileSync(path.join(directory, "results.json"), redact(JSON.stringify({
    model, runtime: "bundled haolo_ai.exe", completedAt: new Date().toISOString(),
    scope: "Real model intent + real CLI/MCP/Host; synthetic account/cloud/UI/channel effects", stateless,
    productionWrites: false, rows,
  }, null, 2)) + "\n");
}
function execute(row, args) {
  row.effects.push({ ...args, artifact: args.artifact ? "[Host-owned artifact]" : undefined, simulation: args.simulation ? "[Host-owned simulation]" : undefined });
  if (args.action === "context") return { chart: row.noChart ? null : { symbol: "BTCUSDT", interval: "1h", marketId: "BINANCE:FUTURES:BTCUSDT" }, pending: null };
  if (args.action === "catalog") return { strategies: OFFICIAL_TRADING_CATALOG };
  if (args.action === "market_data") return row.marketQuestion
    ? { symbol: "BTCUSDT", interval: "1h", close: 83187.3, changePercent: 1.31, volumeVsPreviousClosedHour: 3.2,
      resistance: [83103, 83213], source: "synthetic audit candles", news: null, openInterest: null, liquidations: null }
    : { symbol: "BTCUSDT", interval: "1h", close: 81000, source: "synthetic audit data" };
  if (args.action === "analyze_only") {
    if (row.cloudFailure) return { result: { error: "Cloud strategy temporarily unavailable; no analysis or plan exists" } };
    if (row.noChart && !args.symbol && !args.marketId) return { result: { question: "请指定交易品种和周期。" } };
    if (row.positionContract) {
      const symbol = args.symbol || args.marketId?.split(":").at(-1);
      const marketId = args.marketId || `BINANCE:FUTURES:${symbol}`, interval = args.interval || "1h";
      const sui = symbol === "SUIUSDT";
      return { result: {
        report: "扫描完成：等待条件触发。",
        marketId, symbol, interval, analysisJobId: `synthetic-${row.id}`,
        cloudReports: [{ marketId, interval, strategyId: "price-action", runId: `synthetic-${row.id}-${symbol}`,
          report: sui ? "SUI一小时结构仍是高点和低点抬升，但上冲后跌回阻力下方。阻力1.02至1.04，支撑0.98。做空信号尚未确认，等待0.99以下收盘；不能把等待开仓等同于现有空仓安全。这里只是市场证据，没有读取实际保护单。"
            : "BTC一小时趋势偏多，81000附近震荡，79000结构失效，83000目标；未读取资金流和新闻。",
          executionPlan: { market: { marketId, interval }, planId: `reference-${symbol}`, action: "wait", expiresAt: Date.now() + 60_000,
            positionSizing: { estimatedRoundTripCostRate: 0.002 },
            scenarios: [{ id: "reference", side: sui ? "short" : "long", trigger: { price: sui ? 0.99 : 81000 },
              stop: { price: sui ? 1.04 : 79000 }, targets: [{ price: sui ? 0.98 : 83000 }] }],
          },
        }],
      }, presentationItems: [] };
    }
    return { result: {
      report: args.analysisKind === "general" ? "公开K线显示本小时涨幅1.31%，成交量为上一完整小时的3.2倍，价格回到83103至83213阻力区。放量突破后守住该区才支持延续，收盘跌回则突破失败。没有新闻、持仓量或爆仓数据，不能确认拉升的事件原因。"
        : row.noCandidate ? "云端计算结果：当前无有效入场候选，建议观望，不生成可执行开仓计划。"
        : `云端 ${args.strategyId || "general"} 分析：趋势震荡，等待突破确认。计划：观察 82000 阻力与 79000 支撑，暂不下单。${row.unbound ? "账户未绑定，不提供按账户计算的仓位数量。" : ""}`,
      symbol: args.symbol || "BTCUSDT", interval: args.interval || "1h",
      marketId: args.marketId || "BINANCE:FUTURES:BTCUSDT", analysisJobId: `synthetic-${row.id}-${row.effects.length}`,
    }, presentationItems: [] };
  }
  if (args.action === "draw") return { result: { drawn: true }, presentationItems: [{ id: `chart-${row.id}`, type: "agentMessage", text: "原生图表已显示" }] };
  if (args.action === "present") return { result: { presented: true }, presentationItems: [{ id: `plan-${row.id}`, type: "agentMessage", text: "原生分析/计划卡片已显示（隔离测试）" }] };
  if (args.action === "draft_prepare") return { result: { kind: args.kind, prepared: true, summary: row.prompt } };
  if (args.action === "simulate") return { result: { simulation: { simulationId: `sim-${row.id}` }, summary: "模拟K线显示条件触发；等待用户确认。", pending: { draftId: `draft-${row.id}` } } };
  if (args.action === "simulation_draw") return { result: { previewed: true }, presentationItems: [{ id: `preview-${row.id}`, type: "agentMessage", text: "模拟K线已显示，请确认当前条件。" }] };
  if (args.action === "draft_confirm") return { result: { confirmed: row.approval === true, ...(row.approval ? {} : { needsRevision: true }), id: row.approval ? `created-${row.id}` : null } };
  if (args.action === "draft_cancel") return { result: { cancelled: true } };
  if (args.action === "alert_step") return { result: { alerts: [{ alertId: "audit-alert", title: "BTC价格预警", status: "active" }], operation: args.operation, success: true } };
  if (args.action === "plan_manage") return { result: { plans: [{ planId: "audit-plan", symbol: "BTCUSDT", status: "active" }], operation: args.operation, success: true } };
  throw new Error(`Unconfigured synthetic effect: ${args.action}`);
}
const successful = (row, tool) => row.calls.filter(c => c.tool === tool && c.ok);
function marketQuestionChecks(row) {
  assert.equal(row.calls.some(c => ["haolo_plan_present", "haolo_chart_draw", "haolo_trading"].includes(c.tool)), false, "Market explanations must not enter the plan pipeline");
  assert.ok(row.effects.some(e => e.action === "market_data" || e.action === "analyze_only"), "Read market evidence before answering");
  for (const analysis of row.effects.filter(e => e.action === "analyze_only")) {
    assert.equal(analysis.analysisKind, "general");
    assert.equal(analysis.strategyId, undefined);
    assert.equal(analysis.drawingRequested, false);
  }
  assert.ok(row.answer.length > 60, "A substantive explanation must be delivered");
}
function analysisChecks(row, ids, { noDraw = false, position = false } = {}) {
  const account = row.calls.findIndex(c => c.tool === "haolo_account_read" && c.ok);
  assert.ok(account >= 0, "Account must be read");
  for (const id of ids) {
    const a = successful(row, "haolo_analysis").find(c => c.args.strategyId === id || ids.length === 1 && !c.args.strategyId);
    assert.ok(a?.analysisRef, `Missing successful analysis ${id}`);
    assert.ok(row.calls.indexOf(a) > account, "Account must precede analysis");
    if (!noDraw) assert.ok(successful(row, "haolo_chart_draw").some(c => c.args.analysisRef === a.analysisRef), "Missing same-ref drawing");
    if (!position) assert.ok(successful(row, "haolo_plan_present").some(c => c.args.analysisRef === a.analysisRef), "Missing same-ref plan");
    else assert.equal(successful(row, "haolo_plan_present").length, 0, "Position evidence cannot become an advice card");
  }
  assert.equal(row.calls.some(c => c.tool === "haolo_trading" && c.args.action === "analyze"), false, "New work must use independent skills");
  if (noDraw) assert.equal(successful(row, "haolo_chart_draw").length, 0, "No-drawing request violated");
}
function draftChecks(row, tool) {
  const prepared = successful(row, tool).find(c => c.args.operation === "prepare");
  assert.ok(prepared?.draftRef, "Draft must be prepared");
  const simulation = successful(row, "haolo_simulation").find(c => c.args.draftRef === prepared.draftRef);
  const preview = successful(row, "haolo_chart_draw").find(c => c.args.draftRef === prepared.draftRef);
  assert.ok(simulation && preview && row.calls.indexOf(preview) > row.calls.indexOf(simulation), "Same draft must be simulated before preview");
  assert.equal(row.effects.some(e => e.action === "draft_confirm"), false, "Cannot confirm within preparation turn");
}
async function run(spec, threadId) {
  const row = { ...spec, check: undefined, calls: [], effects: [], messages: [], startedAt: Date.now() };
  rows.push(row);
  let visibleThreadId = threadId;
  if (!threadId || stateless) {
    const thread = await rpc("thread/start", { cwd, model, modelProvider: "haolo_audit", approvalPolicy: "never", sandbox: spec.writeFile ? "workspace-write" : "read-only", ephemeral: true, developerInstructions: CODEX_TRADING_INSTRUCTIONS + (stateless ? "\n" + CHANNEL_CODEX_INSTRUCTIONS : "") });
    threadId = thread.thread.id;
  }
  visibleThreadId ||= threadId;
  row.threadId = threadId;
  row.visibleThreadId = visibleThreadId;
  threadRows.set(threadId, row);
  broker.bind(threadId, { client: child, visibleThreadId, userText: spec.prompt, executeTrading: args => execute(row, args),
    ...(spec.external ? { selectedModel: async () => ({ text: "外部所选模型的回答：节约用水，从关紧水龙头开始。", model: "isolated-selected-model" }) } : {}),
  });
  let timer;
  try {
    const terminal = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Live scenario exceeded 180 seconds")), 180000);
      turns.set(threadId, { resolve, reject });
    });
    // Attach a handler before turn/start so an early timeout/exit cannot be unhandled.
    terminal.catch(() => {});
    await rpc("turn/start", { threadId, model, effort: "low", input: [{ type: "text", text: broker.input(threadId, spec.prompt), textElements: [] }] });
    const turn = await terminal;
    assert.equal(turn.status, "completed", redact(JSON.stringify(turn.error || turn.status)));
    row.answer = row.messages.findLast(m => m.phase === "final_answer")?.text || "";
    assert.ok(row.answer, "A final answer is required");
    spec.check(row);
    row.passed = true;
  } catch (error) {
    row.passed = false; row.error = redact(error.message);
    await rpc("turn/interrupt", { threadId, turnId: broker.contexts.get(threadId)?.turnId }).catch(() => {});
  } finally {
    clearTimeout(timer); turns.delete(threadId); broker.cancel(threadId);
    row.durationMs = Date.now() - row.startedAt;
    save(); console.log(JSON.stringify({ id: row.id, passed: row.passed, tools: row.calls.map(c => c.tool.replace("haolo_", "") + (c.ok ? "" : "!")), error: row.error, durationMs: row.durationMs }));
  }
  return visibleThreadId;
}
async function runProductionRunner(spec) {
  const row = { ...spec, check: undefined, calls: [], effects: [], messages: [], startedAt: Date.now(), productionRunner: true };
  rows.push(row);
  const runner = new CodexProviderConversations({
    indexPath: path.join(directory, "must-not-create-channel-history.json"),
    request: (_client, method, params) => rpc(method, params), broker, owner: () => "isolated-routing-audit",
    configure: async () => ({ cwd, model, modelProvider: "haolo_audit", effort: "low",
      approvalPolicy: "never", sandbox: spec.writeFile ? "workspace-write" : "read-only",
      developerInstructions: CODEX_TRADING_INSTRUCTIONS + "\n" + CHANNEL_CODEX_INSTRUCTIONS }),
    registerThread: id => { row.threadId = id; threadRows.set(id, row); },
    recoverTurn: async ({ threadId }) => {
      row.recoveries = (row.recoveries || 0) + 1;
      let resumed;
      try { resumed = await rpc("thread/resume", { threadId, cwd, excludeTurns: true }); row.resumeMethod = "thread/resume"; }
      catch (error) {
        if (!/not found|no rollout|does not exist|ephemeral/i.test(error.message)) throw error;
        resumed = await rpc("thread/read", { threadId, includeTurns: false }); row.resumeMethod = "thread/read";
      }
      assert.equal(resumed.modelProvider || resumed.thread?.modelProvider, "haolo_audit");
      return { model, effort: "low" };
    },
  });
  try {
    const result = await runner.run({
      client: child, params: { provider: "channel-codex", threadId: spec.id, text: spec.prompt, cwd },
      isolated: true, mediaInputs: spec.image ? [{ type: "localImage", path: imagePath }] : [],
    });
    row.answer = result.text; row.turnIds = result.turnIds;
    spec.check(row); row.passed = true;
  } catch (error) { row.passed = false; row.error = redact(error.message); }
  finally {
    row.durationMs = Date.now() - row.startedAt; save();
    console.log(JSON.stringify({ id: row.id, passed: row.passed, error: row.error, durationMs: row.durationMs }));
  }
}
const scenarios = [
  { id: "position-contract", positionContract: true, noChart: true, prompt: "帮我看下真实持仓健康吗，要不要加仓或者减仓？请给出明确判断、依据和风险测算，不用画图。",
    check: r => {
      analysisChecks(r, ["price-action"], { noDraw: true, position: true });
      assert.ok(successful(r, "haolo_analysis").some(c => c.review?.positions?.[0]?.referenceRisk?.[0]?.exceedsRiskBudget));
      assert.match(r.answer, /SUI/); assert.match(r.answer, /8\.4/); assert.match(r.answer, /减仓|減倉|降低仓位/);
      assert.match(r.answer, /不.{0,6}加仓|不.{0,6}加倉|禁止加仓|暂停加仓/);
      assert.match(r.answer, /无法|不能确认|不可用|未.*(?:验证|核实|提供)|缺失/);
    } },
  { id: "position-contract-multi", positionContract: true, multiPosition: true, noChart: true,
    prompt: "帮我复核所有真实持仓健康度，逐笔告诉我加减仓建议和原因，不用画线。",
    check: r => {
      const symbols = r.effects.filter(e => e.action === "analyze_only").map(e => e.symbol || e.marketId?.split(":").at(-1));
      assert.ok(symbols.includes("SUIUSDT") && symbols.includes("BTCUSDT"), "Every holding needs its own market evidence");
      assert.match(r.answer, /SUI/); assert.match(r.answer, /BTC/);
      assert.equal(successful(r, "haolo_plan_present").length, 0);
    } },
  { id: "position-contract-stale", positionContract: true, stale: true, noChart: true,
    prompt: "看一下我的持仓健康吗，现在能加仓吗？不要画图。",
    check: r => { assert.match(r.answer, /过期|陈旧|缓存|不是实时|非实时|无法.*(?:确认|判断)|不能.*(?:确认|判断)/);
      assert.doesNotMatch(r.answer, /可以直接加仓|仓位很安全/); assert.equal(successful(r, "haolo_plan_present").length, 0); } },
  { id: "ordinary-context-trap", prompt: "我刚才一直在看交易图。现在换个问题：帮我解释为什么天空是蓝色的，用两句话。",
    check: r => { assert.equal(r.calls.length, 0); assert.match(r.answer, /散射/); assert.doesNotMatch(r.answer, /已绘制|计划卡/); } },
  { id: "ordinary-missing-file", prompt: "请读取当前目录里的 does-not-exist.txt 并总结正文。",
    check: r => { assert.equal(r.calls.length, 0); assert.match(r.answer, /不存在|未找到|没有找到|找不到|无法.*读取/); assert.doesNotMatch(r.answer, /总结如下|已完成总结/); } },
  { id: "market-rally-question", marketQuestion: true, noChart: true, prompt: "现在比特币怎么突然涨了，还能继续涨吗", check: marketQuestionChecks },
  { id: "market-general-overview", marketQuestion: true, noChart: true, prompt: "帮我分析一下 BTCUSDT 币安永续 1小时现在的行情。", check: marketQuestionChecks },
  { id: "market-explicit-plan", noChart: true, prompt: "为 BTCUSDT 币安永续 1小时制定一个交易计划，画出关键价位并展示计划卡片。", check: r => analysisChecks(r, ["price-action"]) },
  { id: "ordinary-writing", prompt: "帮我写一句祝同事生日快乐的话，简短自然。", check: r => assert.equal(r.calls.length, 0) },
  { id: "ordinary-code", prompt: "写一个 JavaScript 数组去重函数，解释一句即可。", check: r => { assert.equal(r.calls.length, 0); assert.match(r.answer, /Set|filter|reduce/); } },
  { id: "ordinary-file-read", prompt: "读取当前工作目录里的 expenses.json，计算 expenses 数组的合计，告诉我结果。", check: r => { assert.equal(r.calls.length, 0); assert.match(r.answer, /87/); assert.ok(r.commands?.some(c => c.exitCode === 0), "A real file command is required"); } },
  { id: "ordinary-file-write", writeFile: true, prompt: "在当前工作目录创建 audit-note.txt，文件内容精确为 Hello from Codex，再读取一次确认写入成功。", check: r => { assert.equal(r.calls.length, 0); assert.equal(fs.readFileSync(path.join(cwd, "audit-note.txt"), "utf8").trim(), "Hello from Codex"); } },
  { id: "concept-only", prompt: "MACD 金叉是什么意思？只解释概念，不分析实时行情。", check: r => assert.equal(successful(r, "haolo_analysis").length, 0) },
  ...OFFICIAL_TRADING_CATALOG.filter(s => s.enabled).map(s => ({
    id: `strategy-${s.id}`, prompt: `@${s.mentions.canonical} 分析 BTCUSDT 币安永续 1 小时现在的交易机会，画在图上并给出计划卡片。`, check: r => analysisChecks(r, [s.id]),
  })),
  { id: "position-default", prompt: "请实时看我的 BTC 仓位，现在应该怎么调整？帮我画出来，给出仓位调整方案。", check: r => { analysisChecks(r, ["price-action"], { position: true }); assert.ok(r.effects.some(e => e.action === "analyze_only" && e.strategyId === "price-action" && e.positionManagementRequested)); assert.ok(r.answer.length > 80); } },
  { id: "no-drawing", prompt: "@裸K 分析 BTCUSDT 1 小时，给我计划，但这次不要画线或改动图表。", check: r => analysisChecks(r, ["price-action"], { noDraw: true }) },
  { id: "two-strategies", prompt: "@裸K @MACD 分别分析 BTCUSDT 永续 1 小时，分别画线和展示计划，再比较结论。", check: r => analysisChecks(r, ["price-action", "macd-analysis"]) },
  { id: "account-unavailable", unbound: true, prompt: "@裸K 分析 BTCUSDT 1 小时并给我计划，账户未绑定也请继续公共行情分析。", check: r => analysisChecks(r, ["price-action"]) },
  { id: "cloud-failure", cloudFailure: true, prompt: "@裸K 分析 BTCUSDT 1 小时并给我图表和计划。", check: r => { assert.ok(successful(r, "haolo_analysis").length); assert.equal(successful(r, "haolo_plan_present").length, 0); assert.equal(successful(r, "haolo_chart_draw").length, 0); } },
  { id: "no-candidate", noCandidate: true, prompt: "@裸K 分析 BTCUSDT 1 小时，展示图表和计划；没有机会就明确观望。", check: r => { analysisChecks(r, ["price-action"]); assert.match(r.answer, /观望|无.*候选|没有.*机会|等待/); } },
  { id: "mixed-request", prompt: "先帮我写一句生日祝福，再用 @裸K 分析 BTCUSDT 1 小时，画图并给出计划。", check: r => { analysisChecks(r, ["price-action"]); assert.match(r.answer, /生日/); } },
  { id: "explicit-spot", prompt: "@裸K 分析币安 ETHUSDT 现货 4 小时，不要用永续，画线并给我计划。", check: r => { analysisChecks(r, ["price-action"]); const a = r.effects.find(e => e.action === "analyze_only"); assert.equal(a.marketId, "BINANCE:SPOT:ETHUSDT"); assert.equal(a.interval, "4h"); } },
  { id: "account-facts", prompt: "只读取我的币安账户净值、可用余额和当前仓位，不需要策略分析。", check: r => { assert.ok(successful(r, "haolo_account_read").length); assert.equal(successful(r, "haolo_analysis").length, 0); assert.match(r.answer, /10,?000/); } },
  { id: "missing-market", noChart: true, prompt: "帮我看看现在怎么交易。", check: r => { assert.equal(successful(r, "haolo_plan_present").length, 0); assert.equal(r.effects.some(e => e.action === "analyze_only" && (e.symbol || e.marketId)), false, "Must not invent a market"); assert.match(r.answer, /品种|标的|币种|交易对|哪|周期/); } },
  { id: "selected-model", external: true, prompt: "请用我所选的模型写一句节约用水的标语。", check: r => assert.ok(successful(r, "haolo_selected_model").length) },
  { id: "saved-alerts", prompt: "列出我已经创建的预警。", check: r => assert.ok(successful(r, "haolo_alerts").some(c => c.args.operation === "list")) },
  { id: "saved-plans", prompt: "列出我的交易计划。", check: r => assert.ok(successful(r, "haolo_plans").some(c => c.args.operation === "list")) },
];
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
try {
  const bridgeEnv = { ...await bridge.start(), ...await personalBridge.start() };
  const settings = [
    `model=${JSON.stringify(model)}`, 'model_provider="haolo_audit"', 'model_reasoning_effort="low"',
    'windows.sandbox="unelevated"', "features.network_proxy.enabled=false",
    "features.remote_plugin=false", "features.plugins=false", "features.apps=false",
    'model_providers.haolo_audit.name="Haolo isolated routing audit"',
    `model_providers.haolo_audit.base_url=${JSON.stringify(session.modelBaseUrl)}`,
    'model_providers.haolo_audit.wire_api="responses"', 'model_providers.haolo_audit.env_key="OPENAI_API_KEY"',
    "model_providers.haolo_audit.requires_openai_auth=true", "model_providers.haolo_audit.supports_websockets=false",
    'model_providers.haolo_audit.http_headers.version="0.163.0"',
    'model_providers.haolo_audit.http_headers.X-Haolo-Model-Pool="execution"',
    'model_providers.haolo_audit.http_headers.X-Haolo-Model-Capability="root_execution"',
    `mcp_servers.haolo_business.command=${JSON.stringify(process.execPath)}`,
    `mcp_servers.haolo_business.args=[${JSON.stringify(path.join(root, "resources/mcp/business-server/index.mjs"))}]`,
    'mcp_servers.haolo_business.env_vars=["HAOLO_BUSINESS_BROKER_URL","HAOLO_BUSINESS_BROKER_TOKEN"]',
    'mcp_servers.haolo_business.default_tools_approval_mode="approve"',
    `mcp_servers.personal_context.command=${JSON.stringify(process.execPath)}`,
    `mcp_servers.personal_context.args=[${JSON.stringify(path.join(root, "resources/mcp/personal-context-server/index.mjs"))}]`,
    'mcp_servers.personal_context.env_vars=["HAOLO_PERSONAL_CONTEXT_BROKER_URL","HAOLO_PERSONAL_CONTEXT_BROKER_TOKEN"]',
    'mcp_servers.personal_context.default_tools_approval_mode="approve"',
  ];
  const env = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "COMSPEC", "PATHEXT"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  Object.assign(env, bridgeEnv, { CODEX_HOME: home, USERPROFILE: directory, OPENAI_API_KEY: apiKey });
  child = spawn(path.join(root, "resources/bin/haolo_ai.exe"), [...settings.flatMap(s => ["-c", s]), "app-server", "--stdio"], { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", b => { stderr = redact(stderr + b).slice(-5000); });
  const lines = readline.createInterface({ input: child.stdout });
  child.on("error", e => { for (const p of turns.values()) p.reject(e); });
  child.on("exit", () => { lines.close(); for (const p of turns.values()) p.reject(new Error("CLI exited")); });
  lines.on("line", line => {
    let m; try { m = JSON.parse(line); } catch { return; }
    const p = pending.get(m.id);
    if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(new Error(redact(m.error.message))) : p.resolve(m.result); return; }
    if (m.id != null && m.method) { child.stdin.write(JSON.stringify({ id: m.id, error: { code: -32601, message: "No interactive approvals in this audit" } }) + "\n"); return; }
    const threadId = m.params?.threadId;
    if (m.method === "turn/started") broker.start(threadId, m.params.turn.id, child);
    if (m.method === "item/completed") {
      const item = m.params.item, row = threadRows.get(threadId);
      if (row && item?.type === "agentMessage") row.messages.push({ phase: item.phase, text: item.text });
      if (row && item?.type === "commandExecution") (row.commands ||= []).push({ command: item.command, exitCode: item.exitCode });
      if (row && item?.type === "mcpToolCall" && item.server === "personal_context") (row.personalCalls ||= []).push({ tool: item.tool, status: item.status });
    }
    if (m.method === "turn/completed") turns.get(threadId)?.resolve(m.params.turn);
    const row = threadRows.get(threadId);
    if (m.method === "turn/completed" && row?.forceRecovery && !row.failureInjected && m.params.turn.status === "completed") {
      row.failureInjected = true;
      // Fault injection after a real turn verifies continuation on the actual
      // ephemeral CLI root, using the production runner and provider check.
      child.emit("notification", { ...m, params: { ...m.params, turn: { ...m.params.turn,
        status: "failed", error: { message: "stream disconnected before completion (audit fault injection)" } } } });
    } else child.emit("notification", m);
  });
  await rpc("initialize", { clientInfo: { name: "haolo_routing_audit", version: "1" }, capabilities: { experimentalApi: true } });
  child.stdin.write('{"method":"initialized","params":{}}\n');
  const skills = await rpc("skills/list", { cwds: [cwd], forceReload: true });
  for (const s of OFFICIAL_TRADING_CATALOG.filter(s => s.enabled)) assert.ok(JSON.stringify(skills).includes(`trading-analysis-${s.id}`));
  console.log(JSON.stringify({ stage: "ready", directory, model, strategies: OFFICIAL_TRADING_CATALOG.filter(s => s.enabled).length }));
  const queue = scenarios.filter(s => !filter || filter.test(s.id));
  const concurrency = Math.max(1, Math.min(2, Number(process.env.HAOLO_AUDIT_CONCURRENCY || 1)));
  let serviceFailures = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      if (serviceFailures >= 3) throw new Error("Audit stopped after three upstream failures; remaining scenarios were not tested");
      const spec = queue.shift();
      await run(spec);
      const row = rows.findLast(r => r.id === spec.id);
      if (!row.passed && /429|503|Too Many Requests|Service Unavailable/.test(row.error || "")) serviceFailures++;
    }
  }));
  for (const spec of [
    { id: "runtime-current-image", image: true, prompt: "这条消息附的图片主要是什么颜色？只回答颜色，不要读本地文件。", check: r => assert.match(r.answer, /紫|purple|violet/i) },
    { id: "runtime-current-file", prompt: "只读取本条消息引用的 expenses.json，计算 expenses 总和。", check: r => { assert.match(r.answer, /87/); assert.ok(r.commands?.some(c => c.exitCode === 0)); } },
    { id: "runtime-ephemeral-recovery", forceRecovery: true, prompt: "本条任务的编号是青色海豚。请仅回复这个编号，不要保存到长期记忆。", check: r => {
      assert.match(r.answer, /青色海豚/); assert.equal(r.recoveries, 1); assert.equal(r.turnIds.length, 2);
    } },
  ].filter(s => !filter || filter.test(s.id))) await runProductionRunner(spec);
  if (!filter || filter.test("workflow")) {
    if (stateless) {
      const memory = await run({ id: "workflow-no-history-seed", prompt: "我这次讨论的代号是紫色水獭。只回复收到，不要保存到长期记忆。", check: r => assert.equal(r.calls.length, 0) });
      await run({ id: "workflow-no-history-check", prompt: "我上一条说的代号是什么？", check: r => assert.doesNotMatch(r.answer, /紫色水獭/) }, memory);
    }
    const thread = await run({ id: "workflow-alert-prepare", prompt: "帮我创建 BTCUSDT 1 小时价格突破 82000 的预警，先给我模拟K线确认。", check: r => draftChecks(r, "haolo_alerts") });
    await run({ id: "workflow-alert-revise", prompt: "先别创建，价格改成 83000，重新给我看模拟效果。", check: r => draftChecks(r, "haolo_alerts") }, thread);
    await run({ id: "workflow-alert-natural-confirm", approval: true, prompt: "这版条件没问题，就照这个开始监控吧。", check: r => assert.ok(r.effects.some(e => e.action === "draft_confirm")) }, thread);
    const cancelThread = await run({ id: "workflow-alert-cancel-prepare", prompt: "帮我创建 BTCUSDT 跌破 79000 的预警，先模拟。", check: r => draftChecks(r, "haolo_alerts") });
    await run({ id: "workflow-alert-natural-cancel", prompt: "想了想还是算了，别建这个了。", check: r => { assert.ok(r.effects.some(e => e.action === "draft_cancel")); assert.equal(r.effects.some(e => e.action === "draft_confirm"), false); } }, cancelThread);
    const personal = await run({ id: "workflow-personal-prepare", prompt: "创建我的个人策略：BTCUSDT 1 小时 MA5 上穿 MA20 时产生信号，下穿时退出。先模拟给我确认。", check: r => draftChecks(r, "haolo_personal_strategy") });
    await run({ id: "workflow-personal-confirm", approval: true, prompt: "逻辑符合我的想法，按这一版创建。", check: r => assert.ok(r.effects.some(e => e.action === "draft_confirm" && e.kind === "personal")) }, personal);
    const display = await run({ id: "workflow-display-analysis", prompt: "@裸K 分析 BTCUSDT 1 小时，画图和给出计划卡片。", check: r => analysisChecks(r, ["price-action"]) });
    await run({ id: "workflow-display-reuse", prompt: "再展示刚才的计划卡片，不要重新分析。", check: r => { assert.equal(successful(r, "haolo_analysis").length, 0); assert.ok(successful(r, "haolo_plan_present").length); } }, display);
  }
} catch (error) {
  fs.writeFileSync(path.join(directory, "fatal.json"), JSON.stringify({ error: redact(error.message), stderr }, null, 2));
  console.error(redact(error.stack)); process.exitCode = 1;
} finally {
  for (const p of pending.values()) clearTimeout(p.timer);
  for (const id of broker.contexts.keys()) broker.cancel(id);
  if (child && child.exitCode === null) {
    const exited = new Promise(r => child.once("exit", r)); child.kill(); await exited;
  }
  await bridge.stop(); await personalBridge.stop(); save();
  const failed = rows.filter(r => !r.passed);
  console.log(JSON.stringify({ directory, passed: rows.length - failed.length, failed: failed.map(r => r.id), total: rows.length }));
  if (failed.length) process.exitCode = 1;
}
