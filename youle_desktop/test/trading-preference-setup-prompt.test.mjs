import assert from "node:assert/strict";
import test from "node:test";
import { createHarness } from "./helpers/trading-preference-harness.mjs";

const profileResult = (completed = false) => ({
  ok: true, completed, profile: { onboardingCompleted: completed },
});
const createStorage = () => {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};
const flushFrame = h => h.runtime.frames.splice(0).forEach(callback => callback());
const prompt = h => {
  h.scheduleTradingPreferenceSetupPrompt();
  flushFrame(h);
};
const setup = (localStorage = createStorage(), load = async () => profileResult()) =>
  createHarness({ localStorage, api: { getTradingPreferenceProfile: load } });

test("first unset profile opens trading settings with the requested toast only after startup", async () => {
  const storage = createStorage();
  const h = setup(storage);
  h.state.loading = true;
  await h.loadTradingPreferenceProfile();
  prompt(h);
  assert.equal(h.runtime.openedSettings.length, 0);
  assert.equal(storage.values.size, 0);
  h.state.loading = false;
  h.scheduleTradingPreferenceSetupPrompt();
  h.scheduleTradingPreferenceSetupPrompt();
  flushFrame(h);
  assert.deepEqual(h.runtime.openedSettings, ["trading"]);
  assert.deepEqual(h.runtime.toasts, [["请设置交易偏好，新增左侧入场策略", 6000]]);
  assert.equal(h.runtime.saves.length, 0);
  assert.equal(storage.values.size, 1);
});

test("closing without saving suppresses the prompt on reload and the next launch", async () => {
  const storage = createStorage();
  const first = setup(storage);
  await first.loadTradingPreferenceProfile();
  prompt(first);
  await first.loadTradingPreferenceProfile();
  prompt(first);
  assert.equal(first.runtime.openedSettings.length, 1);
  const restarted = setup(storage);
  await restarted.loadTradingPreferenceProfile();
  prompt(restarted);
  assert.deepEqual(restarted.runtime.openedSettings, []);
  assert.deepEqual(restarted.runtime.toasts, []);
});

test("saved profiles, including entry-mode-only saves, never auto-open settings", async () => {
  for (const result of [
    profileResult(true),
    { ok: true, completed: true, profile: { entryMode: "left", fieldSources: { entryMode: "user_saved" } } },
    { ok: true, profile: { onboardingCompleted: true } },
  ]) {
    const storage = createStorage();
    const h = setup(storage, async () => result);
    await h.loadTradingPreferenceProfile();
    prompt(h);
    assert.deepEqual(h.runtime.openedSettings, []);
    assert.equal(storage.values.size, 0);
  }
});

test("errors and unavailable APIs do not consume the prompt; a later successful read can show it", async () => {
  for (const failure of [null, { ok: false }, { ok: true }, new Error("offline")]) {
    let result = failure;
    const storage = createStorage();
    const h = setup(storage, async () => {
      if (result instanceof Error) throw result;
      return result;
    });
    assert.equal(await h.loadTradingPreferenceProfile(), false);
    prompt(h);
    assert.deepEqual(h.runtime.openedSettings, []);
    assert.equal(storage.values.size, 0);
    result = profileResult();
    await h.loadTradingPreferenceProfile();
    prompt(h);
    assert.deepEqual(h.runtime.openedSettings, ["trading"]);
  }
  const h = createHarness();
  await h.loadTradingPreferenceProfile();
  prompt(h);
  assert.deepEqual(h.runtime.openedSettings, []);
});

test("prompt history is scoped to the account and API service and survives logout", async () => {
  const h = setup();
  await h.loadTradingPreferenceProfile();
  prompt(h);
  h.state.auth.profile.id = "second-account";
  h.resetTradingPreferenceProfileState();
  await h.loadTradingPreferenceProfile();
  prompt(h);
  assert.equal(h.runtime.openedSettings.length, 2);
  h.state.auth.profile.id = "qa-account";
  h.resetTradingPreferenceProfileState();
  await h.loadTradingPreferenceProfile();
  prompt(h);
  assert.equal(h.runtime.openedSettings.length, 2);
  h.state.auth.baseUrl = "https://another-qa.invalid";
  h.resetTradingPreferenceProfileState();
  await h.loadTradingPreferenceProfile();
  prompt(h);
  assert.equal(h.runtime.openedSettings.length, 3);
});

test("logout or a settings save before the scheduled frame cancels the prompt", async () => {
  for (const cancel of [
    h => { h.state.auth.authenticated = false; h.resetTradingPreferenceProfileState(); },
    async h => { await h.tradingPreferenceSettings.load(); await h.tradingPreferenceSettings.save(); },
  ]) {
    const storage = createStorage();
    const h = createHarness({ localStorage: storage, api: {
      getTradingPreferenceProfile: async () => profileResult(),
      saveTradingPreferenceProfile: async () => profileResult(true),
    } });
    await h.loadTradingPreferenceProfile();
    h.scheduleTradingPreferenceSetupPrompt();
    await cancel(h);
    flushFrame(h);
    assert.deepEqual(h.runtime.openedSettings, []);
    assert.equal(storage.values.size, 0);
  }
});

test("a stale profile response cannot open settings for the next account", async () => {
  let resolve;
  const h = setup(createStorage(), () => new Promise(done => { resolve = done; }));
  const pending = h.loadTradingPreferenceProfile();
  h.state.auth.profile.id = "second-account";
  h.resetTradingPreferenceProfileState();
  resolve(profileResult());
  assert.equal(await pending, false);
  prompt(h);
  assert.deepEqual(h.runtime.openedSettings, []);
});
