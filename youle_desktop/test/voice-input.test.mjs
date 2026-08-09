import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { transformWithEsbuild } from "vite";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(testDir, "../src/renderer/voice-input.ts");
const rendererSourcePath = path.resolve(testDir, "../src/renderer/main.ts");
const source = await fs.readFile(sourcePath, "utf8");
const rendererSource = await fs.readFile(rendererSourcePath, "utf8");
const transformed = await transformWithEsbuild(source, sourcePath, {
  loader: "ts",
  format: "esm",
  target: "es2022",
});
const voiceInput = await import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString("base64")}`);

test("transcribing state still accepts the recorder's final PCM remainder", () => {
  assert.match(
    rendererSource,
    /state\.voiceInput\.status !== "recording" && state\.voiceInput\.status !== "transcribing"/,
  );
  assert.match(rendererSource, /const recording = await recorder\.stop\(\);[\s\S]*await voiceAudioSendChain/);
});

test("recorder emits paced 200ms PCM16 chunks and flushes the final remainder", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let processor = null;
  let trackStopped = false;
  let contextClosed = false;
  const emitted = [];
  const audioNode = () => ({ connect() {}, disconnect() {} });
  const stream = {
    getTracks: () => [{ stop: () => { trackStopped = true; } }],
  };

  class FakeAudioContext {
    sampleRate = 16_000;
    state = "running";
    destination = audioNode();
    createMediaStreamSource() {
      return audioNode();
    }
    createScriptProcessor() {
      processor = { ...audioNode(), onaudioprocess: null };
      return processor;
    }
    createGain() {
      return { ...audioNode(), gain: { value: 1 } };
    }
    async resume() {}
    async close() {
      this.state = "closed";
      contextClosed = true;
    }
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { AudioContext: FakeAudioContext },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => stream } },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  });

  const recorder = await voiceInput.createVoiceRecorder({
    onAudioChunk: (bytes) => emitted.push(bytes),
  });
  processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(0.25) } });
  assert.equal(emitted.length, 0);
  processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(-0.25) } });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].byteLength, 3200 * 2);

  const recording = await recorder.stop();
  assert.equal(recording.sampleCount, 4096);
  assert.equal(recording.durationMs, 256);
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].byteLength, 896 * 2);
  assert.equal(new DataView(emitted[0]).getInt16(0, true), 8192);
  assert.equal(trackStopped, true);
  assert.equal(contextClosed, true);
});

test("cancelling capture releases the microphone without emitting buffered audio", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let processor = null;
  let trackStopped = false;
  const emitted = [];
  const audioNode = () => ({ connect() {}, disconnect() {} });
  const stream = { getTracks: () => [{ stop: () => { trackStopped = true; } }] };
  class FakeAudioContext {
    sampleRate = 16_000;
    state = "running";
    destination = audioNode();
    createMediaStreamSource() { return audioNode(); }
    createScriptProcessor() {
      processor = { ...audioNode(), onaudioprocess: null };
      return processor;
    }
    createGain() { return { ...audioNode(), gain: { value: 1 } }; }
    async resume() {}
    async close() { this.state = "closed"; }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: { AudioContext: FakeAudioContext } });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => stream } },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  });

  const recorder = await voiceInput.createVoiceRecorder({ onAudioChunk: (bytes) => emitted.push(bytes) });
  processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(1000).fill(0.5) } });
  recorder.cancel();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(emitted.length, 0);
  assert.equal(trackStopped, true);
});
