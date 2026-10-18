import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {CloudRunJournal} from '../src/main/trading-strategy-runtime/cloud-run-journal.mjs';

test('encrypted journal survives restart, serializes mutations and isolates accounts',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'haolo-cloud-journal-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const key=randomBytes(32),safeStorage={isEncryptionAvailable:()=>true,
    encryptString(text){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]);},
    decryptString(data){const cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8');}};
  const options={storagePath:path.join(directory,'runs.bin'),safeStorage};
  const journal=new CloudRunJournal(options);
  await Promise.all([journal.put('account-a','a',{instruction:'private-user-text'}),journal.put('account-a','b',{state:'prepared'}),journal.put('account-b','a',{state:'queued'})]);
  const reopened=new CloudRunJournal(options);
  assert.equal((await reopened.get('account-a','a')).instruction,'private-user-text');
  assert.equal((await reopened.get('account-b','a')).state,'queued');
  assert.equal((await reopened.list('account-a')).length,2);
  assert.equal((await fs.readFile(options.storagePath)).includes('private-user-text'),false);
  const locked=new CloudRunJournal({...options,safeStorage:{isEncryptionAvailable:()=>false}});
  await assert.rejects(locked.put('account-a','a',{}),e=>e.code==='SECURE_STORAGE_UNAVAILABLE');
  assert.equal((await reopened.get('account-a','a')).instruction,'private-user-text');
});
