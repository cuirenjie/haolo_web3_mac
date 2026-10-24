// Local browser regression with a Chrome API fixture; no live browser task or permissions.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.HAOLO_PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('../extensions/haolo-chrome/',import.meta.url));
const browser=await chromium.launch({headless:true,channel:'chrome'});
let count=0;
try {
 for(const theme of ['light','dark']) for(const width of [360,560]) {
  const context=await browser.newContext({viewport:{width,height:1000},colorScheme:theme});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='haolo-extension.test')return route.abort();
   const file=path.resolve(root,'.'+url.pathname);
   if(!file.startsWith(root))return route.abort();
   try { await route.fulfill({body:await fs.readFile(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'}); } catch { await route.fulfill({status:404}); }
  });
  await context.addInitScript(()=>{
   window.__qaLanguage='ko';let listener;
   window.__emit=message=>listener(message);
   window.chrome={i18n:{getUILanguage:()=>window.__qaLanguage},permissions:{request:async()=>true},runtime:{connect:()=>({onMessage:{addListener:fn=>listener=fn},postMessage:message=>setTimeout(()=>{
    if(message.type==='connection.status')listener({type:message.type,payload:{state:'connected',language:window.__qaLanguage,profileId:'profile_12345678'}});
    if(message.type==='tab.status')listener({type:message.type,payload:{title:'User page BTC',origin:'https://example.test',supported:true,authorized:true,mode:'once'}});
    if(message.type==='capabilities.status')listener({type:message.type,payload:{downloads:false,debugger:false,history:false}});
    if(message.type==='page.preview')listener({type:message.type,payload:{text:'用户原文 BTC 123.45',elements:[{}],truncated:true}});
   },0)})}};
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://haolo-extension.test/sidepanel.html');
  await page.locator('#promptInput').fill('保留原始输入 BTC 123.45');
  for(const language of ['ko','en','zh-TW','zh-CN','ko']) {
   await page.evaluate(language=>{window.__qaLanguage=language;window.__emit({type:'connection.status',payload:{state:'connected',language,profileId:'profile_12345678'}});},language);
   await page.waitForTimeout(60);
   assert.equal(await page.locator('html').getAttribute('lang'),language);
   assert.equal(await page.locator('#promptInput').inputValue(),'保留原始输入 BTC 123.45');
   const audit=await page.evaluate(()=>{
    const clone=document.querySelector('main').cloneNode(true);
    clone.querySelectorAll('#promptInput,#previewText,#siteTitle,#siteOrigin').forEach(node=>node.remove());
    return {text:clone.textContent,placeholder:document.querySelector('#promptInput').placeholder,overflow:document.documentElement.scrollWidth>innerWidth+1};
   });
   if(language==='en'||language==='ko')assert.doesNotMatch(audit.text+audit.placeholder,/[\u3400-\u9fff]/u,language);
   assert.equal(audit.overflow,false,`${theme}/${width}/${language}`);
   await page.locator('#previewButton').click();
   await page.waitForFunction(()=>document.querySelector('#previewText').textContent==='用户原文 BTC 123.45');
   assert.equal(await page.locator('#previewText').textContent(),'用户原文 BTC 123.45');
   count++;
  }
  assert.deepEqual(errors,[]);
  await context.close();
 }
} finally { await browser.close(); }
console.log(`PASS: ${count} Chrome panel language/theme/width states; original input, preview and permission scope preserved`);
