// Actual renderer thinking functions and CSS, isolated hidden Electron windows.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises');
const syncFs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const output=path.resolve(root,'../.cache/market-recovery-20261022/ui');
syncFs.mkdirSync(path.join(output,'profile'),{recursive:true});
app.setPath('userData',path.join(output,'profile'));
app.on('window-all-closed',()=>{});
async function main(){
  const source=await fs.readFile(path.join(root,'src/renderer/main.ts'),'utf8');
  const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
  const names=['tradingExpertThinkingStage','englishSafeAssistantText','localizedThinkingStage','handledStatusLabel','renderThinkingBubble'];
  const functions=names.map(name=>{const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(fn,name);return fn.getText(ast);}).join('\n');
  const compiled=ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const {marketRecoveryProgressMessage}=await import(pathToFileURL(path.join(root,'src/shared/market-recovery-progress.mjs')));
  const {translateAppText}=await import(pathToFileURL(path.join(root,'src/renderer/app-language.mjs')));
  const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const css=await fs.readFile(path.join(root,'src/renderer/styles.css'),'utf8');
  const results=[];
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,done)=>done({cancel:true}));
  for(const language of ['zh-CN','en','zh-TW'])for(const theme of ['light','dark']){
    const render=new Function('state','escapeHtml','escapeAttr','HANDLED_STATUS_LABEL','HAN_CHARACTER_PATTERN',compiled+';return (phase,message)=>renderThinkingBubble("3h",null,tradingExpertThinkingStage(phase,"",message));')(
      {settings:{language}},escape,escape,'已处理',/[\u3400-\u9fff\uf900-\ufaff]/u);
    const waiting=marketRecoveryProgressMessage('market_waiting',language),resuming=marketRecoveryProgressMessage('market_resuming',language);
    // The real app's DOM observer applies this same text catalog after render.
    const content=(render('market-waiting',waiting)+render('preparing',resuming)).replace(/>([^<>]+)</g,(_match,text)=>`>${translateAppText(text,language)}<`);
    const html=`<!doctype html><html data-theme="${theme}" data-language="${language}"><head><meta charset="utf-8"><style>${css}</style></head><body><main style="padding:24px;width:480px;display:grid;gap:30px">${content}</main></body></html>`;
    const file=path.join(output,`${language}-${theme}.html`);await fs.writeFile(file,html);
    const win=new BrowserWindow({show:false,width:600,height:400,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    try{
      await win.loadFile(file);
      const value=await win.webContents.executeJavaScript(`(() => {
        const nodes=[...document.querySelectorAll('.thinking-stage-detail')];
        return {theme:document.documentElement.dataset.theme,text:document.body.innerText,
          labels:[...document.querySelectorAll('.thinking-stage-label')].map(n=>n.textContent),
          details:nodes.map(n=>{const r=n.getBoundingClientRect();return {text:n.textContent,width:r.width,height:r.height,right:r.right,bottom:r.bottom,color:getComputedStyle(n).color};}),
          overflow:document.documentElement.scrollWidth>innerWidth};
      })()`);
      assert.equal(value.theme,theme);assert.equal(value.overflow,false);
      assert.deepEqual(value.details.map(d=>d.text),[waiting,resuming]);
      assert.ok(value.details.every(d=>d.width>0&&d.height>0&&d.right<=600&&d.bottom<=400));
      assert.equal(value.labels[0],language==='en'?'Waiting for market data':language==='zh-TW'?'正在等待行情恢復':'正在等待行情恢复');
      if(language==='en')assert.doesNotMatch(value.text,/[\u3400-\u9fff]/u);
      if(language==='zh-TW')assert.doesNotMatch(value.text,/已处理|正在准备|额度|恢复/);
      await fs.writeFile(path.join(output,`${language}-${theme}.png`),(await win.webContents.capturePage()).toPNG());
      results.push({language,theme,...value});
    }finally{win.destroy();}
  }
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({passed:results.length,results},null,2));
  console.log(JSON.stringify({passed:results.length,output}));
}
main().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
