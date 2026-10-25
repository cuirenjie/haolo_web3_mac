import { app, BrowserWindow } from "electron/main";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.HAOLO_WATCHLIST_ICONS_QA_OUTPUT || path.join(root, ".tmp", "trading-watchlist-icons-qa");
app.setPath("userData", path.join(output, "profile"));
app.disableHardwareAcceleration();
const report = { checks: [], failures: [], screenshots: [] };
const requests = new Map();
const held = [];
let server, window;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#627eea"/><path d="m16 5 7 11-7 11-7-11z" fill="white"/></svg>';
async function main() {
  await mkdir(output, { recursive: true });
  try {
    server = await createServer({
      configFile: false, root: path.join(root, "src", "renderer"),
      server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root] } },
      plugins: [{ name: "controlled-logo-responses", configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (!request.url.startsWith("/__logo/")) return next();
          const [, , stage, encodedAsset] = request.url.split("/");
          const asset = decodeURIComponent(encodedAsset);
          const send = () => {
            response.setHeader("Cache-Control", "no-store");
            if (asset === "QAFAIL" || (asset === "龙虾" && stage === "binance")) {
              response.writeHead(404); response.end();
            } else {
              response.setHeader("Content-Type", "image/svg+xml"); response.end(svg);
            }
          };
          if (asset === "QASLOW") held.push(send);
          else setTimeout(send, 20);
        });
      } }], clearScreen: false,
    });
    await server.listen();
    await app.whenReady();
    window = new BrowserWindow({ show: false, width: 1440, height: 900,
      webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true } });
    window.webContents.session.webRequest.onBeforeRequest({ urls: [
      "https://bin.bnbstatic.com/static/assets/logos/*", "https://app.hyperliquid.xyz/coins/*",
    ] }, (details, callback) => {
      const url = new URL(details.url);
      const stage = url.hostname === "bin.bnbstatic.com" ? "binance" : "hyperliquid";
      const asset = decodeURIComponent(url.pathname.split("/").at(-1)).replace(/\.(png|svg)$/, "");
      const key = `${stage}:${asset}`;
      requests.set(key, (requests.get(key) || 0) + 1);
      callback({ redirectURL: `${server.resolvedUrls.local[0]}__logo/${stage}/${encodeURIComponent(asset)}` });
    });
    const js = source => window.webContents.executeJavaScript(source, true);
    const wait = async expression => {
      for (let i = 0; i < 100; i++) {
        if (await js(expression)) return;
        const error = await js("window.qaError || ''");
        if (error) throw Error(error);
        await pause(50);
      }
      throw Error(`Timed out: ${expression}`);
    };
    const check = async (name, action) => {
      try { await action(); report.checks.push(name); }
      catch (error) { report.failures.push(`${name}: ${error.message}`); }
    };
    const fixture = `${server.resolvedUrls.local[0]}@fs/${path.join(root, "test/fixtures/trading-watchlist.html").replaceAll("\\", "/")}`;
    await window.loadURL(fixture);
    await wait("window.ready === true");
    await js(`(() => {
      window.qaIcons = ['ETH', '龙虾', 'SNDK', 'SKHYNIX', 'CL', 'QAFAIL', 'QASLOW'].map((asset, i) => ({
        ...qaMarkets[0], id:'BINANCE:FUTURES:'+asset+'USDT', symbol:asset+'USDT', baseAsset:asset,
        displaySymbol:asset+'/USDT', assetClass:asset==='CL'?'commodity':['SNDK','SKHYNIX'].includes(asset)?'stock':'crypto',
        markPrice:100+i, changePercent:1, quoteAvailable:true,
      }));
      workspace.markets=qaIcons;
      workspace.watchlist.selectGroup('watchlist');
      workspace.watchlist.groups[0].markets=qaIcons.map(m=>({...m,assetClass:'crypto'}));
      workspace.watchlistMarketsById=new Map(qaIcons.map(m=>[m.id,{...m,assetClass:'crypto',markPrice:999}]));
      workspace.favoriteTickerMarketsById=new Map();
      workspace.watchlistPanel.refresh();
      window.qaLogo=asset=>document.querySelector('[data-watchlist-row="BINANCE:FUTURES:'+asset+'USDT"] [data-market-logo-shell]');
      window.qaImage=asset=>qaLogo(asset)?.querySelector('img');
    })()`);
    await check("Catalog identity survives stale quote metadata while the live price is retained", async () => {
      assert.deepEqual(await js("['SNDK','SKHYNIX','CL'].map(asset=>{const market=workspace.resolveWatchlistMarket(qaIcons.find(m=>m.baseAsset===asset));return [market.assetClass,market.markPrice]})"), [["stock",999],["stock",999],["commodity",999]]);
      await wait("['SNDK','SKHYNIX','CL'].every(asset=>qaImage(asset)?.naturalWidth>0&&qaLogo(asset).dataset.marketLogoState==='loaded')");
      assert.equal(await js("['SNDK','SKHYNIX','CL'].every(asset=>qaImage(asset).dataset.marketLogoStage==='bundled')"), true);
    });
    await check("A delayed image never covers the visible fallback with a blank circle", async () => {
      assert.equal(await js("(()=>{const image=qaImage('QASLOW'),style=getComputedStyle(image),fallback=qaLogo('QASLOW').querySelector('[data-market-logo-fallback]');return !!fallback.textContent.trim()&&(image.hidden||style.visibility==='hidden'||style.opacity==='0'||style.display==='none')})()"), true);
    });
    await wait("qaImage('ETH').complete && qaImage('ETH').naturalWidth>0 && qaImage('龙虾').dataset.marketLogoStage==='hyperliquid' && qaImage('龙虾').naturalWidth>0 && qaImage('QAFAIL').hidden");
    await js("window.qaOriginalLogos=new Map(qaIcons.map(m=>[m.baseAsset,qaLogo(m.baseAsset)]))");
    const before = Object.fromEntries(requests);
    await check("Repeated refreshes retain loaded images, alternate-source success and failed-source fallback", async () => {
      for (let i=0; i<20; i++) { await js("workspace.watchlistPanel.refresh()"); await pause(20); }
      assert.equal(await js("qaIcons.every(m=>qaOriginalLogos.get(m.baseAsset)===qaLogo(m.baseAsset))"), true);
      assert.equal(requests.get("binance:龙虾"), before["binance:龙虾"]);
      assert.equal(requests.get("binance:QAFAIL"), before["binance:QAFAIL"]);
      assert.equal(requests.get("hyperliquid:QAFAIL"), before["hyperliquid:QAFAIL"]);
    });
    await check("Replacing the conversation panel retains the same logo nodes and load state", async () => {
      await js("document.querySelector('.trading-expert-panel').outerHTML=qaPanelMarkup();workspace.syncWatchlistHost()");
      assert.equal(await js("qaIcons.every(m=>qaOriginalLogos.get(m.baseAsset)===qaLogo(m.baseAsset))"), true);
    });
    await check("Sorting, group changes and live quote paints keep icons attached to the right asset", async () => {
      await js("document.querySelector('[data-watchlist-action=sort-price]').click();workspace.watchlist.addGroup('图标组');workspace.watchlist.addMarkets(qaIcons.slice(0,5));workspace.watchlistPanel.refresh()");
      assert.equal(await js("qaIcons.slice(0,5).every(m=>qaOriginalLogos.get(m.baseAsset)===qaLogo(m.baseAsset))"), true);
      await js("workspace.watchlist.selectGroup('watchlist');workspace.watchlistPanel.refresh();for(let i=0;i<30;i++)workspace.watchlistPanel.paintQuotes()");
      assert.equal(await js("qaIcons.every(m=>qaOriginalLogos.get(m.baseAsset)===qaLogo(m.baseAsset))"), true);
    });
    held.splice(0).forEach(send => send());
    await wait("qaImage('QASLOW').complete && qaImage('QASLOW').naturalWidth>0");
    await check("A pending image completes after repeated panel refreshes and remains visible", async () => {
      assert.equal(await js("(()=>{const image=qaImage('QASLOW'),s=getComputedStyle(image);return !image.hidden&&s.visibility!=='hidden'&&s.opacity!=='0'&&qaOriginalLogos.get('QASLOW')===qaLogo('QASLOW')})()"), true);
    });
    for (const theme of ["light", "dark"]) {
      await js(`document.documentElement.dataset.theme='${theme}'`);
      await pause(100);
      const file = path.join(output, `icons-${theme}.png`);
      await writeFile(file, (await window.webContents.capturePage()).toPNG());
      report.screenshots.push(file);
      await check(`${theme}: 11px spacing and no overlapping or blank fallback content`, async () => {
        assert.equal(await js("[...document.querySelectorAll('.trading-watchlist-market')].every(m=>{const logo=m.querySelector('[data-market-logo-shell]'),text=m.querySelector('.trading-watchlist-pair');return Math.abs(text.getBoundingClientRect().left-logo.getBoundingClientRect().right-11)<0.1&&!!logo.textContent.trim()})"), true);
      });
    }
    await check("Clicking the icon still selects its market", async () => {
      const point = await js("(()=>{const r=qaLogo('ETH').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()");
      window.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
      window.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
      await pause(100);
      assert.equal(await js("workspace.selectedMarketId"), "BINANCE:FUTURES:ETHUSDT");
    });
    await check("Search results reuse decoded icons and remember failed/alternate sources", async () => {
      const failedBefore = requests.get('binance:QAFAIL');
      const alternateBefore = requests.get('binance:龙虾');
      await js("workspace.setPickerOpen(true);workspace.showFavoritesOnly=false;workspace.search.value='';workspace.renderMarkets()");
      await wait("workspace.marketList.querySelector('[data-market-id=\"BINANCE:FUTURES:ETHUSDT\"]') && workspace.marketList.querySelectorAll('[data-market-logo-shell]').length>=7");
      await js("window.qaSearchLogos=[...workspace.marketList.querySelectorAll('[data-market-logo-shell]')];window.qaSearchKeys=qaSearchLogos.map(n=>n.dataset.marketLogoKey)");
      for (let i=0;i<10;i++) { await js("workspace.renderMarkets()"); await pause(50); }
      assert.equal(await js("qaSearchLogos.every(n=>n.isConnected&&workspace.marketList.contains(n))"),true);
      assert.equal(requests.get('binance:QAFAIL'),failedBefore);
      assert.equal(requests.get('binance:龙虾'),alternateBefore);
      for (const theme of ['light','dark']) {
        await js(`document.documentElement.dataset.theme='${theme}'`);
        await pause(100);
        const file=path.join(output,`search-icons-${theme}.png`);
        await writeFile(file,(await window.webContents.capturePage()).toPNG());
        report.screenshots.push(file);
      }
      await js("workspace.setPickerOpen(false)");
    });
    await check("Main and split chart headers and split search preserve their icon nodes", async () => {
      await js("workspace.selectedMarketMeta=qaIcons.find(m=>m.baseAsset==='SNDK');workspace.updateSymbolUi();workspace.splitLayoutId='2-columns';workspace.applySplitLayout()");
      await wait("workspace.splitPanes.length===1");
      await js("window.qaSplit=workspace.splitPanes[0];qaSplit.market=qaIcons.find(m=>m.baseAsset==='SKHYNIX');qaSplit.updateToolbarState();qaSplit.updateMarkets(workspace.availableSplitPaneMarkets());qaSplit.setSymbolMenuOpen(true)");
      await wait("workspace.host.querySelector('.trading-market-symbol .official-tradfi-logo img')?.naturalWidth>0 && qaSplit.host.querySelector('[data-split-symbol-logo] .official-tradfi-logo img')?.naturalWidth>0");
      await pause(150);
      await js("window.qaMainLogo=workspace.host.querySelector('.trading-market-symbol [data-market-logo-shell]');window.qaSplitLogos=[...qaSplit.host.querySelectorAll('[data-market-logo-shell]')]");
      for (let i=0;i<10;i++) { await js("workspace.updateSymbolUi();qaSplit.updateToolbarState()"); await pause(30); }
      assert.equal(await js("qaMainLogo===workspace.host.querySelector('.trading-market-symbol [data-market-logo-shell]')"),true);
      assert.equal(await js("qaSplitLogos.every(n=>n.isConnected&&qaSplit.host.contains(n))"),true);
      await js("qaSplit.setSymbolMenuOpen(false);workspace.splitLayoutId='1';workspace.applySplitLayout()");
    });
    await check("Alert and recharge surfaces share stable fallback and automatically recover online", async () => {
      await js(`(async()=>{
        const {renderTradingMarketAssetLogo}=await import('/trading-expert-market-identity.ts');
        window.qaOther=document.createElement('section');document.body.append(qaOther);
        window.qaOtherMarkup=()=>['trading-alert-market-pair','recharge-payment-network-icon','recharge-payment-qr-logo'].map(className=>'<div class="'+className+'">'+renderTradingMarketAssetLogo('QAFAIL','binance')+'</div>').join('');
        qaOther.innerHTML=qaOtherMarkup();
      })()`);
      await js("window.qaOtherLogos=[...qaOther.querySelectorAll('[data-market-logo-shell]')]");
      const failedBefore=requests.get('binance:QAFAIL');
      for(let i=0;i<10;i++) { await js("qaOther.innerHTML=qaOtherMarkup()"); await pause(20); }
      assert.equal(await js("qaOtherLogos.every(n=>n.isConnected&&n.dataset.marketLogoState==='fallback'&&!!n.textContent.trim())"),true);
      assert.equal(requests.get('binance:QAFAIL'),failedBefore);
      await js("window.dispatchEvent(new Event('online'))");
      await pause(200);
      assert.ok(requests.get('binance:QAFAIL')>failedBefore);
      assert.equal(await js("qaOtherLogos.every(n=>n.isConnected&&n.dataset.marketLogoState==='fallback'&&!!n.textContent.trim())"),true);
      await js("qaOther.remove()");
    });
    await check("Every bundled original decodes offline, and same-ticker crypto cannot inherit a stock source", async () => {
      await js(`(async()=>{
        const {renderTradingMarketAssetLogo}=await import('/trading-expert-market-identity.ts');
        const {BINANCE_TRADFI_LOGOS}=await import('/trading-tradfi-logo-assets.ts');
        window.qaAll=document.createElement('section');qaAll.style.cssText='position:fixed;left:-10000px;top:0';document.body.append(qaAll);
        qaAll.innerHTML=Object.entries(BINANCE_TRADFI_LOGOS).map(([asset,logo])=>renderTradingMarketAssetLogo(asset,'binance',true,logo.kind==='equity'?'stock':logo.kind)).join('')+renderTradingMarketAssetLogo('MU','binance',true,'crypto');
      })()`);
      await wait("[...qaAll.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0)");
      assert.equal(await js("[...qaAll.querySelectorAll('.official-tradfi-logo img')].every(i=>i.dataset.marketLogoStage==='bundled')"), true);
      assert.match(await js("qaAll.querySelector('img[data-market-logo-asset=MU][data-market-logo-primary-stage=binance]').dataset.marketLogoSrc"), /static\/assets\/logos\/MU\.png/);
      await js("qaAll.remove()");
    });
    // Actual watchlist rows, using the same brands as the user's Binance reference.
    window.setSize(1440, 1100);
    await js(`(() => {
      const symbols=['MU','NVDA','SPCX','AAPL','TSLA','SNDK','META','AMD','MSFT','BE','KORU','SKHYNIX','XAU'];
      workspace.markets=symbols.map(asset=>({...qaMarkets[0],id:'BINANCE:FUTURES:'+asset+'USDT',symbol:asset+'USDT',baseAsset:asset,displaySymbol:asset+'/USDT',assetClass:asset==='XAU'?'commodity':asset==='KORU'?'etf':'stock',quoteAvailable:false}));
      workspace.watchlist.selectGroup('watchlist');workspace.watchlist.activeGroup.markets=workspace.markets;
      workspace.watchlistMarketsById=new Map();workspace.watchlistPanel.refresh();
    })()`);
    await wait("[...document.querySelectorAll('[data-watchlist-row] img')].every(i=>i.naturalWidth>0)");
    for (const theme of ['light','dark']) {
      await js(`document.documentElement.dataset.theme='${theme}'`);
      await pause(100);
      const bounds=await js("(()=>{const r=document.querySelector('[data-watchlist-host]').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()");
      const file=path.join(output,`tradfi-reference-${theme}.png`);
      await writeFile(file,(await window.webContents.capturePage(bounds)).toPNG());
      report.screenshots.push(file);
    }
    assert.equal(await js("window.qaError || ''"), "");
  } catch (error) {
    report.failures.push(error.stack || String(error));
  } finally {
    report.status = report.failures.length ? "failed" : "passed";
    report.requests = Object.fromEntries(requests);
    await writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));
    process.stdout.write(JSON.stringify(report,null,2)+"\n");
    window?.destroy();
    held.splice(0).forEach(send=>send());
    await Promise.race([server?.close(),pause(1000)]);
    app.exit(report.failures.length ? 1 : 0);
  }
}
void main().catch(error=>{process.stderr.write(String(error));app.exit(1)});
