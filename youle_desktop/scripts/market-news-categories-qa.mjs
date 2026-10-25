// Run against the loopback QA API replaying verified public provider responses.
import {app,BrowserWindow,ipcMain} from 'electron/main';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';
import {NEWS_CATEGORIES} from '../src/shared/market-news-categories.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'output/news-categories-20261026');
const apiBase=process.env.HAOLO_NEWS_QA_BASE_URL || 'http://127.0.0.1:5229';
assert.equal(new URL(apiBase).hostname,'127.0.0.1','QA must use a loopback API');
app.setPath('userData',path.join(output,'categories-profile'));app.disableHardwareAcceleration();
const report={checks:[],screenshots:[],errors:[]};let server,win;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){try{
  await mkdir(output,{recursive:true});
  const fixtures=JSON.parse((await readFile(path.join(output,'provider-verified.json'),'utf8')).replace(/^\uFEFF/,''));
  const client=new YouleApiClient({serviceFetch:fetch});client.loaded=true;client.baseUrl=apiBase;client.token='local-news-qa';
  const preload=path.join(output,'categories-preload.cjs');
  await writeFile(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('newsQaApi',{list:p=>ipcRenderer.invoke('news-qa:list',p)});");
  server=await createServer({configFile:false,root:path.join(root,'src/renderer'),server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root]}},clearScreen:false});await server.listen();await app.whenReady();
  win=new BrowserWindow({show:false,width:1134,height:876,webPreferences:{preload,partition:'categories-qa',offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true}});
  ipcMain.handle('news-qa:list',(event,params)=>{assert.equal(event.sender,win.webContents);return client.marketNewsRequest(params);});
  const js=source=>win.webContents.executeJavaScript(`(async()=>{${source}})()`,true);
  const until=async expr=>{for(let i=0;i<150;i++){if(await js(`return ${expr}`))return;await sleep(50);}throw Error('Timeout: '+expr+' / '+await js('return window.qaError'));};
  const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const ready=()=>until('!workspace.newsController.loading');
  const screenshot=async name=>{await sleep(120);await writeFile(path.join(output,name),(await win.webContents.capturePage()).toPNG());report.screenshots.push(name);};
  const positions=()=>js(`return ['.market-news-header','.market-news-header .market-news-date','.market-news-refresh','.market-page-trigger'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,right:r.right};});`);
  const ids=()=>js('return [...document.querySelectorAll(".market-news-row")].map(n=>n.dataset.newsId)');
  const selected=()=>js('return document.querySelector(".market-news-category[aria-pressed=true]").dataset.category');
  win.webContents.on('console-message',(_event,_level,message)=>{if(/Uncaught|ResizeObserver loop/.test(message))report.errors.push(message);});
  await win.loadURL(`${server.resolvedUrls.local[0]}@fs/${path.join(root,'test/fixtures/trading-watchlist.html').replaceAll('\\','/')}`);await until('window.ready');
  await js('window.newsCalls=[];window.codexDesktop.getMarketNews=async p=>{newsCalls.push(p);return newsQaApi.list(p)};workspace.newsController.setMode("news")');await ready();
  assert.equal(await selected(),'featured');assert.equal(await js('return document.querySelectorAll(".market-news-category").length'),7);
  await screenshot('01-featured-header.png');
  for(const category of NEWS_CATEGORIES){
    await click(`[data-category="${category}"]`);await ready();
    assert.equal(await selected(),category);
    assert.deepEqual(await ids(),fixtures.pages[category].latest.items.map(x=>x.id));
    await screenshot(`category-${category}.png`);
    if(fixtures.pages[category].older){await click('[data-news-action="more"]');await ready();assert.deepEqual(await ids(),[...fixtures.pages[category].latest.items,...fixtures.pages[category].older.items].map(x=>x.id));}
    await click('.market-news-header .market-news-date');await click(`[data-news-action="day"][data-day="${fixtures.day}"]`);await click('[data-news-action="confirm-date"]');await ready();
    assert.deepEqual(await ids(),fixtures.pages[category].history.items.map(x=>x.id));assert.equal(await js('return newsCalls.at(-1).category'),category);
    await click('[data-news-action="latest"]');await ready();assert.equal(await selected(),category);assert.equal(await js('return newsCalls.at(-1).day'),undefined);
  }
  report.checks.push('all seven categories: renderer → preload IPC → desktop API client → FastAPI → provider replay, with real feed IDs, dates, refresh and exclusive pagination');
  await js("qaSetLanguage('en')");await ready();
  for(const category of NEWS_CATEGORIES){
    await click(`[data-category="${category}"]`);await ready();
    assert.deepEqual(await ids(),fixtures.pages[category].english.items.map(x=>x.id));
    const firstId=(await ids())[0];
    const record=fixtures.raw.find(r=>r.params.lan==='en'&&!r.params.last_id&&!r.params.start_date&&r.value.list.some(row=>String(row.id)===firstId));
    const row=record.value.list.find(row=>String(row.id)===firstId);
    const prefix=(row.transContent||row.content).replace(/<[^>]+>/g,'').replace(/aicoin/gi,'Haolo').trim().slice(0,40);
    assert.ok((await js('return document.querySelector(".market-news-copy p").textContent')).startsWith(prefix));
  }
  await js("qaSetLanguage('zh-CN')");await ready();
  report.checks.push('all seven English feeds use the provider translations, including titleless posts');
  await click('[data-category="featured"]');await ready();
  await click('.market-news-date');await click(`[data-news-action="day"][data-day="${fixtures.day}"]`);await click('[data-news-action="confirm-date"]');await ready();
  await click('[data-category="whales"]');await ready();assert.equal(await js('return newsCalls.at(-1).day'),fixtures.day);assert.equal(await js('return newsCalls.at(-1).cursor'),undefined);
  report.checks.push('category switching preserves selected day and resets pagination');
  await click('[data-news-action="latest"]');await ready();
  await js(`window.originalNews=codexDesktop.getMarketNews;codexDesktop.getMarketNews=async p=>{const result=await originalNews(p);if(p.category==='fed')await new Promise(resolve=>window.releaseFed=resolve);return result;}`);
  await click('[data-category="fed"]');await until('!!window.releaseFed');await click('[data-category="trump"]');await ready();await js('releaseFed()');await sleep(80);
  assert.equal(await selected(),'trump');assert.deepEqual(await ids(),fixtures.pages.trump.latest.items.map(x=>x.id));
  await js('codexDesktop.getMarketNews=originalNews');report.checks.push('late responses cannot overwrite a newer category');
  for(const width of [1500,1134,850,700]){
    win.setSize(width,876);await sleep(100);await click('[data-category="featured"]');await ready();
    await js('document.querySelector("[data-market-news]").scrollTop=0');const before=await positions();
    await js('document.querySelector("[data-market-news]").scrollTop=700');await sleep(50);assert.deepEqual(await positions(),before);
    if(width===1134)await screenshot('02-sticky-scrolled.png');
    await click('.market-news-header .market-news-date');assert.ok(await js('const r=document.querySelector(".market-news-calendar").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight'));await click('[data-news-action="cancel-date"]');
    await js(`codexDesktop.getMarketNews=p=>new Promise(resolve=>{window.releaseEmpty=()=>resolve({items:[],nextCursor:null,status:'ready',fetchedAt:Date.now(),category:p.category})});`);
    await click('[data-news-action="latest"]');assert.deepEqual(await positions(),before);
    await js('releaseEmpty()');await ready();assert.deepEqual(await positions(),before);assert.match(await js('return document.querySelector(".market-news-bottom").textContent'),/暂无快讯/);
    if(width===1134)await screenshot('03-empty-header.png');
    assert.ok(await js('const p=document.querySelector("[data-market-news]");return p.scrollWidth<=p.clientWidth'));
    await js('codexDesktop.getMarketNews=originalNews');await click('[data-news-action="latest"]');await ready();
  }
  report.checks.push('header, date, refresh and page switch stay fixed on scroll/loading/empty at four window widths; calendar remains visible');
  for(const locale of ['zh-CN','zh-TW','en','ko'])for(const theme of ['light','dark'])for(const width of [1134,700]){
    win.setSize(width,876);await js(`qaSetLanguage('${locale}');document.documentElement.dataset.theme='${theme}';document.querySelector('[data-market-news]').scrollTop=0`);await ready();await sleep(80);
    assert.equal(await js('return document.querySelectorAll(".market-news-category").length'),7);
    assert.ok(await js('const p=document.querySelector("[data-market-news]");return p.scrollWidth<=p.clientWidth'));
    await screenshot(`header-${locale}-${theme}-${width}.png`);
    await js('document.querySelector("[data-category=trump]").focus()');
    assert.equal(await js('return document.activeElement.dataset.category'),'trump');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});
    win.webContents.sendInputEvent({type:'char',keyCode:'\r'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});
    await until('workspace.newsController.category==="trump"&&!workspace.newsController.loading');assert.equal(await selected(),'trump');
    await click('[data-category="featured"]');await ready();
  }
  report.checks.push('four locales, two themes, standard/narrow widths and keyboard activation');
  await js("qaSetLanguage('zh-CN');codexDesktop.getMarketNews=async p=>({...await originalNews(p),category:undefined})");await ready();await click('[data-category="fed"]');await ready();
  assert.deepEqual(await ids(),[]);assert.ok(await js('return !!document.querySelector(".market-news-notice")'));await js('codexDesktop.getMarketNews=originalNews');await click('[data-news-action="retry"]');await ready();assert.deepEqual(await ids(),fixtures.pages.fed.latest.items.map(x=>x.id));
  report.checks.push('older APIs cannot masquerade as category results; retry recovers current category');
  report.apiRequests=await(await fetch(apiBase+'/qa/requests')).json();
  assert.deepEqual(report.errors,[]);await js('workspace.destroy()');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await writeFile(path.join(output,'categories-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error}));ipcMain.removeHandler('news-qa:list');win?.destroy();await server?.close();app.exit(process.exitCode||0);}}
void main();
