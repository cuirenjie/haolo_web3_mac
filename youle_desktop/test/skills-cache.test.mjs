import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CwdSkillsCache } from "../src/main/skills-cache.mjs";

test("skills cache reuses values per cwd without crossing workspaces", async () => {
  const cache = new CwdSkillsCache();
  let workspaceALoads = 0;
  let workspaceBLoads = 0;
  const loadA = () => cache.load("c:/workspace/a", {
    loader: async () => ({ cwd: "A", revision: ++workspaceALoads }),
  });
  const loadB = () => cache.load("c:/workspace/b", {
    loader: async () => ({ cwd: "B", revision: ++workspaceBLoads }),
  });

  assert.deepEqual((await loadA()).value, { cwd: "A", revision: 1 });
  assert.deepEqual((await loadA()).value, { cwd: "A", revision: 1 });
  assert.deepEqual((await loadB()).value, { cwd: "B", revision: 1 });
  assert.equal(workspaceALoads, 1);
  assert.equal(workspaceBLoads, 1);
});

test("skills cache supports cwd and global invalidation plus explicit force reload", async () => {
  const cache = new CwdSkillsCache();
  const loads = new Map();
  const load = (key, forceReload = false) => cache.load(key, {
    forceReload,
    loader: async () => {
      const revision = (loads.get(key) || 0) + 1;
      loads.set(key, revision);
      return `${key}:${revision}`;
    },
  });

  await load("a");
  await load("b");
  cache.invalidate("a");
  assert.equal((await load("a")).value, "a:2");
  assert.equal((await load("b")).value, "b:1");
  assert.equal((await load("b", true)).value, "b:2");

  cache.invalidateAll();
  assert.equal((await load("a")).value, "a:3");
  assert.equal((await load("b")).value, "b:3");
});

test("failed refresh falls back only to the stale value for the same cwd", async () => {
  const cache = new CwdSkillsCache();
  const original = { cwd: "A", skills: ["one"] };
  await cache.load("a", { loader: async () => original });
  cache.invalidate("a");

  const fallback = await cache.load("a", {
    loader: async () => { throw new Error("skills endpoint unavailable"); },
  });
  assert.equal(fallback.value, original);
  assert.equal(fallback.cached, true);
  assert.equal(fallback.stale, true);
  assert.match(fallback.error.message, /endpoint unavailable/);

  await assert.rejects(
    cache.load("b", { loader: async () => { throw new Error("workspace B failed"); } }),
    /workspace B failed/,
  );
});

test("main process uses cached before-turn skills and invalidates existing refresh paths", async () => {
  const source = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");

  assert.match(source, /refreshSkills\(\{ cwd, reason, preferCache: true \}\)/);
  assert.doesNotMatch(source, /refreshSkills\(\{ cwd, forceReload: true, reason \}\)/);
  assert.match(source, /scheduleSkillsRefresh\("skills\/changed", serverClient\.__youleWorkspaceCwd\)/);
  assert.match(source, /invalidateSkillsCache\(\);\s*scheduleSkillsRefresh\("skill-install"\)/);
  assert.match(source, /invalidateSkillsCache\(\);\s*scheduleSkillsRefresh\("skill-uninstall"\)/);
  assert.match(source, /if \(forceReload\) params\.forceReload = true/);
});
