import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AutomationStore } from '../src/main/automation/store.mjs';

test('reading during a pending commit cannot replace uncommitted run state', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haolo-store-read-race-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const store = new AutomationStore({dataDir:directory});
  const job = await store.createJob({name:'Fixture', workspacePath:directory,
    prompt:'Every run, inspect the workspace and return NO_FINDINGS if no findings.',
    schedule:{type:'manual',timezone:'UTC'}});
  let arrived, release;
  const entering = new Promise(resolve => {arrived=resolve;});
  const gate = new Promise(resolve => {release=resolve;});
  const write = store.writeSnapshot.bind(store);
  store.writeSnapshot = async () => {arrived(); await gate; return write();};
  const creating = store.createRun({jobId:job.id,triggerType:'manual',status:'running'});
  await entering;
  let readFinished=false;
  const reading=store.listRuns().then(rows => {readFinished=true; return rows;});
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(readFinished, false, 'reads must wait for the pending commit');
  } finally { release(); }
  const run=await creating;
  assert.equal((await reading)[0].id,run.id);
  const reopened=new AutomationStore({dataDir:directory});
  assert.equal((await reopened.getRun(run.id)).status,'running');
});
