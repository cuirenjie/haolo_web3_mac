// Synthetic loopback page for testing the installed store extension and desktop UI.
// Page receipts alone do not prove model execution: correlate with the desktop turn.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, "output", "chrome-store-e2e");
await fs.mkdir(output, { recursive: true });
const runId = randomUUID();
const pages = new Map();
const startedAt = new Date().toISOString();
let url;
let writing = Promise.resolve();
const save = () => {
  const report = JSON.stringify({ runId, startedAt, url, modelExecutionVerified: false,
    note: "Correlate synthetic browser receipts with the actual desktop model turn before declaring E2E passed.",
    pages: [...pages.values()] }, null, 2);
  writing = writing.then(() => fs.writeFile(path.join(output, "browser-receipts.json"), report));
  return writing;
};
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const route = new URL(req.url, "http://127.0.0.1");
  if (route.pathname === `/${runId}/` && req.method === "GET") {
    const id = randomUUID();
    const challenge = `DS-${randomUUID().slice(0, 8)}`;
    pages.set(id, { id, challenge, loadedAt: new Date().toISOString(), events: [] });
    await save();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Haolo 商店版端到端验收</title>
<style>body{font:18px system-ui;max-width:850px;margin:50px auto;padding:20px;color:#172239;background:#f5f7fc}main{background:white;padding:32px;border-radius:20px}button,input,select{font:inherit;padding:10px;margin:12px 0}label{display:block}output{display:block;padding:16px;background:#eef3ff}small{color:#52627b}</style>
<main><h1>Haolo 商店版端到端验收</h1><p>这个本机测试页只含合成数据。</p>
<p>测试编号：${runId}</p><p>页面编号：${id}</p>
<button type="button" aria-label="显示验收码" id="reveal">显示验收码</button>
<p id="challenge">验收码尚未显示</p>
<label>验收文本 <input aria-label="验收文本" id="draft" autocomplete="off"></label>
<label>测试区域 <select aria-label="测试区域" id="region"><option value="eu">欧洲</option><option value="apac">亚太</option></select></label>
<output id="result">等待完成点击、输入和选择</output><p><small>原标签页应保持未操作，Haolo 在新任务标签页执行。</small></p></main>
<script>
const id=${JSON.stringify(id)}, code=${JSON.stringify(challenge)}; let revealed=false;
function report(action){const state={action,revealed,draft:document.querySelector('#draft').value,region:document.querySelector('#region').value};
state.passed=state.revealed&&state.draft===code&&state.region==='apac';
document.querySelector('#result').textContent=state.passed?'验收通过：'+code:'等待完成点击、输入和选择';
fetch('/${runId}/receipt/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)}).catch(()=>{});}
document.querySelector('#reveal').onclick=()=>{revealed=true;document.querySelector('#challenge').textContent='本页验收码：'+code;report('reveal')};
document.querySelector('#draft').oninput=()=>report('input');
document.querySelector('#region').onchange=()=>report('select');
</script></html>`);
    return;
  }
  if (route.pathname.startsWith(`/${runId}/receipt/`) && req.method === "POST") {
    if (req.headers.origin !== new URL(url).origin) { res.writeHead(403).end(); return; }
    const page = pages.get(route.pathname.split("/").at(-1));
    if (!page) { res.writeHead(404).end(); return; }
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 2048) { res.writeHead(413).end(); return; } }
    try {
      const value = JSON.parse(body);
      if (!["reveal", "input", "select"].includes(value.action)) throw Error("Invalid action");
      const event = { at: new Date().toISOString(), action: value.action, revealed: value.revealed === true,
        draft: String(value.draft || "").slice(0, 80), region: String(value.region || "").slice(0, 20) };
      event.passed = event.revealed && event.draft === page.challenge && event.region === "apac";
      if (page.events.length < 100) page.events.push(event);
      await save(); res.writeHead(204).end();
    } catch { res.writeHead(400).end(); }
    return;
  }
  res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
url = `http://127.0.0.1:${server.address().port}/${runId}/`;
const prompt = `执行商店版端到端验收 ${runId}。仅使用 chrome MCP 工具，在已绑定的任务标签页读取当前页面，点击“显示验收码”，再次读取页面获得验收码，将它填入“验收文本”，将“测试区域”选择为“亚太”，最后再次读取页面确认“验收通过”并报告验收码。保留原标签页不变。不要使用终端、代码执行或直接网络请求替代浏览器工具。`;
await fs.writeFile(path.join(output, "launch.json"), JSON.stringify({ runId, startedAt, pid: process.pid, url, prompt }, null, 2));
await save();
console.log(JSON.stringify({ runId, url, prompt }));
setTimeout(() => server.close(), 90 * 60 * 1000).unref();
process.on("SIGTERM", () => server.close());
