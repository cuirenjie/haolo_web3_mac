import assert from 'node:assert/strict';
import { SettingsReplica } from '../src/renderer/account-settings-sync.ts';
import { clientSettingsRequest } from '../src/main/client-settings-sync.mjs';
import { sharedDefaultIndicatorColor } from '../src/renderer/shared-indicator-defaults.ts';

const baseUrl = 'http://127.0.0.1:18089';
const owner = '0fdfe087-803a-4fba-b2ae-a7dd3b361faa';
const api = { token: 'synthetic-local-fixture', profile: { id: owner }, baseUrl,
  load: async () => {}, requireAuth() {}, authHeaders: () => ({}),
  async requestJson(url, options) {
    assert.equal(new URL(url).origin, baseUrl);
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`Fixture HTTP ${response.status}`);
    return response.json();
  },
};
const request = (action, body) => clientSettingsRequest(api, { action, owner, baseUrl, body });
const replica = new SettingsReplica(); replica.merge(await request('read'));
if (process.argv[2] === 'seed') {
  replica.edit(replica.values(), {
    'app.theme': 'dark', 'app.language': 'zh-Hant', 'app.fontScale': 1.1,
    'indicator.main:ma.enabled': true, 'indicator.main:ma.parameters.0': 21,
    'indicator.main:ma.series.short.color': '#123456', 'indicator.main:ma.series.short.lineWidth': 3,
    'chart.risingColor': '#234567', 'chart.themes.dark.backgroundColor': '#171819',
  });
  await request('write', replica.begin());
  console.log('Windows -> API: saved parameters, color, width, theme, language, font and chart appearance.');
} else {
  const values = replica.values();
  assert.equal(values['app.theme'], 'light'); assert.equal(values['app.language'], 'en');
  assert.equal(values['app.fontScale'], 1.2); assert.equal(values['app.completionNotices'], false);
  assert.equal(values['indicator.main:ma.parameters.0'], 34);
  assert.equal(values['indicator.main:ma.series.short.color'], '#abcdef');
  assert.equal(values['indicator.main:ma.series.short.lineWidth'], 2);
  assert.equal(values['indicator.main:ma.series.medium.color'], null);
  assert.equal(sharedDefaultIndicatorColor('indicator.main:ma.series.medium.color', false), '#986800');
  assert.equal(values['chart.risingColor'], '#234567');
  console.log('Flutter -> API -> Windows: all changes and default reset received; unrelated chart color preserved.');
}
