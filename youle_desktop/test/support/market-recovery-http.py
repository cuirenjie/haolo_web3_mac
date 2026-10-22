"""Independent SDK -> HTTP API -> PostgreSQL -> Worker -> real Node engine gate.

Only exchange/model/auth transports and time passage are controlled fixtures.
The selected test DB is isolated; production databases are rejected by fixture.
"""
import asyncio
from collections import Counter
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import UUID, uuid4
from unittest.mock import AsyncMock

import asyncpg
import httpx
import pytest
from fastapi import HTTPException

BACKEND = Path(os.environ["HAOLO_BACKEND_SOURCE_ROOT"])
WINDOWS = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))
spec = importlib.util.spec_from_file_location("haolo_quota_integration", BACKEND / "tests/integration/__init__.py")
package = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = package
spec.loader.exec_module(package)
from haolo_quota_integration.test_entry_v2_analysis import api, prepare, Select
from haolo_quota_integration.test_mobile_business import OWNER
from app.mobile import agent, worker
from app.mobile.api import _optional_market_tier
from app.mobile.binance_usage import request_lane
from app.mobile.market_recovery import MarketInputsDeferred
from app.mobile.store import Store
from app.mobile.worker_protocol import RUN_PROTOCOL

pytestmark = pytest.mark.asyncio


