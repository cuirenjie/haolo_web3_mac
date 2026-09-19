// M1-318: production card renderers + CSS in an isolated Electron window.
// node_modules/electron/dist/electron.exe scripts/execution-plan-context-visual-qa.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'execution-plan-context-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();

function parse(file) {
  return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
}
const spec = parse('test/execution-plan-context.test.mjs');
const renderer = parse('src/renderer/main.ts');
function variable(name) {
  return spec.statements.filter(ts.isVariableStatement).flatMap((node) => [...node.declarationList.declarations])
    .find((node) => node.name.getText(spec) === name).initializer.getText(spec);
}
function helper(name) {
  return spec.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(spec);
}
const names = new Function(`return ${variable('functionNames')}`)();
const javascript = ts.transpileModule(names.map((name) => renderer.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(renderer)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const moduleJs = ts.transpileModule(fs.readFileSync(path.join(root, 'src/renderer/execution-plans.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const styles = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
const fixture = path.join(output, 'cards.html');
fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style>
<style>body{display:block;overflow:auto;padding:24px;background:var(--bg);color:var(--text)}#controls{display:flex;gap:16px;margin-bottom:16px}#messages{display:flex;gap:24px;align-items:flex-start}.fixture-column{width:410px;flex-shrink:0}.message-execution-plan-list{margin:0}.fixture-column>h3{margin-bottom:12px}</style></head>
<body><nav id="controls"><button id="analyze">分析 4H</button><button id="market">切换 BTC 1D</button></nav><main id="messages"></main></body></html>`, 'utf8');

const bootstrap = `
const plans = (() => { const exports = {}; ${moduleJs}\n return exports; })();
const functionNames = ${JSON.stringify(names)};
const javascript = ${JSON.stringify(javascript)};
const escapeHtml = ${variable('escapeHtml')};
${helper('report')}
${helper('harness')}
window.h = harness(document.documentElement.dataset.theme);
window.hasFour = false;
window.redraw = () => {
  document.querySelector('#messages').innerHTML = ['1H', ...(hasFour ? ['4H'] : [])].map((interval) => {
    const id = interval === '1H' ? 'one' : 'four';
    const text = report(interval);
    const message = h.message(id, text);
    return '<div class="fixture-column"><h3>' + interval + ' 分析记录</h3>' + h.renderMessageExecutionPlan(message, text).cards + h.renderAddToPlanAction(message, text) + '</div>';
  }).join('');
};
document.querySelector('#analyze').onclick = () => { h.runtime.latest = 'ETH4H'; h.state.threads[0].name = 'ETH4H'; hasFour = true; redraw(); };
document.querySelector('#market').onclick = () => { h.runtime.latest = 'BTC1D'; h.state.threads[0].name = 'BINANCE:FUTURES:BTCUSDT · 1日分析'; redraw(); };
document.querySelector('#messages').onclick = async (event) => {
  const sticky = event.target.closest('[data-message-execution-plan-action="sticky"]');
  const add = event.target.closest('[data-message-action="add-to-plan"]');
  if (sticky) await h.createExecutionPlanStickyFromMessageCard(sticky.closest('.message-execution-plan'));
  if (add) await h.addExecutionPlanFromMessageAction(add);
};
redraw();
void 0;
`;

(async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 960, height: 1250, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const report = { themes: [], errors: [] };
  win.webContents.on('console-message', (event) => { if (event.level === 'error') report.errors.push(event.message); });
  const click = async (selector) => {
    const point = await js(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    await pause(120);
  };
  for (const theme of ['light', 'dark']) {
    await win.loadFile(fixture);
    await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await js(bootstrap);
    const headings = () => js(`Array.from(document.querySelectorAll('.message-execution-plan h2'), el=>el.textContent)`);
    const original = await headings();
    assert.equal(original.length, 2);
    assert.ok(original.every((title) => title.includes('ETH/USDT') && title.includes('1H')));
    await click('#analyze');
    let titles = await headings();
    assert.deepEqual(titles.slice(0, 2), original);
    assert.equal(titles.length, 4);
    assert.ok(titles.slice(2).every((title) => title.includes('4H')));
    await click('#market');
    assert.deepEqual(await headings(), titles);
    await click('.message-execution-plan [data-message-execution-plan-action="sticky"]');
    assert.match(await js('h.runtime.sticky[0].title'), /ETH\/USDT .*1H/);
    assert.equal(await js('h.runtime.sticky[0].theme'), theme);
    await click('[data-message-action="add-to-plan"]');
    assert.match(await js('h.runtime.alerts[0].title'), /ETH\/USDT .*1H/);
    assert.deepEqual(await js('h.runtime.errors'), []);
    assert.equal(await js('document.querySelector("[data-message-action=add-to-plan]").disabled'), true);
    await js(`document.querySelector('[data-message-execution-plan-action="decrease"]').focus()`);
    const appearance = await js(`(() => {const card=document.querySelector('.message-execution-plan'), title=card.querySelector('h2'), control=card.querySelector('button');return {card:getComputedStyle(card).backgroundColor,title:getComputedStyle(title).color,control:getComputedStyle(control).color,focus:document.activeElement.dataset.messageExecutionPlanAction}})()`);
    assert.equal(appearance.focus, 'decrease');
    await pause(150);
    const screenshot = path.join(output, theme + '.png');
    fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
    report.themes.push({ theme, titles, appearance, sticky: await js('h.runtime.sticky[0].title'), alert: await js('h.runtime.alerts[0].title'), screenshot });
  }
  assert.deepEqual(report.errors, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  win.destroy();
  app.quit();
})().catch((error) => { console.error(error); app.exit(1); });
