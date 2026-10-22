import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import { businessPresentationItems } from '../src/shared/codex-business-presentation.mjs';
import { ExternalChannelRecoveryTurns } from '../src/renderer/external-channel-recovery.mjs';
import { externalTradingPlanCardMarkup } from '../src/renderer/external-trading-plan-images.ts';
import { saveExternalTradingPlanImage } from '../src/main/external-trading-plan-image.mjs';
import { WechatExternalChannelServer } from '../src/main/wechat-external-channel-server.mjs';
import { cloudAccountPlanCardFixture, legacyCloudPlanCardFixture } from './support/cloud-plan-card-fixture.mjs';

const source = await fs.readFile(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
function load(names, deps) {
  const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
  assert.equal(functions.length, names.length);
  const js = ts.transpileModule(functions.map(n => n.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(deps), js + `\nreturn {${names.join(',')}}`)(...Object.values(deps));
}

for (const channel of ['wechat', 'feishu', 'telegram']) test(`${channel}: attachment-only native charts accompany the plan and final reply, isolated by turn`, () => {
  const image = name => ({ name, mime: 'image/png', path: `C:/temp/${name}` });
  const native = (turn, items) => businessPresentationItems({ type: 'mcpToolCall', tool: 'haolo_chart_draw', turnId: turn,
    result: { content: [{ type: 'text', text: JSON.stringify({ presentationItems: items }) }] } });
  const [chart] = native('recovered', [{ id: 'chart', type: 'agentMessage', text: '', attachments: [image('kline.png')] }]);
  const [plan] = native('recovered', [{ id: 'plan', type: 'agentMessage', text: 'Verified plan', attachments: [image('plan.png')] }]);
  const items = [chart, plan,
    { id: 'final', type: 'agentMessage', text: 'Conclusion', phase: 'final_answer', turnId: 'request' },
    { ...chart, id: 'old', turnId: 'previous', attachments: [image('previous.png')] },
    { ...chart, id: 'future', turnId: 'next', attachments: [image('next.png')] },
    { ...chart, id: 'progress', phase: 'commentary', attachments: [image('progress.png')] },
    { ...chart, id: 'user', type: 'userMessage', turnId: 'request', attachments: [image('input.png')] },
  ];
  const recovery = new ExternalChannelRecoveryTurns(); recovery.link(channel, 'request', 'recovered');
  const deps = {
    state: { itemOrder: { [channel]: items.map(i => i.id) }, items: { [channel]: Object.fromEntries(items.map(i => [i.id, i])) } },
    firstString: (...values) => values.find(v => typeof v === 'string' && v),
    itemTurnId: i => i.turnId, itemText: i => i.text, assistantVisibleText: x => x, itemAttachments: i => i.attachments || [],
    externalChannelRecoveryTurns: recovery, wechatChannelFinalExternalReplySegment: x => x,
    wechatChannelFinalExternalReply: candidates => ({text: candidates.map(c => c.text).filter(Boolean).join('\n'), itemIds: new Set(candidates.filter(c => c.text).map(c => c.id))}),
    wechatChannelAttachmentPayload: x => x, wechatChannelTextFileAttachments: () => [], wechatChannelHasDeliverableReference: () => false,
    dedupeMessageAttachments: list => [...new Map(list.map(a => [a.path, a])).values()], WECHAT_CHANNEL_REPLY_ATTACHMENT_LIMIT: 10,
  };
  const api = load(['wechatChannelReplyAttachments','wechatChannelReplyAttachmentItems','wechatChannelReplyCandidates',
    'wechatChannelCanUseAgentItemForExternalReply','wechatChannelAgentItemMatchesReplyScope','wechatChannelAgentItemPhase'], deps);
  assert.deepEqual(api.wechatChannelReplyAttachments(channel, new Set(), 'Conclusion', {turnId:'request'}).map(a => a.name), ['kline.png','plan.png']);
  assert.deepEqual(api.wechatChannelReplyAttachments(channel, new Set(['chart']), '', {turnId:'request'}).map(a => a.name), ['plan.png']);
});

test('channel image markup uses the same cloud account card in all languages and preserves separate alternatives', () => {
  for (const language of ['zh-CN','zh-TW','en']) for (const side of ['long','short']) {
    const report = cloudAccountPlanCardFixture(language === 'zh-TW' ? 'zh-Hant' : language, side);
    const cards = externalTradingPlanCardMarkup({ cloudReports:[report] }, language);
    assert.equal(cards.length,1);
    for (const field of ['execution-plan-price','execution-plan-account-detail','execution-plan-target-amount','execution-plan-target-profit']) assert.ok(cards[0].includes(field),field);
  }
  const legacy = legacyCloudPlanCardFixture('price-action');
  const cards = externalTradingPlanCardMarkup({ cloudReports: [legacy] }, 'zh-CN');
  assert.equal(cards.length,1); assert.match(cards[0],/82292\.30/);
  assert.equal(externalTradingPlanCardMarkup({ report: legacy.report }, 'zh-CN').length,1);
  const wait = cloudAccountPlanCardFixture(); wait.executionPlan.outcome.action = 'wait'; wait.executionPlan.scenarios=[]; wait.planRecords=[];
  assert.deepEqual(externalTradingPlanCardMarkup({cloudReports:[wait]},'zh-CN'),[]);
  assert.deepEqual(externalTradingPlanCardMarkup({report:'No entry plan.'},'zh-CN'),[]);
});

test('each channel reply generates fresh plan images before returning even when no artifact polling is needed', async () => {
  const calls=[]; let serial=0, fail=false;
  const item={id:'plan',text:'verified',__youleExecutionPlanPresentation:'execution-plan'};
  const deps={
    wechatChannelReplyCandidates: (thread,before,scope) => { calls.push(['scope',thread,before,scope]);return [{item}]; },
    appLanguageLocale: ()=>'zh-CN',
    createExternalTradingReplyPlanAttachments: async (items,language,save) => { assert.deepEqual(items,[item]);assert.equal(language,'zh-CN');return [await save({dataUrl:'png'})]; },
    api:{saveExternalTradingPlanImage:async()=>{if(fail)throw Error('disk full');return {path:`plan-${++serial}.png`};}},
    wechatChannelReplyAttachmentsWithRecentArtifacts: async()=>[{path:'kline.png'}],
    wechatChannelShouldWaitForReplyAttachments: ()=>false,
    dedupeMessageAttachments: x=>x,WECHAT_CHANNEL_REPLY_ATTACHMENT_LIMIT:10,
  };
  const {waitForWechatChannelReplyAttachments:wait}=load(['waitForWechatChannelReplyAttachments'],deps);
  const before=new Set(['previous']),scope={turnId:'request'};
  for(const channel of ['wechat','feishu','telegram']) {
    const result=await wait(channel,before,'Conclusion',scope);
    assert.deepEqual(result.map(a=>a.path),['kline.png',`plan-${serial}.png`]);
    assert.deepEqual(calls.at(-1),['scope',channel,before,scope]);
  }
  assert.equal(serial,3);
  fail=true;await assert.rejects(wait('wechat',before,'Conclusion',scope),/disk full/);
});

test('generated card PNGs stay in a bounded temporary directory and reject invalid input', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'haolo-plan-image-test-'));
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+y2S8AAAAASUVORK5CYII=','base64');
  const dataUrl='data:image/png;base64,'+bytes.toString('base64');
  const deps={app:{getPath:name=>{assert.equal(name,'temp');return dir;}},nativeImage:{createFromBuffer:()=>({isEmpty:()=>false,getSize:()=>({width:1200,height:1335})})}};
  try {
    const first=await saveExternalTradingPlanImage({dataUrl},deps),second=await saveExternalTradingPlanImage({dataUrl},deps);
    assert.notEqual(first.path,second.path);assert.equal(path.dirname(first.path),path.join(dir,'haolo-trading-plan-images'));
    assert.deepEqual(await fs.readFile(first.path),bytes);
    for (const invalid of ['', 'data:text/html;base64,AAAA', 'data:image/png;base64,AAAA']) await assert.rejects(saveExternalTradingPlanImage({dataUrl:invalid},deps),/INVALID_PLAN_IMAGE/);
    const oversized=Buffer.from(bytes);oversized.writeUInt32BE(100_000,16);
    await assert.rejects(saveExternalTradingPlanImage({dataUrl:'data:image/png;base64,'+oversized.toString('base64')},deps),/INVALID_PLAN_IMAGE/);
    await fs.utimes(first.path,new Date(0),new Date(0));
    const unrelated=path.join(path.dirname(first.path),'keep.txt');await fs.writeFile(unrelated,'keep');await fs.utimes(unrelated,new Date(0),new Date(0));
    await saveExternalTradingPlanImage({dataUrl},deps);
    await assert.rejects(fs.stat(first.path),{code:'ENOENT'});assert.ok(await fs.stat(second.path));assert.equal(await fs.readFile(unrelated,'utf8'),'keep');
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));
    await fs.rm(dir,{recursive:true,force:true});
  }
});

