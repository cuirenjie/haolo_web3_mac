import { OFFICIAL_TRADING_CATALOG } from '../../shared/official-trading-catalog.mjs';

// Discovery only. Codex chooses Skills; catalog lookup never classifies user text.
export class CloudTradingCatalog {
  listStrategies() {
    return { schemaVersion: 1, strategies: OFFICIAL_TRADING_CATALOG, diagnostics: [],
      runtime: { mode: 'cloud', enabled: true, shadow: false, disabledStrategyIds: [] } };
  }
}
