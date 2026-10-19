import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import ts from 'typescript';
import vm from 'node:vm';
import {CloudTradingCatalog} from '../src/main/trading-strategy-runtime/cloud-catalog.mjs';
import {OFFICIAL_TRADING_CATALOG} from '../src/shared/official-trading-catalog.mjs';
const require=createRequire(import.meta.url),builder=createRequire(require.resolve('electron-builder'));
const {minimatch}=createRequire(builder.resolve('app-builder-lib'))('minimatch');
const {forbiddenPath,privateMarkers,sensitiveAsset}=require('../scripts/cloud-strategy-package-policy.cjs');
const root=fileURLToPath(new URL('../',import.meta.url));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const included=relative=>pkg.build.files.some(pattern=>typeof pattern==='string'&&minimatch(relative,pattern));
test('release audit accepts only a blank auth template and rejects credential assets without printing values',()=>{
  assert.equal(sensitiveAsset('default-haolo-ai/auth.json','{"OPENAI_API_KEY":""}'),false);
  assert.equal(sensitiveAsset('auth.json',JSON.stringify({OPENAI_API_KEY:'example-value'})),true);
  assert.equal(sensitiveAsset('auth.json','not json'),true);
  assert.equal(sensitiveAsset('haolo-session.json','{}'),true);
  assert.equal(sensitiveAsset('nested/.env.production',''),true);
  assert.equal(sensitiveAsset('haolo-evsign-license.json','{}'),true);
  assert.equal(sensitiveAsset('main.mjs',JSON.stringify('sk-proj-'+ 'x'.repeat(40))),true);
  assert.equal(sensitiveAsset('main.mjs','const description="API key"'),false);
});
function files(dir) {return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(path.join(dir,item.name)):[path.join(dir,item.name)]);}

test('every shipped host import resolves within the public package and private implementations are excluded',()=>{
  const selected=files(path.join(root,'src')).map(file=>path.relative(root,file).replaceAll('\\','/')).filter(included);
  assert.ok(selected.includes('src/main/main.mjs'));
  assert.ok(selected.includes('src/main/personal-strategy/pipeline.mjs'));
  assert.ok(selected.includes('src/main/execution-plan-card.css'));
  assert.ok(selected.includes('src/main/execution-plan-sticky-preload.cjs'));
  for(const relative of selected) {
    assert.equal(forbiddenPath(relative),false,relative);
    const source=fs.readFileSync(path.join(root,relative),'utf8');
    for(const marker of privateMarkers)assert.ok(!source.includes(marker),`${relative}: ${marker}`);
    const parsed=ts.createSourceFile(relative,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const visit=node=>{
      const spec=(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))?node.moduleSpecifier
        :ts.isNewExpression(node)&&node.expression.getText(parsed)==='URL'&&node.arguments?.[1]?.getText(parsed)==='import.meta.url'?node.arguments[0]
        :ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(parsed)==='require')?node.arguments[0]:null;
      if(spec&&ts.isStringLiteralLike(spec)&&spec.text.startsWith('.')) {
        const target=path.resolve(root,path.dirname(relative),spec.text),name=path.relative(root,target).replaceAll('\\','/');
        assert.ok(fs.existsSync(target),`${relative} imports missing ${name}`);
        assert.ok(included(name),`${relative} imports excluded ${name}`);
      }
      ts.forEachChild(node,visit);
    };visit(parsed);
  }
  for(const relative of ['src/main/trading-analysis/wave-engine.mjs','src/main/trading-strategy-runtime/coordinator.mjs',
    'src/main/trading-strategy-runtime/builtins/index.mjs','src/main/personal-context/trading-preference-compiler.mjs',
    'resources/trading-strategies/builtins/wave/SKILL.md'])assert.equal(included(relative),false,relative);
  assert.equal(pkg.build.afterPack,'scripts/after-pack-cloud.cjs');
});

test('17 public catalog entries retain intent routing without exposing executable adapters or rule assets',async()=>{
  const catalog=new CloudTradingCatalog({modelRegistry:{analyze:async()=>{throw Error('offline');}},providerId:'fixture'});
  assert.equal(catalog.run,undefined);assert.equal(catalog.listStrategies().strategies.length,17);
  for(const item of OFFICIAL_TRADING_CATALOG) {
    assert.equal(item.assets,undefined);assert.equal(item.implementation.kind,'cloud-v1');
    const result=await catalog.classify(item.id,{text:`@策略:${item.mentions.canonical} 分析 BTCUSDT 1h K线`});
    assert.equal(result.request.mode,'chart-analysis');assert.equal(result.request.interval,'60');
  }
});

test('macOS and Windows afterPack audits are mandatory and use their actual resource roots',async()=>{
  const source=fs.readFileSync(path.join(root,'scripts/after-pack-cloud.cjs'),'utf8');
  for(const platform of ['darwin','win32']) for(const reject of [false,true]) {
    const calls=[],module={exports:{}};
    vm.runInNewContext(source,{module,console:{log(){}},require:name=>{
      if(name==='node:path')return path;
      if(name==='./restore-windows-icon.cjs')return async()=>calls.push('icon');
      if(name==='./audit-cloud-strategy-package.cjs')return {auditCloudStrategyPackage:target=>{
        calls.push(target);if(reject)throw Error('private assets');return {fileCount:5,asarSha256:'fixture'};
      }};
      throw Error(name);
    }});
    const appOutDir=path.join(root,'output/qa');
    const operation=module.exports({electronPlatformName:platform,appOutDir,packager:{appInfo:{productFilename:'好咯'}}});
    if(reject)await assert.rejects(operation,/private assets/);else await operation;
    assert.deepEqual(calls,['icon',platform==='darwin'?path.join(appOutDir,'好咯.app'):appOutDir]);
  }
});
