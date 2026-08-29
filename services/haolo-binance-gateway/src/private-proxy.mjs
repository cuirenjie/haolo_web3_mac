import dns from "node:dns/promises";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { metricsAuthorized, proxyToken, verifyHaoloJwt, verifyPrivateEgressPermit } from "./auth.mjs";
import { FixedWindowRateLimiter } from "./rate-limit.mjs";
import { DrainState, closeHttp } from "./drain.mjs";

const blockedAddresses = new net.BlockList();
for (const [subnet, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blockedAddresses.addSubnet(subnet, prefix, "ipv4");
for (const [subnet, prefix] of [
  ["::", 128], ["::1", 128], ["100::", 64], ["2001:2::", 48], ["2001:10::", 28],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
]) blockedAddresses.addSubnet(subnet, prefix, "ipv6");

export function isPublicAddress(address) {
  const normalized = String(address || "").trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (mapped) return net.isIPv4(mapped[1]) && !blockedAddresses.check(mapped[1], "ipv4");
  if (net.isIPv4(normalized)) return !blockedAddresses.check(normalized, "ipv4");
  if (net.isIPv6(normalized)) return !blockedAddresses.check(normalized, "ipv6");
  return false;
}

function parseAuthority(value) {
  const text = String(value || "").trim();
  const bracket = /^\[([^\]]+)\]:(\d+)$/.exec(text);
  const simple = /^([^:]+):(\d+)$/.exec(text);
  const host = String(bracket?.[1] || simple?.[1] || "").toLowerCase();
  const port = Number(bracket?.[2] || simple?.[2]);
  return { host, port };
}

function reject(socket, statusCode, reason, authenticate = false) {
  socket.write(
    `HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\n${authenticate ? 'Proxy-Authenticate: Basic realm="haolo-private"\r\n' : ""}\r\n`,
  );
  socket.destroy();
}

export function createPrivateProxyServer({ config, cache = null, lookup = dns.lookup, connect = net.connect } = {}) {
  const tlsEnabled = Boolean(config.privateTlsCertPath && config.privateTlsKeyPath);
  const drain = new DrainState();
  let closing;
  const requestHandler = drain.http((request, response) => {
    if (request.url === "/metrics") {
      if (!metricsAuthorized(request.headers, config.metricsToken)) {
        const payload = '{"error":"AUTHENTICATION_REQUIRED"}';
        response.writeHead(401, { "content-type": "application/json", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
        response.end(payload);
        return;
      }
      const payload = `${Object.entries(metrics).map(([key, value]) => `haolo_private_proxy_${key} ${Number(value)}`).join("\n")}\n`;
      response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
      response.end(payload);
      return;
    }
    if (request.url === "/health" || request.url === "/ready") {
      const ready = request.url !== "/ready" || (cache?.ready?.() ?? false);
      const payload = JSON.stringify({ status: ready ? "ok" : "not_ready", service: "haolo-binance-private-proxy", tls: tlsEnabled, cache: cache?.redis ? "redis" : "memory" });
      response.writeHead(ready ? 200 : 503, { "content-type": "application/json", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
      response.end(payload);
      return;
    }
    response.writeHead(405, { allow: "CONNECT", "content-type": "application/json" });
    response.end('{"error":"CONNECT_REQUIRED"}');
  });
  const server = tlsEnabled
    ? https.createServer({ cert: fs.readFileSync(config.privateTlsCertPath), key: fs.readFileSync(config.privateTlsKeyPath), minVersion: "TLSv1.2" }, requestHandler)
    : http.createServer(requestHandler);
  const connectLimiter = new FixedWindowRateLimiter({ limit: config.privateProxyConnectsPerMinute });
  const activeByUser = new Map();
  const tunnelSockets = new Set();
  const allowedHosts = new Set(config.privateAllowedHosts);
  const metrics = { activeTunnels: 0, acceptedTunnels: 0, rejectedTunnels: 0, permitRejected: 0, upstreamFailures: 0 };

  server.on("connect", drain.upgrade(async (request, clientSocket, head) => {
    const target = parseAuthority(request.url);
    if (target.port !== 443 || !allowedHosts.has(target.host)) {
      metrics.rejectedTunnels += 1;
      reject(clientSocket, 403, "Forbidden");
      return;
    }
    let identity;
    let permit = null;
    try {
      const token = proxyToken(request.headers);
      if (!token) {
        metrics.rejectedTunnels += 1;
        reject(clientSocket, 407, "Proxy Authentication Required", true);
        return;
      }
      try {
        permit = verifyPrivateEgressPermit(token, config);
        identity = { userId: permit.userId };
      } catch (error) {
        if (!config.allowLegacyPrivateProxyJwt) throw error;
        identity = verifyHaoloJwt(token, config);
      }
    } catch {
      metrics.rejectedTunnels += 1;
      metrics.permitRejected += 1;
      reject(clientSocket, 407, "Proxy Authentication Required", true);
      return;
    }
    if (permit && (
      permit.shardId !== config.privateEgressShardId
      || permit.targetHost !== target.host
      || !cache
    )) {
      metrics.rejectedTunnels += 1;
      metrics.permitRejected += 1;
      reject(clientSocket, 403, "Forbidden");
      return;
    }
    const rate = connectLimiter.consume(identity.userId);
    const active = Number(activeByUser.get(identity.userId) || 0);
    if (!rate.allowed || active >= config.privateProxyMaxConnectionsPerUser) {
      metrics.rejectedTunnels += 1;
      reject(clientSocket, 429, "Too Many Requests");
      return;
    }
    if (permit) {
      const record = await cache.take(`private-permit:${permit.permitId}`).catch(() => null);
      if (
        !record
        || record.userId !== permit.userId
        || record.shardId !== permit.shardId
        || record.targetHost !== target.host
        || Number(record.weight) !== permit.weight
      ) {
        metrics.rejectedTunnels += 1;
        metrics.permitRejected += 1;
        reject(clientSocket, 409, "Conflict");
        return;
      }
    }
    let addresses;
    try {
      addresses = await lookup(target.host, { all: true, verbatim: true });
    } catch {
      metrics.upstreamFailures += 1;
      reject(clientSocket, 502, "Bad Gateway");
      return;
    }
    const selected = addresses.find((entry) => isPublicAddress(entry.address));
    if (!selected || addresses.some((entry) => !isPublicAddress(entry.address))) {
      metrics.rejectedTunnels += 1;
      reject(clientSocket, 403, "Forbidden");
      return;
    }
    activeByUser.set(identity.userId, active + 1);
    metrics.activeTunnels += 1;
    metrics.acceptedTunnels += 1;
    const upstream = connect({ host: selected.address, port: target.port, family: selected.family });
    tunnelSockets.add(clientSocket);
    tunnelSockets.add(upstream);
    const release = () => {
      if (upstream.__haoloReleased) return;
      upstream.__haoloReleased = true;
      metrics.activeTunnels = Math.max(0, metrics.activeTunnels - 1);
      const remaining = Math.max(0, Number(activeByUser.get(identity.userId) || 1) - 1);
      if (remaining) activeByUser.set(identity.userId, remaining); else activeByUser.delete(identity.userId);
      tunnelSockets.delete(clientSocket);
      tunnelSockets.delete(upstream);
    };
    upstream.setTimeout(config.privateProxyIdleTimeoutMs, () => upstream.destroy());
    clientSocket.setTimeout(config.privateProxyIdleTimeoutMs, () => clientSocket.destroy());
    const lifetimeTimer = setTimeout(() => {
      upstream.destroy();
      clientSocket.destroy();
    }, config.privateProxyMaxTunnelMs || 30_000);
    lifetimeTimer.unref?.();
    upstream.once("connect", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: haolo-private\r\n\r\n");
      if (head?.length) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });
    upstream.once("error", () => {
      metrics.upstreamFailures += 1;
      if (!clientSocket.destroyed) reject(clientSocket, 502, "Bad Gateway");
    });
    upstream.once("close", () => {
      clearTimeout(lifetimeTimer);
      release();
    });
    clientSocket.once("close", () => {
      clearTimeout(lifetimeTimer);
      upstream.destroy();
      release();
    });
  }));

  return Object.freeze({
    server,
    metrics,
    tlsEnabled,
    status: () => ({ phase: drain.phase, operations: drain.operations, tunnels: metrics.activeTunnels }),
    async listen() {
      await new Promise((resolve, rejectPromise) => {
        server.once("error", rejectPromise);
        server.listen(config.privatePort, config.privateHost, () => {
          server.off("error", rejectPromise);
          resolve();
        });
      });
    },
    async close() {
      if (!closing) {
        drain.begin();
        const httpClosed = closeHttp(server);
        closing = (async () => {
          await drain.idle(() => tunnelSockets.size === 0);
          await httpClosed;
          drain.phase = "stopped";
        })();
      }
      return closing;
    },
  });
}
