import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {HaoloAccessTokenVerifier} from '../src/access-token-verifier.mjs';
import {GatewayCache} from '../src/cache.mjs';
import {BinanceRestGateway} from '../src/binance-rest.mjs';
import {createPublicGatewayServer} from '../src/public-server.mjs';
import {loadGatewayConfig} from '../src/config.mjs';
import {baseConfig,createJwt} from './helpers.mjs';

async function listen(handler) {
  const server=http.createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,origin:`http://127.0.0.1:${server.address().port}`,
    close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}

test('the five measured auth tails reproduce twelve 503s at 5s and recover at the bounded 10s budget',async()=>{
  const samples=[{delay:5062,readers:1},{delay:8851,readers:1},{delay:6059,readers:4},{delay:6787,readers:3},{delay:5886,readers:3}];
  assert.equal(loadGatewayConfig({HAOLO_GATEWAY_ROLE:'market',HAOLO_AUTH_API_ORIGIN:'https://auth.example',HAOLO_GATEWAY_ALLOW_ANONYMOUS_PUBLIC:'false'}).authRequestTimeoutMs,10000);
  for(const timeout of [5000,10000]) {
    const config=baseConfig({authRequestTimeoutMs:timeout,authCacheTtlMs:15000,downstreamRequestsPerMinute:300});
    const tokens=samples.map((_,i)=>createJwt(config.jwtSecret,{sub:`fixture-${i}`}));
    let authReads=0,upstreamReads=0;const diagnostics=[];
    const profile=await listen((request,response)=>{
      authReads++;
      const index=tokens.indexOf(String(request.headers.authorization).slice(7));
      assert.ok(index>=0);
      const timer=setTimeout(()=>{response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({id:`fixture-${index}`}));},samples[index].delay);
      response.once('close',()=>clearTimeout(timer));
    });
    config.authApiOrigin=profile.origin;config.authProfilePath='/api/auth/me';
    const cache=new GatewayCache();
    const verifier=new HaoloAccessTokenVerifier({config,cache});
    const restGateway=new BinanceRestGateway({config,cache,fetchImpl:async()=>{
      upstreamReads++;const now=Date.now(),time=Math.floor(now/60000)*60000;
      return Response.json([[time,'10','12','9','11','5',time+59999]]);
    }});
    const gateway=createPublicGatewayServer({config,restGateway,accessTokenVerifier:verifier,
      streamPool:{stats:()=>({}),subscribe:()=>()=>{}},onDiagnostic:entry=>diagnostics.push(entry)});
    try {
      await gateway.listen();const origin=`http://127.0.0.1:${gateway.server.address().port}`;
      const values=await Promise.all(samples.flatMap((sample,index)=>Array.from({length:sample.readers},async()=>{
        const response=await fetch(origin+'/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=2',{headers:{authorization:'Bearer '+tokens[index],'x-haolo-market-freshness':'live'}});
        return {status:response.status,headers:response.headers,body:await response.json()};
      })));
      assert.equal(authReads,5,'one authoritative read per shared session');
      if(timeout===5000) {
        assert.ok(values.every(r=>r.status===503&&r.body.error==='AUTHENTICATION_UNAVAILABLE'));
        assert.ok(values.every(r=>r.headers.get('x-haolo-error-source')==='haolo-auth'&&r.headers.get('retry-after')==='1'));
        assert.equal(new Set(values.map(r=>r.headers.get('x-haolo-request-id'))).size,12);
        assert.equal(upstreamReads,0,'failed authentication must never read Binance');
        assert.equal(diagnostics.length,12);
        assert.ok(diagnostics.every(e=>e.failureKind==='timeout'&&e.dependency==='haolo-auth'));
        for(const token of tokens)assert.ok(!JSON.stringify(diagnostics).includes(token));
      } else {
        assert.ok(values.every(r=>r.status===200));assert.equal(diagnostics.length,0);
        for(const value of values){assert.notEqual(value.headers.get('x-haolo-cache'),'STALE');assert.ok(Number(value.headers.get('x-haolo-data-fetched-at'))>Date.now()-5000);assert.equal(value.body[0][4],'11');}
        assert.ok(upstreamReads>0&&upstreamReads<=5);
      }
    } finally {await gateway.close();await profile.close();await cache.close();}
  }
});

test('auth budget includes an unfinished response body and the next request can recover',async()=>{
  let stalled=true;
  const profile=await listen((_request,response)=>{
    response.writeHead(200,{'content-type':'application/json'});response.flushHeaders();
    if(!stalled)response.end(JSON.stringify({id:'recovered'}));
  });
  const cache=new GatewayCache();
  const config=baseConfig({authApiOrigin:profile.origin,authProfilePath:'/api/auth/me',authRequestTimeoutMs:100,authCacheTtlMs:15000});
  const verifier=new HaoloAccessTokenVerifier({config,cache});
  try {
    const started=Date.now();
    await assert.rejects(verifier.verify(createJwt(config.jwtSecret)),e=>e.statusCode===503&&e.failureKind==='timeout');
    assert.ok(Date.now()-started<1500,'body stalls cannot wait for the proxy timeout');
    stalled=false;
    assert.equal((await verifier.verify(createJwt(config.jwtSecret))).userId,'recovered');
  } finally {await profile.close();await cache.close();}
});

test('rejections and invalid responses fail closed without becoming cached identities',async()=>{
  for(const [status,body,kind] of [[401,'{}',null],[403,'{}',null],[404,'{}',null],[503,'{}','upstream-status'],[200,'{','invalid-response'],[200,'{}','invalid-profile']]) {
    const cache=new GatewayCache();let reads=0;
    const verifier=new HaoloAccessTokenVerifier({config:baseConfig({authApiOrigin:'https://auth.example',authProfilePath:'/me',authRequestTimeoutMs:100,authCacheTtlMs:15000}),cache,
      fetchImpl:async()=>{reads++;return new Response(body,{status});}});
    for(let i=0;i<2;i++)await assert.rejects(verifier.verify('fixture-session'),e=>kind?e.statusCode===503&&e.failureKind===kind:e.statusCode===401);
    assert.equal(reads,2);assert.equal(cache.memory.size,0);await cache.close();
  }
});

test('expired L1 auth identity re-reads a fresh shared verification in the same call',async()=>{
  const cache=new GatewayCache();const now=Date.now();let reads=0;
  cache.memory.set('auth-token:fixture',{value:{userId:'old'},freshUntil:now-1,staleUntil:now-1});
  cache.redis={get:async()=>{reads++;return JSON.stringify({value:{userId:'current'},freshUntil:now+1000,staleUntil:now+1000});}};
  assert.equal((await cache.get('auth-token:fixture',now)).value.userId,'current');assert.equal(reads,1);
  cache.redis=null;await cache.close();
});
