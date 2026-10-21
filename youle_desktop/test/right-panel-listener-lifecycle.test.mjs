import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const handler = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleRightPanelToggle');
const bindEvents = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'bindEvents');
const binding = bindEvents.body.statements.find(node => node.getText(ast).includes('.querySelectorAll<HTMLButtonElement>(\'[data-action="toggle-right-panel"]\')'));
assert.ok(handler && binding, 'exercise the production handler and its binding');
const compiled = ts.transpileModule(`${handler.getText(ast)}\nfunction bind() { ${binding.getText(ast)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  class Button extends EventTarget {
    attributes = new Set();
    hasAttribute(name) { return this.attributes.has(name); }
    click() { this.dispatchEvent(new Event('click')); }
  }
  const button = new Button();
  const state = { currentThreadId: 'trading', rightCollapsed: true, tradingExpertChartCollapsed: false, tradingExpertChartFocusMode: false, chatPreview: null };
  const calls = [];
  const context = vm.createContext({
    state, HTMLButtonElement: Button, root: { querySelectorAll: () => [button] },
    finishTradingExpertLayoutControlPointerInteraction: value => calls.push(['finish', value]),
    localGroupChatRecord: id => id === 'group',
    toggleLocalGroupChatMembersPanel: () => calls.push(['group']),
    closePreviewPanel: value => calls.push(['preview', value]),
    isTradingExpertSurfaceThreadId: id => id === 'trading',
    isTradingExpertConversationCollapseLocked: () => !!state.locked,
    syncTradingExpertCollapseControlsState: () => calls.push(['locked']),
    syncAgentPanelState: () => calls.push(['sync']),
    patchActiveChatSurfaces: id => calls.push(['patch', id]),
    scrollWorkflowToLatestStep: () => calls.push(['scroll']),
    render: () => calls.push(['render']),
  });
  vm.runInContext(compiled, context);
  return { button, state, calls, bind: context.bind };
}

test('a preserved chart button handles one click once after 100 shell rebindings', () => {
  const f = fixture();
  for (let i = 0; i <= 100; i++) f.bind();
  f.button.click();
  assert.equal(f.state.rightCollapsed, false);
  assert.deepEqual(f.calls, [['finish', false], ['sync'], ['patch', 'trading'], ['scroll']]);
  f.calls.length = 0;
  f.button.click();
  assert.equal(f.state.rightCollapsed, true);
  assert.deepEqual(f.calls, [['finish', false], ['sync'], ['scroll']]);
});

test('the stable callback reads current thread and preview state after rebinding', () => {
  const f = fixture(); f.bind();
  f.state.currentThreadId = 'group'; f.bind(); f.button.click();
  assert.deepEqual(f.calls, [['finish', false], ['group']]);
  f.calls.length = 0; f.state.currentThreadId = 'chat'; f.state.chatPreview = {}; f.button.click();
  assert.deepEqual(f.calls, [['finish', false], ['preview', 'chat']]);
  f.calls.length = 0; f.state.chatPreview = null; f.button.click();
  assert.equal(f.state.rightCollapsed, false);
  assert.deepEqual(f.calls, [['finish', false], ['sync'], ['scroll']]);
});

test('conversation expansion uses currentTarget and renders exactly once', () => {
  const f = fixture(); f.state.rightCollapsed = false;
  f.button.attributes.add('data-trading-expert-conversation-expansion');
  for (let i = 0; i < 100; i++) f.bind();
  f.button.click();
  assert.equal(f.state.tradingExpertChartCollapsed, true);
  assert.deepEqual(f.calls, [['finish', false], ['render']]);
});

for (const scenario of ['focus', 'chart-collapsed', 'busy', 'expansion-with-right-collapsed', 'expansion-in-focus']) {
  test(`preserves the ${scenario} guard`, () => {
    const f = fixture(); f.state.rightCollapsed = false;
    if (scenario.includes('focus')) f.state.tradingExpertChartFocusMode = true;
    if (scenario === 'chart-collapsed') f.state.tradingExpertChartCollapsed = true;
    if (scenario === 'busy') f.state.locked = true;
    if (scenario.startsWith('expansion')) f.button.attributes.add('data-trading-expert-conversation-expansion');
    if (scenario === 'expansion-with-right-collapsed') f.state.rightCollapsed = true;
    const before = { ...f.state }; f.bind(); f.bind(); f.button.click();
    assert.deepEqual(f.state, before);
    assert.deepEqual(f.calls, scenario === 'busy' ? [['finish', false], ['locked']] : [['finish', false]]);
  });
}
