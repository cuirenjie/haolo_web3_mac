import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createNewsWindows } from '../src/main/news-windows.mjs';

test('display changes keep all visible news on screen without dismissing queued articles', () => {
  let height=1040;const instances=[],dismissed=[];
  class Window extends EventEmitter {
    constructor(){super();this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};instances.push(this);}
    removeMenu(){} setAlwaysOnTop(){} setVisibleOnAllWorkspaces(){} showInactive(){}
    setPosition(x,y){this.position={x,y};} async loadURL(){}
    isDestroyed(){return !!this.destroyed;} close(){this.destroyed=true;this.emit('closed');}
  }
  const screen=new EventEmitter();screen.getPrimaryDisplay=()=>({workArea:{x:0,y:0,width:1280,height}});
  const controller=createNewsWindows({BrowserWindow:Window,screen,html:()=>'',theme:()=> 'light',language:()=> 'en',openExternal:async()=>{},dismiss:id=>dismissed.push(id)});
  controller.update([1,2,3].map(id=>({id,articleId:`00000000-0000-4000-8000-00000000000${id}`})));
  const active=()=>instances.filter(window=>!window.isDestroyed());
  assert.equal(active().length,3);
  height=500;screen.emit('display-removed');
  assert.equal(active().length,1);
  assert.ok(active().every(window=>window.position.y>=0&&window.position.y+236<=height));
  height=1040;screen.emit('display-metrics-changed');
  assert.equal(active().length,3);assert.deepEqual(dismissed,[]);
  controller.stop();
  for(const event of ['display-metrics-changed','display-added','display-removed'])assert.equal(screen.listenerCount(event),0);
});

test('news windows persist, isolate navigation, dismiss on click/close and preserve pending on shutdown', async () => {
  const instances = [], opened = [], dismissed = [];
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = handler => this.handler = handler; instances.push(this); }
    removeMenu() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setPosition() {}
    async loadURL(url) { this.url = url; } showInactive() { this.shown = true; }
    isDestroyed() { return !!this.destroyed; }
    close() { this.destroyed = true; this.emit('closed'); }
  }
  const screen = new EventEmitter(); screen.getPrimaryDisplay = () => ({ workArea: { x:0,y:0,width:1920,height:1040 } });
  const items = [1,2,3,4].map(n => ({ id:`event-${n}`,articleId:`00000000-0000-4000-8000-00000000000${n}`,title:'News',summary:'Summary' }));
  let pending = [...items], rendered;
  const controller = createNewsWindows({ BrowserWindow:Window,screen,html:value => { rendered=value; return '<p>News</p>'; },theme:()=> 'dark',language:()=> 'en',openExternal:async url=>opened.push(url),dismiss:id=>{dismissed.push(id); pending=pending.filter(item=>item.id!==id); controller.update(pending);} });
  controller.update(pending);
  assert.equal(instances.length,3); assert.equal(rendered.news,true); assert.equal(instances[0].options.webPreferences.nodeIntegration,false);
  instances[0].emit('ready-to-show'); assert.equal(instances[0].shown,true);
  const navigate = (window,url) => { let prevented=false; window.webContents.emit('will-navigate',{preventDefault(){prevented=true;}},url); assert.ok(prevented); };
  navigate(instances[0],'https://evil.invalid'); assert.deepEqual(opened,[]); assert.deepEqual(dismissed,[]);
  controller.update(pending); assert.equal(instances.length,3); assert.equal(instances[0].isDestroyed(),false);
  navigate(instances[0],'youle-notification://open'); await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(opened,['https://haolo.com/api/news/read/00000000-0000-4000-8000-000000000001?lang=en']);
  assert.deepEqual(dismissed,['event-1']); assert.equal(instances.length,4);
  navigate(instances[1],'youle-notification://close'); assert.deepEqual(dismissed,['event-1','event-2']);
  controller.stop(); assert.equal(screen.listenerCount('display-metrics-changed'),0);
  assert.deepEqual(pending.map(item=>item.id),['event-3','event-4']);
  assert.ok(instances.every(window=>window.isDestroyed()));
});
