import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CodexTradingArtifacts } from '../src/main/codex-trading-artifacts.mjs';
import { withBusinessPresentationHistory } from '../src/main/business-presentation-history.mjs';
import { compactActiveThreadReadResult, compactBackgroundThreadReadResult } from '../src/main/background-thread-hydration.mjs';
import { legacyCloudPlanCardFixture } from './support/cloud-plan-card-fixture.mjs';
import { renderCurrentReports } from './support/right-renderer-parity.mjs';
import { businessPresentationItems } from '../src/shared/codex-business-presentation.mjs';

const owner = 'account-a', thread = 'thread-a';
function card(id = 'plan-a', turnId = 'turn-a') {
  const report = legacyCloudPlanCardFixture('wyckoff', 'zh-CN');
  return { id, type: 'agentMessage', text: report.report, phase: 'final_answer', turnId,
    createdAt: '2026-10-21T08:04:00.000Z', __youleNativeResponseComplete: false,
    __youleExecutionPlanPresentation: 'execution-plan', __youleCloudReports: [report] };
}
const snapshot = () => ({ thread: { id: thread, turns: [{ id: 'turn-a', status: 'completed',
  startedAt: '2026-10-21T08:02:00.000Z', items: [
    { id: 'user-a', type: 'userMessage', text: '分析威科夫' },
    { id: 'code-mode', type: 'commandExecution', aggregatedOutput: 'Warning: truncated output ...' },
    { id: 'answer-a', type: 'agentMessage', phase: 'final_answer', text: '计划卡已显示' },
  ] }] } });
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'haolo-plan-history-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new CodexTradingArtifacts({ directory });
  const ref = await store.put(owner, thread, { hugeAnalysis: 'original evidence' });
  const record = await store.get(owner, thread, ref);
  record.effects.present = { presentationItems: [card()] };
  await store.save(record);
  return { directory, store, record };
}

test('restart restores a durable plan before the final answer even when tool history is missing or truncated', async t => {
  const { directory } = await fixture(t);
  const artifacts = new CodexTradingArtifacts({ directory });
  const source = snapshot(), before = structuredClone(source);
  const restored = await withBusinessPresentationHistory(source, { artifacts, owner });
  assert.deepEqual(source, before);
  assert.deepEqual(restored.thread.turns[0].items.map(i => i.id), ['user-a', 'code-mode', 'plan-a', 'answer-a']);
  assert.equal(restored.thread.turns[0].items[2].__youleNativeResponseComplete, false);
  for (const compact of [compactActiveThreadReadResult, compactBackgroundThreadReadResult]) {
    const items = compact(restored).thread.turns[0].items;
    const recovered = items.find(i => i.id === 'plan-a');
    assert.deepEqual(recovered.__youleCloudReports, card().__youleCloudReports);
    assert.match(renderCurrentReports(recovered.__youleCloudReports).rendered.cards, /message-execution-plan/);
  }
  assert.deepEqual(await withBusinessPresentationHistory(restored, { artifacts, owner }), restored);
});

test('native tool replay wins and must not duplicate its durable card', async t => {
  const { store: artifacts } = await fixture(t);
  const source = snapshot();
  source.thread.turns[0].items[1] = { id: 'present', type: 'mcpToolCall', tool: 'haolo_plan_present',
    result: { content: [{ type: 'text', text: JSON.stringify({ presentationItems: [card()] }) }] } };
  assert.deepEqual(await withBusinessPresentationHistory(source, { artifacts, owner }), source);
});

test('account, conversation, file identity and successful presentation are required', async t => {
  const { directory, store: artifacts, record } = await fixture(t);
  assert.deepEqual(await withBusinessPresentationHistory(snapshot(), { artifacts, owner: 'account-b' }), snapshot());
  const other = { thread: { ...snapshot().thread, id: 'thread-b' } };
  assert.deepEqual(await withBusinessPresentationHistory(other, { artifacts, owner }), other);
  await artifacts.put(owner, thread, { report: 'not presented' });
  await fs.writeFile(path.join(directory, `${'0'.repeat(64)}.json`), JSON.stringify({ ...record, ref: '00000000-0000-0000-0000-000000000000', effects: { present: { presentationItems: [card('wrong-file')] } } }));
  await fs.writeFile(path.join(directory, `${'1'.repeat(64)}.json`), '{incomplete');
  const fresh = new CodexTradingArtifacts({ directory });
  assert.deepEqual((await fresh.presentations(owner, thread)).map(i => i.id), ['plan-a']);
});

test('presentation added after an initial history read is visible and returned values cannot mutate storage', async t => {
  const { store, record } = await fixture(t);
  const first = await store.presentations(owner, thread);
  first[0].text = 'changed outside store';
  record.effects.present.presentationItems.push(card('plan-b', 'turn-b'));
  await store.save(record);
  const latest = await store.presentations(owner, thread);
  assert.equal(latest.length, 2);
  assert.equal(latest[0].text, card().text);
});

test('compacted turns retain original plan identity without inventing another user message', async t => {
  const { store: artifacts } = await fixture(t);
  const restored = await withBusinessPresentationHistory({ thread: { id: thread, turns: [] } }, { artifacts, owner });
  assert.equal(restored.thread.turns.length, 1);
  assert.equal(restored.thread.turns[0].id, 'turn-a');
  assert.deepEqual(restored.thread.turns[0].items.map(i => i.id), ['plan-a']);
  assert.equal(restored.thread.turns[0].items[0].__youleNativeResponseComplete, false);
});

test('an account switch during asynchronous history reading cannot return the former account cards', async t => {
  const { store } = await fixture(t);
  let currentOwner = owner;
  const artifacts = { presentations: async (...args) => { const items = await store.presentations(...args); currentOwner = 'account-b'; return items; } };
  assert.deepEqual(await withBusinessPresentationHistory(snapshot(), { artifacts, owner, currentOwner: () => currentOwner }), snapshot());
});

test('native text block variants survive foreground and background replay without accepting unrelated tool output', () => {
  for (const type of ['inputText', 'input_text', 'outputText', 'output_text', 'text']) {
    const tool = { id: 'present', type: 'mcpToolCall', tool: 'haolo_plan_present', turnId: 'turn-a',
      result: { content: [{ type, text: JSON.stringify({ presentationItems: [card()] }) }] } };
    assert.equal(businessPresentationItems(tool).length, 1);
    const source = { thread: { id: thread, turns: [{ id: 'turn-a', items: [tool] }] } };
    const active = compactActiveThreadReadResult(source).thread.turns[0].items[0];
    assert.deepEqual(businessPresentationItems(active), [card()]);
    assert.deepEqual(compactBackgroundThreadReadResult(source).thread.turns[0].items, [card()]);
    assert.deepEqual(businessPresentationItems({ ...tool, tool: 'unrelated_tool' }), []);
  }
});
