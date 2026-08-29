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

test("contact request background sync backs off after failed loads", async () => {
  const source = await mainSource;

  assert.match(source, /const CONTACT_REQUEST_SYNC_INTERVAL_MS = 6_000;/);
  assert.match(source, /const CONTACT_REQUEST_SYNC_BACKOFF_BASE_MS = 15_000;/);
  assert.match(source, /const CONTACT_REQUEST_SYNC_MAX_BACKOFF_MS = 5 \* 60_000;/);
  assert.match(source, /let contactRequestSyncFailureCount = 0;/);
  assert.match(source, /let contactRequestSyncNextAllowedAt = 0;/);

  const startBlock = sourceBlock(source, "function startContactRequestSync", "function stopContactRequestSync");
  assert.match(startBlock, /resetContactRequestSyncBackoff\(\);/);
  assert.match(startBlock, /const now = Date\.now\(\);/);
  assert.match(startBlock, /if \(contactRequestSyncNextAllowedAt > now\) return;/);
  assert.match(startBlock, /CONTACT_REQUEST_SYNC_INTERVAL_MS/);

  const backoffBlock = sourceBlock(source, "function stopContactRequestSync", "function contactRequestsSignature");
  assert.match(backoffBlock, /resetContactRequestSyncBackoff\(\);/);
  assert.match(backoffBlock, /function resetContactRequestSyncBackoff\(\)/);
  assert.match(backoffBlock, /contactRequestSyncFailureCount = 0;/);
  assert.match(backoffBlock, /contactRequestSyncNextAllowedAt = 0;/);
  assert.match(backoffBlock, /function markContactRequestSyncFailure\(\)/);
  assert.match(backoffBlock, /contactRequestSyncFailureCount \+= 1;/);
  assert.match(backoffBlock, /CONTACT_REQUEST_SYNC_BACKOFF_BASE_MS \* 2 \*\* backoffStep/);
  assert.match(backoffBlock, /CONTACT_REQUEST_SYNC_MAX_BACKOFF_MS/);
  assert.match(backoffBlock, /contactRequestSyncNextAllowedAt = Date\.now\(\) \+ delayMs;/);

  const loadBlock = sourceBlock(
    source,
    "async function loadContactRequests",
    "async function syncContactRequestsAndContacts",
  );
  assert.match(loadBlock, /if \(!api\.listContactRequests\) return false;/);
  assert.match(loadBlock, /if \(!options\.force && state\.contactRequestsState\.loaded\) return true;/);
  assert.match(loadBlock, /resetContactRequestSyncBackoff\(\);\s*return true;/s);
  assert.match(loadBlock, /markContactRequestSyncFailure\(\);\s*return false;/s);

  const syncBlock = sourceBlock(source, "async function syncContactRequestsAndContacts", "async function submitContactAddRequest");
  assert.match(syncBlock, /const loaded = await loadContactRequests\(\{ force: true, renderAfter: false \}\)\.catch\(\(\) => false\);/);
  assert.match(syncBlock, /if \(!loaded\) \{\s*if \(options\.renderAfter !== false\) render\(\);\s*return;\s*\}/s);
});
