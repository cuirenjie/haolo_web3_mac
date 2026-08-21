import assert from "node:assert/strict";
import test from "node:test";

import { blockchainTransactionUrl } from "../src/main/blockchain-explorer.mjs";

const EVM_HASH = `0x${"a".repeat(64)}`;
const TRON_HASH = "b".repeat(64);

test("blockchain transaction URLs use fixed HTTPS explorer origins", () => {
  assert.equal(
    blockchainTransactionUrl({ network: "bsc", transactionHash: EVM_HASH }),
    `https://bscscan.com/tx/${EVM_HASH}`,
  );
  assert.equal(
    blockchainTransactionUrl({ network: "arbitrum", transactionHash: EVM_HASH }),
    `https://arbiscan.io/tx/${EVM_HASH}`,
  );
  assert.equal(
    blockchainTransactionUrl({ network: "tron", transactionHash: TRON_HASH }),
    `https://tronscan.org/#/transaction/${TRON_HASH}`,
  );
});

test("blockchain transaction URLs reject internal transfers and malformed hashes", () => {
  assert.throws(
    () => blockchainTransactionUrl({ network: "binance_internal", transactionHash: "12345" }),
    /没有可用的区块链浏览器记录/,
  );
  assert.throws(
    () => blockchainTransactionUrl({ network: "okx_internal", transactionHash: "12345" }),
    /没有可用的区块链浏览器记录/,
  );
  assert.throws(
    () => blockchainTransactionUrl({ network: "bsc", transactionHash: `${EVM_HASH}/../../malicious` }),
    /交易哈希格式无效/,
  );
  assert.throws(
    () => blockchainTransactionUrl({ network: "tron", transactionHash: EVM_HASH }),
    /交易哈希格式无效/,
  );
});
