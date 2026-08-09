import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { ChromeNativeBroker } from "../src/main/chrome/native-broker.mjs";
import { HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID } from "../src/main/chrome/native-host-manager.mjs";

test("compiled Native Host bridges Chrome frames to the authenticated broker", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows Native Messaging Host test");
    return;
  }
  const hostPath = path.resolve("resources/bin/haolo-chrome-native-host.exe");
  if (!fs.existsSync(hostPath)) {
    t.skip("Compile the Chrome Native Host before running this test");
    return;
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-chrome-native-process-"));
  const appData = path.join(tempRoot, "AppData", "Roaming");
  const userData = path.join(appData, "haolo_desktop");
  const origin = `chrome-extension://${HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID}/`;
  const broker = new ChromeNativeBroker({ userDataPath: userData, extensionOrigins: [origin], timeoutMs: 2_000, logger: { warn() {} } });
  let child = null;
  try {
    await broker.start();
    child = spawn(hostPath, [origin], {
      env: { ...process.env, APPDATA: appData, HAOLO_CHROME_HOST_CONFIG: broker.configPath() },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const messages = nativeMessageCollector(child.stdout);
    writeNativeMessage(child.stdin, {
      protocolVersion: 1,
      type: "extension.hello",
      requestId: "extension-process-1",
      profileId: "profile_process123",
      extensionVersion: "0.1.0",
    });
    const ready = await withTimeout(messages.next(), 5_000);
    assert.equal(ready.type, "extension.ready", ready.payload?.message || "Native Host did not return extension.ready");
    assert.equal(ready.profileId, "profile_process123");

    const healthPromise = broker.call("profile_process123", "health.ping", { echo: "ok" });
    const ping = await withTimeout(messages.next(), 2_000);
    assert.equal(ping.type, "health.ping");
    writeNativeMessage(child.stdin, { ...ping, type: "tool.result", payload: { ok: true } });
    assert.deepEqual(await healthPromise, { ok: true });
  } finally {
    child?.stdin?.end();
    child?.kill();
    await broker.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function writeNativeMessage(stream, value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length, 0);
  stream.write(Buffer.concat([length, body]));
}

function nativeMessageCollector(stream) {
  let buffer = Buffer.alloc(0);
  const queue = [];
  const waiters = [];
  stream.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < length + 4) break;
      const value = JSON.parse(buffer.subarray(4, length + 4).toString("utf8"));
      buffer = buffer.subarray(length + 4);
      const waiter = waiters.shift();
      if (waiter) waiter(value);
      else queue.push(value);
    }
  });
  return {
    next() {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

function withTimeout(promise, timeoutMs) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}
