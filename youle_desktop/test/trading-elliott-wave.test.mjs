import assert from 'node:assert/strict';
import test from 'node:test';
import { renderElliottWave, elliottWaveLabels } from '../src/renderer/trading-elliott-wave.ts';
import { tradingDrawingToolDefinition, tradingDrawingRequiredPointCount, tradingDrawingAdvanceDraftPoints } from '../src/renderer/trading-expert-drawing.ts';

const tools = ['elliott-impulse', 'elliott-correction', 'elliott-triangle', 'elliott-double-combo', 'elliott-triple-combo'];
const points = [{x:100,y:600},{x:230,y:400},{x:350,y:480},{x:400,y:180},{x:530,y:280},{x:630,y:100}];
const model = tool => ({id:tool,tool,symbol:'ETHUSDT',points:points.slice(0,elliottWaveLabels(tool).length).map((p,i)=>({time:1700000000+i*86400,price:3000-p.y}))});
const renderedLabels = svg => [...svg.matchAll(/data-elliott-label="(\d+)"[^>]*y="([\d.-]+)"[^>]*>(.*?)<\/text>/g)].map(m=>({index:Number(m[1]),y:Number(m[2]),text:m[3]}));

for (const tool of tools) {
  test(`${tool}: clicks confirm only real anchors and complete at the required count`, () => {
    const m=model(tool),count=m.points.length;
    assert.equal(tradingDrawingRequiredPointCount(tradingDrawingToolDefinition(tool)),count);
    let progress={points:[m.points[0],m.points[0]],confirmedPointCount:1};
    for(let i=1;i<count;i++) {
      const preview=renderElliottWave({...m,points:[...m.points.slice(0,i),m.points[i]]},points.slice(0,i+1),{draft:true,selected:false,confirmedPointCount:i});
      assert.equal(renderedLabels(preview.body).length,i);
      assert.doesNotMatch(preview.body, /<circle|<polygon|NaN|Infinity/);
      progress=tradingDrawingAdvanceDraftPoints(progress.points,progress.confirmedPointCount,count,m.points[i]);
      assert.equal(progress.complete,i===count-1);
      assert.deepEqual(progress.points.slice(0,i+1),m.points.slice(0,i+1));
    }
    assert.deepEqual(progress.points,m.points);
  });
  test(`${tool}: selected labels, default color, deselection and inverted swings match reference`, () => {
    const m=model(tool),p=points.slice(0,m.points.length);
    const state={draft:false,selected:true,confirmedPointCount:p.length};
    const out=renderElliottWave(m,p,state),names=elliottWaveLabels(tool);
    assert.deepEqual(renderedLabels(out.body).map(l=>l.text),names.map(n=>`(${n})`));
    const color=tool==='elliott-triangle'?'#ff9800':tool.includes('combo')?'#6aa84f':'#3d85c6';
    assert.ok(out.body.includes(`stroke="${color}" stroke-width="2"`));
    assert.ok(out.body.includes('font-size="20" font-weight="400"'));
    for(const invert of [false,true]) {
      const projected=p.map(v=>({...v,y:invert?700-v.y:v.y}));
      const labels=renderedLabels(renderElliottWave(m,projected,state).body);
      for(const label of labels) assert.equal(label.y>projected[label.index].y,invert?label.index%2===1:label.index%2===0);
    }
    const deselected=renderElliottWave(m,p,{...state,selected:false});
    assert.deepEqual(renderedLabels(deselected.body).map(l=>l.text),names.slice(1).map(n=>`(${n})`));
    assert.doesNotMatch(out.body, /<circle|fill-opacity/);
    assert.equal((out.hit.match(/data-elliott-label-hit=/g)??[]).length,names.length);
    if(tool==='elliott-triple-combo') {
      assert.match(out.body,/data-elliott-label="2"[^>]*>\(X\)/);
      assert.match(out.body,/data-elliott-label="4"[^>]*>\(X\)/);
    }
  });
}

test('wave renderer preserves arbitrary manual counts and styles without theory validation',()=>{
  const m={...model('elliott-impulse'),color:'#e91e63',textColor:'#00ff00',fontSize:24,lineWidth:4,lineStyle:'dotted',bold:true,italic:true};
  const crossed=[...points].reverse();
  const out=renderElliottWave(m,crossed,{draft:false,selected:true,confirmedPointCount:6});
  assert.equal(renderedLabels(out.body).length,6);
  assert.match(out.body,/stroke-width="4" stroke-dasharray="2 4"/);
  assert.match(out.body,/fill="#00ff00".*font-size="24" font-weight="700" font-style="italic"/);
  const zero=renderElliottWave(m,points.map(()=>({x:20,y:20})),{draft:true,selected:false,confirmedPointCount:3});
  assert.equal(renderedLabels(zero.body).length,3);
  assert.doesNotMatch(zero.body+zero.hit,/NaN|Infinity/);
});