@pytest.mark.parametrize("strategy,failure,mode", [
    ("harmonic", "snapshot", "run"),
    ("wyckoff", "snapshot", "run"),
    ("wave", "snapshot", "run"),
    ("wave", "context", "run"),
    ("dow-theory", "context", "run"),
    ("ict-smc", "context", "run"),
    ("smt-divergence", "comparison", "run"),
    ("order-flow", "aggTrades", "run"),
    ("order-flow", "depth", "run"),
    ("order-flow", "openInterest", "run"),
    ("order-flow", "openInterestHist", "run"),
    ("order-flow", "klines", "run"),
    ("order-flow", "aggTrades", "cancel"),
    ("order-flow", "aggTrades", "revoke"),
    ("harmonic", "snapshot", "restart"),
    ("harmonic", "snapshot", "worker-crash"),
    ("harmonic", "snapshot", "status-outage"),
])
async def test_durable_market_http(api, monkeypatch, tmp_path, strategy, failure, mode):
    client, store, market = api
    await prepare(api, monkeypatch, "right", strategy=strategy, admit=False)
    connection_id = str(uuid4()) if mode == 'revoke' else ''
    if connection_id:
        from app.mobile import price_action
        async with store.transaction(OWNER) as conn:
            await store.put(conn,OWNER,'connection',connection_id,{'analysisConsent':True,
                'venue':'binance','marketType':'usdm','revoked':False,'credentialsCiphertext':'fixture-encrypted'})
        monkeypatch.setattr(price_action,'fetch_snapshot',AsyncMock(return_value={
            'fetchedAt':int(time.time()*1000),'equity':10000,'available':9000,'positions':[]}))
    async def authenticated_market():
        return "member", True
    client._transport.app.dependency_overrides[_optional_market_tier] = authenticated_market
    async with store.transaction() as conn:
        await conn.execute("INSERT INTO haolo_mobile.worker_health(name,heartbeat) VALUES($1,now())", RUN_PROTOCOL+"quota-http")

    class CountedModel(Select):
        def __init__(self):
            super().__init__()
            self.keys = Counter()
        async def respond(self, key, items, *args, **kwargs):
            request_hash = hashlib.sha256(json.dumps(items,sort_keys=True).encode()).hexdigest()
            self.keys[request_hash] += 1
            return await super().respond(key, items, *args, **kwargs)
    model = CountedModel()
    state = {"worker": False, "blocked": True, "snapshot_reads": 0, "deferrals": 0, "claims": [], "admissions": 0}
    original_access = agent.analysis_access.require_analysis_access
    async def access(*args, **kwargs):
        if mode == 'worker-crash' and len(state['claims']) == 5 and not state.get('crashed'):
            state['crashed'] = True
            raise RuntimeError('fixture crash after durable resuming state')
        return await original_access(*args, **kwargs)
    monkeypatch.setattr(agent.analysis_access,'require_analysis_access',access)
    observations = {i: asyncio.Event() for i in range(1, 5)}
    resume_restart = asyncio.Event()
    original_snapshot = market.snapshot
    async def snapshot(*args, **kwargs):
        assert request_lane('/fapi/v1/klines') == 'interactive_analysis'
        state['snapshot_reads'] += 1
        if state['snapshot_reads'] == 1:
            raise HTTPException(429, {'code':'MARKET_UNAVAILABLE'}, headers={'Retry-After':'1'})
        if state['worker'] and state['blocked'] and (failure == 'snapshot' or failure == 'context' and kwargs.get('before')):
            raise HTTPException(429, {'code':'MARKET_UNAVAILABLE'}, headers={'Retry-After':'10800'})
        market.now = int(time.time()*1000)
        return await original_snapshot(*args, **kwargs)
    market.snapshot = snapshot
    if strategy == 'order-flow':
        original_request = market.request
        async def request(kind, path, params, **kwargs):
            assert request_lane(path) == 'interactive_analysis'
            if state['blocked'] and path.endswith('/'+failure):
                raise HTTPException(429, {'code':'MARKET_UNAVAILABLE'}, headers={'Retry-After':'10800'})
            return await original_request(kind, path, params, **kwargs)
        market.request = request
    if strategy == 'smt-divergence':
        original_post = market.client.post
        async def post(url, **kwargs):
            if state['blocked']:
                return httpx.Response(429,headers={'Retry-After':'10800'},request=httpx.Request('POST',url))
            return await original_post(url,**kwargs)
        monkeypatch.setattr(market.client,'post',post)

    loop = asyncio.get_running_loop()
    async def forward(method, path, body, headers):
        if method == 'POST' and path.endswith('/agent-runs'):
            state['admissions'] += 1
        response = await client.request(method, path, content=body, headers=headers)
        if method == 'GET' and '/agent-runs/' in path and response.status_code == 200:
            value = response.json()
            recovery = value.get('marketRecovery', {})
            if value.get('state') == 'queued' and recovery.get('state') == 'waiting':
                if mode == 'status-outage' and recovery['attempt'] == 2 and not state.get('status_outage'):
                    state['status_outage'] = True
                    return httpx.Response(503,json={'detail':{'code':'TEMPORARILY_UNAVAILABLE'}})
                observations[recovery['attempt']].set()
        return response
    class Bridge(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def forward(self):
            body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
            future = asyncio.run_coroutine_threadsafe(forward(self.command, self.path, body,
                {k:v for k,v in self.headers.items() if k.lower() not in {'host','content-length'}}), loop)
            response = future.result(timeout=30)
            self.send_response(response.status_code)
            for name in ['Content-Type','Retry-After']:
                if name in response.headers:
                    self.send_header(name,response.headers[name])
            self.send_header('Content-Length',str(len(response.content)))
            self.end_headers()
            self.wfile.write(response.content)
        do_GET = do_POST = do_PATCH = forward
    server = ThreadingHTTPServer(('127.0.0.1',0),Bridge)
    thread = threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    replacement_pool = None
    async def consume():
        nonlocal replacement_pool
        current_store = store
        while True:
            job = await current_store.claim('run')
            if not job:
                await asyncio.sleep(.01)
                continue
            state['claims'].append(str(job['lease_id']))
            if mode == 'worker-crash' and len(state['claims']) == 6:
                assert job['interrupted']
            if len(state['claims']) == 1 and failure == 'snapshot':
                async with current_store.transaction(OWNER) as conn:
                    run = await current_store.get(conn,OWNER,'run',job['id'])
                    run['snapshot']['fetchedAt'] = int(time.time()*1000)-90000
                    await current_store.put(conn,OWNER,'run',job['id'],run,version=run['version'])
            state['worker'] = True
            try:
                async with asyncio.timeout(job['timeout_seconds']):
                    await agent.process(current_store,market,model,job)
            except MarketInputsDeferred as error:
                await worker.fail(current_store,job,error)
                state['deferrals'] += 1
                attempt = state['deferrals']
                assert not model.keys
                assert await current_store.claim('run') is None
                async with current_store.transaction(OWNER) as conn:
                    queued = await current_store.get(conn,OWNER,'run',job['id'])
                    assert queued['marketRecovery']['retryAfterMs'] >= 10800000
                    row = await conn.fetchrow('SELECT status,lease_id,lease_until FROM haolo_mobile.jobs WHERE owner=$1 AND id=$2',OWNER,job['id'])
                    assert row['status'] == 'queued' and row['lease_id'] is None and row['lease_until'] is None
                    for kind in ['private_account','private_analysis','private_review']:
                        assert not await current_store.list(conn,OWNER,kind)
                await asyncio.wait_for(observations[attempt].wait(),10)
                if mode == 'cancel':
                    return
                if mode == 'revoke':
                    async with current_store.transaction(OWNER) as conn:
                        binding = await current_store.get(conn,OWNER,'connection',connection_id)
                        await current_store.put(conn,OWNER,'connection',connection_id,{**binding,'revoked':True},version=binding['version'])
                    state['blocked'] = False
                if mode == 'restart' and attempt == 1:
                    await asyncio.wait_for(resume_restart.wait(),10)
                if attempt == 1:
                    # New connection pool and Store, with no previous worker
                    # object state: all waiting work is recovered from PostgreSQL.
                    replacement_pool = await asyncpg.create_pool(os.environ['HAOLO_MOBILE_TEST_DATABASE_URL'],min_size=1,max_size=2)
                    current_store = Store(replacement_pool)
                if attempt >= 4:
                    state['blocked'] = False
                # Accelerate only the isolated test clock. Check above proved
                # the real scheduler cannot claim before the stored cooldown.
                async with current_store.transaction(OWNER) as conn:
                    await conn.execute('UPDATE haolo_mobile.jobs SET due_at=now() WHERE owner=$1 AND id=$2',OWNER,job['id'])
            except RuntimeError as error:
                if mode != 'worker-crash' or str(error) != 'fixture crash after durable resuming state':
                    raise
                assert not model.keys
                async with current_store.transaction(OWNER) as conn:
                    run = await current_store.get(conn,OWNER,'run',job['id'])
                    assert run['state'] == 'running' and run['marketRecovery']['state'] == 'resuming'
                    run['snapshot']['fetchedAt'] = int(time.time()*1000)-180000
                    await current_store.put(conn,OWNER,'run',job['id'],run,version=run['version'])
                    await conn.execute("UPDATE haolo_mobile.jobs SET lease_until=now()-interval '1 second' WHERE owner=$1 AND id=$2",OWNER,job['id'])
                current_store = Store(replacement_pool)
            except ValueError as error:
                if mode != 'revoke' or str(error) != 'CONSENT_REVOKED':
                    raise
                await worker.fail(current_store,job,error)
                return
            else:
                return

    consumer = asyncio.create_task(consume())
    process = None
    async def run_sdk(phase):
        nonlocal process
        process = await asyncio.create_subprocess_exec('node','--experimental-transform-types',
            str(Path(__file__).with_name('market-recovery-roundtrip.mjs')),
            f'http://127.0.0.1:{server.server_port}',str(OWNER),strategy,str(tmp_path/'journal.bin'),phase,'en',connection_id,
            cwd=WINDOWS,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
        communication = asyncio.create_task(process.communicate())
        done,_ = await asyncio.wait({communication,consumer},timeout=45,return_when=asyncio.FIRST_COMPLETED)
        if consumer in done:
            consumer.result()
        output,errors = await asyncio.wait_for(communication,45)
        assert process.returncode == 0, errors.decode(errors='replace')
        return json.loads(output.decode().splitlines()[-1])
    try:
        if mode == 'restart':
            first = await run_sdk('restart-first')
            assert first['restart'] and state['admissions'] == 1
            resume_restart.set()
            result = await run_sdk('resume')
            assert result['runId'] == first['runId']
        else:
            result = await run_sdk(mode)
        await asyncio.wait_for(consumer,10)
        assert result['ok'] and state['admissions'] == 1
        assert len(set(state['claims'])) == len(state['claims'])
        stored = (await client.get('/api/mobile/v1/agent-runs/'+result['runId'])).json()
        if mode == 'cancel':
            assert stored['state'] == 'cancelled' and not model.keys
        elif mode == 'revoke':
            assert stored['state'] == 'failed' and stored['error'] == 'CONSENT_REVOKED' and not model.keys
        else:
            assert stored['state'] == 'succeeded'
            assert state['deferrals'] == 4 and len(state['claims']) == (6 if mode == 'worker-crash' else 5)
            assert all(count == 1 for count in model.keys.values())
            assert result['virtualWait'] >= 900000
            if mode == 'status-outage':
                assert state['status_outage']
            assert await store.claim('run') is None
        output_root = Path(os.environ['HAOLO_MARKET_RECOVERY_EVIDENCE'])
        output_root.mkdir(parents=True,exist_ok=True)
        (output_root/f'{strategy}-{failure}-{mode}.json').write_text(json.dumps({
            'strategy':strategy,'failure':failure,'mode':mode,'state':stored['state'],
            'admissions':state['admissions'],'deferrals':state['deferrals'],'workerLeases':len(state['claims']),
            'modelCalls':sum(model.keys.values()),'modelRequestCounts':list(model.keys.values()),'sdk':result},indent=2),encoding='utf-8')
    finally:
        if process and process.returncode is None:
            process.kill()
            await process.wait()
        consumer.cancel()
        await asyncio.gather(consumer,return_exceptions=True)
        await asyncio.to_thread(server.shutdown)
        server.server_close()
        if replacement_pool:
            await replacement_pool.close()
