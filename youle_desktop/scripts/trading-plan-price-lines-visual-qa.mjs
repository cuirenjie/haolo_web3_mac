// Run from the repository root. Offscreen fixtures only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronExecutable from 'electron';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { buildTradingPlanPriceLines } from '../src/renderer/trading-plan-price-lines.ts';
import { renderTradingOrderLineSvg } from '../src/renderer/trading-expert-order-lines.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, '.cache', 'plan-single-entry-M1-393');
fs.mkdirSync(output, { recursive: true });
const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
const renderer = ts.transpileModule(fs.readFileSync(path.join(root, 'src/renderer/trading-expert-order-lines.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const market = 'BINANCE:FUTURES:SNDKUSDT';
const fixtures = [];
for (const theme of ['light', 'dark']) for (const language of ['zh-CN', 'en', 'zh-TW']) for (const width of [900, 420]) {
  const bounds = { width, height: 500 };
  const levels = [['entry', 1405.85], ['entry', 1409.49], ['stop', 1453.71], ['target', 1358.78], ['target', 1325.55], ['target', 1285.246]];
  const drawings = levels.map(([role, price], index) => ({ id: `plan-${index}`, source: 'ai', symbol: market, interval: '1h',
    tool: 'path', colorToken: `strategy-${role}`, points: [{ time: 1, price }, { time: 10, price }],
    text: language === 'en' ? role : language === 'zh-TW' ? '入場 止損 止盈參考' : '入场 止损 止盈参考' }));
  const plan = buildTradingPlanPriceLines(drawings).lines;
  const account = { id: 'actual-position-tp', marketId: market, price: 1255, kind: 'take-profit', label: '100 USDT +5 USDT',
    shortLabel: language === 'en' ? 'TP' : '止盈', quantityUsdt: 100, pnl: 5 };
  const project = price => (1480 - price) * 1.8;
  const candles = Array.from({ length: 40 }, (_, i) => {
    const x = 20 + i * (width - 100) / 45, y = 170 + Math.sin(i / 4) * 75;
    return { x, y, width: 5, height: 20 + i % 4 * 5 };
  });
  const bars = candles.map((bar, i) => `<g fill="${i % 2 ? '#0dbd8b' : '#f64e68'}" stroke="${i % 2 ? '#0dbd8b' : '#f64e68'}"><line x1="${bar.x + 2.5}" x2="${bar.x + 2.5}" y1="${bar.y - 8}" y2="${bar.y + bar.height + 8}"/><rect x="${bar.x}" y="${bar.y}" width="5" height="${bar.height}"/></g>`).join('');
  const html = `<!doctype html><html data-theme="${theme}" lang="${language}"><meta charset="utf-8"><style>${css}
    body{margin:0;padding:20px;display:block;height:auto;background:var(--trading-market-panel);color:var(--trading-market-text);font-family:'Segoe UI','Microsoft YaHei',sans-serif}
    h2{font-size:15px;margin:0 0 18px}.trading-drawing-layer{position:static;display:block;overflow:hidden}</style>
    <body class="trading-expert-market"><h2>SNDK / USDT · 1h — ${language === 'en' ? 'Plan price levels' : '计划入场与止盈止损'}</h2>
    <svg class="trading-drawing-layer" width="${width}" height="500"><g stroke="${theme === 'dark' ? '#303642' : '#e6ebf2'}">${Array.from({ length: 10 }, (_, i) => `<line x1="0" x2="${width}" y1="${i * 50}" y2="${i * 50}"/>`).join('')}</g>${bars}<g id="levels">${renderTradingOrderLineSvg([...plan, account], market, bounds, project, candles)}</g></svg>
    <script type="module">${renderer};fitTradingOrderLineLabels(document.querySelector('#levels'),null,${JSON.stringify(bounds)});window.qaReady=true;</script></body></html>`;
  const id = `${theme}-${language}-${width}`;
  fs.writeFileSync(path.join(output, `${id}.html`), html);
  fixtures.push({ id, width });
}
fs.writeFileSync(path.join(output, 'fixtures.json'), JSON.stringify(fixtures));
const runner = String.raw`
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.join(__dirname,'isolated-profile'));app.disableHardwareAcceleration();
(async()=>{
 await app.whenReady();const rows=[];
 const win=new BrowserWindow({show:false,width:960,height:580,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 for(const f of JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures.json')))){
  win.setSize(f.width+40,580);await win.loadFile(path.join(__dirname,f.id+'.html'));
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const result=await win.webContents.executeJavaScript('('+(()=>{
   const groups=[...document.querySelectorAll('[data-trading-plan-price-line]')];
   return {ready:window.qaReady,count:groups.length,labels:groups.map(g=>{
    const key=g.querySelector('.trading-order-line-key-text').getBBox(),badge=g.querySelector('.trading-order-line-label-key').getBBox();
    const text=g.querySelector('.trading-order-line-label-text').getBBox(),bg=g.querySelector('.trading-order-line-label-bg').getBBox();
    return {keyFits:key.x>=badge.x&&key.x+key.width<=badge.x+badge.width+1,priceFits:text.x+text.width<=bg.x+bg.width+1,
     color:getComputedStyle(g).color,text:g.textContent};}),
    entryCount:document.querySelectorAll('[data-trading-plan-price-line].trading-order-line-plan-entry').length,
    entryColor:getComputedStyle(document.querySelector('[data-trading-plan-price-line].trading-order-line-plan-entry')).color,
    targetColor:getComputedStyle(document.querySelector('[data-trading-plan-price-line].trading-order-line-take-profit')).color,
    accountColor:getComputedStyle(document.querySelector('[data-trading-order-line="actual-position-tp"]')).color,
    themeColor:getComputedStyle(document.body).getPropertyValue('--trading-order-take-profit').trim()};
  }).toString()+')()');
  assert.ok(result.ready);assert.equal(result.count,5);assert.ok(result.themeColor);assert.equal(result.targetColor,result.accountColor);
  assert.ok(result.labels.every(label=>label.keyFits&&label.priceFits),JSON.stringify({id:f.id,...result}));
  assert.ok(result.labels.some(label=>label.text.includes('1,285.246')));
  assert.equal(result.entryCount,1);assert.equal(result.entryColor,f.id.startsWith('dark')?'rgb(127, 181, 255)':'rgb(47, 128, 237)');
  assert.ok(result.labels.some(label=>label.text.includes('1409.490')));
  assert.ok(result.labels.every(label=>!label.text.includes('1,405.85')));
  rows.push({id:f.id,...result});
  fs.writeFileSync(path.join(__dirname,f.id+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 fs.writeFileSync(path.join(__dirname,'visual-report.json'),JSON.stringify(rows,null,2));
 console.log(JSON.stringify({passed:rows.length,output:__dirname}));win.destroy();app.quit();
})().catch(error=>{console.error(error);app.exit(1)});
`;
fs.writeFileSync(path.join(output, 'runner.cjs'), runner);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electronExecutable, [path.join(output, 'runner.cjs')],
  { cwd: path.resolve(root, '..'), env, encoding: 'utf8', timeout: 90000, windowsHide: true });
console.log(result.stdout || '');
if (result.status !== 0) { console.error(result.stderr || result.error); process.exit(result.status || 1); }
