import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncDefaultCodexResources } from "../src/main/app-server-client.mjs";

const skillsRoot = new URL("../resources/default-haolo-ai/skills/", import.meta.url);
const skillCreatorRoot = new URL(".system/skill-creator/", skillsRoot);
const findSkillsRoot = new URL("find-skills/", skillsRoot);

test("bundled authoring and discovery skills follow the Codex skill layout", () => {
  const fixtures = [
    {
      root: skillCreatorRoot,
      name: "skill-creator",
      displayName: "Skill Creator",
      defaultPrompt: "$skill-creator",
    },
    {
      root: findSkillsRoot,
      name: "find-skills",
      displayName: "Find Skills",
      defaultPrompt: "$find-skills",
    },
  ];

  for (const fixture of fixtures) {
    const skillBytes = fs.readFileSync(new URL("SKILL.md", fixture.root));
    const skill = skillBytes.toString("utf8");
    const openaiYaml = fs.readFileSync(new URL("agents/openai.yaml", fixture.root), "utf8");

    assert.deepEqual([...skillBytes.subarray(0, 3)], [45, 45, 45]);
    assert.match(skill, new RegExp(`^name: ["']?${fixture.name}["']?$`, "m"));
    assert.match(skill, /^description:\s*\S/m);
    assert.match(openaiYaml, new RegExp(`display_name: "${fixture.displayName}"`));
    assert.match(openaiYaml, /short_description: "[^"\r\n]{25,64}"/);
    assert.match(openaiYaml, new RegExp(`default_prompt: ".*\\${fixture.defaultPrompt}`));
  }
});

test("skill-creator is self-contained for Haolo's managed Python runtime", () => {
  const scriptsRoot = new URL("scripts/", skillCreatorRoot);
  const validator = fs.readFileSync(new URL("quick_validate.py", scriptsRoot), "utf8");
  const generator = fs.readFileSync(new URL("generate_openai_yaml.py", scriptsRoot), "utf8");
  const frontmatter = fs.readFileSync(new URL("frontmatter.py", scriptsRoot), "utf8");
  const skill = fs.readFileSync(new URL("SKILL.md", skillCreatorRoot), "utf8");

  assert.doesNotMatch(`${validator}\n${generator}`, /import yaml|yaml\.safe_load/);
  assert.match(`${validator}\n${generator}`, /from frontmatter import FrontmatterError, parse_frontmatter/);
  assert.match(frontmatter, /def parse_frontmatter\(content\):/);
  assert.match(skill, /\$HOME\/\.agents\/skills/);
  assert.match(skill, /<repo>\/\.agents\/skills/);
  assert.doesNotMatch(skill, /default to `\$CODEX_HOME\/skills`/);
  assert.equal(fs.existsSync(new URL("LICENSE.txt", skillCreatorRoot)), true);
  assert.equal(fs.existsSync(new URL("assets/skill-creator.svg", skillCreatorRoot)), true);
});

test("find-skills preserves provenance and requires explicit install approval", () => {
  const skill = fs.readFileSync(new URL("SKILL.md", findSkillsRoot), "utf8");
  const license = fs.readFileSync(new URL("LICENSE.txt", findSkillsRoot), "utf8");

  assert.match(skill, /adapted from Vercel Labs/);
  assert.match(skill, /Install only after the user explicitly approves/);
  assert.match(skill, /Free to install.+does not mean/s);
  assert.match(skill, /security-audit results/);
  assert.match(skill, /\$env:PNPM dlx skills find/);
  assert.match(skill, /--agent codex --global --yes --copy/);
  assert.match(license, /Copyright \(c\) 2026 Vercel, Inc\./);
});

test("default resource sync installs both skills into every Haolo Codex home", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-bundled-skills-"));
  try {
    const codexHome = path.join(tempRoot, "haolo-ai-home");
    const result = syncDefaultCodexResources(codexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
    });

    assert.equal(result.errors.length, 0);
    assert.equal(
      fs.existsSync(path.join(codexHome, "skills", ".system", "skill-creator", "SKILL.md")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(codexHome, "skills", "find-skills", "SKILL.md")),
      true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
