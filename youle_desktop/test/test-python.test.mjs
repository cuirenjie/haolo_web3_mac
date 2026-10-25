import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveTestPython } from '../scripts/test-python.mjs';

test('broken Windows aliases and stale launcher registrations do not mask a working bundled Python', () => {
  const calls = [], executable = path.resolve('fixture/中文/python.exe');
  const result = resolveTestPython({env:{}, platform:'win32', home:path.resolve('fixture'), run(command, args, options) {
    calls.push(command);
    assert.equal(options.windowsHide,true);
    assert.equal(options.env.PYTHONUTF8,'1');
    assert.ok(options.timeout > 0);
    return calls.length < 4 ? {status:9009,stdout:''} : {status:0,stdout:JSON.stringify(executable)};
  }});
  assert.equal(result, executable);
  assert.deepEqual(calls.slice(0,3),['python','py','python3']);
});

test('an explicit invalid Python override fails visibly instead of selecting another installation', () => {
  let calls=0;
  assert.throws(()=>resolveTestPython({env:{PYTHON:'missing-python'},run(command) {
    calls++; assert.equal(command,'missing-python'); return {status:1,stdout:''};
  }}),/Configured test Python/);
  assert.equal(calls,1);
});

test('verified PATH Python is preferred and an unparseable launcher banner is rejected', () => {
  const executable=path.resolve('fixture/python'); let calls=0;
  assert.equal(resolveTestPython({env:{},platform:'linux',run() {
    calls++; return calls===1 ? {status:0,stdout:'Open the app store'} : {status:0,stdout:JSON.stringify(executable)};
  }}),executable);
  assert.equal(calls,2);
});
