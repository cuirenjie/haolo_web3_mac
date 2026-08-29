import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const apiClientSource = readFile(new URL("../src/main/youle-api-client.mjs", import.meta.url), "utf8");
const mainProcessSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");

test("recharge page exposes an aligned recharge-history dialog with required columns", async () => {
  const renderer = await rendererSource;

  assert.match(renderer, /class="recharge-history-action"/);
  assert.match(renderer, /data-recharge-history-open/);
  assert.match(renderer, /充值时间/);
  assert.match(renderer, /金额/);
  assert.match(renderer, /支付方式/);
  assert.match(renderer, /到账积分/);
  assert.match(renderer, /<th>交易记录<\/th>/);
  assert.doesNotMatch(renderer, /<th>积分余额<\/th>/);
  assert.doesNotMatch(renderer, /会员到期日/);
  assert.match(renderer, /transaction_hash/);
  assert.match(renderer, /normalizeRechargeHistoryTransactionHash/);
  assert.match(renderer, /data-recharge-history-transaction/);
  assert.match(renderer, /站内转账，无链上记录/);
  assert.match(renderer, /truncateRechargeHistoryTransactionHash/);
  assert.match(renderer, /api\.openBlockchainTransaction/);
  assert.match(renderer, /币安内部转账/);
  assert.match(renderer, /OKX内部转账/);
  assert.match(renderer, /币安链 BSC/);
  assert.match(renderer, /波场 TRON/);
  assert.match(renderer, /Arbitrum One/);
  assert.match(renderer, /role="dialog" aria-modal="true"/);
  assert.match(renderer, /data-recharge-history-backdrop/);
  assert.match(renderer, /data-recharge-history-retry/);
  assert.match(renderer, /event\.key !== "Escape"/);
});

test("recharge history is connected through authenticated Electron IPC", async () => {
  const [apiClient, mainProcess, preload] = await Promise.all([
    apiClientSource,
    mainProcessSource,
    preloadSource,
  ]);

  assert.match(apiClient, /async listWeb3RechargeHistory/);
  assert.match(apiClient, /web3PaymentOrdersPath\}\/history\?limit=\$\{limit\}/);
  assert.match(apiClient, /clientHeaders\(\{ auth: true \}\)/);
  assert.match(mainProcess, /ipcMain\.handle\("youle:listWeb3RechargeHistory"/);
  assert.match(preload, /listWeb3RechargeHistory: \(params\) => ipcRenderer\.invoke\("youle:listWeb3RechargeHistory", params\)/);
  assert.match(mainProcess, /ipcMain\.handle\("youle:openBlockchainTransaction"/);
  assert.match(mainProcess, /blockchainTransactionUrl\(params\)/);
  assert.match(preload, /openBlockchainTransaction: \(params\) => ipcRenderer\.invoke\("youle:openBlockchainTransaction", params\)/);
});

test("recharge history covers light, dark, interaction, loading and empty states", async () => {
  const styles = await stylesSource;

  assert.match(styles, /\.recharge-history-action[\s\S]*?grid-column: 3/);
  assert.match(styles, /\.recharge-history-button:hover:not\(:disabled\)/);
  assert.match(styles, /\.recharge-history-button:active:not\(:disabled\)/);
  assert.match(styles, /\.recharge-history-button:focus-visible/);
  assert.match(styles, /\.recharge-history-button:disabled/);
  assert.match(styles, /\.recharge-history-skeleton/);
  assert.match(styles, /\.recharge-history-status\.error/);
  assert.match(styles, /\.recharge-history-dialog[\s\S]*?height: min\(680px, calc\(100vh - 120px\)\)/);
  assert.match(styles, /\.recharge-history-table-wrap[\s\S]*?overflow-y: scroll/);
  assert.match(styles, /\.recharge-history-table-wrap[\s\S]*?scrollbar-gutter: stable/);
  assert.match(styles, /\.recharge-history-table-wrap[\s\S]*?scrollbar-color: transparent transparent/);
  assert.match(styles, /\.recharge-history-table-wrap:hover,[\s\S]*?\.recharge-history-table-wrap\.is-scrollbar-active/);
  assert.match(styles, /\.recharge-history-table-wrap::-webkit-scrollbar-button[\s\S]*?display: none/);
  assert.match(styles, /\.recharge-history-table-wrap::-webkit-scrollbar-thumb:hover/);
  assert.match(styles, /\.recharge-history-table-wrap::-webkit-scrollbar-thumb:active/);
  assert.match(styles, /\.recharge-history-transaction:hover:not\(:disabled\)/);
  assert.match(styles, /\.recharge-history-transaction:active:not\(:disabled\)/);
  assert.match(styles, /\.recharge-history-transaction:focus-visible/);
  assert.match(styles, /\.recharge-history-transaction:disabled/);
  assert.match(await rendererSource, /addEventListener\("wheel", revealScrollbarForWheel, \{ passive: true \}\)/);
  assert.match(await rendererSource, /aria-label="充值记录，可上下滑动查看更多" tabindex="0"/);
  assert.match(await rendererSource, /class="recharge-history-status empty"/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-history-dialog/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-history-table th/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-history-table-wrap::-webkit-scrollbar-thumb:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-history-table-wrap::-webkit-scrollbar-thumb:active/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-history-transaction:hover:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-history-transaction:active:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-history-transaction:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-history-transaction:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.recharge-history-status button:hover/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?recharge-history-skeleton::after/);
});
