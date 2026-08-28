import { pathToFileURL } from "node:url";
import { HaoloAccessTokenVerifier } from "./access-token-verifier.mjs";
import { BinanceRestGateway } from "./binance-rest.mjs";
import { GatewayCache } from "./cache.mjs";
import { loadGatewayConfig } from "./config.mjs";
import { PrivateEgressCoordinator } from "./private-egress-coordinator.mjs";
import { createPrivateProxyServer } from "./private-proxy.mjs";
import { createPublicGatewayServer } from "./public-server.mjs";
import { BinanceStreamPool } from "./stream-pool.mjs";

export async function startGateway(options = {}) {
  const config = options.config || loadGatewayConfig(options.env || process.env);
  const cache = options.cache || new GatewayCache({ redisUrl: config.redisUrl });
  await cache.connect();
  const startsPublic = config.gatewayRole !== "private";
  const startsPrivate = config.gatewayRole !== "public";
  const restGateway = startsPublic
    ? (options.restGateway || new BinanceRestGateway({ config, cache, fetchImpl: options.fetchImpl || globalThis.fetch }))
    : null;
  const streamPool = startsPublic
    ? (options.streamPool || new BinanceStreamPool({ config, WebSocketImpl: options.WebSocketImpl }))
    : null;
  const privateEgressCoordinator = startsPublic
    ? (options.privateEgressCoordinator || new PrivateEgressCoordinator({ config, cache }))
    : null;
  const accessTokenVerifier = startsPublic && config.authApiOrigin
    ? (options.accessTokenVerifier || new HaoloAccessTokenVerifier({ config, cache, fetchImpl: options.authFetchImpl || options.fetchImpl || globalThis.fetch }))
    : null;
  const publicGateway = startsPublic
    ? createPublicGatewayServer({ config, restGateway, streamPool, privateEgressCoordinator, accessTokenVerifier })
    : null;
  const privateProxy = startsPrivate ? createPrivateProxyServer({ config, cache }) : null;
  await publicGateway?.listen();
  try {
    await privateProxy?.listen();
  } catch (error) {
    await publicGateway?.close();
    await streamPool?.close();
    await cache.close();
    throw error;
  }
  console.log(JSON.stringify({
    event: "haolo_binance_gateway_started",
    role: config.gatewayRole,
    public: startsPublic ? `${config.publicHost}:${config.publicPort}` : null,
    private: startsPrivate ? `${config.privateHost}:${config.privatePort}` : null,
    privateShardId: startsPrivate ? config.privateEgressShardId : null,
    privateTls: privateProxy?.tlsEnabled || false,
    redis: Boolean(config.redisUrl),
  }));
  let closing;
  return Object.freeze({
    config,
    publicGateway,
    privateProxy,
    privateEgressCoordinator,
    status() {
      return { public: publicGateway?.status(), private: privateProxy?.status() };
    },
    close() {
      // Every caller waits for the same drain. Never close cache/upstream pools
      // when a listener failed to drain or still owns accepted work.
      return closing ||= (async () => {
        await Promise.all([publicGateway?.close(), privateProxy?.close()].filter(Boolean));
        await streamPool?.close();
        await cache.close();
      })();
    },
  });
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const gateway = await startGateway();
  const shutdown = async () => {
    await gateway.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
