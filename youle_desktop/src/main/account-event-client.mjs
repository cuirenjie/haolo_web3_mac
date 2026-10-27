// One authenticated connection per desktop session. No periodic business GETs.
// Durable application receipts, not SSE ids, are the reconnect authority.
import { withAbort } from './system-proxy-fetch.mjs';

export function createAccountEventClient({owner, api, cursor, reminders, gap, state, status,
  now=Date.now, random=Math.random, schedule=setTimeout, cancel=clearTimeout}) {
  let stopped=true, controller, timer, running=null, failures=0, epoch=0, activeScope='', activeToken='';
  let lastConnected=0;
  const report=value=>status?.(value);
  async function consume(signal, selected, revision) {
    const client=api();
    const token=client.token;
    const valid=async()=>{
      const current=await withAbort(owner(),signal);
      if(stopped||revision!==epoch||signal.aborted||current.ownerId!==selected.ownerId
        ||current.baseUrl!==selected.baseUrl||client.token!==token||api().token!==token) throw Error('EVENT_SESSION_CHANGED');
    };
    await valid();
    const after=await withAbort(cursor(selected),signal);
    await valid();
    if(!Number.isSafeInteger(after)||after<0)throw Error('EVENT_CURSOR_INVALID');
    const url=new URL('/api/mobile/v1/sync/events',selected.baseUrl);url.searchParams.set('after',String(after));
    const connection=controller;
    const headerTimeout=schedule(()=>connection.abort(),20000);headerTimeout?.unref?.();
    let response;
    try {response=await withAbort(Promise.resolve(client.serviceFetch(url.href,{method:'GET',headers:{...client.authHeaders(),Accept:'text/event-stream'},signal,redirect:'error'})).then(value=>{
      if(signal.aborted)void value.body?.cancel().catch(()=>{});
      return value;
    }),signal);}
    finally {cancel(headerTimeout);}
    if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream')) {
      void response.body?.cancel().catch(()=>{});
      const seconds=Number(response.headers.get('retry-after'));
      throw Object.assign(Error('EVENT_STREAM_UNAVAILABLE'),{retryAfterMs:Math.max(response.status===404?300000:0,Number.isFinite(seconds)?Math.min(300000,seconds*1000):0)});
    }
    const reader=response.body.getReader(), decoder=new TextDecoder();
    let cancelled=false;
    const cancelReader=()=>{if(!cancelled){cancelled=true;void reader.cancel().catch(()=>{});}};
    signal.addEventListener('abort',cancelReader,{once:true});
    let buffer='', watchdog, healthy=false;
    const connectedAt=now();
    const arm=()=>{cancel(watchdog);watchdog=schedule(()=>connection.abort(),45000);watchdog?.unref?.();};
    arm();
    try {
      while(true) {
        const chunk=await withAbort(reader.read(),signal);if(chunk.done)break;
        await valid();buffer=(buffer+decoder.decode(chunk.value,{stream:true})).replace(/\r\n/g,'\n');
        let end;
        while((end=buffer.indexOf('\n\n'))!==-1) {
          if(end>2*1024*1024)throw Error('EVENT_FRAME_TOO_LARGE');
          const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
          const kind=block.split('\n').find(line=>line.startsWith('event:'))?.slice(6).trim();
          const raw=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
          if(!raw)continue;
          const value=JSON.parse(raw);await valid();
          if(kind==='reset')throw Error('EVENT_STREAM_RESET');
          if(kind==='gap') {await gap(selected,value);throw Error('EVENT_HISTORY_GAP');}
          if(value.version!==2)throw Error('EVENT_PROTOCOL_INVALID');
          if(kind==='reminders')await reminders(selected,value,valid);
          else if(kind==='state') {
            if(!value.topics||['settings','drawings','plans'].some(key=>typeof value.topics[key]!=='string'||value.topics[key].length>80))throw Error('EVENT_STATE_INVALID');
            state?.({...value,accountId:selected.accountId,baseUrl:selected.baseUrl});
          } else if(kind!=='check')throw Error('EVENT_PROTOCOL_INVALID');
          await valid();arm();healthy=true;
          // A state frame followed by a failed notification must not reset the
          // retry budget on every reconnect. Require durable progress or time.
          if(kind==='reminders'||now()-connectedAt>=30000)failures=0;
          lastConnected=now();report({state:'connected',accountId:selected.accountId,baseUrl:selected.baseUrl,at:lastConnected});
        }
        if(buffer.length>2*1024*1024)throw Error('EVENT_FRAME_TOO_LARGE');
      }
      if(buffer.trim())throw Error('EVENT_FRAME_TRUNCATED');
      if(!healthy)throw Error('EVENT_STREAM_EMPTY');
      // A proxy may close a complete frame cleanly. A short-lived stream is
      // still a failure; otherwise every device reconnects once per second.
      if(now()-connectedAt<30000)throw Error('EVENT_STREAM_SHORT');
      failures=0;
    } finally {cancel(watchdog);signal.removeEventListener('abort',cancelReader);cancelReader();reader.releaseLock();}
  }
  function retry(delay) {
    if(stopped)return;
    timer=schedule(()=>{timer=null;void run();},delay);timer?.unref?.();
  }
  async function run() {
    if(stopped||running)return running;
    const revision=epoch;
    running=(async()=>{
      let delay=1000;
      try {
        const selected=await owner();activeScope=selected.ownerId;activeToken=api().token;
        controller=new AbortController();
        await consume(controller.signal,selected,revision);
      } catch(error) {
        if(!stopped&&revision===epoch) {
          failures=Math.min(8,failures+1);
          delay=Math.max(error.retryAfterMs||0,Math.min(60000,1000*2**failures)*(1+.2*random()));
          report({state:'reconnecting',lastConnected,at:now(),code:'EVENT_STREAM_UNAVAILABLE'});
        }
      } finally {
        controller=null;running=null;
        if(!stopped)retry(revision===epoch?delay:0);
      }
    })();
    return running;
  }
  return {
    start(){if(!stopped)return;stopped=false;epoch++;void run();},
    async wake(force=false){
      if(stopped)return;
      const selected=await owner().catch(()=>null);
      if(!force&&selected?.ownerId===activeScope&&api().token===activeToken&&running)return;
      epoch++;cancel(timer);timer=null;controller?.abort();if(!running)void run();
    },
    stop(){stopped=true;epoch++;cancel(timer);timer=null;controller?.abort();},
    get running(){return !!running;},get scope(){return activeScope;},
  };
}
