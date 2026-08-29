import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("profile refresh ignores stale logout-era level refresh failures", async () => {
  const source = await mainSource;
  const helperBlock = sourceBlock(
    source,
    "function authProfileRefreshSnapshot",
    "function applyActivityLevelResult",
  );

  assert.match(helperBlock, /authenticated: state\.auth\.authenticated/);
  assert.match(helperBlock, /baseUrl: state\.auth\.baseUrl \|\| ""/);
  assert.match(helperBlock, /profileKey: currentAuthProfileIdentityKey\(\)/);
  assert.match(helperBlock, /return state\.auth\.authenticated && snapshot === authProfileRefreshSnapshot\(\)/);

  const refreshBlock = sourceBlock(
    source,
    "async function refreshProfileFromApi",
    "function prepareProfileEditDraft",
  );

  assert.match(refreshBlock, /if \(!state\.auth\.authenticated\) return/);
  assert.match(refreshBlock, /const refreshSnapshot = authProfileRefreshSnapshot\(\)/);
  assert.match(refreshBlock, /if \(!canApplyProfileRefreshResult\(refreshSnapshot\)\) return/);
  assert.match(refreshBlock, /const levelRefreshSnapshot = authProfileRefreshSnapshot\(\)/);
  assert.match(refreshBlock, /if \(!canApplyProfileRefreshResult\(levelRefreshSnapshot\)\) return/);
  assert.match(refreshBlock, /canApplyProfileRefreshResult\(levelRefreshSnapshot\)[\s\S]*console\.warn\("\[member-level\] profile refresh failed", error\)/);
  assert.match(refreshBlock, /options\.reportError && canApplyProfileRefreshResult\(refreshSnapshot\)/);
  assert.match(refreshBlock, /if \(isAuthSessionExpiredError\(error\)\) \{\s*state\.error = null;/);
  assert.match(refreshBlock, /console\.warn\("\[profile\] refresh failed", error\)/);
  assert.doesNotMatch(refreshBlock, /用户信息加载失败/);
  assert.doesNotMatch(refreshBlock, /等级信息加载失败|state\.error\s*=\s*`[^`]*等级信息/);
});

test("profile refresh never exposes revoked-session errors", async () => {
  const source = await mainSource;
  const errorHelperBlock = sourceBlock(
    source,
    "function isAuthSessionExpiredError",
    "function cleanIpcError",
  );
  assert.match(errorHelperBlock, /YOULE_AUTH_EXPIRED/);
  assert.match(errorHelperBlock, /SESSION_REVOKED/);
  assert.match(errorHelperBlock, /session\\s\+/);
});

test("returning to the desktop silently refreshes membership and balance once", async () => {
  const source = await mainSource;
  const lifecycleBlock = sourceBlock(
    source,
    "function wireDesktopEvents",
    "function scheduleRender",
  );
  assert.match(lifecycleBlock, /window\.addEventListener\("focus", \(\) => refreshProfileOnAppActivation\(\)/);
  assert.match(lifecycleBlock, /document\.addEventListener\("visibilitychange", \(\) => refreshProfileOnAppActivation\(\)/);
  assert.match(lifecycleBlock, /await api\.refreshYouleSession\?\.\(\{ reason: "network-online" \}\)/);
  assert.match(lifecycleBlock, /refreshProfileOnAppActivation\(\{ force: true \}\)/);

  const activationRefreshBlock = sourceBlock(
    source,
    "function refreshProfileOnAppActivation",
    "async function refreshProfileFromApi",
  );
  assert.match(activationRefreshBlock, /!state\.auth\.authenticated \|\| document\.visibilityState !== "visible"/);
  assert.match(activationRefreshBlock, /if \(profileActivationRefreshInFlight\) return/);
  assert.match(activationRefreshBlock, /PROFILE_ACTIVATION_REFRESH_MIN_INTERVAL_MS/);
  assert.match(activationRefreshBlock, /refreshProfileFromApi\(\{[\s\S]*renderAfter: false,[\s\S]*reportError: false,[\s\S]*showRefreshing: false/);
  assert.match(activationRefreshBlock, /if \(refreshed\) scheduleRender\(\{ protectComposer: true \}\)/);
  assert.match(activationRefreshBlock, /profileActivationRefreshInFlight = false/);
});
