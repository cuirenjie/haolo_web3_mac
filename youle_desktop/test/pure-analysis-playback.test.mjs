import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import {TradingAiDrawingPlaybackController} from '../src/renderer/trading-expert-ai-playback.ts';

const drawing={id:'a',tool:'path',points:[{time:1,price:10},{time:2,price:20}],locked:true};
async function clocked(run, reducedMotion = false) {
  const previous=globalThis.window,queue=[];let time=0;
  globalThis.window={matchMedia:()=>({matches:reducedMotion}),setTimeout:(fn,ms)=>queue.push(()=>{time+=ms;fn();}),requestAnimationFrame:fn=>queue.push(()=>fn(time+=16))};
  try {
    let done=false,error;const promise=run().then(()=>done=true,e=>{error=e;done=true;});
    for(let step=0;!done&&step<2000;step++){queue.shift()?.();await Promise.resolve();}
    assert.equal(done,true,'playback must settle');await promise;if(error)throw error;return time;
  }finally{globalThis.window=previous;}
}

test('reduced motion paints observable separate objects without moving or flashing the cursor',async()=>{
  const commits=[],drafts=[],cursors=[];
  await clocked(async()=>{
    const playback=new TradingAiDrawingPlaybackController({setDraft:d=>drafts.push(d),commit:d=>commits.push(d.id),setCursor:p=>cursors.push(p)});
    const playing=playback.play([drawing,{...drawing,id:'b'}],{speedMultiplier:100});
    await Promise.resolve();await Promise.resolve();
    assert.deepEqual(commits,[],'microtasks cannot skip the visible frame boundary');
    await playing;
  },true);
  assert.deepEqual(commits,['a','b']);
  assert.deepEqual(drafts.filter(Boolean).map(d=>d.id),['a','b']);
  assert.ok(cursors.every(p=>p===null));
});

test('reduced motion cancellation does not commit the pending object or the rest of the batch',async()=>{
  let active=true;const commits=[];
  await clocked(async()=>{
    const playback=new TradingAiDrawingPlaybackController({setDraft:d=>{if(d)active=false;},commit:d=>commits.push(d.id),setCursor:()=>{}});
    await playback.play([drawing,{...drawing,id:'b'}],{shouldContinue:()=>active});
  },true);
  assert.deepEqual(commits,[]);
});

test('normal playback still draws intermediate frames and commits every complete shape in order',async()=>{
  const frames=[],commits=[],phases=[];
  const elapsed=await clocked(async()=>{
    const playback=new TradingAiDrawingPlaybackController({setDraft:d=>{if(d)frames.push(d);},commit:d=>commits.push(d.id),setCursor:()=>{}});
    await playback.play([drawing,{...drawing,id:'b'}],{onPhase:p=>phases.push(p)});
  });
  assert.deepEqual(commits,['a','b']);assert.ok(frames.length>20);assert.ok(frames.some(d=>d.points.at(-1).price>10&&d.points.at(-1).price<20));
  assert.equal(phases.at(-1),'completed');assert.ok(elapsed>=1000,'the original drawing durations are retained');
});

test('pure analysis stop interrupts intermediate frames without committing the remaining complete patch',async()=>{
  let active=true;const drafts=[],commits=[],phases=[];
  await clocked(async()=>{
    const playback=new TradingAiDrawingPlaybackController({setDraft:d=>{drafts.push(d);if(d)active=false;},commit:d=>commits.push(d),setCursor:()=>{}});
    await playback.play([drawing,{...drawing,id:'b'}],{shouldContinue:()=>active,onPhase:p=>phases.push(p),speedMultiplier:1.3});
  });
  assert.deepEqual(commits,[]);assert.equal(drafts.at(-1),null);assert.equal(phases.at(-1),'cancelled');assert.equal(phases.includes('completed'),false);
});

test('30 percent faster playback retains incremental frames and final shapes without changing later default playback',async()=>{
  const frames=[],commits=[];
  const playback=new TradingAiDrawingPlaybackController({setDraft:d=>{if(d)frames.push(d);},commit:d=>commits.push(d),setCursor:()=>{}});
  const shapes=[drawing,{...drawing,id:'b'},{...drawing,id:'note',tool:'note',text:'风险与失效条件'}];
  const normal=await clocked(()=>playback.play(shapes));
  frames.length=0;commits.length=0;
  const faster=await clocked(()=>playback.play(shapes,{speedMultiplier:1.3}));
  assert.deepEqual(commits,shapes);
  assert.ok(frames.length>10&&frames.some(d=>d.points.at(-1).price>10&&d.points.at(-1).price<20));
  // Animation frames are quantized to 16 ms by the browser; include that margin.
  assert.ok(faster/normal>0.76&&faster/normal<0.82,`unexpected duration ratio ${faster/normal}`);
  assert.equal(await clocked(()=>playback.play(shapes)),normal,'the speed is per request, not retained on the controller');
});

const source=fs.readFileSync(new URL('../src/renderer/trading-expert-drawing.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('drawing.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let method;
function visit(node){if(ts.isMethodDeclaration(node)&&node.name.getText(ast)==='playAiDrawingPatch')method=node.getText(ast);ts.forEachChild(node,visit);}visit(ast);
const Subject=Function(ts.transpileModule(`class Subject {${method}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return Subject;')();

test('the production drawing gateway cannot reapply a full patch after pure playback is stopped',async()=>{
  for(const cancel of [false,true]) {
    let active=true;const saved=[];const subject=new Subject();
    Object.assign(subject,{storageSessionId:'thread',aiDrawingClearVersion:0,aiDrawingPlaybackVersion:0,aiDrawings:[],
      normalizeAiDrawingPatch:()=>[drawing],cancelAiPlayback:()=>{},getSymbol:()=> 'BTC',getInterval:()=> '60',
      aiPlayback:{play:async()=>{if(cancel)active=false;}},storeAiDrawingPatch:patch=>saved.push(patch),
      aiDrawingSets:{selectedDrawings:d=>d},redraw:()=>{}});
    const patch={marketId:'BTC',interval:'60'};await subject.playAiDrawingPatch(patch,{shouldContinue:()=>active});
    assert.equal(saved.length,cancel?0:1);assert.equal(subject.aiDrawingSetPlaying,false);
  }
});
