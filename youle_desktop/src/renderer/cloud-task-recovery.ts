export type CloudTask = {key:string;runId:string;state:string;marketId:string;interval:string;strategyId:string;cancelRequested:boolean};
export type CloudRecoveryResult = {analysisPlan?:{report?:string};[key:string]:any};
type Reply = {ok:boolean;items?:CloudTask[];result?:CloudRecoveryResult;error?:{message?:string;code?:string}};
export type CloudRecoveryApi = (action:string,key?:string)=>Promise<Reply>;
export type CloudResultRestore = (result:CloudRecoveryResult,key:string,isCurrent:()=>boolean)=>Promise<boolean>;
const copy = {
  title:['云端任务','Cloud tasks','雲端任務'],
  note:['查看尚未在本机保存的分析。恢复会沿用原任务；报告中的条件不代表成交。','Review analysis not yet saved on this device. Recovery uses the original task; report conditions do not imply a fill.','查看尚未在本機儲存的分析。恢復會沿用原任務；報告中的條件不代表成交。'],
  refresh:['刷新','Refresh','重新整理'],resume:['恢复／查看','Resume / view','恢復／查看'],cancel:['取消云端任务','Cancel cloud task','取消雲端任務'],
  acknowledge:['已查看，移出恢复列表','Reviewed; remove from recovery list','已查看，移出恢復清單'],
  close:['关闭','Close','關閉'],empty:['没有待恢复的任务。','No tasks to recover.','沒有待恢復的任務。'],
  busy:['正在核对云端状态…','Checking cloud status…','正在核對雲端狀態…'],failed:['读取失败，请重试。','Could not load. Try again.','讀取失敗，請重試。'],
  saved:['报告和图表已保存到原会话。','The report and drawings were saved to the original conversation.','報告和圖表已儲存到原會話。'],
  prepared:['提交状态待核对','Submission needs verification','提交狀態待核對'],queued:['排队中','Queued','排隊中'],running:['处理中','Running','處理中'],
  succeeded:['已完成，待查看','Completed; ready to view','已完成，待查看'],cancelled:['已取消','Cancelled','已取消'],cancelPending:['取消尚未确认','Cancellation unconfirmed','取消尚未確認'],
};
export const cloudTaskText=(key:keyof typeof copy,language:string)=>copy[key][language==='en'?1:['zh-TW','zh-Hant'].includes(language)?2:0];

// Account generation is checked after every await. Closing the dialog also
// invalidates in-flight work; a previous account's report cannot reappear.
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

export function openCloudRecoveryDialog(api:CloudRecoveryApi,language:string,restore?:CloudResultRestore) {
  const t=(key:keyof typeof copy)=>cloudTaskText(key,language);
  const dialog=document.createElement('dialog');
  dialog.style.cssText='width:min(900px,90vw);max-height:85vh;padding:24px;border:1px solid currentColor;border-radius:12px;background:var(--bg,Canvas);color:var(--text,CanvasText);color-scheme:inherit;overflow:auto;';
  dialog.setAttribute('aria-label',t('title'));
  const controller=createCloudRecoveryController(api,draw,restore);
  const button=(label:string,action:()=>void)=>{const el=document.createElement('button');el.type='button';el.textContent=label;el.disabled=controller.state.busy;el.style.cssText='padding:7px 12px;margin:4px;border:1px solid currentColor;border-radius:7px;background:transparent;color:inherit;cursor:pointer;';el.onclick=action;return el;};
  function draw(){
    const state=controller.state;dialog.replaceChildren();
    const title=document.createElement('h2');title.textContent=t('title');dialog.append(title);
    const note=document.createElement('p');note.textContent=t('note');dialog.append(note);
    const close=button(t('close'),()=>dialog.close());close.disabled=false;
    dialog.append(button(t('refresh'),()=>void controller.act('list')),close);
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent=state.busy?t('busy'):state.error==='LOAD_FAILED'?t('failed'):state.error||(!state.items.length?t('empty'):'');dialog.append(status);
    for(const row of state.items){
      const article=document.createElement('article');article.style.cssText='padding:12px 0;border-top:1px solid color-mix(in srgb,currentColor 25%,transparent);';
      const name=document.createElement('p');const label=row.cancelRequested&&row.state!=='succeeded'?t('cancelPending'):copy[row.state as keyof typeof copy]?t(row.state as keyof typeof copy):row.state;
      name.textContent=`${row.marketId} · ${row.interval} · ${row.strategyId} — ${label}`;article.append(name);
      article.append(button(t('resume'),()=>void controller.act('resume',row.key)));
      if(!['succeeded','failed','cancelled'].includes(row.state))article.append(button(t('cancel'),()=>void controller.act('cancel',row.key)));
      if(state.viewedKey===row.key||['failed','cancelled'].includes(row.state))article.append(button(t('acknowledge'),()=>void controller.act('acknowledge',row.key)));
      dialog.append(article);
    }
    if(state.report){const report=document.createElement('pre');report.textContent=state.report;report.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;padding:16px;border:1px solid currentColor;user-select:text;';dialog.append(report);}
  }
  dialog.addEventListener('close',()=>{controller.reset();dialog.remove();},{once:true});
  document.body.append(dialog);draw();dialog.showModal();void controller.act('list');
  return ()=>dialog.close();
}
