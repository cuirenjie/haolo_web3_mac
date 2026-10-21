import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compactMarketPayload, decodeMarketPayload } from '../src/market-wire-codec.mjs';
import { decodeMarketPayload as desktopDecode } from '../../../youle_desktop/src/main/market-wire-codec.mjs';
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/market-wire-hmc1.json', import.meta.url)));
test('Node encoder, desktop decoder and shared mobile goldens remain identical', () => {
  for (const fixture of fixtures) {
    const combined = fixture.json.data != null;
    const event = combined ? fixture.json : { stream: 'unused', data: fixture.json };
    assert.deepEqual(compactMarketPayload(event, combined), fixture.compact, fixture.name);
    assert.deepEqual(decodeMarketPayload(fixture.compact), fixture.json, fixture.name);
    assert.deepEqual(desktopDecode(fixture.compact), fixture.json, fixture.name);
  }
});
