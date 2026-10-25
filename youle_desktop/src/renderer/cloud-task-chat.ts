type History = {threadId:string; items:any[]; activeRunIds:string[]; pending:{requestId:string;prompt:string}|null; [key:string]:any};
type Entry = {scope:string; ready:boolean; loading:boolean; sending:boolean; history?:History; timer?:ReturnType<typeof setTimeout>; failures:number; version:number};

export function createCloudTaskChatController(deps:{
  scope():string|null;
  request(action:'read'|'send'|'cancel',input:Record<string,unknown>):Promise<any>;
  apply(history:History):void; changed(threadId:string):void; error(error:unknown):void;
  restoreDraft(threadId:string,prompt:string):void;
  schedule?:(fn:()=>void,ms:number)=>ReturnType<typeof setTimeout>; cancel?:(timer:ReturnType<typeof setTimeout>)=>void;
}) {
  const entries = new Map<string,Entry>(), schedule=deps.schedule||setTimeout, cancel=deps.cancel||clearTimeout;
  const taskId=(id:string)=>id.slice('cloud-task:'.length);
  const entry=(id:string)=>{
    const scope=deps.scope(); if(!scope)return null;
    let current=entries.get(id);
    if(current?.scope!==scope){if(current?.timer)cancel(current.timer);current={scope,ready:false,loading:false,sending:false,failures:0,version:0};entries.set(id,current);}
    return current;
  };
  const valid=(id:string,e:Entry)=>deps.scope()===e.scope&&entries.get(id)===e;
  const unwrap=(result:any)=>{if(!result?.ok)throw Object.assign(new Error(result?.error?.message||'无法读取会话'),result?.error);return result as History;};
  const receive=(id:string,e:Entry,h:History)=>{
    if(h.threadId!==id)throw new Error('CLOUD_TASK_HISTORY_INVALID');
    if(h.failure && e.history?.failure?.runId!==h.failure.runId)deps.error(Object.assign(new Error(h.failure.message),h.failure));
    e.history=h;e.ready=true;e.failures=0;deps.apply(h);
    if(h.pending)deps.restoreDraft(id,h.pending.prompt);
  };
  const poll=(id:string,e:Entry,delay=1200)=>{
    if(e.timer)cancel(e.timer);
    e.timer=schedule(()=>{e.timer=undefined;if(valid(id,e))void load(id,false);},delay);
  };
  async function load(id:string,foreground=true) {
    const e=entry(id);if(!e||e.loading||e.sending)return;
    e.loading=true;const version=e.version;if(!e.ready)deps.changed(id);
    try{
      const h=unwrap(await deps.request('read',{taskId:taskId(id)}));
      if(!valid(id,e)||version!==e.version)return;
      receive(id,e,h);if(h.activeRunIds.length)poll(id,e);
    }catch(error){
      if(!valid(id,e)||version!==e.version)return;
      if(foreground||e.failures===0)deps.error(error);
      if(!['RESOURCE_NOT_FOUND','TRADING_PREFERENCE_OWNER_CHANGED','AUTH_REQUIRED'].includes((error as any)?.code))poll(id,e,Math.min(15000,1500*2**Math.min(e.failures++,4)));
    }finally{if(valid(id,e)){e.loading=false;deps.changed(id);}}
  }
  return {
    load,
    ready:(id:string)=>entry(id)?.ready===true,
    busy:(id:string)=>{const e=entry(id);return Boolean(e&&(e.sending||e.history?.activeRunIds.length));},
    canCancel:(id:string)=>Boolean(entry(id)?.history?.activeRunIds.length),
    async send(id:string,prompt:string,modelId:string,locale:string){
      const e=entry(id);if(!e?.ready||e.sending||e.history?.activeRunIds.length)return false;
      const pending=e.history?.pending;
      if(pending&&pending.prompt!==prompt){deps.restoreDraft(id,pending.prompt);throw new Error('上一条消息的发送结果尚未确认，请先重试原消息。');}
      e.sending=true;e.version++;if(e.timer)cancel(e.timer);deps.changed(id);
      try{
        const h=unwrap(await deps.request('send',{taskId:taskId(id),prompt,modelId,locale,requestId:pending?.requestId||crypto.randomUUID()}));
        if(!valid(id,e))return false;
        receive(id,e,h);if(h.activeRunIds.length)poll(id,e);return true;
      }catch(error){if(valid(id,e)){deps.error(error);poll(id,e);}return false;}
      finally{if(valid(id,e)){e.sending=false;deps.changed(id);}}
    },
    async stop(id:string){
      const e=entry(id);if(!e||e.sending||!e.history?.activeRunIds.length)return;
      e.sending=true;e.version++;if(e.timer)cancel(e.timer);deps.changed(id);
      try{const h=unwrap(await deps.request('cancel',{taskId:taskId(id)}));if(valid(id,e)){receive(id,e,h);if(h.activeRunIds.length)poll(id,e);}}
      catch(error){if(valid(id,e)){deps.error(error);poll(id,e);}}
      finally{if(valid(id,e)){e.sending=false;deps.changed(id);}}
    },
    reset(){for(const e of entries.values())if(e.timer)cancel(e.timer);entries.clear();},
  };
}
