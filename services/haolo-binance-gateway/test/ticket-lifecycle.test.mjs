import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { once } from "node:events";
import WebSocket from "ws";
import { GatewayCache } from "../src/cache.mjs";
import { createPublicGatewayServer } from "../src/public-server.mjs";
import { baseConfig, createJwt } from "./helpers.mjs";

test("real upgrades classify replay, expiry and unknown tickets without weakening auth or logging credentials", async t => {
  let clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  const config = baseConfig(), cache = new GatewayCache(), diagnostics = [];
  const gateway = createPublicGatewayServer({ config, restGateway: { cache }, onDiagnostic: d => diagnostics.push(d),
    streamPool: { stats: () => ({}), subscribe() { return () => {}; } } });
  await gateway.listen(); t.after(() => gateway.close());
  const origin = `http://127.0.0.1:${gateway.server.address().port}`;
  const issue = async () => {
    const r = await fetch(`${origin}/api/market/v1/tickets`, { method: "POST",
      headers: { authorization: `Bearer ${createJwt(config.jwtSecret)}`, "content-type": "application/json" },
      body: JSON.stringify({ ticketProtocol: 2 }) });
    assert.equal(r.status, 201); return r.json();
  };
  const upgrade = ticket => new WebSocket(`${origin.replace("http:", "ws:")}/stream/futures?ticket=${ticket}`);
  const reject = async ticket => {
    const socket = upgrade(ticket);
    socket.on("error", () => {});
    const result = await new Promise(resolve => socket.on("unexpected-response", (_req, response) => {
      resolve({ status: response.statusCode, code: response.headers["x-haolo-error-code"] });
      response.destroy(); socket.terminate();
    }));
    if (socket.readyState !== 3) await once(socket, "close");
    return result;
  };
  const first = await issue(), accepted = upgrade(first.ticket);
  await once(accepted, "open");
  const ended = Promise.all([once(accepted, "close"), once([...gateway.websocketServer.clients][0], "close")]);
  accepted.close(); await ended;
  assert.deepEqual(await reject(first.ticket), { status: 401, code: "WS_TICKET_CONSUMED" });
  const expiring = await issue(); clock += 30_000;
  assert.deepEqual(await reject(expiring.ticket), { status: 401, code: "WS_TICKET_EXPIRED" });
  assert.deepEqual(await reject(crypto.randomBytes(32).toString("base64url")), { status: 401, code: "WS_TICKET_UNKNOWN" });
  assert.deepEqual(await reject("malformed"), { status: 401, code: "WS_TICKET_INVALID" });
  const fresh = await issue(), recovered = upgrade(fresh.ticket);
  await once(recovered, "open");
  const recoveredClose = Promise.all([once(recovered, "close"), once([...gateway.websocketServer.clients][0], "close")]);
  recovered.close(); await recoveredClose;
  assert.equal(gateway.metrics.websocketClients, 0);
  assert.equal(gateway.metrics.websocketTicketConsumed, 1);
  assert.equal(gateway.metrics.websocketTicketExpired, 1);
  assert.equal(gateway.metrics.websocketTicketUnknown, 1);
  const issued = diagnostics.find(d => d.event === "market_ticket_issued");
  assert.equal(issued.clientProtocol, "2");
  assert.equal(diagnostics.find(d => d.code === "WS_TICKET_CONSUMED").ticketRef, issued.ticketRef);
  for (const secret of [first.ticket, expiring.ticket, fresh.ticket, config.jwtSecret]) assert.ok(!JSON.stringify(diagnostics).includes(secret));
});
