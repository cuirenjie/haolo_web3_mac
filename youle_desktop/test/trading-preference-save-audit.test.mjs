import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudTradingPreferences, cloudTradingPreferenceFailure } from '../src/main/personal-context/cloud-trading-preferences.mjs';
import { translateAppText } from '../src/renderer/app-language.mjs';
import { createTradingPreferenceSettings } from '../src/renderer/trading-preference-settings.ts';
import { DEFAULT_TRADING_PREFERENCE_ENTRIES } from '../src/main/personal-context/trading-preference-defaults.mjs';
import { TRADING_PREFERENCE_CHOICE_FIELDS } from '../src/shared/trading-preference-fields.mjs';

function fixture() {
  const choices = Object.values(TRADING_PREFERENCE_CHOICE_FIELDS).flat();
  let current = {
    schemaVersion: 1, revision: 0, configHash: 'a'.repeat(64),
    fields: Object.fromEntries([
      ['entryMode', { choice: { selected: ['auto'], custom: '' }, source: 'product_default' }],
      ...choices.map(f => [f.id, { choice: { selected: [f.defaultValue], custom: '' }, source: 'product_default' }]),
    ]),
    entries: structuredClone(DEFAULT_TRADING_PREFERENCE_ENTRIES),
    extraNotes: { value: '', source: 'product_default' },
  };
  const receipts = new Map(), calls = [];
  let confirmationFailure = false, afterSave;
  const api = { async tradingCloudRequest(operation, payload, options) {
    calls.push({ operation, payload, key: options.idempotencyKey });
    if (operation === 'preferences') {
      if (confirmationFailure && receipts.size) throw new Error('connection interrupted');
      return current;
    }
    if (receipts.has(options.idempotencyKey)) return receipts.get(options.idempotencyKey);
    assert.equal(payload.expectedRevision, current.revision);
    current = structuredClone(current);
    current.revision++;
    for (const [id, choice] of Object.entries(payload.changes)) {
      current.fields[id] = { choice: structuredClone(choice), source: 'user_saved' };
    }
    if (Object.hasOwn(payload, 'extraNotes')) current.extraNotes = { value: payload.extraNotes, source: 'user_saved' };
    const receipt = structuredClone(current);
    receipts.set(options.idempotencyKey, receipt);
    afterSave?.(current);
    return receipt;
  } };
  const makeAdapter = () => createCloudTradingPreferences({
    owner: async () => ({ ownerId: 'audit', accountId: 'audit', baseUrl: 'https://audit.invalid' }),
    api: () => api,
  });
  return {
    adapter: makeAdapter(), makeAdapter, calls, receipts,
    failConfirmation(value) { confirmationFailure = value; },
    afterSave(fn) { afterSave = fn; },
  };
}

const changes = [
  ...['left', 'right', 'auto'].map(mode => ['entryMode', { selected: [mode], custom: '' }]),
  ['risk', { selected: ['1'], custom: '' }],
  ['breakEven', { selected: ['off'], custom: '' }],
  ['ratio', { selected: ['2'], custom: '' }],
  ['style', { selected: ['detailed'], custom: '' }],
  ['sections', { selected: ['adaptive'], custom: '' }],
  ['discipline', { selected: ['no-add', 'news'], custom: '' }],
  ['extraNotes', ''],
];
for (const [id, choice] of changes) {
  test(`one-field save reports success without the questionnaire marker: ${id} ${JSON.stringify(choice)}`, async () => {
    const f = fixture();
    const loaded = await f.adapter.load();
    assert.equal(loaded.completed, false);
    const payload = { ...loaded.profile.preferenceForm, expectedRevision: 0, changedFields: [id] };
    if (id === 'entryMode') payload.entryMode = choice.selected[0];
    else if (id === 'extraNotes') payload.extraNotes = choice;
    else payload.choices[id] = choice;
    const editor = createTradingPreferenceSettings({
      load: () => f.adapter.load(), save: () => f.adapter.save(payload), render() {}, onSaved() {},
    });
    await editor.load();
    await editor.save();
    assert.match(editor.render(), /role="status">交易偏好已保存/);
    assert.match(editor.render(), /role="alert" hidden/);
    const fresh = await f.makeAdapter().load();
    assert.equal(fresh.completed, true);
    assert.equal(fresh.revision, 1);
    assert.equal(fresh.profile.entries.some(e => e.key === 'onboarding_completed'), false);
    assert.deepEqual(f.calls.find(c => c.operation === 'savePreferences').payload.changes,
      id === 'extraNotes' ? {} : { [id]: choice });
  });
}

