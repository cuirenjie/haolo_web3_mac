// Real Electron/SVG rendering with isolated profile and fixture candles only.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const output = path.join(root, '.cache/ai-playback-motion-M1-446', baseline ? 'baseline' : 'fixed');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, `profile-${Date.now()}`));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { baseline, checks: [], scenarios: [], screenshots: [] };
let win, server;
const check = (name, ok) => report.checks.push({ name, ok: Boolean(ok) });
(async () => {
  const timeout = setTimeout(() => { console.error('QA exceeded 180 seconds'); app.exit(1); }, 180000); timeout.unref();
  await app.whenReady();
  const { createServer } = await import('vite');
  const original = baseline ? execFileSync('git', ['show', 'HEAD:youle_desktop/src/renderer/trading-expert-ai-playback.ts'], { cwd: path.dirname(root), encoding: 'utf8' }) : null;
  server = await createServer({ configFile: path.join(root, 'vite.config.mjs'),
    plugins: original ? [{ name: 'baseline-playback', enforce: 'pre', transform(code, id) {
      return id.replaceAll('\\', '/').endsWith('/trading-expert-ai-playback.ts') ? original : null;
    } }] : [],
    server: { port: 5216, strictPort: true, hmr: false, fs: { allow: [root] } },
  });
  await server.listen();
  win = new BrowserWindow({ show: false, width: 1400, height: 920, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`, true);
  await win.loadURL(`http://127.0.0.1:5216/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  for (let i = 0; i < 150 && !await js('return Boolean(window.ready)'); i++) await pause(100);
  assert.equal(await js('return Boolean(window.ready)'), true, await js('return String(window.qaError)'));
  console.log('Fixture chart ready');
  win.webContents.debugger.attach('1.3');
  await js(`
    window.d=workspace.drawingController;workspace.loadingHistory=true;
    document.querySelector('#host').style.cssText='width:100%;height:100%';
    window.nativeRaf=window.requestAnimationFrame.bind(window);
    window.makePatch=controller=>{
      const candles=controller.getCandles(),symbol=controller.getSymbol(),interval=controller.getInterval();
      const points=[-70,-45,-20].map((i,n)=>({time:candles.at(i).time,price:1310+n%2*25}));
      const shape=(id,tool,anchors,text)=>({op:'upsert',drawing:{id,tool,points:anchors,text,symbol,interval,
        theory:'chan',layer:'ai/chan',colorToken:tool==='note'?'chan-note':'chan-pen',locked:true,status:'confirmed',evidenceIds:[]}});
      return {schemaVersion:1,analysisId:'qa-motion',baseRevision:0,marketId:symbol,interval,operations:[
        shape('path','path',points),shape('box','rectangle',points.slice(0,2)),shape('ellipse','ellipse',points.slice(0,2)),
        shape('circle','circle',points.slice(0,2)),shape('mark','text',[points[1]],'•'),shape('text','text',[points[2]],'Support'),
        shape('note','note',[points[0]],'支撑 / Support')
      ]};
    };
    window.runMotion=async(controller,paneIndex,slow,speed)=>{
      controller.clearAllDrawings();
      controller.drawings=[{id:'manual-kept',tool:'trend-line',symbol:controller.getSymbol(),points:[
        {time:controller.getCandles().at(-9).time,price:1300},{time:controller.getCandles().at(-3).time,price:1300}]}];
      controller.persistDrawings();const manual=JSON.stringify(controller.drawings),undo=JSON.stringify(controller.redoStack);
      const patch=makePatch(controller),snapshot=JSON.stringify(patch),frames=[],commits=[];
      const originalDraft=controller.aiPlayback.options.setDraft;
      window.motionDone=false;window.motionCapture=false;window.motionError=null;
      let stalled=false;
      controller.aiPlayback.options.setDraft=(draft,opacity)=>{
        originalDraft(draft,opacity);
        if(!draft)return;
        const copy=JSON.parse(JSON.stringify(draft)),fade=opacity??1;
        // Observe the production SVG on the next display frame, before the next
        // animation callback mutates it. Stored geometry alone is insufficient.
        nativeRaf(()=>{
          const node=controller.aiContent.querySelector('[data-drawing-id="'+copy.id+'"]');
          if(!node)return;
          frames.push({id:copy.id,points:copy.points,text:copy.text,opacity:Number(node.parentElement.getAttribute('opacity')??1),
            svg:node.innerHTML,visible:node.getBoundingClientRect().width>0,cursor:controller.aiCursorContent.childElementCount});
        });
        if(copy.id==='path'&&copy.points.at(-1).time>patch.operations[0].drawing.points[0].time&&copy.points.at(-1).time<patch.operations[0].drawing.points[1].time){
          window.motionCapture=true;
          if(slow&&!stalled){stalled=true;const until=performance.now()+400;while(performance.now()<until){}}
        }
      };
      try{
        await workspace.acceptAnalysisDrawingPatch(patch,paneIndex,(phase,drawing)=>{if(phase==='committing')commits.push(performance.now());},()=>true,speed);
        await new Promise(r=>nativeRaf(r));
        const normalized=controller.normalizeAiDrawingPatch(patch).map(x=>controller.aiDrawingModel(x));
        const actual=controller.aiDrawings.filter(x=>x.symbol===patch.marketId&&x.interval===patch.interval);
        window.motionResult={frames,commits,stalled,patchUnchanged:JSON.stringify(patch)===snapshot,
          finalUnchanged:JSON.stringify(actual)===JSON.stringify(normalized),manualUnchanged:JSON.stringify(controller.drawings)===manual&&JSON.stringify(controller.redoStack)===undo,
          cursorCleared:controller.aiCursorContent.childElementCount===0,points:patch.operations[0].drawing.points};
      }catch(error){window.motionError=String(error.stack);}finally{controller.aiPlayback.options.setDraft=originalDraft;window.motionDone=true;}
    };
  `);
  for (const theme of ['light', 'dark']) {
    for (const reduced of [false, true]) {
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
      check(`${theme}/${reduced} emulated system preference`, await js(`return matchMedia('(prefers-reduced-motion: reduce)').matches===${reduced}`));
      await js(`document.documentElement.dataset.theme='${theme}';d.redraw();`);
      for (const slow of [false, true]) {
        const name = `${theme}-${reduced ? 'reduced' : 'normal'}-${slow ? 'stall' : 'smooth'}`;
        console.log('Starting '+name);
        await js(`void runMotion(d,0,${slow},${slow ? 1.5 : 1});`);
        let captured=false;
        const deadline=Date.now()+25000;
        while (!await js('return motionDone')) {
          if(Date.now()>deadline)throw new Error('Playback timed out: '+name+' '+JSON.stringify(await js('return {error:motionError,qaError:window.qaError,visibility:document.visibilityState,capture:motionCapture,frames:d.aiDraft?.points}')));
          if(!captured && await js('return motionCapture')) {
            fs.writeFileSync(path.join(output, `${name}-partial.png`), (await win.webContents.capturePage()).toPNG());
            report.screenshots.push(`${name}-partial.png`);captured=true;
          }
          await pause(20);
        }
        assert.equal(await js('return motionError'), null);
        const result = await js('return motionResult');
        console.log('Completed '+name+': '+result.frames.length+' frames');
        report.scenarios.push({ name, ...result });
        for(const id of ['path','box','ellipse','circle']) {
          const rows=result.frames.filter(frame=>frame.id===id&&frame.visible&&frame.points.length===2
            &&frame.points[1].time>result.points[0].time&&frame.points[1].time<result.points[1].time);
          check(`${name}/${id} intermediate painted SVG`, new Set(rows.map(row=>row.svg)).size>=4);
        }
        for(const id of ['mark','text'])check(`${name}/${id} actual SVG fade`, result.frames.filter(frame=>frame.id===id&&frame.opacity>0&&frame.opacity<1).length>=4);
        if(reduced)check(`${name} no cursor movement or pulses`,result.frames.every(frame=>frame.cursor===0));
        check(`${name} final accepted geometry and manual undo preserved`,result.patchUnchanged&&result.finalUnchanged&&result.manualUnchanged&&result.cursorCleared);
        check(`${name} seven ordered object commits`,result.commits.length===7&&result.commits.every((time,i)=>!i||time>result.commits[i-1]));
        if(slow)check(`${name} real 400ms main-thread stall exercised`,result.stalled);
        fs.writeFileSync(path.join(output, `${name}-complete.png`), (await win.webContents.capturePage()).toPNG());
      }
    }
  }
  await js(`workspace.splitLayoutId='2-columns';workspace.applySplitLayout();`);
  for(let i=0;i<100&&!await js('return Boolean(workspace.splitPanes[0]?.candles.length)');i++)await pause(50);
  await js(`window.sd=workspace.splitPanes[0].getDrawingController();void runMotion(sd,1,false,1.5);`);
  while(!await js('return motionDone'))await pause(50);
  assert.equal(await js('return motionError'),null);
  const split=await js('return motionResult');report.scenarios.push({name:'split-reduced',...split});
  check('split pane uses progressive geometry',new Set(split.frames.filter(frame=>frame.id==='path').map(frame=>frame.svg)).size>=5);
  check('split pane final geometry/manual layer preserved',split.finalUnchanged&&split.manualUnchanged);
  check('no renderer errors', !await js('return window.qaError'));
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  const failures=report.checks.filter(check=>!check.ok);
  console.log(JSON.stringify({baseline,checks:report.checks.length,failed:failures.length,failures,output},null,2));
  await server.close();win.destroy();app.exit(failures.length?1:0);
})().catch(async error=>{console.error(error);if(server)await server.close();app.exit(1);});
