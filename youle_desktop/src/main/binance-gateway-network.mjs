import { createGatewayRouteLookup } from "./gateway-route-lookup.mjs";
import { createProxyFreeHttpsFetch } from "./proxy-free-https-fetch.mjs";

export function createBinanceGatewayNetworkFetch(config, options = {}) {
  if (options.network && config.marketOrigin === "https://market.youle.pro") {
    // The shared policy owns both proxy use and the GA/ordinary decision. Do not
    // race the old mixed IP candidate list or send a proxy user directly to GA.
    return options.network.fetch;
  }
  const routes = [];
  // The existing Hong Kong GA forwards these two exact TLS origins to their
  // existing server. Do not require production health identities on custom hosts.
  if (config.gatewayRouteSelection && config.marketOrigin === "https://market.youle.pro") {
    routes.push({ origin: config.marketOrigin, candidates: config.marketGatewayResolutionCandidates,
      service: "haolo-binance-market-gateway" });
  }
  if (config.gatewayRouteSelection && config.privateProxyUrl === "https://sg-a.binance-egress.waduo.com") {
    routes.push({ origin: config.privateProxyUrl, candidates: config.privateProxyResolutionCandidates,
      service: "haolo-binance-private-proxy" });
  }
  const routeLookup = routes.length ? createGatewayRouteLookup({ routes, ...options.routeOptions }) : null;
  return createProxyFreeHttpsFetch({
    allowedOrigins: [config.marketOrigin],
    resolutionCandidatesByHostname: {
      [new URL(config.marketOrigin).hostname]: config.marketGatewayResolutionCandidates,
    },
    timeoutMs: config.gatewayRequestTimeoutMs,
    ...options.fetchOptions,
    routeLookup,
  });
}
