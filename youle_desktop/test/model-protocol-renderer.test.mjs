import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {rendererImports} from './support/renderer-imports.mjs';
import { redactLeakedToolProtocol, modelProtocolErrorText } from "../src/shared/model-protocol-text.mjs";

const source = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const imported = await rendererImports(ast, ['modelIncompleteFacts', 'incompleteResponseCopy']);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ["assistantVisibleText", "formatTurnFailureMessage"].includes(node.name?.text));
assert.equal(functions.length, 2);
const compiled = ts.transpileModule(functions.map(node => node.getText(ast)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

test("actual renderer hides restored protocol text, preserves ordinary reports and localizes the terminal error", () => {
  const history = { text: 'Earlier position evidence.\n<｜DSML｜calls><｜DSML｜invoke name="exec">hidden command</｜DSML｜invoke>' };
  const original = structuredClone(history);
  for (const language of ["zh-CN", "zh-Hant", "en", "ko", "ja", "vi"]) {
    const context = { ...imported, state: { settings: { language } }, redactLeakedToolProtocol, modelProtocolErrorText,
      cleanVisibleMessageText: text => text, redactVideoGenerationCompletionMetadata: text => text,
      isContextWindowExhaustedError: () => false };
    vm.createContext(context);vm.runInContext(compiled, context);
    const visible = context.assistantVisibleText(history.text);
    assert.ok(visible.startsWith("Earlier position evidence."));
    assert.ok(!visible.includes("DSML") && !visible.includes("hidden command"));
    assert.equal(context.assistantVisibleText("ETHUSDT 多单 2 ETH\n| 入场价 | 2300 |"), "ETHUSDT 多单 2 ETH\n| 入场价 | 2300 |");
    assert.equal(context.formatTurnFailureMessage("stream disconnected before completion: MODEL_TOOL_PROTOCOL_ERROR"), modelProtocolErrorText(language));
  }
  assert.deepEqual(history, original);
});
