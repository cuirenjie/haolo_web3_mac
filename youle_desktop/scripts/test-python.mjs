import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const probe = 'import json,sys; assert sys.version_info >= (3,10); print(json.dumps(sys.executable))';
let cached;

// Windows App Execution Aliases and stale py.exe registrations are not Python
// interpreters. Resolve and probe an executable before running any media test.
export function resolveTestPython({ env = process.env, platform = process.platform,
  home = os.homedir(), run = spawnSync } = {}) {
  const configured = env.HAOLO_TEST_PYTHON || env.PYTHON;
  const candidates = configured ? [[configured, []]] : [
    [platform === 'win32' ? 'python' : 'python3', []],
    ...(platform === 'win32' ? [['py', ['-3']], ['python3', []]] : [['python', []]]),
    // Codex's bundled runtime is useful on machines without a system Python;
    // CI and standalone development continue to use their verified PATH Python.
    [path.join(home, '.cache/codex-runtimes/codex-primary-runtime/dependencies/python',
      platform === 'win32' ? 'python.exe' : 'bin/python3'), []],
  ];
  for (const [command, prefix] of candidates) {
    const result = run(command, [...prefix, '-X', 'utf8', '-c', probe], {
      env: { ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      encoding: 'utf8', windowsHide: true, timeout: 5_000,
    });
    if (result.status !== 0 || result.error) continue;
    try {
      const executable = JSON.parse(result.stdout.trim());
      if (typeof executable === 'string' && path.isAbsolute(executable)) return executable;
    } catch { /* A launcher or shell banner is not a successful interpreter probe. */ }
  }
  throw new Error(configured
    ? 'Configured test Python is unavailable or older than 3.10. Correct HAOLO_TEST_PYTHON/PYTHON.'
    : 'Python 3.10+ is required for the full suite. Install Python or set HAOLO_TEST_PYTHON to its executable.');
}

export function testPython() { return cached ??= resolveTestPython(); }