for (const channel of ['wechat', 'feishu', 'telegram']) test(`${channel}: final conclusion and two PNGs use native image delivery to the originating conversation`, async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'haolo-channel-image-test-'));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+y2S8AAAAASUVORK5CYII=','base64');
  const sends=[],uploads=[];
  const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  const fetch=async(url,init={})=>{
    if(String(url).endsWith('/getuploadurl')) {
      const body=JSON.parse(init.body);uploads.push(body);
      assert.equal(body.media_type,1);assert.equal(body.to_user_id,'origin-user');assert.equal(body.rawsize,png.length);
      assert.equal(body.rawfilemd5,crypto.createHash('md5').update(png).digest('hex'));
      return json({ret:0,upload_full_url:'https://cdn.example.com/upload'});
    }
    if(String(url)==='https://cdn.example.com/upload') {
      const uploaded=uploads.at(-1),encrypted=Buffer.from(init.body);
      assert.equal(encrypted.length,uploaded.filesize);
      const decipher=crypto.createDecipheriv('aes-128-ecb',Buffer.from(uploaded.aeskey,'hex'),null);
      assert.deepEqual(Buffer.concat([decipher.update(encrypted),decipher.final()]),png);
      return new Response('',{status:200,headers:{'x-encrypted-param':`image-${uploads.length}`}});
    }
    if(String(url).endsWith('/sendmessage')) {
      const {msg}=JSON.parse(init.body);assert.equal(msg.to_user_id,'origin-user');assert.equal(msg.context_token,'origin-context');
      assert.equal(msg.item_list.length,1);sends.push(msg.item_list[0]);return json({ret:0});
    }
    if(String(url).endsWith('/sendMessage')) {
      const body=JSON.parse(init.body);assert.equal(body.chat_id,'origin-chat');assert.equal(body.message_thread_id,77);
      assert.equal(body.reply_parameters.message_id,42);sends.push({text:body.text});return json({ok:true,result:{message_id:43}});
    }
    if(String(url).endsWith('/sendPhoto')) {
      assert.ok(init.body instanceof FormData);assert.equal(init.body.get('chat_id'),'origin-chat');assert.equal(init.body.get('message_thread_id'),'77');
      assert.equal(JSON.parse(init.body.get('reply_parameters')).message_id,42);
      const photo=init.body.get('photo');assert.equal(photo.type,'image/png');assert.deepEqual(Buffer.from(await photo.arrayBuffer()),png);
      sends.push({photo:photo.name});return json({ok:true,result:{message_id:43+sends.length}});
    }
    throw new Error(`Unexpected external request: ${url}`);
  };
  const server=new WechatExternalChannelServer({fetch,ilinkBaseUrl:'https://ilink.example.com',telegramApiBaseUrl:'https://telegram.example.com'});
  try {
    const attachments=[];
    for(const name of ['kline.png','plan.png']) {
      const file=path.join(dir,name);await fs.writeFile(file,png);attachments.push({name,mime:'image/png',path:file,local_path:file});
    }
    let reply;
    if(channel==='wechat') {
      Object.assign(server.connection,{connected:true,botToken:'test-token'});
      server.messageContextById.set('incoming',{replyToUserId:'origin-user',replyFromUserId:'bot',contextToken:'origin-context'});
      reply=await server.replyMessage('incoming',{text:'Conclusion',attachments});
      assert.deepEqual(sends.map(item=>item.type),[1,2,2]);assert.equal(sends[0].text_item.text,'Conclusion');
      for(let i=0;i<2;i++) {
        const image=sends[i+1].image_item;
        assert.equal(image.mid_size,uploads[i].filesize);assert.equal(image.media.encrypt_query_param,`image-${i+1}`);
        assert.equal(Buffer.from(image.media.aes_key,'base64').toString('ascii'),uploads[i].aeskey);
      }
    } else if(channel==='feishu') {
      server.feishuConnection.connected=true;
      server.feishuMessageContextById.set('incoming',{chatId:'origin-chat',messageId:'origin-message'});
      server.feishuChannel={send:async(chat,input,options)=>{
        assert.equal(chat,'origin-chat');assert.equal(options.replyTo,'origin-message');sends.push(input);return {messageId:'reply'};
      }};
      reply=await server.replyFeishuMessage('incoming',{text:'Conclusion',attachments});
      assert.deepEqual(sends,[{markdown:'Conclusion'},...attachments.map(a=>({image:{source:a.path}}))]);
    } else {
      Object.assign(server.telegramConnection,{connected:true,botToken:'42:fixture_token_for_offline_test'});
      server.telegramMessageContextById.set('incoming',{chatId:'origin-chat',messageId:42,messageThreadId:77});
      reply=await server.replyTelegramMessage('incoming',{text:'Conclusion',attachments});
      assert.deepEqual(sends,[{text:'Conclusion'},{photo:'kline.png'},{photo:'plan.png'}]);
    }
    assert.equal(reply.ok,true);assert.equal(reply.attachments.length,2);assert.ok(reply.attachments.every(item=>item.ok));
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));
    await fs.rm(dir,{recursive:true,force:true});
  }
});
