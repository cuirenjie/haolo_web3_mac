import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/renderer/task-anchor.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const taskAnchors = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

test("task anchors prefer the requested deliverable over incidental reference topics", () => {
  const prompt = `以我给你的文章做内容参考，参照我给你的框架，给我一份内容丰富完整的深圳白皮书，要求内容通俗易懂，小白家长也能理解。

以下是可供参考的白皮书框架：
酒店与旅游行业案例只属于参考材料。`;
  assert.equal(taskAnchors.taskAnchorFromPromptText(prompt), "白皮");
  assert.equal(taskAnchors.taskAnchorFromPromptText("请参考附件里的 Word 文档，生成一份 PPT"), "演示");
  assert.equal(taskAnchors.taskAnchorFromPromptText("把酒店经营数据整理成 Excel 表格"), "表格");
  assert.equal(taskAnchors.taskAnchorFromPromptText("以白皮书为参考，生成一份演示文稿"), "演示");
  assert.equal(taskAnchors.taskAnchorFromPromptText("请根据以下代码报错生成一份修复方案"), "方案");
});

test("task anchors still use the task topic when no concrete deliverable is requested", () => {
  assert.equal(taskAnchors.taskAnchorFromPromptText("帮我查一下深圳酒店"), "酒店");
  assert.equal(taskAnchors.taskAnchorFromPromptText("分析这段代码为什么报错"), "代码");
  assert.equal(taskAnchors.taskAnchorFromPromptText("我在运营一个面向家长的社群"), "运营");
});

test("task anchor extraction ignores pasted reference sections and preserves attachment fallback", () => {
  assert.equal(taskAnchors.taskAnchorFromPromptText("生成一份招生报告\n\n参考资料如下：\n酒店行业报告"), "报告");
  assert.equal(taskAnchors.taskAnchorFromPromptText("", "图片"), "图片");
});
