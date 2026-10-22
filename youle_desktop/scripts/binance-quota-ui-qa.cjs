// Isolated renderer build, synthetic account and blocked outbound network.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.cache/binance-quota-M1-445/ui');
require('node:fs').mkdirSync(path.join(output,'profile'),{recursive:true});
app.setPath('userData',path.join(output,'profile'));
app.on('window-all-closed',()=>{});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(win,condition){
  for(let i=0;i<120;i++){
    if(await win.webContents.executeJavaScript(`Boolean(${condition})`))return;
    await pause(100);
  }
  throw new Error(condition);
}
async function main(){
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
  const results=[];
  for(const locale of ['zh-CN','en','zh-TW'])for(const theme of ['light','dark']){
    const win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    try{
      await win.loadFile(path.join(root,'.cache/binance-quota-M1-445/renderer-build/index.html'),{query:{'binance-account-bound':'1','i18n-layout-qa':'1'}});
      await wait(win,"document.querySelector('[data-conversation-static-action=account]')");
      await win.webContents.executeJavaScript(`document.querySelector('[data-action=close-update-dialog]')?.click();document.querySelector('[data-action=open-settings]').click();document.querySelector('[data-settings-tab=general]')?.click();`);
      await wait(win,"document.querySelector('[data-settings-language]')");
      await win.webContents.executeJavaScript(`(()=>{const language=document.querySelector('[data-settings-language]');language.value=${JSON.stringify(locale)};language.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-settings-theme=${theme}]').click();document.querySelector('[data-action=close-settings]').click();
      window.__quotaErrors=[];window.addEventListener('error',e=>window.__quotaErrors.push(e.message));
      const api=window.codexDesktop,status=api.getBinanceAccountStatus.bind(api);
      api.getBinanceAccountStatus=async()=>({...await status(),serverCredentialsBound:true,serverConnectionId:'quota-ui'});
      document.querySelector('[data-conversation-static-action=account]').click();})()`);
      await wait(win,"document.querySelector('[data-binance-account-action=refresh]')");
      await pause(250);
      await win.webContents.executeJavaScript(`(()=>{window.codexDesktop.getBinanceAccountSnapshot=async()=>{throw Object.assign(new Error('账户数据请求繁忙，稍后自动重试。'),{code:'BINANCE_BUDGET_DEFERRED',scope:'binance_account',status:429,retryable:true,retryAfterMs:30000});};document.querySelector('[data-binance-account-action=refresh]').click();})()`);
      await wait(win,"/请求繁忙|requests are busy|請求繁忙/.test(document.body.innerText)");
      const state=await win.webContents.executeJavaScript(`(()=>{const toast=[...document.querySelectorAll('[role=status],.toast')].filter(e=>e.textContent.includes('Binance')).at(-1);return {language:document.documentElement.dataset.language,theme:document.documentElement.dataset.theme,text:toast?.textContent||document.body.innerText.slice(-450),overflow:document.documentElement.scrollWidth>innerWidth,errors:window.__quotaErrors};})()`);
      assert.equal(state.language,locale);assert.equal(state.theme,theme);assert.equal(state.overflow,false);assert.deepEqual(state.errors,[]);
      assert.doesNotMatch(state.text,/模型|model upstream|模型上遊/i);
      assert.match(state.text,locale==='en'?/Account data requests are busy/:locale==='zh-TW'?/帳戶資料請求繁忙/:/账户数据请求繁忙/);
      await win.webContents.capturePage();
      await pause(300);
      await fs.writeFile(path.join(output,`${locale}-${theme}.png`),(await win.webContents.capturePage()).toPNG());
      results.push(state);
    }finally{win.destroy();}
  }
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({ok:true,cases:results.length,output}));
}
main().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