test('the settings success contract does not depend on retired questionnaire completion', async () => {
  const f = fixture();
  const editor = createTradingPreferenceSettings({
    load: () => f.adapter.load(),
    save: async () => ({ ...(await f.adapter.save({ entryMode: 'right', changedFields: ['entryMode'] })), completed: false }),
    render() {}, onSaved() {},
  });
  await editor.load(); await editor.save();
  assert.match(editor.render(), /role="status">交易偏好已保存/);
  assert.match(editor.render(), /role="alert" hidden/);
});

for (const asynchronous of [false, true]) {
  test(`post-save callback errors cannot turn a persisted save into failure (async=${asynchronous})`, async () => {
    const f = fixture();
    const editor = createTradingPreferenceSettings({
      load: () => f.adapter.load(),
      save: () => f.adapter.save({ entryMode: 'right', changedFields: ['entryMode'] }),
      render() {},
      onSaved: asynchronous ? async () => { throw Error('view refresh failed'); } : () => { throw Error('view refresh failed'); },
    });
    await editor.load(); await editor.save();
    assert.match(editor.render(), /role="status">交易偏好已保存/);
    assert.match(editor.render(), /role="alert" hidden/);
    assert.equal(f.receipts.size, 1);
  });
}

test('a confirmed write with unavailable readback is pending confirmation, then retries without a second write', async () => {
  const f = fixture();
  await f.adapter.load();
  const payload = { entryMode: 'right', changedFields: ['entryMode'], expectedRevision: 0 };
  f.failConfirmation(true);
  await assert.rejects(f.adapter.save(payload), { code: 'TRADING_PREFERENCE_CONFIRMATION_PENDING' });
  f.failConfirmation(false);
  assert.equal((await f.adapter.save(payload)).completed, true);
  assert.equal(f.receipts.size, 1);
  const writes = f.calls.filter(c => c.operation === 'savePreferences');
  assert.equal(writes[0].key, writes[1].key);
});

test('a newer revision during readback is distinguished from a rejected write', async () => {
  const f = fixture();
  await f.adapter.load();
  f.afterSave(current => { current.revision++; current.fields.entryMode.choice.selected = ['left']; });
  await assert.rejects(f.adapter.save({ entryMode: 'right', changedFields: ['entryMode'] }),
    { code: 'PREFERENCE_UPDATED_AFTER_SAVE' });
  assert.equal((await f.makeAdapter().load()).profile.entryMode, 'left');
});

test('a lost PATCH response reports an unknown result and retry does not save twice', async () => {
  const f = fixture();
  await f.adapter.load();
  f.afterSave(() => { throw Object.assign(Error('fetch failed'), { category: 'transport' }); });
  const payload = { entryMode: 'right', changedFields: ['entryMode'], expectedRevision: 0 };
  await assert.rejects(f.adapter.save(payload), { code: 'TRADING_PREFERENCE_SAVE_UNCONFIRMED' });
  assert.equal((await f.makeAdapter().load()).profile.entryMode, 'right');
  assert.equal((await f.adapter.save(payload)).revision, 1);
  assert.equal(f.receipts.size, 1);
});

for (const [code, title] of [
  ['TRADING_PREFERENCE_CONFIRMATION_PENDING', '保存结果待确认'],
  ['TRADING_PREFERENCE_SAVE_UNCONFIRMED', '保存结果待确认'],
  ['PREFERENCE_UPDATED_AFTER_SAVE', '配置已更新'],
]) {
  test(`save outcome ${code} has an accurate, localized error envelope and heading`, async () => {
    const envelope = cloudTradingPreferenceFailure({ code, message: 'private detail must not leak' });
    assert.equal(envelope.error.code, code);
    assert.doesNotMatch(envelope.error.message, /private detail|尚未保存/);
    for (const language of ['en', 'zh-TW']) {
      assert.notEqual(translateAppText(envelope.error.message, language), envelope.error.message);
      assert.notEqual(translateAppText(title, language), title);
    }
    const f = fixture();
    const editor = createTradingPreferenceSettings({
      load: () => f.adapter.load(), save: async () => envelope, render() {}, onSaved() { assert.fail('No confirmation'); },
    });
    await editor.load(); await editor.save();
    const alert = editor.render().match(/role="alert"[\s\S]*?<\/div>/)[0];
    assert.ok(alert.includes(title));
    assert.doesNotMatch(alert, /保存失败/);
    assert.doesNotMatch(editor.render(), /role="status">交易偏好已保存/);
  });
}
