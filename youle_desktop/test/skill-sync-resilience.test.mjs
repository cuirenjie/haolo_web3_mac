import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareUserSkillPromotionTarget } from "../src/main/skill-sync-resilience.mjs";

function createDirectoryLink(target, link) {
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

test("removes a dangling Skill directory link before workspace promotion", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-skill-sync-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missingTarget = path.join(root, "missing-plugin-skill");
  const link = path.join(root, "pdf");

  createDirectoryLink(missingTarget, link);

  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(prepareUserSkillPromotionTarget(link), true);
  assert.throws(() => fs.lstatSync(link), { code: "ENOENT" });
});

test("preserves a live plugin-managed Skill directory link", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-skill-sync-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pluginSkill = path.join(root, "plugin-skill");
  const link = path.join(root, "pdf");
  fs.mkdirSync(pluginSkill);
  fs.writeFileSync(path.join(pluginSkill, "SKILL.md"), "# PDF\n", "utf8");
  createDirectoryLink(pluginSkill, link);

  assert.equal(prepareUserSkillPromotionTarget(link), false);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(link, "SKILL.md"), "utf8"), "# PDF\n");
});
