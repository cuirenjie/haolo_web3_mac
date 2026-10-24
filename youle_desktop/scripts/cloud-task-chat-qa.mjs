// Native input against production composer/send functions and controller.
// The server is isolated; no test message is added to the user's conversation.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
import {build} from 'vite';
const root=fileURLToPath(new URL('..',import.meta.url)),out=path.join(root,'.cache','cloud-task-chat-20261025');
fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.join(root,'src/renderer/main.ts'),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const names=['renderComposer','sendCurrentMessage','sendCloudTaskMessage','isCloudTaskThread','shouldHydrateAssistantPreview'];
const glue=ts.transpileModule(names.map(name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast)).join('\n'),
  {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
fs.writeFileSync(path.join(out,'entry.ts'),`
import {createCloudTaskChatController} from '../../src/renderer/cloud-task-chat.ts';
const id='cloud-task:00000000-0000-4000-8000-000000000001';
const state:any={auth:{authenticated:true},settings:{language:'zh-CN'},voiceInput:{status:'idle'},currentThreadId:id,composerText:'',composerQuote:null,attachments:[],composerThreadReferences:[],composerDrafts:{}};
let authenticatedWorkspaceGeneration=1,root=document.querySelector('#host'),runtime:any,calls:any[]=[],errors:any[]=[];
let data=JSON.parse(localStorage.getItem('qa-history')||'null')||{ok:true,threadId:id,title:'原来的历史会话',items:Array.from({length:50},(_,i)=>({id:'old-'+i,text:'原历史 '+i})),activeRunIds:[],pending:null};
const persist=()=>localStorage.setItem('qa-history',JSON.stringify(data));
const esc=(s:any)=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function render(){if(!runtime)return;const old=document.querySelector('#composerInput') as HTMLTextAreaElement;
  if(old)state.composerText=old.value;
  root!.innerHTML='<h3>'+esc(data.title)+'</h3><div id="history">'+data.items.map((x:any)=>'<p>'+esc(x.text)+'</p>').join('')+'</div>'+runtime.renderComposer({id,name:data.title});
  root!.querySelector('#composerInput')!.addEventListener('input',(e:any)=>{state.composerText=e.target.value;const b=root!.querySelector('.send-button') as HTMLButtonElement;b.disabled=!state.composerText.trim()||controller.busy(id);});
  root!.querySelector('#composerForm')!.addEventListener('submit',(e:any)=>{e.preventDefault();void runtime.sendCurrentMessage(id);});
}
const controller=createCloudTaskChatController({scope:()=> 'owner',request:async(action,input)=>{
  calls.push({action,input});if(input.taskId!==id.slice(11))throw Error('wrong task');
  if(action==='send'){data.items.push({id:'new-user',text:input.prompt},{id:'new-answer',text:'回复生成中'});data.activeRunIds=['run'];persist();}
  if(action==='read'&&data.activeRunIds.length){data.items.at(-1).text='保留原历史的最终回复';data.activeRunIds=[];persist();}
  return structuredClone(data);
},apply:h=>{data=h;},changed:()=>queueMicrotask(render),error:e=>errors.push(String(e)),restoreDraft:()=>{}});
const deps={state,authenticatedWorkspaceGeneration,root,createCloudTaskChatController,
  getCloudTaskChat:()=>controller,firstString:(...a:any[])=>a.find(Boolean),currentComposerThreadId:()=>id,composerThreadIdForSend:(x:string)=>x,
  composerInputTextForThread:()=> (root!.querySelector('#composerInput') as HTMLTextAreaElement).value,
  rememberComposerDraftForThread:()=>{state.composerDrafts[id]={text:state.composerText};},forgetComposerDraft:()=>delete state.composerDrafts[id],
  tradingExpertSelectedModelRequestOptions:()=>({model:'gpt-6-astra'}),scheduleProtectedRender:()=>{const e=root!.querySelector('#composerInput') as HTMLTextAreaElement;if(e)e.value=state.composerText;render();},
  errorMessage:String,showToast:(e:any)=>errors.push(String(e)),escapeAttr:esc,escapeHtml:esc,renderComposerMentionHighlights:esc,
  renderComposerModelPicker:()=>'<span>GPT-6 Astra</span>',renderVoiceInputButton:()=>'',
  renderComposerSubmitButton:()=>'<button class="send-button" type="submit" '+(!controller.ready(id)||controller.busy(id)||!state.composerText.trim()?'disabled':'')+'>发送</button>',
};
runtime=Function(...Object.keys(deps),${JSON.stringify(glue)}+';return {renderComposer,sendCurrentMessage,shouldHydrateAssistantPreview};')(...Object.values(deps));
if(runtime.shouldHydrateAssistantPreview({id}))throw Error('Cloud history must not enter local UUID hydration');
render();void controller.load(id);
(window as any).qa={poll:()=>controller.load(id),state:()=>({id,items:data.items,calls,errors,busy:controller.busy(id),ready:controller.ready(id)})};
`);
await build({configFile:false,root,logLevel:'error',build:{outDir:out,emptyOutDir:false,lib:{entry:path.join(out,'entry.ts'),name:'CloudTaskChatQA',formats:['iife'],fileName:()=> 'bundle.js'},minify:false}});
const css=fs.readFileSync(path.join(root,'src/renderer/styles.css'),'utf8');
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><style>${css}\nbody{padding:20px}#host{width:440px}#history{height:420px;overflow:auto}.composer{position:relative;min-height:140px}h3{padding:10px}</style><div id="host"></div><script src="bundle.js"></script>`);
fs.writeFileSync(path.join(out,'runner.cjs'),String.raw`
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();
(async()=>{await app.whenReady();const win=new BrowserWindow({show:false,width:540,height:800,webPreferences:{sandbox:true,contextIsolation:true,offscreen:true,backgroundThrottling:false}});
 const js=x=>win.webContents.executeJavaScript(x),pause=()=>new Promise(r=>setTimeout(r,100));
 await win.loadFile(path.join(__dirname,'index.html'));await js('localStorage.clear()');await win.reload();await pause();
 assert.equal(await js('qa.state().items.length'),50);assert.equal(await js('document.querySelector("#composerInput").readOnly'),false);
 await js('document.querySelector("#composerInput").focus()');await win.webContents.insertText('继续解释原计划');await pause();
 const p=await js('(()=>{const r=document.querySelector(".send-button").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
 assert.equal(await js('document.querySelector(".send-button").disabled'),false);
 win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await pause();
 await js('qa.poll()');await pause();
 const sent=await js('qa.state()');assert.equal(sent.calls.filter(c=>c.action==='send').length,1);assert.equal(sent.items.length,52);
 assert.equal(sent.items[0].text,'原历史 0');assert.equal(sent.items[50].text,'继续解释原计划');assert.equal(sent.items[51].text,'保留原历史的最终回复');assert.deepEqual(sent.errors,[]);
 fs.writeFileSync(path.join(__dirname,'continued.png'),(await win.webContents.capturePage()).toPNG());
 await win.reload();await pause();const reopened=await js('qa.state()');assert.equal(reopened.items.length,52);assert.equal(reopened.id,sent.id);
 assert.equal(reopened.items[51].text,sent.items[51].text);assert.equal(await js('document.querySelector("#composerInput").readOnly'),false);
 fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify({originalMessages:50,afterSend:52,sameTask:true,reloadPreserved:true,nativeInput:true},null,2));
 win.destroy();console.log('Cloud task chat native input and reload passed');app.quit();
})().catch(e=>{console.error(e);app.exit(1);});
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(path.join(root,'node_modules/electron/dist/electron.exe'),[path.join(out,'runner.cjs')],{cwd:path.resolve(root,'..'),encoding:'utf8',env,timeout:60000,windowsHide:true});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error)throw result.error;process.exitCode=result.status??1;
