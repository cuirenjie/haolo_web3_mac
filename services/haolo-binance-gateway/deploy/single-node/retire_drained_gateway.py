"""Retire exactly the saved old instance after two natural-zero checks.

Run against a root-owned accepted release directory. No forced disconnects,
timeouts that kill a container, Redis operations, or routing changes.
"""
import argparse
import fcntl
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

ACTIVE = Path('/var/lib/haolo/gateway-active.env')
HAPROXY = Path('/etc/haproxy/haproxy.cfg')
LOCK = Path('/run/lock/haolo-gateway-deploy.lock')


def run(args, timeout=30):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed (exit {result.returncode})')
    return result.stdout


def save(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def check(release):
    with open(LOCK, 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        state = json.loads((release / 'state.json').read_text())
        if state['phase'] == 'complete':
            return True
        if state['phase'] != 'accepted_retirement_pending':
            raise RuntimeError('release is not accepted for retirement')
        old = state['old']
        active = ACTIVE.read_text()
        config = HAPROXY.read_text()
        if f"CONTAINER={old['container']}\n" in active:
            raise RuntimeError('old instance became active again')
        if not any(line.startswith('CONTAINER=') and line.split('=', 1)[1] for line in active.splitlines()):
            raise RuntimeError('active pointer is missing')
        if any(f":{old[key]}" in config for key in ('public', 'private')):
            raise RuntimeError('HAProxy still references an old port')
        snapshots = []
        for attempt in range(2):
            data = json.loads(run(['docker', 'inspect', old['container']]))[0]
            identity = [data['Id'], data['Image'], data['State']['StartedAt'], data['RestartCount']]
            if identity != old['identity']:
                raise RuntimeError('old instance identity changed')
            if data['State']['Status'] == 'exited':
                if data['State']['ExitCode'] != 0:
                    raise RuntimeError('old instance exited unsuccessfully')
                break
            if data['State']['Status'] != 'running':
                raise RuntimeError('old instance has unexpected runtime state')
            connections = len(run(['nsenter', '-t', str(data['State']['Pid']), '-n',
                'ss', '-Htn', 'state', 'established', '(', 'sport', '=', ':8787', 'or', 'sport', '=', ':8788', ')']).splitlines())
            script = "const r=await fetch('http://127.0.0.1:8787/metrics',{headers:{authorization:'Bearer '+process.env.HAOLO_GATEWAY_METRICS_TOKEN},signal:AbortSignal.timeout(5000)});if(!r.ok)process.exit(2);const m=/^haolo_market_gateway_websocketClients (\\d+)$/m.exec(await r.text());if(!m)process.exit(3);console.log(m[1]);"
            websocket_clients = int(run(['docker', 'exec', old['container'], 'node', '--input-type=module', '-e', script]).strip())
            snapshots.append({'at': time.time(), 'established': connections, 'websocketClients': websocket_clients})
            if connections or websocket_clients:
                save(release / 'retirement-status.json', {'phase': 'waiting_for_natural_zero',
                    'container': old['container'], 'snapshots': snapshots})
                return False
            if attempt == 0:
                time.sleep(1)
        if data['State']['Status'] == 'running':
            # Infinite Docker grace period: SIGKILL is never scheduled.
            run(['docker', 'stop', '--time', '-1', old['container']], timeout=180)
            data = json.loads(run(['docker', 'inspect', old['container']]))[0]
            if data['State']['Status'] != 'exited' or data['State']['ExitCode'] != 0:
                raise RuntimeError('graceful retirement is not complete')
        receipt = {'phase': 'stopped', 'container': old['container'], 'at': time.time(),
            'identity': old['identity'], 'snapshots': snapshots, 'exitCode': data['State']['ExitCode'],
            'haproxySha256': hashlib.sha256(config.encode()).hexdigest(), 'forced': False}
        save(release / 'retirement-status.json', receipt)
        state['phase'] = 'complete'
        state['old_retained'] = False
        state['old_container_and_image_preserved'] = True
        state['retired_at'] = receipt['at']
        save(release / 'state.json', state)
        print(json.dumps(receipt), flush=True)
        return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('release', type=Path)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    release = args.release.resolve(strict=True)
    if release.parent != Path('/opt/haolo/releases') or release.stat().st_uid != 0:
        raise RuntimeError('expected a root-owned production release directory')
    while not check(release):
        if args.once:
            break
        time.sleep(30)
