import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCustomTheme, encodeCustomTheme, mapSurfaceColor, mapSurfacePaint } from '../src/renderer/custom-theme.ts';
import { SettingsReplica } from '../src/renderer/account-settings-sync.ts';

test('atomic custom themes reject white, malformed colors and invalid opacity', () => {
  for (const v of ['custom:#ffffff:50','custom:#FFFFFF:100','custom:#12349e:101','custom:#12349e:-1','custom:#12349e:1.5','custom:#123:50',null]) assert.equal(decodeCustomTheme(v), null);
  for (const opacity of [0,1,50,100]) assert.deepEqual(decodeCustomTheme(encodeCustomTheme({color:'#12349e',opacity})),{color:'#12349e',opacity});
});
test('surface density, alpha and gradient stops keep their original ratios', () => {
  const theme = { color:'#12349e', opacity:50 };
  assert.equal(mapSurfaceColor('#000000',theme),'rgba(18, 52, 158, 0.5)');
  assert.equal(mapSurfaceColor('#b3b3b3',theme),'rgba(184, 194, 226, 0.5)');
  assert.equal(mapSurfaceColor('#ffffff',theme),'#ffffff');
  assert.equal(mapSurfaceColor('rgba(0, 0, 0, 0.2)',theme),'rgba(18, 52, 158, 0.1)');
  assert.equal(mapSurfaceColor('#00000000',theme),'#00000000');
  assert.equal(mapSurfaceColor('rgb(0 0 0 / 20%)',theme),'rgba(18, 52, 158, 0.1)');
  assert.equal(mapSurfaceColor('rgb(100% 100% 100% / 50%)',theme),'rgb(100% 100% 100% / 50%)');
  assert.equal(mapSurfacePaint('linear-gradient(90deg, #000000 0%, #b3b3b3 100%)',theme),'linear-gradient(90deg, rgba(18, 52, 158, 0.5) 0%, rgba(184, 194, 226, 0.5) 100%)');
});
test('two replicas converge on a complete theme, never one device color with another opacity', () => {
  const desktop=new SettingsReplica(), mobile=new SettingsReplica();
  desktop.edit({}, {'app.theme':'custom:#12349e:40'});
  mobile.edit({}, {'app.theme':'custom:#a12345:70'});
  const ops=[...Object.values(desktop.pending),...Object.values(mobile.pending)];
  const winner=ops.sort((a,b)=>a.changedAt-b.changedAt || a.changeId.localeCompare(b.changeId)).at(-1);
  desktop.begin();desktop.acknowledge();mobile.begin();mobile.acknowledge();
  const receipt={schemaVersion:1,version:1,serverTime:Date.now(),entries:[winner]};
  desktop.merge(receipt);mobile.merge(receipt);
  assert.deepEqual(desktop.values(),mobile.values());assert.equal(desktop.values()['app.theme'],winner.value);
});

test('white regions and colored non-controls preserve their original alpha at every custom opacity',()=>{
 for(const opacity of [0,25,100]){const t={color:'#12349e',opacity};for(const white of ['#fff','#ffffffff','white','rgba(255, 255, 255, 0.4)']){assert.equal(mapSurfaceColor(white,t),white);assert.equal(mapSurfaceColor(white,t,true),white)}assert.equal(mapSurfaceColor('#ff9800',t),'#ff9800');assert.notEqual(mapSurfaceColor('#ff9800',t,true),'#ff9800');}
});
