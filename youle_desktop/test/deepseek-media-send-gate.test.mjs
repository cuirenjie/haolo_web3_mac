import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createProviderSendHost } from "./helpers/provider-send-host.mjs";
import { providerModelInputCapabilities } from "../src/main/provider-input-capabilities.mjs";

const source = readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("Flash 1017 accepts native images and image history while unsupported video stays blocked", () => {
  const definition = block("function deepSeekMediaComposerValidationError", "function personalStrategyCreationDescription")
    .replace("threadId: string", "threadId");
  const makeGate = (attachments) => new Function("channelIdFromThreadId", "isMediaCreationMode", "newThreadModeForThread", "selectedChatModelRequestOptions", "DEEPSEEK_EXECUTION_PROVIDER_ID", "composerAttachmentsForThread", "isVideoAttachment", "DEEPSEEK_MEDIA_SEND_BLOCKED_MESSAGE", definition + "\nreturn deepSeekMediaComposerValidationError;")(
    () => null, () => false, () => "execution", () => ({ modelProvider: "deepseek" }), "deepseek", () => attachments,
    (file) => file.mime?.startsWith("video/"), "unsupported video",
  );
  assert.equal(makeGate([{ mime: "image/png" }])("task"), null);
  assert.equal(makeGate([{ mime: "video/mp4" }])("task"), "unsupported video");
  const history = block("function threadHasNativeVideoHistory", "function selectChatModelForThread");
  assert.match(history, /itemAttachments\(item\)\.some\(isVideoAttachment\)/);
  assert.doesNotMatch(history, /isImageOrVideoAttachment|isImageAttachment/);
  for (const model of ["deepseek-flash", "deepseek-v4-flash"]) {
    assert.equal(providerModelInputCapabilities("deepseek", model).image, true);
    assert.equal(providerModelInputCapabilities("deepseek", model).video, false);
  }
  assert.equal(providerModelInputCapabilities("deepseek", "deepseek-pro").image, false);
});

test("production send preserves current images and image history when changing provider", async () => {
  const calls = [];
  const image = { type: "image", url: "data:image/png;base64,synthetic" };
  const host = createProviderSendHost({ mediaInputs: [image], request: async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") return { thread: { id: "image-task", turns: [{ input: [image] }] } };
    if (method === "thread/resume") return { modelProvider: "deepseek", thread: { id: "image-task" } };
    if (method === "turn/start") return { turn: { id: "same-task-recovery" } };
    throw Error(method);
  } });
  const result = await host.send({ threadId: "image-task", model: "deepseek-flash", text: "Describe the original image" });
  assert.equal(result.turn.id, "same-task-recovery");
  const sends = calls.filter(c => c.method === "turn/start");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].params.threadId, "image-task");
  assert.deepEqual(sends[0].params.input.at(-1), image);
  assert.equal(sends[0].params.model, "deepseek-flash");
});

test("host rejects unsupported video history and native video before starting a turn", async () => {
  for (const video of [{ type: "input_video", video_url: "https://fixture.invalid/v.mp4" }, { mimeType: "video/mp4" }, "data:video/mp4;base64,fixture"]) {
    const host = createProviderSendHost({ request: async (method) => {
      assert.equal(method, "thread/read");
      return { thread: { turns: [{ input: [video] }] } };
    } });
    await assert.rejects(host.resumeThreadForRequestedProvider({ serverClient: host.client, threadId: "video-task", targetSettings: { modelProvider: "deepseek" } }), /history contains video/);
  }
  const host = createProviderSendHost({ mediaInputs: [{ type: "input_video" }], request: async (method) => {
    assert.equal(method, "thread/read"); return { thread: { turns: [] } };
  } });
  await assert.rejects(host.send({ threadId: "new-video", model: "deepseek-flash", text: "Read video" }), /does not accept video input/);
});

test("video warnings have all three locales and shared toast contrast in both themes", () => {
  for (const locale of ["en", "zh-tw"]) {
    const translations = readFileSync(new URL(`../src/renderer/app-language-${locale}-generated.mjs`, import.meta.url), "utf8");
    assert.ok(translations.includes('"此模型暂不支持视频，请移除视频或切换模型。":'));
    assert.ok(translations.includes('"当前任务包含视频历史，无法无损切换到 DeepSeek；请新建任务后使用":'));
  }
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const toast = styles.slice(styles.indexOf(".toast {"), styles.indexOf(".contact-request-sent-toast", styles.indexOf(".toast {")));
  assert.match(toast, /background:\s*rgba\(17, 24, 39, 0\.92\)/);
  assert.match(toast, /color:\s*#fff/);
});
