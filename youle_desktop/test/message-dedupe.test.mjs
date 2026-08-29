import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

async function loadMessageDedupeHarness() {
  const source = await rendererSource;
  const harness = `
    type Message = any;

    function stripAttachmentMetadataText(value: unknown) {
      return String(value || "");
    }

    function attachmentIdentity(attachment: Record<string, unknown>) {
      return String(attachment.id || attachment.object_key || attachment.url || attachment.name || "");
    }

    function isWechatOptimisticUserItemId(id: string) {
      return id.startsWith("wechat-user-");
    }

    function isOptimisticUserItemId(id: string) {
      return id.startsWith("local-user-")
        || id.startsWith("local-pending-send-")
        || id.startsWith("provider-user-")
        || id.startsWith("local-channel-")
        || isWechatOptimisticUserItemId(id);
    }

    ${sourceBlock(
      source,
      "function dedupeRenderedOptimisticUserMessages",
      "function dedupeAdjacentRenderedUserMessages",
    )}
    ${sourceBlock(
      source,
      "function dedupeAdjacentRenderedUserMessages",
      "function isRenderedUserSideMessage",
    )}
    ${sourceBlock(
      source,
      "function isRenderedUserSideMessage",
      "function preserveLiveConversationSupplementMessageOrder",
    )}
    ${sourceBlock(
      source,
      "function renderedUserMessageDedupKey",
      "function withPendingChannelAgentReply",
    )}

    export { dedupeRenderedOptimisticUserMessages };
  `;
  const transpiled = ts.transpileModule(harness, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`
  );
}

const messageDedupeHarness = loadMessageDedupeHarness();

function userMessage(id, text, attachments = []) {
  return {
    id,
    conversation_id: "thread-1",
    kind: "user_text",
    role: "user",
    text,
    attachments,
  };
}

function assistantMessage(id, text) {
  return {
    id,
    conversation_id: "thread-1",
    kind: "agent_text",
    role: "ceo_assistant",
    text,
  };
}

test("an identical prompt after an assistant response remains a distinct optimistic turn", async () => {
  const { dedupeRenderedOptimisticUserMessages } = await messageDedupeHarness;
  const messages = [
    userMessage("canonical-user-1", "写一篇短篇小说题目是：10年后的ai"),
    assistantMessage("assistant-1", "上一轮已经结束"),
    userMessage("local-pending-send-2", "写一篇短篇小说题目是：10年后的ai"),
  ];

  assert.deepEqual(
    dedupeRenderedOptimisticUserMessages(messages).map((message) => message.id),
    ["canonical-user-1", "assistant-1", "local-pending-send-2"],
  );
});

test("adjacent optimistic and canonical echoes still collapse to one user message", async () => {
  const { dedupeRenderedOptimisticUserMessages } = await messageDedupeHarness;
  const messages = [
    userMessage("local-pending-send-1", "同一条消息"),
    userMessage("canonical-user-1", "同一条消息"),
  ];

  assert.deepEqual(
    dedupeRenderedOptimisticUserMessages(messages).map((message) => message.id),
    ["canonical-user-1"],
  );
});

test("a repeated attachment after an assistant response is not mistaken for an old echo", async () => {
  const { dedupeRenderedOptimisticUserMessages } = await messageDedupeHarness;
  const attachment = { id: "attachment-1", name: "reference.png" };
  const messages = [
    userMessage("canonical-user-1", "", [attachment]),
    assistantMessage("assistant-1", "上一轮附件已处理"),
    userMessage("local-pending-send-2", "", [attachment]),
  ];

  assert.deepEqual(
    dedupeRenderedOptimisticUserMessages(messages).map((message) => message.id),
    ["canonical-user-1", "assistant-1", "local-pending-send-2"],
  );
});
