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
const styles = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8') + fs.readFileSync(path.join(root, 'src/main/execution-plan-card.css'), 'utf8');
const viewJs = ts.transpileModule(fs.readFileSync(path.join(root, 'src/main/execution-plan-card-view.mjs'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const fixture = path.join(output, 'cards.html');
fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style>
<style>body{display:block;overflow:auto;padding:24px;background:var(--bg);color:var(--text)}#controls{display:flex;gap:16px;margin-bottom:16px}#messages{display:flex;gap:24px;align-items:flex-start}.fixture-column{width:410px;flex-shrink:0}.message-execution-plan-list{margin:0}.fixture-column>h3{margin-bottom:12px}</style></head>
<body><nav id="controls"><button id="analyze">分析 4H</button><button id="market">切换 BTC 1D</button></nav><main id="messages"></main></body></html>`, 'utf8');

const bootstrap = `
const plans = (() => { const exports = {}; ${moduleJs}\n return exports; })();
const planView = (() => { const exports = {}; ${viewJs}\n return exports; })();
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
  const zoom = event.target.closest('[data-message-execution-plan-action="increase"], [data-message-execution-plan-action="decrease"]');
  const sticky = event.target.closest('[data-message-execution-plan-action="sticky"]');
  const add = event.target.closest('[data-message-action="add-to-plan"]');
  if (sticky) await h.createExecutionPlanStickyFromMessageCard(sticky.closest('.message-execution-plan'));
  if (add) await h.addExecutionPlanFromMessageAction(add);
  if (zoom) h.applyMessageExecutionPlanGroupFontSize(zoom.closest('.message-execution-plan'), zoom.dataset.messageExecutionPlanAction === 'increase' ? 1 : -1);
};
redraw();
void 0;
`;

(async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 960, height: 1250, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const report = { themes: [], layouts: [], errors: [] };
  win.webContents.on('console-message', (event) => { if (event.level === 'error') report.errors.push(event.message); });
  const click = async (selector) => {
    const point = await js(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    await pause(120);
  };
  for (const theme of ['light', 'dark']) {
    await win.loadFile(fixture);
    await js('localStorage.clear()'); // Isolated QA profile only.
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
    const dark = theme === 'dark';
    assert.equal(appearance.card, dark ? 'rgb(28, 32, 36)' : 'rgb(255, 255, 255)');
    assert.equal(appearance.title, dark ? 'rgb(247, 248, 250)' : 'rgb(24, 25, 28)');
    const palette = await js(`(() => {
      const card = document.querySelector('.message-execution-plan');
      const color = (selector, property = 'color') => getComputedStyle(card.querySelector(selector))[property];
      return { label: color('.execution-plan-card-label'), bullish: color('.execution-plan-price.bullish'),
        bearish: color('.execution-plan-price.bearish'), muted: color('.execution-plan-ratio'),
        controls: color('.message-execution-plan-controls', 'backgroundColor') };
    })()`);
    assert.deepEqual(palette, {
      label: dark ? 'rgb(255, 212, 59)' : 'rgb(154, 103, 0)',
      bullish: dark ? 'rgb(122, 227, 162)' : 'rgb(37, 133, 76)',
      bearish: dark ? 'rgb(255, 127, 159)' : 'rgb(203, 62, 80)',
      muted: dark ? 'rgb(193, 198, 206)' : 'rgb(108, 112, 122)',
      controls: appearance.card,
    });
    // Saved cards use the production renderer and must share the chat palette.
    const saved = await js(`(() => {
      const host = document.createElement('div');
      host.innerHTML = h.renderExecutionPlanCard(h.state.executionPlans[0]);
      document.body.append(host);
      const card = host.querySelector('.execution-plan-card');
      const result = { background: getComputedStyle(card).backgroundColor, text: getComputedStyle(card.querySelector('h2')).color };
      host.remove(); return result;
    })()`);
    assert.deepEqual(saved, { background: appearance.card, text: appearance.title });
    await pause(150);
    const screenshot = path.join(output, theme + '.png');
    fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
    report.themes.push({ theme, titles, appearance, sticky: await js('h.runtime.sticky[0].title'), alert: await js('h.runtime.alerts[0].title'), screenshot });
    await click('.message-execution-plan [data-message-execution-plan-action="increase"]');
    assert.deepEqual(await js(`Array.from(document.querySelector('.message-execution-plan-list').children, card => getComputedStyle(card.querySelector('.execution-plan-card-content')).fontSize)`), ['13px', '13px']);
    await click('.message-execution-plan [data-message-execution-plan-action="decrease"]');
    await js(`document.querySelector('.message-execution-plan .execution-plan-card-content').innerHTML = planView.executionPlanCardBody([
      {label:'当前动作：',text:'等待条件触发'}, {label:'方向判断：',text:'偏多'},
      {label:'多头触发：',text:'82849.635，用 3 倍杠杆开仓 100 USDT 的多单'}, {label:'止损与失效：',text:'82620.422'},
      {label:'分批止盈：',text:'挂条件委托 83173.299178 市价止盈 33 USDT；预计盈利 +1.11 USDT，挂条件委托 83210.48542333 市价止盈 33 USDT；预计盈利 +2.22 USDT，挂条件委托 83308.061 市价止盈 34 USDT；预计盈利 +3.33 USDT'},
      {label:'风险收益比：',text:'目标1为 1:0.4，目标2为 1:0.49，目标3为 1:0.74，如果止损：约 -5.00 USDT，如果全部止盈：约 +6.66 USDT'},
      {label:'仓位大小：',text:'名义金额 100 USDT；账户权益 50.51 USDT'},
      {label:'可能盈亏：',text:'止损约 -5.00 USDT；全部止盈约 +6.66 USDT；已计入预估手续费和滑点'}
    ])`);
    for (const width of [280, 340, 410]) {
      for (const fontSize of [11, 12, 20]) {
        const layout = await js(`(() => {
          document.querySelectorAll('.fixture-column').forEach(el => el.style.width = '${width}px');
          document.querySelectorAll('.message-execution-plan').forEach(el => h.applyMessageExecutionPlanFontSize(el, ${fontSize}));
          const card = document.querySelector('.message-execution-plan');
          const box = card.getBoundingClientRect();
          const footer = card.querySelector('footer').getBoundingClientRect();
          const content = card.querySelector('.execution-plan-card-content').getBoundingClientRect();
          const badge = getComputedStyle(card.querySelector('.execution-plan-badge'));
          const strategy = card.querySelector('.execution-plan-badge.strategy');
          const direction = strategy.previousElementSibling.getBoundingClientRect();
          const ratioStyle = getComputedStyle(card.querySelector('.execution-plan-ratio'));
          const baseline = (el) => {
            const marker = document.createElement('span');
            marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
            el.append(marker);
            const y = marker.getBoundingClientRect().top;
            marker.remove();
            return y;
          };
          const priceRatioOffsets = [...card.querySelectorAll('.execution-plan-target')].map(row => baseline(row.querySelector('strong')) - baseline(row.querySelector('.execution-plan-ratio')));
          const rightmostText = Math.max(...[...card.querySelectorAll('.execution-plan-metric:last-child > *, .execution-plan-ratio, .execution-plan-target-profit')].map(el => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return range.getBoundingClientRect().right;
          }));
          const estimateStylesMatch = [...card.querySelectorAll('.execution-plan-estimate, .execution-plan-estimate span')].every(el => {
            const style = getComputedStyle(el);
            const value = el.matches('span') ? Number(el.textContent.replaceAll(',', '')) : 0;
            const expectedColor = value === 0 ? ratioStyle.color : getComputedStyle(card.querySelector(value > 0 ? '.execution-plan-price.bullish' : '.execution-plan-price.bearish')).color;
            return style.color === expectedColor && style.fontSize === ratioStyle.fontSize && style.fontWeight === ratioStyle.fontWeight;
          });
          return { width: box.width, fontSize: getComputedStyle(card.querySelector('.execution-plan-card-content')).fontSize,
            priceRatioOffsets,
            leftInset: content.left - box.left, rightInset: box.right - rightmostText,
            controlsTopGap: footer.top - content.bottom,
            estimateStylesMatch, estimates: card.querySelectorAll('.execution-plan-estimate').length,
            accountSummaryOrUnit: /USDT|仓位大小|可能盈亏/.test(card.querySelector('.execution-plan-card-content').textContent),
            strategy: strategy.textContent, strategyFill: getComputedStyle(strategy).backgroundColor,
            badgesAdjacent: strategy.getBoundingClientRect().left > direction.right && Math.abs(strategy.getBoundingClientRect().top - direction.top) < 0.1,
            overflow: card.scrollWidth > card.clientWidth, controlsInside: footer.right <= box.right && footer.bottom <= box.bottom,
            controlsBelowContent: footer.top >= content.bottom, badgeColor: badge.color, badgeFill: badge.backgroundColor,
            ratioLefts: Array.from(card.querySelectorAll('.execution-plan-ratio'), el => el.getBoundingClientRect().left),
            stopLeft: card.querySelectorAll('.execution-plan-metric')[1].getBoundingClientRect().left,
            rowsFit: Array.from(card.querySelectorAll('.execution-plan-target'), el => el.scrollWidth <= el.clientWidth),
            prices: Array.from(card.querySelectorAll('.execution-plan-price, .execution-plan-target strong'), el => el.textContent),
            hasWaitingAction: card.textContent.includes('等待条件触发'),
            increaseDisabled: card.querySelector('[data-message-execution-plan-action="increase"]').disabled,
            decreaseDisabled: card.querySelector('[data-message-execution-plan-action="decrease"]').disabled };
        })()`);
        assert.equal(layout.overflow, false);
        assert.ok(layout.priceRatioOffsets.every(offset => Math.abs(offset) < 0.5), JSON.stringify(layout));
        assert.ok(Math.abs(layout.leftInset - layout.rightInset) < 1, JSON.stringify(layout));
        assert.ok(Math.abs(layout.controlsTopGap - 5) < 0.5, JSON.stringify(layout));
        assert.equal(layout.estimateStylesMatch, true);
        assert.equal(layout.estimates, 4);
        assert.equal(layout.accountSummaryOrUnit, false);
        assert.equal(layout.strategy, '裸K分析');
        assert.equal(layout.strategyFill, 'rgb(154, 103, 0)');
        assert.equal(layout.badgesAdjacent, true);
        assert.equal(layout.controlsInside, true);
        assert.equal(layout.controlsBelowContent, true);
        assert.equal(layout.ratioLefts.length, 3);
        assert.ok(layout.ratioLefts.every(left => Math.abs(left - layout.ratioLefts[0]) < 0.1));
        assert.ok(layout.ratioLefts.every(left => Math.abs(left - layout.stopLeft) < 0.1));
        assert.ok(layout.rowsFit.every(Boolean));
        assert.deepEqual(layout.prices, ['82849.64', '82620.42', '83173.30', '83210.49', '83308.06']);
        assert.equal(layout.hasWaitingAction, false);
        assert.equal(layout.badgeColor, 'rgb(255, 255, 255)');
        assert.equal(layout.badgeFill, 'rgb(37, 133, 76)');
        assert.equal(layout.increaseDisabled, fontSize === 20);
        assert.equal(layout.decreaseDisabled, fontSize === 11);
        report.layouts.push({ theme, ...layout });
        if (width === 340 && fontSize === 12) fs.writeFileSync(path.join(output, theme + '-two-decimals.png'), (await win.webContents.capturePage()).toPNG());
      }
    }
  }
  assert.deepEqual(report.errors, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  win.destroy();
  app.quit();
})().catch((error) => { console.error(error); app.exit(1); });
