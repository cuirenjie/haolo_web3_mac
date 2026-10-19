export type CloudTask = {key:string;runId:string;state:string;marketId:string;interval:string;strategyId:string;cancelRequested:boolean};
export type CloudRecoveryResult = {analysisPlan?:{report?:string};[key:string]:any};
type Reply = {ok:boolean;items?:CloudTask[];result?:CloudRecoveryResult;error?:{message?:string;code?:string}};
export type CloudRecoveryApi = (action:string,key?:string)=>Promise<Reply>;
export type CloudResultRestore = (result:CloudRecoveryResult,key:string,isCurrent:()=>boolean)=>Promise<boolean>;
// Resetting the controller invalidates in-flight work across account changes.
export function createCloudRecoveryController(api:CloudRecoveryApi,changed:()=>void,restore?:CloudResultRestore) {
  let generation=0;
  const state:{items:CloudTask[];report:string;viewedKey:string;error:string;busy:boolean}={items:[],report:'',viewedKey:'',error:'',busy:false};
  const reset=()=>{generation++;Object.assign(state,{items:[],report:'',viewedKey:'',error:'',busy:false});changed();};
  const act=async(action:string,key?:string)=>{
    if(state.busy)return;
    const token=generation;
    state.busy=true;state.error='';changed();
    try {
      const reply=await api(action,key);
      if(token!==generation)return;
      if(!reply.ok)state.error=reply.error?.message||'LOAD_FAILED';
      if(reply.result?.analysisPlan?.report){state.report=reply.result.analysisPlan.report;state.viewedKey=key||'';}
      if(action==='resume'&&reply.ok&&reply.result&&restore&&key) {
        const saved=await restore(reply.result,key,()=>token===generation);
        if(token!==generation)return;
        if(saved) {
          const acknowledged=await api('acknowledge',key);
          if(token!==generation)return;
          if(!acknowledged.ok)state.error=acknowledged.error?.message||'LOAD_FAILED';
          else {state.viewedKey='';}
        }
      }
      if(action==='acknowledge'&&reply.ok){state.report='';state.viewedKey='';}
      const listed=action==='list'?reply:await api('list');
      if(token!==generation)return;
      if(listed.ok)state.items=listed.items||[];
    } catch {if(token===generation)state.error='LOAD_FAILED';}
    finally {if(token===generation){state.busy=false;changed();}}
  };
  return {state,act,reset};
}
