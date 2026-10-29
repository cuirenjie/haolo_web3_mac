import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/main/main.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const helpers = ['voiceRequestId', 'clearVoiceSessionOwner', 'voiceTranscriptionErrorPayload'];
const declarations = helpers.map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)).join('\n');
const registration = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(ast) === 'ipcMain.handle' && node.expression.arguments[0]?.text === 'voice:startSession');

function harness() {
  const pending = [], starts = [];
  const permission = () => new Promise((resolve, reject) => pending.push({resolve, reject}));
  const recognizer = {startSession: async params => { starts.push(params); return {requestId: params.requestId}; }};
  const run = Function('ensureVoiceMicrophoneAccess', 'getVoiceRecognizer', `
    let voiceSessionOwner = null;
    const clearVoiceCredentialCache = () => {};
    const appLanguage = () => 'en';
    ${declarations}
    return { start: ${registration.expression.arguments[1].getText(ast)},
      clear: () => {voiceSessionOwner = null;}, owner: () => voiceSessionOwner };
  `)(permission, () => recognizer);
  return {...run, pending, starts};
}
const event = id => ({sender: {id, isDestroyed: () => false, send() {}}});

test('mac permission wait reserves the voice session against another window', async () => {
  const h = harness();
  const first = h.start(event(1), {requestId: 'first'});
  const second = h.start(event(2), {requestId: 'second'});
  // Resolve all waits so the old implementation fails an assertion, never hangs.
  h.pending.forEach(item => item.resolve({ok: true}));
  assert.equal((await first).ok, true);
  assert.equal((await second).code, 'VOICE_SESSION_BUSY');
  assert.deepEqual(h.starts.map(item => item.requestId), ['first']);
  assert.equal(h.owner().webContentsId, 1);
});

for (const boundary of ['cancel', 'closed', 'replacement']) test(`mac permission completion cannot revive a ${boundary} capture`, async () => {
  const h = harness(), sender = event(1);
  const first = h.start(sender, {requestId: 'old'});
  let replacement;
  if (boundary === 'closed') sender.sender.isDestroyed = () => true;
  else h.clear();
  if (boundary === 'replacement') replacement = h.start(event(1), {requestId: 'new'});
  h.pending[0].resolve({ok: true});
  assert.equal((await first).ok, false);
  assert.equal(h.starts.length, 0);
  if (replacement) {
    h.pending[1].resolve({ok: true});
    assert.equal((await replacement).ok, true);
    assert.deepEqual(h.starts.map(item => item.requestId), ['new']);
  }
});

test('permission denial or rejection releases its reservation for the next capture', async () => {
  const h = harness();
  const denied = h.start(event(1), {requestId: 'denied'});
  h.pending[0].resolve({ok: false, code: 'VOICE_MICROPHONE_PERMISSION_DENIED'});
  assert.equal((await denied).code, 'VOICE_MICROPHONE_PERMISSION_DENIED');
  assert.equal(h.owner(), null);
  const rejected = h.start(event(2), {requestId: 'rejected'});
  const result = rejected.catch(error => ({unexpectedRejection: error.message}));
  h.pending[1].reject(new Error('permission check failed'));
  assert.equal((await result).code, 'VOICE_TRANSCRIPTION_FAILED');
  assert.equal(h.owner(), null);
});
