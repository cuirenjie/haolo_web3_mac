import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncManagedTradingSkill } from "../src/main/managed-trading-skills.mjs";
import { OFFICIAL_TRADING_CATALOG } from "../src/shared/official-trading-catalog.mjs";

test("bundled skills install, upgrade, retain recovery copy and preserve user modifications", t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"haolo-skill-sync-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,"source","trading-analysis-price-action"),target=path.join(dir,"target","trading-analysis-price-action");
  fs.mkdirSync(source,{recursive:true});
  const file=path.join(source,"SKILL.md"),installed=path.join(target,"SKILL.md");
  fs.writeFileSync(file,"version one\n");
  assert.equal(syncManagedTradingSkill(source,target).changed,true);
  assert.equal(syncManagedTradingSkill(source,target).changed,false);
  fs.writeFileSync(file,"version two\n");
  assert.equal(syncManagedTradingSkill(source,target).changed,true);
  assert.equal(fs.readFileSync(path.join(target,".haolo-previous-skill.txt"),"utf8"),"version one\n");
  fs.writeFileSync(installed,"user custom\n");fs.writeFileSync(file,"version three\n");
  assert.throws(()=>syncManagedTradingSkill(source,target),/Custom skill preserved/);
  assert.equal(fs.readFileSync(installed,"utf8"),"user custom\n");
});

test("every enabled strategy and indicator has one discoverable Skill with its stable catalog identity", () => {
  const names=new Set();
  for(const entry of OFFICIAL_TRADING_CATALOG.filter(s=>s.enabled)) {
    const name=`trading-analysis-${entry.id}`;
    const source=fs.readFileSync(new URL(`../resources/default-haolo-ai/skills/${name}/SKILL.md`,import.meta.url),"utf8");
    assert.equal(names.has(name),false);names.add(name);
    assert.ok(source.replaceAll("\r\n", "\n").includes(`name: ${name}\n`));
    assert.ok(source.includes(`strategyId \`${entry.id}\``));
    assert.ok(source.includes("haolo_analysis"));
  }
  assert.equal(names.size,17);
});
