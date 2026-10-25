import electronPath from 'electron';
// Hidden Electron; real HaoBao UI and language switching, no production data.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(createRequire(import.meta.url).resolve('vite/package.json'));
const {buildSync}=require('esbuild');
const output=path.join(root,'output/m1-465-regression/visual');fs.mkdirSync(output,{recursive:true});
const entry=String.raw`
import {createHaoBaoUi} from './src/renderer/haobao.ts';
import {applyAppLanguage,translateAppText} from './src/renderer/app-language.mjs';
const host=document.querySelector('#app');let ui,locale;
function render(){host.innerHTML=ui.renderPage({name:'用户名字',avatar:''})+ui.renderDialog();ui.bind(host);applyAppLanguage(locale,{root:host});}
window.qa=(config)=>{
  locale=config.locale;document.documentElement.dataset.theme=config.theme;localStorage.clear();
  if(config.page!=='intro')localStorage.setItem('haolo.haobao.preview.v1:qa',JSON.stringify({name:'晴空蓝',created:true,customized:true,
    color:'sky',character:'classic',mood:'wink',createdAt:1792929600000,conversationStarted:config.page==='chat',
    messages:config.page==='chat'?[{from:'user',text:'云朵白 这是用户原文',createdAt:1792929600000},{from:'hao',text:'用户的历史文本',createdAt:1792929600000}]:[]}));
  applyAppLanguage(locale,{root:host});ui=createHaoBaoUi(render);ui.useAccount('qa');render();
  if(config.page==='dialog')host.querySelector('[data-haobao-action="customize"]').click();
  const names=[...host.querySelectorAll('[data-i18n-skip]')].map(e=>e.textContent);
  const messages=[...host.querySelectorAll('.message-text')].map(e=>e.textContent);
  const text=[];const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);let n;
  while(n=walker.nextNode())if(!n.parentElement.closest('[data-i18n-skip],.message-text'))text.push(n.textContent.trim());
  const attrs=[...host.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap(e=>['aria-label','title','placeholder'].map(k=>e.getAttribute(k)||''));
  const options=[...host.querySelectorAll('.haobao-option')];
  const optionMismatch=options.filter(e=>e.getAttribute('aria-label')!==e.querySelector('span').textContent).length;
  let disabled=null;
  if(config.page==='dialog'){
    const input=host.querySelector('#haobao-name');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
    disabled=host.querySelector('.haobao-preview button[type="submit"]').disabled;
    input.value='晴空蓝';input.dispatchEvent(new Event('input',{bubbles:true}));
  }
  const button=host.querySelector('.haobao-dialog button')||host.querySelector('button');button?.focus();
  return {text,attrs,names,messages,optionMismatch,options:options.length,disabled,focus:document.activeElement===button,
    title:host.querySelector('h1,h2')?.textContent,selected:host.querySelectorAll('.haobao-option[aria-pressed="true"]').length,
    expectedWelcome:translateAppText('嘿！我是你的{name}。').replace('{name}','晴空蓝')};
};
`;
buildSync({stdin:{contents:entry,resolveDir:root,sourcefile:'haobao-language-qa.js'},bundle:true,platform:'browser',format:'esm',loader:{'.css':'empty'},outfile:path.join(output,'bundle.js')});
const css=['src/renderer/styles.css','src/renderer/haobao.css'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
fs.writeFileSync(path.join(output,'preview.html'),`<!doctype html><meta charset="UTF-8"><style>${css}</style><style>html,body,#app{margin:0;width:100%;height:100%;}#app{display:flex;background:var(--bg);}.haobao-page{flex:1}</style><div id="app"></div><script type="module" src="bundle.js"></script>`);
const runner=String.raw`
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();
(async()=>{await app.whenReady();const win=new BrowserWindow({width:1024,height:900,show:false,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
await win.loadFile(path.join(__dirname,'preview.html'));const results=[];
for(const locale of ['zh-CN','zh-TW','en','ko'])for(const theme of ['light','dark'])for(const page of ['intro','welcome','dialog','chat']){
  const config={locale,theme,page},id=Object.values(config).join('-');
  const r=await win.webContents.executeJavaScript('(()=>{try{return window.qa('+JSON.stringify(config)+')}catch(error){return {qaError:String(error.stack||error)}}})()');
  assert.ok(!r.qaError,r.qaError);
  if(locale==='en'||locale==='ko')assert.deepEqual([...r.text,...r.attrs].filter(t=>/\p{Script=Han}/u.test(t)),[],id+' untranslated UI');
  if(page==='welcome'){assert.equal(r.messages[0],r.expectedWelcome);if(locale==='en'||locale==='ko')assert.ok(r.messages.slice(1).every(t=>!/\p{Script=Han}/u.test(t)),id+' welcome');}
  if(page==='chat'){assert.deepEqual(r.messages,['云朵白 这是用户原文','用户的历史文本']);assert.ok(r.names.includes('晴空蓝'));}
  if(page==='dialog'){assert.equal(r.options,18);assert.equal(r.selected,3);assert.equal(r.optionMismatch,0);assert.equal(r.disabled,true);}
  assert.equal(r.focus,true,id+' focus');results.push({id,...r});
  if(page==='dialog'||page==='intro'){await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');fs.writeFileSync(path.join(__dirname,id+'.png'),(await win.webContents.capturePage()).toPNG());}
}
fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.length,output:__dirname}));win.destroy();})().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
`;
fs.writeFileSync(path.join(output,'runner.cjs'),runner);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(electronPath,[path.join(output,'runner.cjs')],{cwd:path.dirname(root),env,windowsHide:true,stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status??1;
