import { isIP } from "node:net";

// A lookup belongs to one connection. Retain its selected address before TLS
// or WebSocket upgrade, when a failed socket may no longer expose its peer.
export function createConnectionLookup(lookup) {
  if (typeof lookup !== "function" || typeof lookup.invalidate !== "function") return lookup;
  let selected = null;
  const connectionLookup = (hostname, options, callback) => {
    if (typeof options === "function") { callback = options; options = {}; }
    return lookup(hostname, options, (error, result, family) => {
      const address = typeof result === "string" ? result
        : Array.isArray(result) && result.length === 1 ? result[0]?.address : null;
      selected = !error && isIP(address || "") === 4
        ? { hostname: String(hostname).toLowerCase(), address } : null;
      callback(error, result, family);
    });
  };
  connectionLookup.invalidate = (hostname, remoteAddress) => {
    const address = remoteAddress || (selected?.hostname === String(hostname).toLowerCase() ? selected.address : null);
    // Unknown addresses must not be inferred from a newer shared route cache.
    if (isIP(address || "") === 4) lookup.invalidate(hostname, address);
  };
  return connectionLookup;
}
