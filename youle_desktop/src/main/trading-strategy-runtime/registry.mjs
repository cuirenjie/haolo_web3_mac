import { publicStrategyManifest, validateStrategyManifest } from "./contracts.mjs";
import { createDeclarativeStrategyAdapter } from "./declarative-adapter.mjs";
import { tradingStrategyRuntimeEnabled, tradingStrategyRuntimeStatus } from "./feature-flags.mjs";
import { loadTradingStrategyManifestFiles } from "./manifest-loader.mjs";

function diagnosticRecord(id, message, manifestPath = null) {
  return Object.freeze({
    id: String(id || "unknown").slice(0, 80),
    message: String(message || "Invalid strategy package").slice(0, 300),
    manifestPath,
  });
}

export class TradingStrategyRegistry {
  #strategies = new Map();
  #disabledStrategies = new Map();
  #adapters = new Map();
  #strategyAdapters = new Map();
  #diagnostics = [];
  #environment;

  constructor({ manifestRecords = [], adapters = [], environment = process.env } = {}) {
    this.#environment = environment;
    for (const adapter of adapters) {
      const id = String(adapter?.id || "").trim();
      if (!id || typeof adapter?.run !== "function" || !adapter?.routing) {
        throw new TypeError("Trading strategy adapters must expose id, routing, and run");
      }
      if (this.#adapters.has(id)) throw new TypeError(`Duplicate trading strategy adapter: ${id}`);
      this.#adapters.set(id, adapter);
    }

    const claims = new Map();
    for (const record of manifestRecords) {
      if (record?.error) {
        this.#diagnostics.push(diagnosticRecord(
          record?.manifest?.id || record?.packageRoot?.split(/[\\/]/).at(-1),
          record.error.message,
          record.manifestPath,
        ));
        continue;
      }
      let manifest = null;
      let mentionClaimsAccepted = false;
      try {
        manifest = validateStrategyManifest(record?.manifest ?? record);
        if (this.#strategies.has(manifest.id) || this.#disabledStrategies.has(manifest.id)) {
          throw new TypeError(`Duplicate strategy id: ${manifest.id}`);
        }
        const names = [manifest.mentions.canonical, ...manifest.mentions.aliases];
        for (const name of names) {
          const key = name.toLocaleLowerCase("zh-CN");
          if (claims.has(key)) throw new TypeError(`Duplicate strategy mention: ${name}`);
        }
        names.forEach((name) => claims.set(name.toLocaleLowerCase("zh-CN"), manifest.id));
        mentionClaimsAccepted = true;
        const strategyAdapter = manifest.implementation.kind === "builtin-adapter"
          ? this.#adapters.get(manifest.implementation.adapterId)
          : createDeclarativeStrategyAdapter({ manifest, packageRoot: record?.packageRoot, rules: record?.rules });
        if (!strategyAdapter) throw new TypeError(`Adapter ${manifest.implementation.adapterId} is not registered`);
        this.#strategies.set(manifest.id, Object.freeze({
          manifest,
          packageRoot: record?.packageRoot || null,
          manifestPath: record?.manifestPath || null,
        }));
        this.#strategyAdapters.set(manifest.id, strategyAdapter);
      } catch (error) {
        if (manifest && mentionClaimsAccepted) {
          this.#disabledStrategies.set(manifest.id, Object.freeze({
            manifest,
            diagnostic: String(error.message || "Strategy implementation is unavailable").slice(0, 300),
          }));
        }
        this.#diagnostics.push(diagnosticRecord(
          record?.manifest?.id || record?.id,
          error.message,
          record?.manifestPath,
        ));
      }
    }
  }

  list({ includeDisabled = true } = {}) {
    const available = [...this.#strategies.values()]
      .map(({ manifest }) => {
        const usesV1Runtime = tradingStrategyRuntimeEnabled(manifest.id, this.#environment);
        return publicStrategyManifest(manifest, {
          enabled: true,
          diagnostic: usesV1Runtime ? null : "该策略当前通过兼容链路运行",
        });
      });
    const unavailable = [...this.#disabledStrategies.values()].map(({ manifest, diagnostic }) => (
      publicStrategyManifest(manifest, { enabled: false, diagnostic })
    ));
    return [...available, ...unavailable]
      .filter((manifest) => includeDisabled || manifest.enabled)
      .sort((first, second) => first.display.sortOrder - second.display.sortOrder || first.id.localeCompare(second.id));
  }

  get(strategyId) {
    return this.#strategies.get(String(strategyId || "").trim()) || null;
  }

  require(strategyId) {
    const strategy = this.get(strategyId);
    if (!strategy) {
      const error = new Error("Unknown or unavailable trading strategy");
      error.code = "TRADING_STRATEGY_NOT_FOUND";
      throw error;
    }
    return strategy;
  }

  adapter(strategyId) {
    const strategy = this.require(strategyId);
    return this.#strategyAdapters.get(strategy.manifest.id) || null;
  }

  diagnostics() {
    return Object.freeze([...this.#diagnostics]);
  }

  runtimeStatus() {
    return tradingStrategyRuntimeStatus(this.#environment);
  }
}

export function createTradingStrategyRegistry({ adapters = [], environment = process.env, manifestRoot } = {}) {
  return new TradingStrategyRegistry({
    manifestRecords: loadTradingStrategyManifestFiles(manifestRoot),
    adapters,
    environment,
  });
}
