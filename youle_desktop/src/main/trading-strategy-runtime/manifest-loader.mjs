import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function builtInTradingStrategyManifestRoot() {
  return fileURLToPath(new URL("../../../resources/trading-strategies/builtins/", import.meta.url));
}

export function loadTradingStrategyManifestFiles(root = builtInTradingStrategyManifestRoot()) {
  const absoluteRoot = path.resolve(root);
  if (!fs.existsSync(absoluteRoot)) return [];
  return fs.readdirSync(absoluteRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((first, second) => first.name.localeCompare(second.name, "en"))
    .map((entry) => {
      const packageRoot = path.join(absoluteRoot, entry.name);
      const manifestPath = path.join(packageRoot, "strategy.json");
      if (!fs.existsSync(manifestPath)) {
        return { packageRoot, manifestPath, error: new Error("strategy.json is missing") };
      }
      try {
        const text = fs.readFileSync(manifestPath, "utf8");
        if (Buffer.byteLength(text, "utf8") > 64 * 1024) throw new TypeError("strategy.json is too large");
        return { packageRoot, manifestPath, manifest: JSON.parse(text) };
      } catch (error) {
        return { packageRoot, manifestPath, error };
      }
    });
}
