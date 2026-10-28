import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {incompleteNoticeItem} from '../src/shared/model-incomplete.mjs';

const source=fs.readFileSync(new URL('../src/renderer/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const bind=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='bindMessageContentEvents');
let handler;
const visit=n=>{
  if(ts.isCallExpression(n)&&n.expression.getText(ast).endsWith('.addEventListener')&&n.arguments[0]?.getText(ast)==='"click"'&&n.arguments[1]?.getText(ast).includes('kind === "continue-incomplete"'))handler=n.arguments[1];
  ts.forEachChild(n,visit);
};
visit(bind);assert.ok(handler);
const compiled=ts.transpileModule('globalThis.click = '+handler.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

for(const mode of ['ready','draft','busy','different-thread','filtered','ordinary-item']){
  test(`manual continuation action: ${mode}`,()=>{
    const notice=incompleteNoticeItem('thread','turn',mode==='filtered'?'content_filter':'max_output_tokens','en');
    if(mode==='ordinary-item')delete notice.__youleIncompleteNotice;
    const state={items:{thread:{notice}},composerText:mode==='draft'?'existing draft':''};
    let saves=0,renders=0;
    const context={state,button:{dataset:{messageActionKind:'continue-incomplete',messageActionConversation:'thread'},closest:()=>({dataset:{messageId:'notice'}})},
      currentComposerThreadId:()=>mode==='different-thread'?'other':'thread',isThreadBusy:()=>mode==='busy',messageActionsFromItem:item=>item.actions,
      rememberActiveComposerDraft:()=>saves++,render:()=>renders++,api:new Proxy({},{get(){throw Error('continuation must not send a request');}})};
    vm.runInNewContext(compiled,context);context.click({preventDefault(){},stopPropagation(){}});
    if(mode==='ready'){
      assert.equal(state.composerText,notice.actions[0].text);assert.equal(saves,1);assert.equal(renders,1);
      context.click({preventDefault(){},stopPropagation(){}});assert.equal(saves,1);
    }else{
      assert.equal(state.composerText,mode==='draft'?'existing draft':'');assert.equal(saves,0);assert.equal(renders,0);
    }
  });
}
