import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import test from "node:test";
import { CodexBusinessTools, CODEX_BUSINESS_TOOLS, CODEX_TRADING_INSTRUCTIONS } from "../src/main/codex-business-tools.mjs";
import { PersonalContextMcpBridge } from "../src/main/personal-context/mcp-bridge.mjs";
import { businessPresentationItems } from "../src/shared/codex-business-presentation.mjs";
import { requestWithThreadHistoryRecovery } from "../src/main/thread-history-recovery.mjs";

const testArch = process.env.HAOLO_TEST_CODEX_ARCH || process.arch;
const runtime = fileURLToPath(new URL(process.platform === "darwin"
  ? `../resources/bin/darwin-${testArch}/haolo_ai` : "../resources/bin/haolo_ai.exe", import.meta.url));
// Real bundled CLI + real MCP transport; the model and cloud execution are local fixtures.
// This verifies protocol, ownership and persistence, not live-model intent accuracy.
test("Codex 0.163 runs business MCP in new and restored conversations and retains native cards", {
  skip: !["win32", "darwin"].includes(process.platform) || !fs.existsSync(runtime), timeout: 60_000,
}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-business-runtime-"));
  const home = path.join(directory, "home"), cwd = path.join(directory, "workspace");
  fs.mkdirSync(home); fs.mkdirSync(cwd);
  const skillRoot = fileURLToPath(new URL("../resources/default-haolo-ai/skills/", import.meta.url));
  for (const name of fs.readdirSync(skillRoot).filter(name=>name.startsWith("trading-"))) {
    fs.cpSync(path.join(skillRoot,name), path.join(home,"skills",name), {recursive:true});
  }
  const pending = new Map(), events = [], modelInputs = [], executions = [];
  let child, nextId = 0, activeContext, scenario = "plain", step = 0, stderr = "";
  let lastAnalysisRef, lastDraftRef;
  const broker = new CodexBusinessTools({ owner: () => "fixture-account", accountRead:async()=>({available:true,positions:[]}) });
  const bridge = new PersonalContextMcpBridge({
    envPrefix: "HAOLO_BUSINESS", invoke: async p => {
      const result = await broker.invokeBound(p);
      if (result?.analysisRef) lastAnalysisRef = result.analysisRef;
      if (result?.draftRef) lastDraftRef = result.draftRef;
      return result;
    },
    tools: CODEX_BUSINESS_TOOLS.map(tool => ({ ...tool, inputSchema: {
      ...tool.inputSchema, properties: { ...tool.inputSchema.properties, context_id: { type: "string" } },
      required: [...(tool.inputSchema.required || []), "context_id"],
    }})),
  });
  const bridgeEnv = await bridge.start();
  const model = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    if (request.url !== "/v1/responses") { response.writeHead(404).end(); return; }
    let body = Buffer.concat(chunks);
    if (request.headers["content-encoding"] === "gzip") body = zlib.gunzipSync(body);
    if (request.headers["content-encoding"] === "zstd") body = zlib.zstdDecompressSync(body);
    const input = JSON.parse(body); modelInputs.push(input);
    const sequence = scenario === "workflow" ? ["haolo_alerts","haolo_simulation","haolo_chart_draw"] :
      scenario === "workflow-confirm" ? ["haolo_alerts"] : ["haolo_account_read","haolo_analysis","haolo_chart_draw","haolo_plan_present"];
    const modular = ["modular","workflow","workflow-confirm"].includes(scenario);
    const modularStep = modular ? step++ : -1;
    const callTool = modular ? modularStep < sequence.length : scenario !== "plain" && step++ === 0;
    const id = `local_${modelInputs.length}`;
    const item = callTool
      ? { id: `fc_${id}`, type: "function_call", call_id: `call_${id}`,
          namespace: "mcp__haolo_business", name: modular ? sequence[modularStep] : "haolo_trading", arguments: JSON.stringify(scenario.startsWith("workflow") ? {
            context_id: activeContext.token,
            ...(scenario === "workflow-confirm" ? {operation:"confirm",draftRef:lastDraftRef}
              : modularStep === 0 ? {operation:"prepare"} : {draftRef:lastDraftRef}),
          } : scenario === "modular" ? {
            context_id: activeContext.token,
            ...(modularStep === 1 ? {strategyId:"price-action",symbol:"ETHUSDT",drawingRequested:true} : {}),
            ...(modularStep > 1 ? {analysisRef:lastAnalysisRef} : {}),
          } : {
            context_id: activeContext.token, action: scenario === "confirm" ? "alert" : "analyze",
            instruction: "Analyze ETH; no drawing", symbol: "ETHUSDT", interval: "1h",
            drawingRequested: false, positionManagementRequested: true,
          }), status: "completed" }
      : { id: `msg_${id}`, type: "message", role: "assistant", phase: "final_answer", status: "completed",
          content: [{ type: "output_text", text: `done ${scenario}`, annotations: [] }] };
    const stream = [
      { type: "response.created", response: { id, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: callTool ? { ...item, arguments: "", status: "in_progress" } : { ...item, content: [], status: "in_progress" } },
      callTool ? { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: item.arguments }
        : { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { id, status: "completed", output: [item], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } } },
    ];
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(stream.map(value => `data: ${JSON.stringify(value)}\n\n`).join(""));
  });
  await new Promise(r => model.listen(0, "127.0.0.1", r));
  const mcpPath = fileURLToPath(new URL("../resources/mcp/business-server/index.mjs", import.meta.url));
  const settings = [
    'model="gpt-5.6-sol"', 'model_provider="local_business"', "features.remote_plugin=false", "features.plugins=false", "features.apps=false",
    'model_providers.local_business.name="Local test"',
    `model_providers.local_business.base_url="http://127.0.0.1:${model.address().port}/v1"`,
    'model_providers.local_business.wire_api="responses"', "model_providers.local_business.requires_openai_auth=false",
    "model_providers.local_business.supports_websockets=false", "model_providers.local_business.request_max_retries=0",
    `mcp_servers.haolo_business.command=${JSON.stringify(process.execPath)}`,
    `mcp_servers.haolo_business.args=[${JSON.stringify(mcpPath)}]`,
    'mcp_servers.haolo_business.env_vars=["HAOLO_BUSINESS_BROKER_URL","HAOLO_BUSINESS_BROKER_TOKEN"]',
    'mcp_servers.haolo_business.default_tools_approval_mode="approve"',
  ];
  const env = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "COMSPEC", "PATHEXT"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  Object.assign(env, bridgeEnv, { CODEX_HOME: home, USERPROFILE: directory, HOME: directory, TMPDIR: os.tmpdir() });
  const raw = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr.slice(-1200)}`)); }, 12_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  const rpc = (method, params) => requestWithThreadHistoryRecovery({ request: raw, method, params, codexHome: home });
  const stop = async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise(r => child.once("exit", r)); child.kill(); await exited;
    }
  };
  t.after(async () => {
    await stop();
    for (const p of pending.values()) clearTimeout(p.timer);
    for (const id of broker.contexts.keys()) broker.cancel(id);
    await bridge.stop(); model.closeAllConnections(); await new Promise(r => model.close(r));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^haolo-business-runtime-/);
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const start = async () => {
    child = spawn(runtime, [...settings.flatMap(s => ["-c", s]), "app-server", "--stdio"], {
      cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.on("data", b => { stderr = (stderr + b).slice(-6000); });
    const lines = readline.createInterface({ input: child.stdout });
    child.once("exit", () => lines.close());
    lines.on("line", line => {
      const message = JSON.parse(line); events.push(message);
      if (message.method === "turn/started") broker.start(message.params.threadId, message.params.turn.id, child);
      const p = pending.get(message.id);
      if (!p) return;
      clearTimeout(p.timer); pending.delete(message.id);
      if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
    });
    await raw("initialize", { clientInfo: { name: "haolo_business_test", version: "1" }, capabilities: { experimentalApi: true } });
    child.stdin.write('{"method":"initialized","params":{}}\n');
  };
  const card = { id: "native-fixture-card", type: "agentMessage", text: "fixture report", __youleCloudReports: [{ runId: "fixture-cloud" }] };
  const run = async (threadId, kind, userText) => {
    scenario = kind; step = 0;
    activeContext = broker.bind(threadId, { client: child, userText, executeTrading: async args => {
      executions.push({ args, userText: activeContext.userText });
      if (args.action === "analyze_only") return { result: {report:"fixture report",analysisJobId:"fixture-cloud"},presentationItems:[] };
      if(args.action==="draft_prepare")return {result:{kind:"alert",prepared:true,summary:"prepared fixture"}};
      if(args.action==="simulate")return {result:{simulation:{simulationId:"sim-fixture"},pending:{draftId:"draft-fixture"}}};
      if(args.action==="simulation_draw")return {result:{previewed:true},presentationItems:[card]};
      if(args.action==="draft_confirm")return {result:{confirmed:activeContext.userText==="确认"},presentationItems:[card]};
      return { presentationItems: [card], pending: kind === "confirm" ? { alert: { stage: "confirmed" } } : null };
    }});
    const result = await rpc("turn/start", { threadId, input: [{ type: "text", text: broker.input(threadId, userText), textElements: [] }] });
    const until = Date.now() + 15_000;
    let terminal;
    while (!(terminal = events.find(e => e.method === "turn/completed" && e.params.turn.id === result.turn.id))) {
      assert.ok(Date.now() < until, `turn timeout: ${stderr.slice(-1000)}`);
      await new Promise(r => setTimeout(r, 15));
    }
    assert.equal(terminal.params.turn.status, "completed", JSON.stringify(terminal));
    broker.cancel(threadId);
  };
  await start();
  const skills = await rpc("skills/list", { cwds: [cwd], forceReload: true });
  assert.ok(JSON.stringify(skills).includes("trading-expert"));
  assert.ok(JSON.stringify(skills).includes("trading-analysis-price-action"));
  assert.ok(JSON.stringify(skills).includes("trading-analysis-macd-analysis"));
  const initial = await rpc("thread/start", { cwd, approvalPolicy: "never", sandbox: "read-only", developerInstructions: CODEX_TRADING_INSTRUCTIONS });
  await run(initial.thread.id, "plain", "Write a short greeting");
  assert.equal(executions.length, 0);
  assert.ok(JSON.stringify(modelInputs[0]).includes("haolo_codex_first"));
  await run(initial.thread.id, "trade", "Analyze my ETH position and then write a summary");
  assert.equal(executions.length, 1, JSON.stringify({ config: Object.fromEntries(Object.entries(modelInputs[1] || {}).filter(([k]) => !["input","instructions"].includes(k))), outputs: modelInputs.at(-1)?.input?.filter(i => i.type === "function_call_output"), stderr }));
  assert.equal(executions[0].args.positionManagementRequested, true);
  assert.ok(JSON.stringify(modelInputs.at(-1).input).includes("fixture-cloud"));
  const mcpItem = events.find(e => e.method === "item/completed" && e.params.item?.type === "mcpToolCall")?.params.item;
  assert.deepEqual(businessPresentationItems(mcpItem), []);
  assert.match(JSON.stringify(modelInputs.at(-1).input), /positionReview/);
  assert.match(JSON.stringify(modelInputs.at(-1).input), /answerRequired/);
  assert.ok(events.some(e => e.method === "item/completed" && e.params.item?.type === "agentMessage" && e.params.item.text === "done trade"));
  await stop(); await start();
  const restored = await rpc("thread/resume", { threadId: initial.thread.id, cwd, developerInstructions: CODEX_TRADING_INSTRUCTIONS });
  assert.equal(restored.thread.id, initial.thread.id);
  await run(initial.thread.id, "confirm", "确认");
  assert.equal(executions.length, 2);
  assert.equal(executions[1].userText, "确认");
  assert.ok(JSON.stringify(modelInputs.at(-1).input).includes("fixture-cloud"));
  await run(initial.thread.id, "modular", "@裸K 分析ETH，然后画线并给出计划");
  assert.deepEqual(executions.slice(2).map(x=>x.args.action),["analyze_only","draw","present"]);
  assert.equal(executions[3].args.analysisRef,executions[4].args.analysisRef);
  assert.equal(executions[3].args.artifact.result.analysisJobId,"fixture-cloud");
  const presented=events.filter(e=>e.method==="item/completed" && e.params.item?.type==="mcpToolCall" && /haolo_plan_present$/.test(e.params.item.tool)).at(-1)?.params.item;
  assert.deepEqual(businessPresentationItems(presented),[{ ...card, __youleNativeResponseComplete: false }]);
  await run(initial.thread.id,"workflow","创建一个条件预警");
  assert.deepEqual(executions.slice(-3).map(x=>x.args.action),["draft_prepare","simulate","simulation_draw"]);
  await run(initial.thread.id,"workflow-confirm","确认");
  assert.equal(executions.at(-1).args.action,"draft_confirm");
  assert.equal(executions.at(-1).args.simulation.simulation.simulationId,"sim-fixture");
  assert.equal(executions.at(-1).userText,"确认");
});
