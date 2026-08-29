import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("automatic long-response file conversion is absent from every app boundary", async () => {
  const [main, preload, renderer] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
  ]);
  const removedIdentifiers = [
    "LONG_FORM_WORD_THRESHOLD",
    "createAutomaticResultArtifact",
    "createLongFormWordArtifact",
    "ensureAutomaticLongFormArtifact",
    "automatic_long_form_artifact",
    "automatic_long_form_word",
    "long_form_artifact",
    "long_form_word_artifact",
  ];
  for (const identifier of removedIdentifiers) {
    assert.doesNotMatch(main, new RegExp(identifier));
    assert.doesNotMatch(preload, new RegExp(identifier));
    assert.doesNotMatch(renderer, new RegExp(identifier));
  }
  await assert.rejects(access(new URL("../src/main/long-form-word.mjs", import.meta.url)));
  await assert.rejects(access(new URL("../src/main/automatic-result-artifact.mjs", import.meta.url)));
});

test("long replies stay inline while explicit result artifacts remain supported", async () => {
  const [main, renderer] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
  ]);
  const providerHandler = sourceBlock(
    main,
    'ipcMain.handle("youle:sendProviderChat"',
    "function assertExternalModelsIpcSender",
  );
  assert.match(providerHandler, /questionAnswerStream\?\.complete\(finalMessage\)/);
  assert.match(providerHandler, /return result;/);

  const artifactNotification = sourceBlock(
    main,
    "async function notifyThreadArtifactsChanged",
    "async function createQuestionAnswerDerivedMediaResult",
  );
  assert.match(artifactNotification, /extractDeliveredArtifactPaths/);
  assert.match(artifactNotification, /buildResultArtifactIndexEntries\(deliveredItems/);
  assert.match(artifactNotification, /buildUnclaimedArtifactIndexEntries\(changedOutputItems/);
  assert.doesNotMatch(artifactNotification, /write.*Artifact|visibleCharacter|threshold/i);

  const bubble = sourceBlock(
    renderer,
    "function renderTextBubble",
    "function renderMessageThreadReferencePreview",
  );
  assert.match(bubble, /content\.text \? `<div class="message-text">/);
  assert.doesNotMatch(bubble, /automaticDeliveryLabel|长文已整理|长内容已整理/);
});
