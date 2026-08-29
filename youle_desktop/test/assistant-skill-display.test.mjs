import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadAssistantSkillDisplayModule() {
  const source = await readFile(new URL("../src/renderer/assistant-skill-display.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
  return import(moduleUrl);
}

const displayModule = loadAssistantSkillDisplayModule();
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

test("assistant skill display aliases imagegen without changing embedded identifiers", async () => {
  const { assistantSkillDisplayText } = await displayModule;

  assert.equal(assistantSkillDisplayText("我会用 imagegen 技能"), "我会用 image-skill 技能");
  assert.equal(assistantSkillDisplayText("IMAGEGEN"), "image-skill");
  assert.equal(
    assistantSkillDisplayText("myimagegen、imagegen-v2 和 imagegen_tool"),
    "myimagegen、imagegen-v2 和 imagegen_tool",
  );
});

test("inline code aliases only the exact skill name", async () => {
  const { assistantSkillDisplayInlineCode } = await displayModule;

  assert.equal(assistantSkillDisplayInlineCode("imagegen"), "image-skill");
  assert.equal(assistantSkillDisplayInlineCode(" imagegen "), " image-skill ");
  assert.equal(assistantSkillDisplayInlineCode("imagegen/SKILL.md"), "imagegen/SKILL.md");
});

test("message rendering enables the alias only for assistant bubbles", async () => {
  const source = await rendererSource;

  assert.match(source, /assistantSkillDisplayAliases:\s*!fromUser/);
  assert.match(source, /options\.assistantSkillDisplayAliases\s*\?\s*assistantSkillDisplayText\(part\)\s*:\s*part/);
  assert.match(source, /options\.assistantSkillDisplayAliases\s*\?\s*assistantSkillDisplayInlineCode\(part\)\s*:\s*part/);
});
