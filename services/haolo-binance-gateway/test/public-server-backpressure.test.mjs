import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createPublicGatewayServer } from "../src/public-server.mjs";
import { baseConfig } from "./helpers.mjs";

function connection(t, streams) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const listeners = new Map();
  const gateway = createPublicGatewayServer({
    config: baseConfig(), restGateway: { cache: {} },
    streamPool: {
      stats: () => ({}),
      subscribe(_marketType, stream, listener) {
        listeners.set(stream, listener);
        return () => listeners.delete(stream);
      },
    },
  });
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1, bufferedAmount: 600_000, extensions: "", sent: [],
    send(frame) { this.sent.push(JSON.parse(frame)); },
    close(code) { this.closeCode = code; this.readyState = 3; this.emit("close"); },
  });
  gateway.websocketServer.emit("connection", socket, {}, {
    route: { marketType: "futures", mode: "stream", initialStreams: streams },
    identity: { userId: "backpressure-test" },
  });
  t.after(async () => { socket.close(); await gateway.close(); });
  return { socket, gateway, emit: (stream, E) => listeners.get(stream)({ stream, data: { E } }) };
}

test("buffer recovery sends the latest value without flushing an older value afterwards", (t) => {
  const { socket, emit } = connection(t, ["btcusdt@ticker", "ethusdt@ticker"]);
  emit("btcusdt@ticker", 1);
  emit("ethusdt@ticker", 2);
  socket.bufferedAmount = 0;
  emit("btcusdt@ticker", 3);
  t.mock.timers.tick(25);
  assert.deepEqual(socket.sent.map((frame) => [frame.stream, frame.data.E]), [["btcusdt@ticker", 3], ["ethusdt@ticker", 2]]);
  t.mock.timers.tick(25);
  assert.equal(socket.sent.length, 2);
});

test("sustained backpressure still coalesces and flushes only the latest quote", (t) => {
  const { socket, gateway, emit } = connection(t, ["btcusdt@ticker"]);
  emit("btcusdt@ticker", 1);
  emit("btcusdt@ticker", 2);
  t.mock.timers.tick(25);
  assert.equal(socket.sent.length, 0);
  socket.bufferedAmount = 0;
  t.mock.timers.tick(25);
  assert.deepEqual(socket.sent.map((frame) => frame.data.E), [2]);
  assert.equal(gateway.metrics.websocketCoalescedFrames, 2);
});

test("unsubscribe removes a queued quote before an old flush can deliver it", (t) => {
  const { socket, emit } = connection(t, ["btcusdt@ticker"]);
  emit("btcusdt@ticker", 1);
  socket.emit("message", JSON.stringify({ method: "UNSUBSCRIBE", params: ["btcusdt@ticker"], id: 1 }));
  socket.bufferedAmount = 0;
  t.mock.timers.tick(25);
  assert.deepEqual(socket.sent, [{ result: null, id: 1 }]);
});

test("trade streams remain ordered and the hard watermark still disconnects a slow client", (t) => {
  const { socket, gateway, emit } = connection(t, ["btcusdt@aggTrade"]);
  emit("btcusdt@aggTrade", 1);
  emit("btcusdt@aggTrade", 2);
  assert.deepEqual(socket.sent.map((frame) => frame.data.E), [1, 2]);
  socket.bufferedAmount = 2 * 1024 * 1024;
  emit("btcusdt@aggTrade", 3);
  assert.equal(socket.closeCode, 1013);
  assert.equal(gateway.metrics.websocketBackpressureDisconnects, 1);
});
