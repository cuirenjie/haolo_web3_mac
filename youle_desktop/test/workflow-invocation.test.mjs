import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadWorkflowInvocationModule() {
  const source = await readFile(
    new URL("../src/renderer/workflow-invocation.ts", import.meta.url),
    "utf8",
  );
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

const workflowInvocationModule = loadWorkflowInvocationModule();

function slot(slotId, type, semanticName, overrides = {}) {
  return {
    slotId,
    type,
    semanticName,
    minCount: 1,
    maxCount: 1,
    required: true,
    accept: [],
    origin: { kind: "workflow_input" },
    ...overrides,
  };
}

test("workflow composer shows its main text field only for exactly one semantic text slot", async () => {
  const {
    workflowInvocationExecutionPrompt,
    workflowInvocationUsesMainText,
  } = await workflowInvocationModule;
  const contract = (slots) => ({
    version: 1,
    entryNodeIds: ["entry"],
    slots,
  });

  assert.equal(workflowInvocationUsesMainText(null), true);
  assert.equal(workflowInvocationUsesMainText(contract([])), false);
  assert.equal(
    workflowInvocationUsesMainText(contract([slot("image", "image", "图片")])),
    false,
  );
  assert.equal(
    workflowInvocationUsesMainText(contract([slot("prompt", "text", "提示词")])),
    true,
  );
  assert.equal(
    workflowInvocationUsesMainText(contract([
      slot("topic", "text", "主题"),
      slot("audience", "text", "受众"),
    ])),
    false,
  );
  assert.equal(
    workflowInvocationExecutionPrompt(""),
    "请按当前冻结画布使用已经提供的结构化入口输入完成本次运行。",
  );
  assert.equal(
    workflowInvocationExecutionPrompt("主题：未来城市"),
    "主题：未来城市",
  );
});

test("renderer restores an immutable workflow input contract from run metadata", async () => {
  const { workflowInvocationContractFromMetadata } = await workflowInvocationModule;
  const metadata = {
    invocationContract: {
      version: 1,
      entryNodeIds: ["entry-b", "entry-d"],
      slots: [
        {
          ...slot("shared-image", "image", "共享图片", {
            accept: ["image/*"],
            sharedResourceKey: "shared-image",
          }),
          targetNodeIds: ["entry-b", "entry-d"],
          targetNodeCodes: ["B", "D"],
        },
        {
          ...slot("shared-prompt", "text", "共享提示词"),
          targetNodeIds: ["entry-b", "entry-d"],
          targetNodeCodes: ["B", "D"],
        },
      ],
    },
  };

  const restored = workflowInvocationContractFromMetadata(metadata);
  assert.deepEqual(restored, metadata.invocationContract);
  restored.entryNodeIds.pop();
  restored.slots[0].targetNodeIds.pop();
  restored.slots[0].accept.pop();
  assert.deepEqual(metadata.invocationContract.entryNodeIds, ["entry-b", "entry-d"]);
  assert.deepEqual(metadata.invocationContract.slots[0].targetNodeIds, ["entry-b", "entry-d"]);
  assert.deepEqual(metadata.invocationContract.slots[0].accept, ["image/*"]);
  assert.equal(workflowInvocationContractFromMetadata({ invocationContract: { version: 1 } }), null);
});

test("renderer defaults compatible prompt, file, image, and video inputs to one shared slot", async () => {
  const {
    buildWorkflowInvocationContract,
    workflowInvocationUsesMainText,
  } = await workflowInvocationModule;
  const contract = buildWorkflowInvocationContract([
    {
      id: "original-entry",
      kind: "agent",
      title: "原始处理",
      dependsOn: [],
      displayCode: "B",
      nodeContract: {
        inputContract: {
          slots: [
            slot("original-image", "image", "参考图片", { accept: ["image/*"] }),
            slot("original-prompt", "text", "提示词"),
            slot("original-file", "file", "参考文件", { accept: [".pdf"] }),
            slot("original-video", "video", "参考视频", { accept: ["video/*"] }),
          ],
        },
      },
    },
    {
      id: "shared-entry",
      kind: "agent",
      title: "共享处理",
      dependsOn: [],
      displayCode: "D",
      nodeContract: {
        inputContract: {
          slots: [
            slot("shared-image-slot", "image", "素材图", { accept: ["image/*"] }),
            slot("shared-prompt-slot", "text", "用户指令"),
            slot("shared-file", "file", "项目资料", { accept: [".pdf"] }),
            slot("shared-video", "video", "素材视频", { accept: ["video/*"] }),
          ],
        },
      },
    },
  ], ["original-entry", "shared-entry"]);

  assert.deepEqual(
    contract.slots.map((input) => input.semanticName),
    ["参考图片", "提示词", "参考文件", "参考视频"],
  );
  assert.deepEqual(
    contract.slots.map((input) => input.targetNodeIds),
    Array.from({ length: 4 }, () => ["original-entry", "shared-entry"]),
  );
  assert.equal(workflowInvocationUsesMainText(contract), true);
});

test("renderer keeps an explicitly distinct prompt separate even when its label matches", async () => {
  const { buildWorkflowInvocationContract } = await workflowInvocationModule;
  const contract = buildWorkflowInvocationContract([
    {
      id: "source-a",
      kind: "model",
      title: "来源 A",
      dependsOn: [],
      nodeContract: { inputContract: { slots: [slot("prompt-a", "text", "提示词")] } },
    },
    {
      id: "source-b",
      kind: "model",
      title: "来源 B",
      dependsOn: [],
      nodeContract: {
        inputContract: {
          slots: [slot("prompt-b", "text", "提示词", {
            distinctResourceKey: "source-b-own-prompt",
          })],
        },
      },
    },
  ], ["source-a", "source-b"]);

  assert.equal(contract.slots.length, 2);
  assert.deepEqual(contract.slots.map((input) => input.targetNodeIds), [
    ["source-a"],
    ["source-b"],
  ]);
});

test("renderer keeps multiple explicitly named image roles distinct", async () => {
  const { buildWorkflowInvocationContract } = await workflowInvocationModule;
  const contract = buildWorkflowInvocationContract([
    {
      id: "source-a",
      kind: "agent",
      title: "来源 A",
      dependsOn: [],
      nodeContract: {
        inputContract: {
          slots: [
            slot("product-image", "image", "产品图", { accept: ["image/*"] }),
            slot("brand-image", "image", "品牌图", { accept: ["image/*"] }),
          ],
        },
      },
    },
    {
      id: "source-b",
      kind: "agent",
      title: "来源 B",
      dependsOn: [],
      nodeContract: {
        inputContract: {
          slots: [
            slot("shared-reference", "image", "共享参考图", {
              accept: ["image/*"],
              sharedResourceKey: "unresolved-shared-image",
            }),
          ],
        },
      },
    },
  ], ["source-a", "source-b"]);

  assert.equal(contract.slots.length, 3);
});
