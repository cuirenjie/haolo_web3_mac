// Isolated backend integration probe. Never accepts a production endpoint or
// real credentials. Each invocation is a fresh desktop main-process adapter.
import assert from 'node:assert/strict';
import { YouleApiClient } from '../src/main/youle-api-client.mjs';
import { createCloudTradingPreferences } from '../src/main/personal-context/cloud-trading-preferences.mjs';
import { createTradingPreferenceSettings } from '../src/renderer/trading-preference-settings.ts';

const baseUrl = process.env.HAOLO_PREFERENCE_TEST_BASE_URL;
const accountId = process.env.HAOLO_PREFERENCE_TEST_OWNER;
const endpoint = new URL(baseUrl);
assert.equal(endpoint.protocol, 'http:');
assert.equal(endpoint.hostname, '127.0.0.1');
assert.match(accountId, /^[0-9a-f-]{36}$/);
const api = new YouleApiClient({
  serviceFetch: (url, options) => {
    assert.equal(new URL(url).origin, endpoint.origin);
    return fetch(url, { ...options, headers: { ...options.headers, 'X-Test-User': accountId } });
  },
});
api.loaded = true;
api.baseUrl = baseUrl;
api.profile = { id: accountId };
api.token = 'isolated-test-only';
const adapter = createCloudTradingPreferences({
  owner: async () => ({ ownerId: `${baseUrl}::${accountId}`, accountId, baseUrl }),
  api: () => api,
});
const loaded = await adapter.load();
const action = process.argv[2];
if (action === 'save') {
  assert.equal(loaded.revision, 0);
  const draft = loaded.profile.preferenceForm;
  draft.entryMode = 'left';
  for (const [id, selected] of Object.entries({
    risk: ['1'], breakEven: ['off'], ratio: ['2'], style: ['detailed'],
    sections: ['adaptive'], discipline: ['no-add', 'news'],
  })) draft.choices[id] = { selected, custom: '' };
  const saved = await adapter.save({ ...draft, expectedRevision: loaded.revision });
  assert.equal(saved.revision, 1);
  assert.equal(saved.completed, true);
  assert.deepEqual(saved.profile.preferenceForm, draft);
} else if (action?.startsWith('verify-account-')) {
  const phase = action.slice('verify-account-'.length);
  assert.ok(['multi', 'right', 'none'].includes(phase));
  assert.equal(loaded.revision, { multi: 1, right: 2, none: 3 }[phase]);
  assert.equal(loaded.profile.maxLossPerTradePercent, 2);
  assert.equal(loaded.profile.breakEvenTriggerR, 1.5);
  assert.equal(loaded.profile.minimumRiskRewardRatio, 1.5);
  const editor = createTradingPreferenceSettings({
    load: () => adapter.load(), save: () => { throw Error('Read-only verification'); },
    render() {}, onSaved() {},
  });
  await editor.load();
  const view = editor.render();
  for (const [id, selected] of Object.entries({
    entryMode: [phase === 'multi' ? 'left' : 'right'], risk: ['2'],
    breakEven: ['1.5'], ratio: ['1.5'], style: ['concise'], sections: ['fixed'],
    discipline: phase === 'none' ? ['none'] : ['no-add', 'trend', 'no-chase'],
  })) {
    const field = view.match(new RegExp(`<fieldset data-preference-field="${id}"[\\s\\S]*?</fieldset>`))[0];
    const checked = [...field.matchAll(/value="([^"]+)" checked/g)].map(match => match[1]);
    assert.deepEqual(checked.sort(), selected.sort());
  }
} else {
  assert.ok(['verify-desktop', 'verify-mobile'].includes(action));
  const mobile = action === 'verify-mobile';
  assert.equal(loaded.revision, mobile ? 2 : 1);
  assert.equal(loaded.profile.entryMode, mobile ? 'right' : 'left');
  assert.equal(loaded.profile.maxLossPerTradePercent, mobile ? 3 : 1);
  assert.equal(loaded.profile.minimumRiskRewardRatio, 2);
  assert.equal(loaded.profile.moveStopToBreakEven, false);
  assert.equal(loaded.profile.analysisStyle, 'detailed');
  assert.deepEqual(loaded.profile.preferenceForm.choices.discipline.selected, ['no-add', 'news']);
  assert.ok(Object.values(loaded.fieldSources).every(source => source === 'user_saved'));
}
console.log(JSON.stringify({ action, passed: true }));
