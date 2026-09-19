import { createHash } from "node:crypto";

export function compressionCohort(userId, percent = 0) {
  if (!(percent > 0)) return false;
  const bucket = createHash("sha256").update(`market-compression-v1:${userId}`).digest().readUInt32BE(0) % 100;
  return bucket < percent;
}

export function compressionOptions(config) {
  if (!(config.wsCompressionPercent > 0)) return false;
  return {
    serverNoContextTakeover: true,
    clientNoContextTakeover: true,
    serverMaxWindowBits: 12,
    concurrencyLimit: config.wsCompressionConcurrency || 2,
    threshold: config.wsCompressionThreshold || 1024,
    zlibDeflateOptions: { level: 1, memLevel: 7 },
  };
}
