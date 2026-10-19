export const OFFICIAL_TRADING_CATALOG: {
  schemaVersion: 1; id: string; version: string; publisher: {id: string; type: string};
  display: {name: string; group: 'strategy'|'indicator'; sortOrder: number};
  mentions: {canonical: string; aliases?: string[]}; implementation: {kind: 'cloud-v1'};
  capabilities: string[]; chartIndicator?: {id: string; scope: 'main'|'sub'; parameters: number[]} | null;
  enabled: boolean;
}[];
