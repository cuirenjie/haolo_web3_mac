import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  consumptionExportDefaultFileName,
  ensureXlsxFilePath,
  normalizeConsumptionExportUnit,
  saveConsumptionReport,
} from "../src/main/consumption-export.mjs";

test("consumption export builds a Shanghai-dated xlsx file name", () => {
  const now = new Date("2026-07-18T16:30:00.000Z");
  assert.equal(consumptionExportDefaultFileName("token", now), "HaoLo使用数据_Token_20260719.xlsx");
  assert.equal(consumptionExportDefaultFileName("points", now), "HaoLo使用数据_积分_20260719.xlsx");
  assert.equal(consumptionExportDefaultFileName("usd", now), "HaoLo使用数据_积分_20260719.xlsx");
  assert.equal(normalizeConsumptionExportUnit("usd"), "points");
  assert.equal(normalizeConsumptionExportUnit("other"), "token");
  assert.equal(ensureXlsxFilePath(path.join("reports", "usage")), path.resolve("reports", "usage.xlsx"));
  assert.equal(ensureXlsxFilePath(path.join("reports", "usage.csv")), path.resolve("reports", "usage.xlsx"));
});

test("consumption export stops before the backend request when save is canceled", async () => {
  let requested = false;
  const result = await saveConsumptionReport({
    app: { getPath: () => "D:\\downloads" },
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    apiClient: { exportConsumptionReport: async () => { requested = true; } },
    unit: "points",
  });
  assert.deepEqual(result, { ok: false, canceled: true });
  assert.equal(requested, false);
});

test("consumption export downloads the selected unit and writes the returned workbook", async () => {
  const writes = [];
  const requests = [];
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]);
  const selectedPath = path.resolve("reports", "all-usage");
  const workbookPath = `${selectedPath}.xlsx`;
  const result = await saveConsumptionReport({
    app: { getPath: () => path.resolve("downloads") },
    dialog: {
      showSaveDialog: async (_window, options) => {
        assert.equal(options.title, "导出使用数据");
        assert.match(options.defaultPath, /HaoLo使用数据_积分_/);
        return { canceled: false, filePath: selectedPath };
      },
    },
    apiClient: {
      exportConsumptionReport: async (params) => {
        requests.push(params);
        return { bytes };
      },
    },
    unit: "points",
    writeFile: async (filePath, contents) => writes.push({ filePath, contents }),
  });

  assert.deepEqual(requests, [{
    unit: "points",
    destinationPath: workbookPath,
  }]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filePath, workbookPath);
  assert.deepEqual(writes[0].contents, bytes);
  assert.deepEqual(result, {
    ok: true,
    canceled: false,
    path: workbookPath,
    unit: "points",
  });
});
