import { app, BrowserWindow, session } from "electron/main";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const evidencePath=process.env.HAOLO_SUPPORT_COLOR_MODEL_EVIDENCE;
const output=path.join(root,evidencePath?"output/support-ai-qa-model":"output/support-ai-qa");await mkdir(output,{recursive:true});
const modelEvidence=evidencePath?JSON.parse(await readFile(evidencePath,'utf8')):null;
const modelCase=modelEvidence?.cases?.find(c=>c.message==='设置K线红涨绿跌'&&c.passed&&c.decision?.kind==='operate');
if(evidencePath)assert.ok(modelCase,'Real model evidence must contain the exact request and an operate decision');
const colorPlan=modelCase?.decision.actions
  || [{kind:'set_candle_colors',up_color:'#F6465D',down_color:'#2EBD85'}];
assert.ok(colorPlan.some(a=>a.kind==='set_candle_colors'&&a.up_color.toUpperCase()==='#F6465D'&&a.down_color.toUpperCase()==='#2EBD85'));
app.setPath("userData",path.join(output,"profile"));await app.whenReady();
const partition=session.fromPartition(`support-ai-qa-${Date.now()}`);
partition.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*","ws://*/*","wss://*/*"]},(_,cb)=>cb({cancel:true}));
const win=new BrowserWindow({show:true,opacity:0,skipTaskbar:true,width:1440,height:960,webPreferences:{session:partition,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const run=(fn,...args)=>win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`,true);
async function wait(fn){for(let n=0;n<200;n++){if(await run(fn))return;await delay(100);}throw new Error(`Timeout: ${fn}`);}
const click=s=>run(s=>{const b=document.querySelector(s);if(!b)throw new Error(s);b.click();},s);
const results=[];
async function fixture(){await run(()=>{
  const sid="11111111-1111-4111-8111-111111111111";
  const qa=window.supportAIQA={calls:[],ai:{mode:"ai",epoch:0,phase:"thinking",actions:[]},messages:[{id:crypto.randomUUID(),role:"human_support",sender_type:"ai",support_event:"joined",text:"客服 haolo 加入会话"}],device:"",failStep:false};
  qa.propose=(plan)=>{qa.ai.actions=[{id:crypto.randomUUID(),epoch:qa.ai.epoch,title:JSON.stringify(plan),plan,status:"proposed",device_id:qa.device,next_step:0,context_binding:structuredClone(qa.context)}];qa.ai.phase="awaiting_consent";};
  window.codexDesktop.supportRequest=async p=>{
    qa.calls.push(p);
    if(p.action==="aiContext"){qa.device=p.context.device_id;qa.context=p.context;return{ok:true,data:{ai:qa.ai}};}
    if(p.action==="ai")return{ok:true,data:{ai:structuredClone(qa.ai)}};
    if(p.action==="aiConsent"){const a=qa.ai.actions[0];a.status=p.body.decision==="accept"?"running":"declined";qa.ai.phase=a.status==="running"?"operating":"idle";return{ok:true,data:{status:a.status,plan:a.plan,next_step:0}};}
    if(p.action==="aiStep"){
      if(qa.failStep)return{ok:false,status:503};
      const a=qa.ai.actions[0];if(qa.ai.mode!=="ai")return{ok:false,status:409};
      if(p.body.stage==="complete"){a.next_step++;if(a.next_step===a.plan.length){a.status="succeeded";qa.ai.phase="idle";qa.messages.push({id:crypto.randomUUID(),role:"human_support",sender_type:"ai",support_event:"operation_result",text:"operation verified"});}}
      if(p.body.stage==="failed"){a.status="failed";qa.ai.phase="idle";}
      return{ok:true,data:{status:a.status,next_step:a.next_step}};
    }
    return{ok:true,data:{session:{id:sid,status:"active"},messages:structuredClone(qa.messages),ai:structuredClone(qa.ai)}};
  };
});}
try{
  await win.loadFile(path.join(root,"dist/renderer/index.html"),{query:{"i18n-layout-qa":"1"}});
  await wait(()=>document.querySelector('[data-action="open-native-support"]'));
  for(const language of ["zh-CN","en","zh-TW"])for(const theme of ["light","dark"]){
    await click('[data-action="open-settings"]');
    await click('.settings-language-select [data-haolo-select-trigger]');
    await click(`.settings-language-select [data-haolo-select-value="${language}"]`);
    await click(`[data-settings-theme="${theme}"]`);await click('.settings-close-button');
    await fixture();await click('[data-action="open-native-support"]');
    await wait(()=>window.supportAIQA.device&&document.querySelector('.native-support-messages'));
    await wait(()=>document.body.innerText.includes('haolo')&&document.querySelector('.native-support-message.is-system'));
    const next=theme==='light'?'dark':'light';
    await run(next=>window.supportAIQA.propose([{kind:'set_theme',theme:next}]),next);
    await wait(()=>document.querySelector('[data-support-consent="decline"]'));
    await click('[data-support-consent="decline"]');
    await wait(()=>!document.querySelector('[data-support-consent="decline"]'));
    assert.equal(await run(()=>document.documentElement.dataset.theme),theme);
    await run(next=>window.supportAIQA.propose([{kind:'set_theme',theme:next}]),next);
    await wait(()=>document.querySelector('[data-support-consent="accept"]'));
    await click('[data-support-consent="accept"]');await wait(()=>document.querySelector('.support-assist-overlay'));
    await writeFile(path.join(output,`${language}-${theme}-operating.png`),(await win.webContents.capturePage()).toPNG());
    await wait(()=>window.supportAIQA.ai.actions[0].status==='succeeded'&&!document.querySelector('.support-assist-overlay'));
    assert.equal(await run(()=>document.documentElement.dataset.theme),next);
    assert.equal(await run(()=>localStorage.getItem('haolo.appearance.theme')),next);
    results.push({language,theme,decline:true,consentedThemePersisted:true});
    await click('.settings-close-button');
    const beforeColors=await run(()=>localStorage.getItem('haolo.trading-market.chart-settings.v1'));
    await run(plan=>window.supportAIQA.propose(plan),colorPlan);
    await wait(()=>document.querySelector('[data-support-consent="accept"]'));
    assert.equal(await run(()=>localStorage.getItem('haolo.trading-market.chart-settings.v1')),beforeColors);
    await writeFile(path.join(output,`${language}-${next}-candle-consent.png`),(await win.webContents.capturePage()).toPNG());
    await click('[data-support-consent="decline"]');await wait(()=>!document.querySelector('[data-support-consent="decline"]'));
    assert.equal(await run(()=>localStorage.getItem('haolo.trading-market.chart-settings.v1')),beforeColors);
    await run(plan=>window.supportAIQA.propose(plan),colorPlan);
    await wait(()=>document.querySelector('[data-support-consent="accept"]'));await click('[data-support-consent="accept"]');
    await wait(()=>window.supportAIQA.ai.actions[0].status==='succeeded'&&!document.querySelector('.support-assist-overlay'));
    const colors=await run(()=>JSON.parse(localStorage.getItem('haolo.trading-market.chart-settings.v1')));
    assert.equal(colors.risingColor.toUpperCase(),'#F6465D');assert.equal(colors.fallingColor.toUpperCase(),'#2EBD85');
    await click('[data-market-settings-tab="main-style"]');
    const controls=await run(()=>Object.fromEntries(['risingColor','fallingColor'].map(key=>[key,
      [...document.querySelectorAll(`[data-chart-setting="${key}"]`)].filter(el=>el.getClientRects().length).map(el=>el.value.toUpperCase())])));
    assert.ok(controls.risingColor.length&&controls.fallingColor.length,'Color controls must be visible');
    assert.ok(controls.risingColor.every(value=>value==='#F6465D')&&controls.fallingColor.every(value=>value==='#2EBD85'));
    await writeFile(path.join(output,`${language}-${next}-candle-complete.png`),(await win.webContents.capturePage()).toPNG());
    results.push({language,theme:next,action:'set_candle_colors',protocol:2,consentRequired:true,declineUnchanged:true,up:colors.risingColor,down:colors.fallingColor,persisted:true,visibleControls:controls});
    await click('[data-market-action="close-chart-settings"]');await click('[data-support-exit]');
  }
  for (const plan of [
    [{kind:'set_indicator',indicator:'sub:rsi',parameters:{'0':9}}],
    [{kind:'set_candle_colors',up_color:'#118844',down_color:'#CC2244'}],
    [{kind:'open_usage'}],
  ]) {
    await win.loadFile(path.join(root,'dist/renderer/index.html'),{query:{'i18n-layout-qa':'1'}});
    await wait(()=>document.querySelector('[data-action="open-native-support"]'));
    await fixture();await click('[data-action="open-native-support"]');await wait(()=>window.supportAIQA.device);
    await run(plan=>window.supportAIQA.propose(plan),plan);
    await wait(()=>document.querySelector('[data-support-consent="accept"]'));await click('[data-support-consent="accept"]');
    await wait(()=>window.supportAIQA.ai.actions[0].status==='succeeded'&&!document.querySelector('.support-assist-overlay'));
    if(plan[0].kind==='open_usage')assert.equal(await run(()=>!!document.querySelector('[data-consumption-unit]')),true);
    if(plan[0].kind==='set_indicator')assert.equal(await run(()=>JSON.parse(localStorage.getItem('haolo.trading-market.indicator-settings.v4'))['sub:rsi'].parameters[0]),9);
    if(plan[0].kind==='set_candle_colors')assert.equal(await run(()=>JSON.parse(localStorage.getItem('haolo.trading-market.chart-settings.v1')).risingColor.toUpperCase()),'#118844');
    results.push({action:plan[0].kind,verified:true});
  }
  await win.loadFile(path.join(root,'dist/renderer/index.html'),{query:{'i18n-layout-qa':'1'}});
  await wait(()=>document.querySelector('[data-action="open-native-support"]'));
  await fixture();await click('[data-action="open-native-support"]');await wait(()=>window.supportAIQA.device);
  await run(()=>window.supportAIQA.propose([{kind:'open_settings'},{kind:'set_theme',theme:'dark'}]));
  await wait(()=>document.querySelector('[data-support-consent="accept"]'));await click('[data-support-consent="accept"]');
  await wait(()=>document.querySelector('.support-assist-overlay'));
  await run(()=>{window.supportAIQA.ai.mode='human';window.supportAIQA.ai.epoch++;window.supportAIQA.ai.actions[0].status='cancelled';});
  await wait(()=>!document.querySelector('.support-assist-overlay'));
  assert.equal(await run(()=>window.supportAIQA.calls.some(p=>p.action==='aiStep'&&p.body.stage==='complete')),false);
  results.push({humanTakeoverUnlocks:true});
  await writeFile(path.join(output,'results.json'),JSON.stringify({passed:true,modelEvidence:evidencePath||null,scope:'Isolated real renderer and controls; support HTTP responses are fixtures.',results},null,2));
  console.log(JSON.stringify({passed:true,results}));win.destroy();app.exit(0);
}catch(error){await writeFile(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());await writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error.stack),body:await run(()=>document.body.innerText.slice(0,10000)),calls:await run(()=>window.supportAIQA?.calls)},null,2));console.error(error);win.destroy();app.exit(1);}
}
main().catch(error=>{console.error(error);app.exit(1);});
