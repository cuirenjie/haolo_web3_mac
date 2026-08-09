import assert from "node:assert/strict";
import fs from "node:fs";
import { once } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChromeNativeBroker } from "../src/main/chrome/native-broker.mjs";
import {
  ChromeNativeHostManager,
  HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID,
  HAOLO_CHROME_NATIVE_HOST_NAME,
} from "../src/main/chrome/native-host-manager.mjs";

test("Native Host manager writes a locked extension manifest and supports precise repair", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-chrome-host-"));
  const hostPath = path.join(tempRoot, "haolo-chrome-native-host.exe");
  fs.writeFileSync(hostPath, "test", "utf8");
  const commands = [];
  const runner = async (command, args) => {
    commands.push({ command, args });
    if (args[0] === "QUERY") return { stdout: `${path.join(tempRoot, "user", "chrome-native-host", `${HAOLO_CHROME_NATIVE_HOST_NAME}.json`)}` };
    return { stdout: "", stderr: "" };
  };
  try {
    const manager = new ChromeNativeHostManager({
      userDataPath: path.join(tempRoot, "user"),
      hostExecutablePath: hostPath,
      extensionIds: [HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID],
      platform: "win32",
      commandRunner: runner,
    });
    const installed = await manager.install();
    const manifest = JSON.parse(fs.readFileSync(installed.manifestPath, "utf8"));
    assert.equal(manifest.name, HAOLO_CHROME_NATIVE_HOST_NAME);
    assert.equal(manifest.path, hostPath);
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID}/`]);
    assert.deepEqual(commands[0].args.slice(0, 2), ["ADD", manager.registryKey()]);
    const diagnosis = await manager.diagnose();
    assert.equal(diagnosis.healthy, true);
    await manager.uninstall();
    assert.equal(fs.existsSync(installed.manifestPath), false);
    assert.equal(commands.at(-1).args[0], "DELETE");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Native broker authenticates the host and binds one profile session", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-chrome-broker-"));
  const origin = `chrome-extension://${HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID}/`;
  const broker = new ChromeNativeBroker({ userDataPath: tempRoot, extensionOrigins: [origin], timeoutMs: 2_000, logger: { warn() {} } });
  try {
    await broker.start();
    const config = JSON.parse(fs.readFileSync(broker.configPath(), "utf8"));
    assert.equal(config.pipeName, broker.pipeName);
    assert.equal(config.expectedOrigins[0], origin);
    const socket = await connect(broker.pipePath);
    const messages = lineCollector(socket);
    socket.write(`${JSON.stringify({
      protocolVersion: 1,
      type: "host.hello",
      requestId: "host-1",
      token: config.token,
      origin,
    })}\n`);
    assert.equal((await messages.next()).type, "host.ready");
    socket.write(`${JSON.stringify({
      protocolVersion: 1,
      type: "extension.hello",
      requestId: "extension-1",
      profileId: "profile_12345678",
      extensionVersion: "0.1.0",
    })}\n`);
    const ready = await messages.next();
    assert.equal(ready.type, "extension.ready");
    assert.equal(ready.profileId, "profile_12345678");
    assert.equal(ready.payload.compatibility.readEnabled, true);
    assert.equal(ready.payload.compatibility.writeEnabled, true);
    assert.equal(broker.status().profileCount, 1);

    const call = broker.call("profile_12345678", "health.ping", { echo: "ok" });
    const outbound = await messages.next();
    assert.equal(outbound.type, "health.ping");
    socket.write(`${JSON.stringify({
      ...outbound,
      type: "tool.result",
      payload: { ok: true },
    })}\n`);
    assert.deepEqual(await call, { ok: true });

    const rawMessage = once(broker, "message");
    const auditMessage = once(broker, "audit");
    socket.write(`${JSON.stringify({
      protocolVersion: 1,
      type: "extension.site.permission",
      requestId: "site-1",
      sessionId: ready.sessionId,
      profileId: ready.profileId,
      payload: { allowed: false, approvalToken: "must-not-leak" },
    })}\n`);
    const [raw] = await rawMessage;
    const [audit] = await auditMessage;
    assert.equal(raw.envelope.payload.allowed, false);
    assert.equal(audit.envelope.payload.approvalToken, "[redacted]");
    socket.end();
  } finally {
    await broker.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Native broker release policy can stop writes while preserving read-only calls", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-chrome-broker-release-"));
  const origin = `chrome-extension://${HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID}/`;
  const broker = new ChromeNativeBroker({
    userDataPath: tempRoot,
    extensionOrigins: [origin],
    releasePolicy: { rolloutPercent: 100, emergencyWriteDisabled: true },
    timeoutMs: 2_000,
    logger: { warn() {} },
  });
  try {
    await broker.start();
    const config = JSON.parse(fs.readFileSync(broker.configPath(), "utf8"));
    const socket = await connect(broker.pipePath);
    const messages = lineCollector(socket);
    socket.write(`${JSON.stringify({ protocolVersion: 1, type: "host.hello", token: config.token, origin })}\n`);
    assert.equal((await messages.next()).type, "host.ready");
    socket.write(`${JSON.stringify({
      protocolVersion: 1,
      type: "extension.hello",
      requestId: "extension-release",
      profileId: "profile_release1",
      extensionVersion: "0.1.0",
    })}\n`);
    const ready = await messages.next();
    assert.equal(ready.payload.release.enabled, true);
    assert.equal(ready.payload.release.writeEnabled, false);

    await assert.rejects(
      broker.call("profile_release1", "tool.call", { tool: "click", arguments: { tab_id: 1, target: { name: "Save" } } }),
      (error) => error?.code === "CHROME_WRITE_DISABLED",
    );

    const read = broker.call("profile_release1", "tool.call", { tool: "list_tabs", arguments: {} });
    const outbound = await messages.next();
    assert.equal(outbound.payload.tool, "list_tabs");
    socket.write(`${JSON.stringify({ ...outbound, type: "tool.result", payload: { tabs: [] } })}\n`);
    assert.deepEqual(await read, { tabs: [] });
    socket.end();
  } finally {
    await broker.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Native broker rejects a wrong host token", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-chrome-broker-deny-"));
  const origin = `chrome-extension://${HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID}/`;
  const broker = new ChromeNativeBroker({ userDataPath: tempRoot, extensionOrigins: [origin], logger: { warn() {} } });
  try {
    await broker.start();
    const socket = await connect(broker.pipePath);
    const messages = lineCollector(socket);
    socket.write(`${JSON.stringify({ protocolVersion: 1, type: "host.hello", token: "wrong", origin })}\n`);
    const denial = await messages.next();
    assert.equal(denial.type, "host.error");
    assert.equal(denial.payload.code, "CHROME_HOST_UNAUTHORIZED");
    socket.destroy();
  } finally {
    await broker.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function connect(pipePath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipePath, () => resolve(socket));
    socket.once("error", reject);
  });
}

function lineCollector(socket) {
  let buffer = "";
  const queue = [];
  const waiters = [];
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const value = JSON.parse(line);
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
