import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = await readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const rendererSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

test("desktop session maintenance covers startup, periodic checks, resume, and unlock", () => {
  assert.match(
    mainSource,
    /safeStorage,\s*\n\s*networkFetch:\s*appNetworkFetch,\s*\n\s*\}\)\)/,
  );
  assert.match(mainSource, /startYouleSessionMaintenance\(\)/);
  assert.match(mainSource, /maintainYouleSession\("app-ready"\)/);
  assert.match(mainSource, /maintainYouleSession\("periodic"\)/);
  assert.match(mainSource, /powerMonitor\.on\("resume"/);
  assert.match(mainSource, /maintainYouleSession\("system-resume"\)/);
  assert.match(mainSource, /powerMonitor\.on\("unlock-screen"/);
  assert.match(mainSource, /maintainYouleSession\("screen-unlock"\)/);
  assert.match(mainSource, /clearInterval\(youleSessionMaintenanceTimer\)/);
});

test("renderer network recovery reaches the main-process session refresher", () => {
  assert.match(mainSource, /ipcMain\.handle\("youle:refreshSession"/);
  assert.match(preloadSource, /refreshYouleSession:\s*\(params\)\s*=>\s*ipcRenderer\.invoke\("youle:refreshSession", params\)/);
  assert.match(rendererSource, /window\.addEventListener\(\s*"online"/);
  assert.match(rendererSource, /api\.refreshYouleSession\?\.\(\{ reason: "network-online" \}\)/);
});

test("terminal auth expiry is single-flight and ignores already-cleared sessions", () => {
  assert.match(mainSource, /let youleSessionExpirationPromise = null/);
  assert.match(mainSource, /if \(youleSessionExpirationPromise\) return youleSessionExpirationPromise/);
  assert.match(mainSource, /if \(!currentSession\.authenticated\) return currentSession/);
  assert.match(mainSource, /youleSessionExpirationPromise = expirationPromise/);
  assert.match(mainSource, /youleSessionExpirationPromise === expirationPromise/);
  assert.match(mainSource, /youleSessionExpirationPromise = null/);
});

test("explicit logout joins auth-expiry cleanup without sending a stale expiry event", () => {
  assert.match(
    mainSource,
    /function wrapYouleApiClient[\s\S]*const authRevision = target\.authRevision;[\s\S]*isYouleAuthExpiredError\(error\) && authRevision === target\.authRevision/,
  );
  assert.match(mainSource, /let youleSessionLogoutOperation = null/);
  assert.match(
    mainSource,
    /function beginYouleSessionLogout[\s\S]*if \(youleSessionLogoutOperation\)[\s\S]*youleSessionLogoutOperation\.explicit = true/,
  );
  assert.match(
    mainSource,
    /const logoutOperation = beginYouleSessionLogout\(apiClient\)[\s\S]*if \(logoutOperation\.explicit\) return session;[\s\S]*sendToRenderer\("youle:authExpired"/,
  );
  assert.match(
    mainSource,
    /ipcMain\.handle\("youle:logout"[\s\S]*beginYouleSessionLogout\(getYouleApiClient\(\), \{ explicit: true \}\)/,
  );
  assert.match(
    rendererSource,
    /function handleAuthExpired[\s\S]*if \(state\.loggingOut \|\| !state\.auth\.authenticated\) return;/,
  );
});
