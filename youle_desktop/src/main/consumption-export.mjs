import fs from "node:fs";
import path from "node:path";

export function normalizeConsumptionExportUnit(value) {
  return value === "points" || value === "usd" ? "points" : "token";
}

export function consumptionExportDefaultFileName(unit, now = new Date(), copy = {}) {
  const normalizedUnit = normalizeConsumptionExportUnit(unit);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now).replaceAll("-", "");
  const prefix = copy.fileNamePrefix || "HaoLo使用数据";
  const unitLabel = normalizedUnit === "points" ? copy.pointsLabel || "积分" : copy.tokenLabel || "Token";
  return `${prefix}_${unitLabel}_${date}.xlsx`;
}

export function ensureXlsxFilePath(value) {
  const filePath = path.resolve(String(value || ""));
  const extension = path.extname(filePath);
  if (extension.toLowerCase() === ".xlsx") return filePath;
  return extension ? `${filePath.slice(0, -extension.length)}.xlsx` : `${filePath}.xlsx`;
}

export async function saveConsumptionReport({
  app,
  dialog,
  window,
  apiClient,
  unit,
  copy = {},
  now = new Date(),
  writeFile = fs.promises.writeFile,
} = {}) {
  const normalizedUnit = normalizeConsumptionExportUnit(unit);
  const defaultPath = path.join(app.getPath("downloads"), consumptionExportDefaultFileName(normalizedUnit, now, copy));
  const selection = await dialog.showSaveDialog(window || undefined, {
    title: copy.title || "导出使用数据",
    defaultPath,
    filters: [{ name: copy.filterName || "Excel 工作簿", extensions: ["xlsx"] }],
  });
  if (selection.canceled || !selection.filePath) return { ok: false, canceled: true };

  const filePath = ensureXlsxFilePath(selection.filePath);
  const report = await apiClient.exportConsumptionReport({
    unit: normalizedUnit,
    destinationPath: filePath,
  });
  if (!report?.path) {
    const bytes = Buffer.isBuffer(report?.bytes) ? report.bytes : Buffer.from(report?.bytes || []);
    if (!bytes.length) throw new Error(copy.emptyFileError || "消费明细导出失败：后端返回了空文件");
    await writeFile(filePath, bytes);
  }
  return {
    ok: true,
    canceled: false,
    path: filePath,
    unit: normalizedUnit,
  };
}
