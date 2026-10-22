// Isolated Electron renderer, synthetic data, no outbound network or user profile.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'.cache/account-pnl-20261023/ui');
fs.mkdirSync(path.join(output,'profile'),{recursive:true});
app.setPath('userData',path.join(output,'profile'));
app.on('window-all-closed',()=>{});
const preload=path.join(output,'preload.cjs');
fs.writeFileSync(preload, `
let stored;
Object.defineProperty(window,'codexDesktop',{configurable:true,get:()=>stored,set:api=>{
  stored=api; window.__pnlCalls=0; window.__pnlErrors=[];
  window.addEventListener('error',e=>window.__pnlErrors.push(e.message));
  api.onBinanceAccountPnl=fn=>{window.__pnlEmit=fn;return()=>{};};
  const status=api.getBinanceAccountStatus.bind(api), snapshot=api.getBinanceAccountSnapshot.bind(api);
  api.getBinanceAccountStatus=async()=>({...await status(),bound:true,serverCredentialsBound:true,serverConnectionId:'pnl-ui'});
  api.getBinanceAccountSnapshot=async()=>{window.__pnlCalls++;return {...await snapshot(),estimatedTotalAssets:100,marginBalance:100,unrealizedPnl:0,todayPnl:null,todayPnlPercent:null,realizedPnlToday:null,pnlScopeId:'scope-ui',pnlSequence:0,bindingVersion:1,pnlStatus:'loading'};};
}});
`);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(win,condition){for(let i=0;i<150;i++){if(await win.webContents.executeJavaScript(`Boolean(${condition})`))return;await pause(50);}throw new Error(condition);}
async function main(){
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
  const results=[];
  for(const locale of ['zh-CN','en','zh-TW'])for(const theme of ['light','dark']){
    const win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{preload,contextIsolation:false,nodeIntegration:false,sandbox:false,backgroundThrottling:false}});
    try{
      await win.loadFile(path.join(root,'.cache/account-pnl-20261023/renderer-build/index.html'),{query:{'binance-account-bound':'1','i18n-layout-qa':'1'}});
      await wait(win,"document.querySelector('[data-conversation-static-action=account]') && window.__pnlEmit");
      await win.webContents.executeJavaScript(`document.querySelector('[data-action=close-update-dialog]')?.click();document.querySelector('[data-action=open-settings]').click();document.querySelector('[data-settings-tab=general]')?.click();`);
      await wait(win,"document.querySelector('[data-settings-language]')");
      await win.webContents.executeJavaScript(`(()=>{const input=document.querySelector('[data-settings-language]');input.value=${JSON.stringify(locale)};input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-settings-theme=${theme}]').click();document.querySelector('[data-action=close-settings]').click();document.querySelector('[data-conversation-static-action=account]').click();})()`);
      await wait(win,"document.querySelector('.binance-account-pnl-progress')");
      const loading=await win.webContents.executeJavaScript("document.querySelector('.binance-account-pnl-progress').textContent");
      assert.equal(loading,locale==='en'?'Updating':'更新中');
      const baseline=await win.webContents.executeJavaScript('window.__pnlCalls');
      for(const width of [1440,700]){
        win.setSize(width,1000);
        await win.webContents.executeJavaScript(`window.__pnlEmit({connectionId:'pnl-ui',pnlScopeId:'scope-ui',bindingVersion:1,pnlSequence:${width===1440?1:4},pnlStatus:'waiting',pnlReason:'BINANCE_BUDGET_DEFERRED',realizedPnlToday:null,pnlRetryAfterMs:61000});`);
        await wait(win,"document.querySelector('.binance-account-pnl-progress')");
        await pause(200);
        const waiting=await win.webContents.executeJavaScript("document.querySelector('.binance-account-pnl-progress').textContent");
        assert.equal(waiting,locale==='en'?'Waiting for update':'等待更新');
        fs.writeFileSync(path.join(output,`${locale}-${theme}-${width}-waiting.png`),(await win.webContents.capturePage()).toPNG());
        const start=Date.now();
        await win.webContents.executeJavaScript(`window.__pnlEmit({connectionId:'pnl-ui',pnlScopeId:'scope-ui',bindingVersion:1,pnlSequence:${width===1440?2:5},pnlStatus:'available',realizedPnlToday:0,pnlAsOf:Date.now(),pnlExpiresAfterMs:60000});`);
        await wait(win,"!document.querySelector('.binance-account-pnl-progress') && document.querySelector('.binance-account-realized-value').textContent.includes('0.00')");
        const latency=Date.now()-start;
        assert.ok(latency<1000,`completion took ${latency}ms`);
        // Wrong binding and older sequence cannot replace the zero result.
        await win.webContents.executeJavaScript(`window.__pnlEmit({connectionId:'other',pnlScopeId:'other',bindingVersion:2,pnlSequence:999,pnlStatus:'available',realizedPnlToday:999,pnlExpiresAfterMs:60000});window.__pnlEmit({connectionId:'pnl-ui',pnlScopeId:'scope-ui',bindingVersion:1,pnlSequence:0,pnlStatus:'available',realizedPnlToday:999,pnlExpiresAfterMs:60000});`);
        await pause(200);
        const state=await win.webContents.executeJavaScript(`({value:document.querySelector('.binance-account-realized-value').textContent,calls:window.__pnlCalls,overflow:document.documentElement.scrollWidth>innerWidth,errors:window.__pnlErrors,language:document.documentElement.dataset.language,theme:document.documentElement.dataset.theme})`);
        assert.match(state.value,/0\.00/);assert.equal(state.calls,baseline);assert.equal(state.overflow,false);assert.deepEqual(state.errors,[]);
        assert.equal(state.language,locale);assert.equal(state.theme,theme);
        fs.writeFileSync(path.join(output,`${locale}-${theme}-${width}-zero.png`),(await win.webContents.capturePage()).toPNG());
        results.push({locale,theme,width,latency,...state});
      }
    }finally{win.destroy();}
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({ok:true,cases:results.length,maxCompletionMs:Math.max(...results.map(r=>r.latency)),output}));
}
main().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
