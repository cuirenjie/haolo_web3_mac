import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Execute the production renderer functions/expressions. Adapters replace only
// DOM/service effects; layout, route choice and storage identity stay real.
const source=fs.readFileSync(new URL('../src/renderer/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const node=name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
function execute(code,deps){
  const compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return Function(...Object.keys(deps),compiled)(...Object.values(deps));
}
function call(name,deps,...args){
  assert.ok(node(name),name);
  return execute(`${node(name).getText(ast)}\nreturn ${name}(...args);`,{...deps,args});
}
function layout(state,conversationStarted=false){
  const names=['tradingExpertLayout','haoBaoLayout','marketLayout','workspaceHasConversationList','isChatLeftCollapsed'];
  const declarations=node('render').body.statements.filter(ts.isVariableStatement).flatMap(n=>n.declarationList.declarations);
  const code=names.map(name=>{
    const declaration=declarations.find(n=>n.name.getText(ast)===name);
    assert.ok(declaration,name);return `const ${declaration.getText(ast)};`;
  }).join('\n');
  return execute(`${code}\nreturn {${names.join(',')}};`,{state,thread:{id:'chart'},haoBaoUi:{conversationStarted},isTradingExpertSurfaceThreadId:()=>true});
}
const sidebarViews=['chat','haobao','account','plans','autoTasks','alerts','skillsPlaza'];
for(const view of [...sidebarViews,'contacts','results','materials','recharge','consumption'])test(`sidebar and collapse behavior: ${view}`,()=>{
  for(const collapsed of [false,true]){
    const state={activeView:view,leftCollapsed:collapsed,externalChannels:{menuOpen:true}};
    const value=layout(state);
    assert.equal(value.workspaceHasConversationList,sidebarViews.includes(view));
    assert.equal(value.isChatLeftCollapsed,sidebarViews.includes(view)&&collapsed);
    let renders=0;
    call('toggleLeftPanelCollapsed',{state,render:()=>renders++});
    assert.equal(state.leftCollapsed,sidebarViews.includes(view)?!collapsed:collapsed);
    assert.equal(renders,sidebarViews.includes(view)?1:0);
  }
});
test('market layout includes started HaoBao sessions, preserves ordinary chat and excludes account pages',()=>{
  assert.equal(layout({activeView:'haobao'},false).marketLayout,false);
  assert.equal(layout({activeView:'haobao'},true).marketLayout,true);
  assert.equal(layout({activeView:'chat'}).marketLayout,true);
  assert.equal(layout({activeView:'chat',chatPreview:{}}).marketLayout,false);
  for(const view of ['account','plans','skillsPlaza'])assert.equal(layout({activeView:view},true).marketLayout,false);
});
test('actual sidebar markup preserves current order and selection without restoring a retired entry',()=>{
  for(const activeView of sidebarViews){
    const html=call('renderConversationListActions',{state:{activeView,currentThreadId:'new'},nativeSupportController:null,
      isBlankNewThread:()=>true,renderConversationListIcon:id=>`<svg data-icon="${id}"></svg>`,
      haoBaoUi:{sidebarIcon:()=>'<svg data-icon="haobao"></svg>',name:'Cloud'},escapeHtml:x=>x});
    const buttons=[...html.matchAll(/<button\b[^>]*>/g)].map(m=>m[0]);
    assert.deepEqual(buttons.map(b=>/data-(?:conversation-static-action|action)="([^"]+)"/.exec(b)?.[1]),['new-chat','haobao','account','plans']);
    const selected=buttons.filter(b=>b.includes('aria-current="page"'));
    assert.equal(selected.length,['chat','haobao','account','plans','alerts'].includes(activeView)?1:0);
    if(selected.length)assert.ok(selected[0].includes(`="${activeView==='chat'?'new-chat':activeView==='alerts'?'plans':activeView}"`));
  }
});
test('composer gallery opens the requested tab once across pointer and click',()=>{
  for(const tab of ['mySkills','indicators']){
    const state={composerSkillMention:{open:true}},handlers={},opened=[];
    const button={hasAttribute:()=>tab==='indicators',addEventListener:(type,handler)=>handlers[type]=handler};
    call('bindComposerSkillMentionItemEvents',{state,positionComposerThreadReferenceDetail:()=>{},
      dismissComposerSkillMentionPopover:()=>{state.composerSkillMention.open=false;},openMyConfigPage:t=>opened.push(t)},
      {querySelectorAll:s=>s.startsWith('[data-open-strategy-plaza]')?[button]:[],querySelector:()=>null});
    const event={preventDefault(){},stopPropagation(){}};
    handlers.pointerdown(event);handlers.click(event);
    assert.deepEqual(opened,[tab]);
  }
});
test('opening either gallery retains the requested tab and refreshes the existing page',()=>{
  for(const tab of ['mySkills','indicators']){
    const state={activeView:'chat',contactChat:{open:true},externalChannels:{menuOpen:true},marketplace:{}},calls=[];
    call('openMyConfigPage',{state,rememberCurrentChatThreadSelection:()=>calls.push('remember'),render:()=>calls.push('render'),
      refreshSkills:options=>calls.push(options),loadMyMarketplaceSkills:()=>calls.push('load')},tab);
    assert.equal(state.activeView,'skillsPlaza');assert.equal(state.skillsPlazaTab,tab);
    assert.deepEqual(calls,['remember','render',{forceReload:true,reason:'my-config',renderAfter:false},'load']);
  }
});
for(const [hao,chart,thread,expected] of [['hao-owner','other-chart','thread','hao-owner'],[null,'chart-store','thread','chart-store'],[null,null,'thread','thread']])
test(`chart preservation keeps its original storage owner: ${expected}`,()=>{
  const moved=[],host={parentElement:{},closest:()=>hao?{dataset:{haobaoMarketPanel:hao}}:null};
  const result=call('preserveTradingExpertMarketWorkspace',{root:{querySelector:()=>host},lastRenderedThreadId:thread,state:{currentThreadId:'different'},
    parkedTradingExpertMarketWorkspace:null,isTradingExpertSurfaceThreadId:()=>true,tradingExpertMarketWorkspaceStorageSessionId:()=>chart,
    captureTradingWorkspaceDialogs:()=>['dialog'],captureTradingWorkspaceFocus:()=>['focus'],document:{body:'body'},moveTradingWorkspaceHost:(...args)=>moved.push(args)});
  assert.equal(result.storageSessionId,expected);assert.equal(result.threadId,hao||thread);
  assert.deepEqual(moved,[[host,'body']]);assert.deepEqual(result.dialogs,['dialog']);assert.deepEqual(result.focus,['focus']);
});
