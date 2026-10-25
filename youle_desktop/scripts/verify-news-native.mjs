// Runs the real Electron notification windows with local synthetic content only.
import { app, BrowserWindow, screen } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createNewsWindows } from '../src/main/news-windows.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),output=path.join(root,'output/news-20261025');
const previewOnly=process.argv.includes('--preview-only');
const main=fs.readFileSync(new URL('../src/main/main.mjs',import.meta.url),'utf8');
const begin=main.indexOf('function desktopNotificationHtml('),end=main.indexOf('\nfunction desktopNotificationIconDataUrl',begin);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=vm.runInNewContext(main.slice(begin,end)+'\ndesktopNotificationHtml',{desktopNotificationIconDataUrl:()=>'',normalizeAppTheme:v=>v,normalizeAppLanguage:v=>v,mainUiText:key=>key==='close'?'关闭':'设置',htmlEscape:escape,appLanguageLocale:v=>v,appLanguage:()=> 'zh-CN',YOULE_DISPLAY_NAME:'HaoLo'});
fs.mkdirSync(output,{recursive:true});
app.removeAllListeners('window-all-closed');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
const timeout=setTimeout(()=>{console.error("Native news QA timed out");app.exit(1);},30000);
try{
 for(const theme of ['light','dark']){
  const instances=[],opened=[],dismissed=[];
  class NewsWindow extends BrowserWindow {constructor(options){super(options);instances.push(this);}showInactive(){if(!previewOnly)super.showInactive();}}
  const item={id:'publication',articleId:'00000000-0000-4000-8000-000000000001',title:'产品更新：HaoLo 新闻中心正式亮相',summary:'产品更新、服务公告与全球路演消息集中发布。点击查看完整文章。'};
  const controller=createNewsWindows({BrowserWindow:NewsWindow,screen,html,theme:()=>theme,language:()=> 'zh-CN',openExternal:async url=>opened.push(url),dismiss:id=>{dismissed.push(id);controller.update([]);}});
  controller.update([item]);const window=instances[0];await new Promise(resolve=>window.once('ready-to-show',resolve));
  if(theme==='light'&&!previewOnly)await new Promise(resolve=>setTimeout(resolve,8000));
  assert.equal(window.isDestroyed(),false);assert.equal(window.isVisible(),!previewOnly);
  assert.equal(await window.webContents.executeJavaScript("getComputedStyle(document.querySelector('[data-action=settings]')).display"),'none');
  fs.writeFileSync(path.join(output,`desktop-${theme}.png`),(await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.querySelector('${theme==='light'?'.card':'[data-action=close]'}').click()`);
  await new Promise(resolve=>setTimeout(resolve,200));assert.deepEqual(dismissed,['publication']);
  assert.equal(opened.length,theme==='light'?1:0);if(opened.length)assert.equal(opened[0],'https://haolo.com/api/news/read/00000000-0000-4000-8000-000000000001?lang=zh-CN');
  controller.stop();
 }
 console.log(previewOnly?'Updated native light/dark popup previews.':'Native Windows news popup: persistent beyond 8s, light/dark, browser link and close passed.');
 fs.writeFileSync(path.join(output,previewOnly?'preview-report.json':'native-report.json'),JSON.stringify({persistentAfterMs:previewOnly?0:8000,themes:['light','dark'],browserClick:true,close:true}));
}finally{clearTimeout(timeout);app.quit();}
}).catch(error=>{console.error(error);app.exit(1);});
