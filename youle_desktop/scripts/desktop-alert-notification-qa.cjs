// Isolated hidden Electron windows exercise the production popup functions.
const {app,BrowserWindow,screen}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'.cache','desktop-alert-qa',String(Date.now()));
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
// macOS offscreen capture may precede the first compositor surface after resize.
const capture=async win=>{
  for(let attempt=0;;attempt++){
    await delay(100);
    try{return (await win.webContents.capturePage()).toPNG();}
    catch(error){if(attempt===3)throw error;}
  }
};
const wait=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await delay(30);}throw Error('popup timed out');};
(async()=>{
  const {createDesktopNotificationQueue}=await import(pathToFileURL(path.join(root,'src/main/desktop-notification-queue.mjs')));
  const {cloudAlertNotification}=await import(pathToFileURL(path.join(root,'src/main/cloud-alert-view.mjs')));
  await app.whenReady();
  const source=fs.readFileSync(path.join(root,'src/main/main.mjs'),'utf8');
  const windows=[],opened=[],results=[];
  let language='zh-CN',theme='light';
  const context=vm.createContext({console,Buffer,process,setTimeout,clearTimeout,queueMicrotask,screen,createDesktopNotificationQueue,
    BrowserWindow:function(options){
      const win=new BrowserWindow({...options,show:false,webPreferences:{...options.webPreferences,offscreen:true,backgroundThrottling:false}});
      win.showInactive=()=>{win.qaShown=true;};windows.push(win);return win;
    },
    appShuttingDown:false,AUTOMATION_BACKGROUND:false,IS_MAC:process.platform==='darwin',mainWindow:null,
    desktopNotificationQueue:null,desktopNotificationWindow:null,desktopNotificationTimer:null,
    DESKTOP_NOTIFICATION_BOUNDS:{width:380,height:154,margin:18},YOULE_DISPLAY_NAME:'HaoLo',
    getYouleApiClient:()=>({token:'isolated-fixture'}),taskCompletionPopupEnabled:()=>true,
    appLanguage:()=>language,appTheme:()=>theme,normalizeAppTheme:v=>v,normalizeAppLanguage:v=>v,appLanguageLocale:v=>v,
    mainUiText:key=>({settings:{'zh-CN':'设置','zh-Hant':'設定',en:'Settings',ko:'설정',ja:'設定'},close:{'zh-CN':'关闭','zh-Hant':'關閉',en:'Close',ko:'닫기',ja:'閉じる'}}[key][language]),
    htmlEscape:v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    desktopNotificationIconDataUrl:()=>'',notificationOpenContext:v=>v,
    focusMainWindowFromNotification:v=>opened.push(v),openSettingsFromNotification:()=>{},
  });
  vm.runInContext(source.slice(source.indexOf('function showDesktopNotificationWindow('),source.indexOf('function desktopNotificationIconDataUrl(')),context);
  const price={id:'fixture',rule:{marketKey:'binance:usdm:BTCUSDT',interval:'1M',operator:'gte',threshold:123456.123456,confirmation:'intrabar'}};
  for(language of ['zh-CN','zh-Hant','en','ko','ja'])for(theme of ['light','dark']) {
    const note=cloudAlertNotification({alert:price,event:{data:{eventId:`${language}-${theme}`,condition:'price',price:123457.123456,occurredAt:Date.now()}}},language);
    context.showDesktopNotificationWindow(note);
    const win=windows.at(-1);await wait(()=>win.qaShown);
    const measured=await win.webContents.executeJavaScript(`(()=>{const card=document.querySelector('.card'),r=card.getBoundingClientRect(),p=document.querySelector('p').getBoundingClientRect();return {height:innerHeight,bottom:r.bottom,textBottom:p.bottom,text:document.body.innerText,background:getComputedStyle(card).backgroundColor}})()`);
    assert.ok(measured.textBottom<=measured.height-8,JSON.stringify(measured));
    assert.ok(measured.text.includes('123457.123456'));
    assert.equal(measured.background,theme==='dark'?'rgb(27, 30, 35)':'rgb(255, 255, 255)');
    fs.writeFileSync(path.join(output,`${language}-${theme}.png`),await capture(win));
    results.push({language,theme,...measured});
    await win.webContents.executeJavaScript("document.querySelector('.card').click()");
    await wait(()=>win.isDestroyed());
    assert.equal(opened.at(-1).alertId,'cloud-price-fixture');
    assert.equal(opened.at(-1).marketId,'BINANCE:FUTURES:BTCUSDT');
    await delay(10);
  }
  const start=windows.length;
  for(let i=0;i<3;i++)context.showDesktopNotificationWindow({title:'Burst '+i,body:'Queued reminder',alertId:'cloud-price-fixture',evidenceId:'burst-'+i});
  assert.equal(windows.length,start+1);
  for(let i=0;i<3;i++){
    await wait(()=>windows.length===start+i+1&&windows.at(-1).qaShown);
    context.closeDesktopNotificationWindow();await delay(10);
  }
  context.desktopNotificationQueue.clear();
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:results.length,burst:3,results},null,2));
  console.log(JSON.stringify({output,passed:results.length,burst:3}));app.quit();
})().catch(error=>{console.error(error);app.exit(1);});
