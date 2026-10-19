import assert from 'node:assert/strict';
import test from 'node:test';
import { translateAppText, translateDrawingText } from '../src/renderer/app-language.mjs';
import { englishDrawingText } from '../src/renderer/app-language-en-drawing.mjs';
import { TRADING_DRAWING_TOOLS } from '../src/renderer/trading-expert-drawing.ts';
import { DRAWING_MENU_SECTIONS } from '../src/renderer/trading-drawing-catalog.ts';

test('every drawing tool and section has a reviewed complete English translation', () => {
  assert.equal(TRADING_DRAWING_TOOLS.length, 104);
  for (const tool of TRADING_DRAWING_TOOLS) {
    const english = englishDrawingText(tool.label);
    assert.ok(english, tool.id);
    assert.doesNotMatch(english, /\p{Script=Han}/u, tool.id);
    assert.equal(translateDrawingText(tool.label, 'en'), english);
    assert.equal(translateDrawingText(translateDrawingText(tool.label, 'zh-TW'), 'en'), english, `${tool.id}: Traditional Chinese input`);
  }
  for (const group of DRAWING_MENU_SECTIONS) {
    assert.doesNotMatch(translateDrawingText(`展开${group.label}`, 'en'), /\p{Script=Han}/u);
    for (const section of group.sections.filter(s => s.label)) {
      assert.match(englishDrawingText(section.label, true) ?? '', /^[A-Z &-]+$/, `${group.id}: ${section.label}`);
    }
  }
});

test('trend menu matches the supplied TradingView English reference', () => {
  const expected = ['Trendline', 'Ray', 'Info line', 'Extended line', 'Trend angle', 'Horizontal line', 'Horizontal ray', 'Vertical line', 'Crossline', 'Parallel channel', 'Regression trend', 'Flat top/bottom', 'Disjoint channel', 'Pitchfork', 'Schiff pitchfork', 'Modified Schiff pitchfork', 'Inside pitchfork'];
  const sections = DRAWING_MENU_SECTIONS.find(g => g.id === 'trend').sections;
  assert.deepEqual(sections.flatMap(s => s.tools).map(id => translateDrawingText(TRADING_DRAWING_TOOLS.find(t => t.id === id).label, 'en')), expected);
  assert.deepEqual(sections.map(s => translateDrawingText(s.label, 'en', true)), ['LINES', 'CHANNELS', 'PITCHFORKS']);
  assert.equal(translateDrawingText('分叉线', 'en'), 'Pitchfork');
  assert.equal(translateDrawingText('分叉线', 'en', true), 'PITCHFORKS');
  assert.equal(translateDrawingText('箭头', 'en'), 'Arrow');
  assert.equal(translateDrawingText('箭头', 'en', true), 'ARROWS');
});

test('complete placement messages retain counts and technical labels without partial translation', () => {
  assert.equal(translateDrawingText('XABCD 形态 · 第 3 个端点已设置（共 5 个） · 移动鼠标选择第 4 个端点，再次点击继续 · 右键撤销上一端点', 'en'), 'XABCD pattern · Point 3 of 5 set · Move to point 4 and click to continue · Right-click to undo the last point');
  assert.equal(translateDrawingText('内部分叉线 · 已取消第 2 个端点，前 1 个端点已保留 · 移动鼠标选择终点，再次点击完成 · 右键撤销上一端点', 'en'), 'Inside pitchfork · Point 2 removed; 1 point retained · Move to the end point and click to finish · Right-click to undo the last point');
  assert.equal(translateDrawingText('+12.50 (3.21%) · 1.5小时', 'en'), '+12.50 (3.21%) · 1.5h');
  for (const tool of TRADING_DRAWING_TOOLS) {
    for (const source of [`收藏${tool.label}`, `取消收藏${tool.label}`, `${tool.label}输入`, `${tool.label} · 已完成`, `${tool.label} · 已取消起点，请点击图表重新设置`]) {
      assert.doesNotMatch(translateDrawingText(source, 'en'), /\p{Script=Han}/u, source);
    }
  }
  for (const source of ['已设置 3 个端点 · 点击继续，双击、Enter 或 Esc 完成 · 右键撤销上一端点 · 点击起点闭合', '连续点击设置端点；右键撤销上一端点；双击、Enter 或 Esc 完成；折线点击起点闭合', '平行通道 · 已设置 2/3 个端点 · 再次点击继续 · 右键撤销上一端点', '清空副图 MACD的所有绘图？', '副图 MACD的手动绘图、AI 绘图及历史记录都将被永久删除，其他分屏不受影响。此操作无法撤销。', '依次点击图表设置 5 个端点；完成后可拖动端点调整']) {
    assert.doesNotMatch(translateDrawingText(source, 'en'), /\p{Script=Han}/u, source);
  }
});

test('drawing terminology is scoped and Chinese language choices remain available', () => {
  assert.equal(translateDrawingText('趋势角度', 'zh-CN'), '趋势角度');
  assert.equal(translateDrawingText('趋势角度', 'zh-TW'), '趨勢角度');
  assert.equal(translateAppText('置顶', 'en'), 'Top');
  assert.equal(translateDrawingText('置顶', 'en'), 'Pin');
  assert.equal(englishDrawingText('我的交易笔记'), null);
});
