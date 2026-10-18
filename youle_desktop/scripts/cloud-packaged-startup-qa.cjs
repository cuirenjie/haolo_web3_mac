// Load the actual sealed ASAR main, preload and renderer in Electron.
// OS registration/shortcuts and external network are isolated test boundaries.
const {app,BrowserWindow,session,shell,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),archive=path.join(root,'resources/app.asar');
const output=path.join(path.dirname(root),'startup-qa');fs.mkdirSync(output,{recursive:true});
const qaHome=path.join(output,'home');fs.mkdirSync(qaHome,{recursive:true});
os.homedir=()=>qaHome;require('node:module').syncBuiltinESMExports();
for(const key of ['home','appData','userData','sessionData','desktop','documents','downloads','logs']){
  const target=path.join(qaHome,key);fs.mkdirSync(target,{recursive:true});app.setPath(key,target);
}
process.env.APPDATA=app.getPath('appData');process.env.LOCALAPPDATA=path.join(qaHome,'local');
process.env.HAOLO_DESKTOP_WORKSPACE=path.join(qaHome,'workspace');
process.env.HAOLO_DESKTOP_RUNTIME_ROOT=path.join(qaHome,'runtime');
process.env.HAOLO_TOOL_RUNTIME_SHARED_ROOT=path.join(qaHome,'shared');
process.env.CODEX_PRIMARY_RUNTIME_ROOT=path.join(qaHome,'shared');
process.env.YOULE_EXTERNAL_CHANNELS_BACKEND_AUTOSTART='false';
process.env.HAOLO_API_BASE_URL='http://127.0.0.1:1';
process.env.HAOLO_APP_UPDATE_BASE_URL='http://127.0.0.1:1';
fs.mkdirSync(process.env.HAOLO_DESKTOP_WORKSPACE,{recursive:true});
app.setAppPath(archive);Object.defineProperty(app,'isPackaged',{value:true});
Object.defineProperty(process,'resourcesPath',{value:path.join(root,'resources')});
app.disableHardwareAcceleration();
shell.writeShortcutLink=()=>true;shell.openExternal=async()=>{};
app.setLoginItemSettings=()=>{};app.setAsDefaultProtocolClient=()=>true;
dialog.showMessageBox=async()=>({response:1});dialog.showErrorBox=(_title,message)=>errors.push(message);
const errors=[],network=[],windows=[],notes=[];
process.on('uncaughtException',error=>{errors.push(error.stack);finish(false);});
process.on('unhandledRejection',error=>{errors.push(String(error?.stack||error));finish(false);});
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
  const url=String(input?.url||input);
  if(/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url))return originalFetch(input,init);
  network.push(url.split('?')[0]);return Promise.resolve(new Response('{}',{status:503}));
};
let finished=false,finalPassed=false,lastState=null;
const originalExit=app.exit.bind(app);app.exit=code=>originalExit(finished?(finalPassed?0:1):code);
function finish(passed,details={}){
  if(finished)return;finished=true;finalPassed=passed;
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed,archive,errors,notes,
    externalNetworkBlocked:network.length,lastState,scope:'Actual packaged ASAR in Electron, isolated paths and OS integrations',...details},null,2)+'\n');
  console.log(JSON.stringify({passed,errors,...details}));
  app.quit();setTimeout(()=>app.exit(passed?0:1),1500).unref();
}
app.on('browser-window-created',(_event,win)=>{
  windows.push(win);win.setOpacity(0);win.focus=()=>{};
  const showInactive=win.showInactive.bind(win);win.show=showInactive;
  win.webContents.on('preload-error',(_event,_preload,error)=>errors.push(error.stack));
  win.webContents.on('render-process-gone',(_event,details)=>errors.push(JSON.stringify(details)));
  win.webContents.on('did-fail-load',(_event,code,description)=>errors.push(`${code}: ${description}`));
  win.webContents.on('console-message',event=>{
    if(event.level==='error'&&!/ERR_CONNECTION_REFUSED|ERR_BLOCKED_BY_CLIENT|Failed to fetch|net::|Binance market catalog/.test(event.message))notes.push(event.message);
  });
});
(async()=>{
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    const allowed=/^(file|data|devtools):/.test(details.url)||/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(details.url);
    if(!allowed)network.push(details.url.split('?')[0]);callback({cancel:!allowed});
  });
  const native=await import(pathToFileURL(path.join(archive,'src/main/chrome/native-host-manager.mjs')));
  const originalInstall=native.ChromeNativeHostManager.prototype.install;
  native.ChromeNativeHostManager.prototype.install=function(){return originalInstall.call(this,{register:false});};
  await import(pathToFileURL(path.join(archive,'src/main/main.mjs')));
  for(let i=0;i<150;i++){
    await new Promise(resolve=>setTimeout(resolve,200));
    const win=windows.find(w=>!w.isDestroyed()&&w.webContents.getURL().includes('index.html'));
    if(!win||win.webContents.isLoading())continue;
    const state=await win.webContents.executeJavaScript(`(async()=>({ready:document.readyState,body:document.body.innerText.length,text:document.body.innerText.slice(0,250),
      login:!!document.querySelector('#loginAgreement'),bridge:typeof window.codexDesktop,cloud:typeof window.codexDesktop?.tradingCloudRecovery,
      preferences:typeof window.codexDesktop?.getTradingPreferenceProfile,
      catalog:await window.codexDesktop.listTradingStrategies(),recovery:await window.codexDesktop.tradingCloudRecovery('list')}))()`);
    lastState=state;
    if(!state.login)continue;
    assert.equal(state.ready,'complete');assert.ok(state.body>0);assert.equal(state.bridge,'object');
    assert.equal(state.cloud,'function');assert.equal(state.preferences,'function');
    assert.equal(state.catalog.strategies.length,17);
    assert.ok(state.catalog.strategies.every(item=>item.implementation.kind==='cloud-v1'));
    assert.equal(state.recovery.ok,false);assert.equal(state.recovery.error.code,'HAOLO_AUTH_REQUIRED');
    assert.equal(errors.length,0,errors.join('\n'));
    await fs.promises.writeFile(path.join(output,'startup.png'),(await win.webContents.capturePage()).toPNG());
    finish(true,{state,userData:app.getPath('userData'),windows:windows.length});return;
  }
  throw new Error('Packaged renderer did not become ready within 30 seconds');
})().catch(error=>{errors.push(error.stack);finish(false);});
