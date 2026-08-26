import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const USER_DATA_SNAPSHOT_MANIFEST_FILE = "haolo-user-data-manifest.json";

const SNAPSHOT_FORMAT = "haolo-user-data-snapshot";
const SNAPSHOT_FORMAT_VERSION = 1;
const SNAPSHOT_DATA_DIR = "data";
const SNAPSHOT_USER_DATA_DIR = path.join(SNAPSHOT_DATA_DIR, "userData");
const SNAPSHOT_EXTERNAL_WORKSPACES_DIR = path.join(SNAPSHOT_DATA_DIR, "external-workspaces");
const PENDING_TRANSFER_FILE = "pending-transfer.json";
const LAST_TRANSFER_STATUS_FILE = "last-transfer-status.json";
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_COMPRESSION_STORE = 0;
const ZIP_COMPRESSION_DEFLATE = 8;
const MANAGED_EXTERNAL_WORKSPACE_DIRS = ["haolo-ai-home", "outputs"];
const USER_DATA_FULL_TOP_LEVEL_DIRS = new Set(["local storage"]);
const USER_DATA_FULL_TOP_LEVEL_FILES = new Set(["haolo-session.json", "local state", "preferences", "wechat-external-channel-state.json"]);
const USER_DATA_LOCAL_ONLY_TOP_LEVEL_FILES = new Set([
  "external-model-credentials.json",
  "binance-account-credentials.json",
  "personal-memory.json",
]);
const HAOLO_AI_HOME_FULL_DIRS = new Set(["sessions", "archived_sessions", "skills"]);
const HAOLO_AI_HOME_FULL_FILES = new Set(["config.toml", "installation_id", ".personality_migration"]);
const HAOLO_AI_HOME_SQLITE_PREFIXES = ["state_", "goals_", "memories_"];
const REMOVE_RETRY_ATTEMPTS = 12;
const REMOVE_RETRY_DELAY_MS = 250;

export function userDataTransferRoot(app, productName = "haolo_desktop") {
  return path.join(app.getPath("appData"), `${safeFileName(productName || "haolo_desktop")}-transfer`);
}

export function pendingUserDataTransferPath(app, productName) {
  return path.join(userDataTransferRoot(app, productName), PENDING_TRANSFER_FILE);
}

export function lastUserDataTransferStatusPath(app, productName) {
  return path.join(userDataTransferRoot(app, productName), LAST_TRANSFER_STATUS_FILE);
}

export async function scheduleUserDataExport({ app, dialog, window, productName, appVersion, workspaces = [], copy = {} }) {
  const result = await dialog.showOpenDialog(window || undefined, {
    title: copy.exportLocationTitle || "选择用户数据导出位置",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };

  await assertNoPendingTransfer(app, productName);
  const destinationParent = path.resolve(result.filePaths[0]);
  const exportDirName = `Haolo-user-data-${timestampForFileName()}`;
  const userDataPath = app.getPath("userData");
  if (isSamePathOrInside(destinationParent, userDataPath)) {
    throw new Error(copy.exportInsideUserDataError || "导出位置不能放在当前用户数据目录里面，请选择其他文件夹。");
  }
  const plan = {
    operation: "export",
    createdAt: new Date().toISOString(),
    productName,
    appVersion,
    userDataPath,
    destinationParent,
    exportDirName,
    externalWorkspaces: normalizeExternalWorkspaces(workspaces, userDataPath),
  };
  return executeExportPlan({ plan, productName, appVersion });
}

export async function scheduleUserDataImport({
  app,
  dialog,
  window,
  productName,
  appVersion,
  workspaces = [],
  copy = {},
  requestConfirmation = async () => false,
}) {
  const result = await dialog.showOpenDialog(window || undefined, {
    title: copy.importFileTitle || "选择用户数据备份 ZIP 文件",
    properties: ["openFile"],
    filters: [{ name: copy.importFilterName || "Haolo 用户数据备份 ZIP", extensions: ["zip"] }],
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };

  const sourcePath = path.resolve(result.filePaths[0]);
  await assertNoPendingTransfer(app, productName);
  const transferRoot = userDataTransferRoot(app, productName);
  const stagingRoot = path.join(transferRoot, "staging", `import-${timestampForFileName()}`);
  const sourceStat = await fs.promises.stat(sourcePath).catch(() => null);
  if (!sourceStat) {
    throw new Error(copy.missingBackupError || "所选用户数据备份不存在。");
  }

  let staged = false;
  let manifestRoot = sourcePath;
  try {
    if (!sourceStat.isFile() || path.extname(sourcePath).toLowerCase() !== ".zip") {
      throw new Error(copy.invalidZipError || "请选择 Haolo 用户数据备份 .zip 文件。");
    }
    staged = true;
    await extractSnapshotZipArchive({ zipPath: sourcePath, destinationRoot: stagingRoot });
    manifestRoot = stagingRoot;

    const manifest = await readSnapshotManifest(manifestRoot);
    validateSnapshotManifest(manifest, manifestRoot);

    const confirmed = await requestConfirmation({
      title: copy.confirmTitle || "导入用户数据",
      message: copy.confirmMessage || "导入会把当前用户数据恢复到所选备份状态。",
      detail: copy.confirmDetail || "导入前会先完整备份当前数据，不会合并新旧数据。应用将自动重启，并在窗口打开前完成替换。",
      confirmLabel: copy.confirmLabel || "继续导入",
      cancelLabel: copy.cancelLabel || "取消",
      tone: "danger",
    });
    if (!confirmed) {
      if (staged) await fs.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
      return { canceled: true };
    }
  } catch (error) {
    if (staged) await fs.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  const userDataPath = app.getPath("userData");
  const plan = {
    operation: "import",
    createdAt: new Date().toISOString(),
    productName,
    appVersion,
    userDataPath,
    sourceRoot: sourcePath,
    stagingRoot,
    currentExternalWorkspaces: normalizeExternalWorkspaces(workspaces, userDataPath),
  };
  await writeJsonAtomic(pendingUserDataTransferPath(app, productName), plan);
  return {
    ok: true,
    operation: "import",
    requiresRelaunch: true,
    sourceRoot: sourcePath,
  };
}

export async function consumeUserDataTransferStatus({ app, productName }) {
  const statusPath = lastUserDataTransferStatusPath(app, productName);
  const status = await readJsonFile(statusPath);
  if (!status) return null;
  await fs.promises.rm(statusPath, { force: true }).catch(() => {});
  return status;
}

export async function applyPendingUserDataTransfer({ app, productName, appVersion, logger = console }) {
  const pendingPath = pendingUserDataTransferPath(app, productName);
  const plan = await readJsonFile(pendingPath);
  if (!plan?.operation) return null;

  let status;
  try {
    if (plan.operation === "export") {
      status = await executeExportPlan({ plan, productName, appVersion });
    } else if (plan.operation === "import") {
      status = await executeImportPlan({ app, plan, productName, appVersion });
    } else {
      throw new Error("未知的用户数据迁移任务。");
    }
  } catch (error) {
    logger.warn?.("[user-data-transfer] pending transfer failed", error?.message || error);
    status = {
      ok: false,
      operation: plan.operation || "unknown",
      completedAt: new Date().toISOString(),
      message: errorMessage(error),
    };
  } finally {
    await fs.promises.rm(pendingPath, { force: true }).catch(() => {});
  }

  await writeJsonAtomic(lastUserDataTransferStatusPath(app, productName), status);
  return status;
}

export async function createUserDataSnapshot({
  destinationRoot,
  userDataPath,
  externalWorkspaces = [],
  productName,
  appVersion,
  kind = "export",
  sourceRoot = null,
}) {
  const startedAt = new Date();
  const destination = path.resolve(destinationRoot);
  await assertSafeDirectoryTarget(destination);
  await fs.promises.mkdir(destination, { recursive: true });

  const totals = emptyCopyTotals();
  const userDataTarget = path.join(destination, SNAPSHOT_USER_DATA_DIR);
  const userDataTotals = await copyTree(userDataPath, userDataTarget, { filter: includeUserDataEntry });
  addCopyTotals(totals, userDataTotals);

  const externalEntries = [];
  for (const workspace of normalizeExternalWorkspaces(externalWorkspaces, userDataPath)) {
    const entry = await copyExternalWorkspaceSnapshot(destination, workspace);
    if (!entry) continue;
    addCopyTotals(totals, entry.totals);
    externalEntries.push(stripTotals(entry));
  }

  const manifest = {
    format: SNAPSHOT_FORMAT,
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    productName: productName || "haolo_desktop",
    appVersion: appVersion || "",
    kind,
    createdAt: startedAt.toISOString(),
    source: {
      root: sourceRoot || path.resolve(userDataPath),
      userDataPath: path.resolve(userDataPath),
    },
    data: {
      userData: normalizeManifestPath(SNAPSHOT_USER_DATA_DIR),
      externalWorkspaces: externalEntries,
    },
    totals,
  };
  await writeJsonAtomic(path.join(destination, USER_DATA_SNAPSHOT_MANIFEST_FILE), manifest);
  return { manifest, totals };
}

export async function restoreUserDataSnapshot({ snapshotRoot, userDataPath, externalWorkspaces = null }) {
  const root = path.resolve(snapshotRoot);
  const manifest = await readSnapshotManifest(root);
  validateSnapshotManifest(manifest, root);

  const userDataSource = path.join(root, manifest.data.userData);
  await assertDirectoryExists(userDataSource, "备份缺少用户数据目录。");
  await replaceDirectoryContents(path.resolve(userDataPath), userDataSource, {
    preserveTopLevelEntries: USER_DATA_LOCAL_ONLY_TOP_LEVEL_FILES,
  });

  const entries = Array.isArray(externalWorkspaces) ? externalWorkspaces : manifest.data.externalWorkspaces || [];
  for (const entry of entries) {
    await restoreExternalWorkspace(root, entry);
  }
  return { manifest };
}

export async function readSnapshotManifest(snapshotRoot) {
  const manifestPath = path.join(path.resolve(snapshotRoot), USER_DATA_SNAPSHOT_MANIFEST_FILE);
  const manifest = await readJsonFile(manifestPath);
  if (!manifest) {
    throw new Error("所选文件夹不是有效的 Haolo 用户数据备份。");
  }
  return manifest;
}

export function validateSnapshotManifest(manifest, snapshotRoot = "") {
  if (!manifest || manifest.format !== SNAPSHOT_FORMAT) {
    throw new Error("备份格式不正确。");
  }
  if (manifest.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
    throw new Error("备份版本不兼容，请使用相同版本的 Haolo 导入。");
  }
  if (!manifest.data?.userData) {
    throw new Error("备份缺少用户数据目录信息。");
  }
  if (path.isAbsolute(manifest.data.userData) || manifest.data.userData.includes("..")) {
    throw new Error("备份清单包含不安全路径。");
  }
  if (snapshotRoot) {
    const userDataSource = path.join(path.resolve(snapshotRoot), manifest.data.userData);
    if (!isSamePathOrInside(userDataSource, path.resolve(snapshotRoot))) {
      throw new Error("备份清单路径越界。");
    }
  }
}

async function createSnapshotZipArchive({ sourceRoot, zipPath }) {
  const root = path.resolve(sourceRoot);
  await assertDirectoryExists(root, "备份临时目录不存在。");
  const entries = await collectZipEntries(root);
  const zipHandle = await fs.promises.open(zipPath, "wx");
  const centralDirectoryEntries = [];
  let offset = 0;
  try {
    for (const entry of entries) {
      const nameBuffer = Buffer.from(entry.name, "utf8");
      const localHeaderOffset = offset;
      let sourceBuffer = Buffer.alloc(0);
      let compressedBuffer = Buffer.alloc(0);
      let method = ZIP_COMPRESSION_STORE;
      if (!entry.directory) {
        sourceBuffer = await fs.promises.readFile(entry.sourcePath);
        const deflated = zlib.deflateRawSync(sourceBuffer, { level: 6 });
        if (deflated.length < sourceBuffer.length) {
          method = ZIP_COMPRESSION_DEFLATE;
          compressedBuffer = deflated;
        } else {
          compressedBuffer = sourceBuffer;
        }
      }
      const crc = entry.directory ? 0 : crc32(sourceBuffer);
      const uncompressedSize = entry.directory ? 0 : sourceBuffer.length;
      const compressedSize = compressedBuffer.length;
      assertZip32Size(uncompressedSize, "ZIP 条目过大。");
      assertZip32Size(compressedSize, "ZIP 条目压缩后过大。");
      assertZip32Size(offset, "ZIP 文件过大。");

      const dos = dateToDos(entry.mtime);
      const localHeader = zipLocalFileHeader({
        nameBuffer,
        method,
        crc,
        compressedSize,
        uncompressedSize,
        dos,
      });
      offset = await writeZipBuffer(zipHandle, offset, localHeader);
      offset = await writeZipBuffer(zipHandle, offset, nameBuffer);
      offset = await writeZipBuffer(zipHandle, offset, compressedBuffer);
      centralDirectoryEntries.push(
        zipCentralDirectoryHeader({
          nameBuffer,
          method,
          crc,
          compressedSize,
          uncompressedSize,
          dos,
          localHeaderOffset,
          directory: entry.directory,
        }),
      );
    }

    const centralDirectoryOffset = offset;
    for (const centralEntry of centralDirectoryEntries) {
      offset = await writeZipBuffer(zipHandle, offset, centralEntry);
    }
    const centralDirectorySize = offset - centralDirectoryOffset;
    const endRecord = zipEndOfCentralDirectory({
      entries: centralDirectoryEntries.length,
      centralDirectorySize,
      centralDirectoryOffset,
    });
    await writeZipBuffer(zipHandle, offset, endRecord);
  } finally {
    await zipHandle.close();
  }
}

async function extractSnapshotZipArchive({ zipPath, destinationRoot }) {
  const destination = path.resolve(destinationRoot);
  await assertSafeDirectoryTarget(destination);
  await fs.promises.rm(destination, { recursive: true, force: true }).catch(() => {});
  await fs.promises.mkdir(destination, { recursive: true });
  const zipBuffer = await fs.promises.readFile(zipPath);
  const entries = readZipCentralDirectory(zipBuffer);
  for (const entry of entries) {
    const target = safeZipEntryTarget(destination, entry.name);
    if (entry.directory) {
      await fs.promises.mkdir(target, { recursive: true });
      continue;
    }
    const content = readZipEntryContent(zipBuffer, entry);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, content);
  }
}

async function collectZipEntries(root) {
  const entries = [];
  async function walk(dirPath, relativePath = "") {
    const dirEntries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    dirEntries.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirEntry of dirEntries) {
      const sourcePath = path.join(dirPath, dirEntry.name);
      const stat = await fs.promises.lstat(sourcePath);
      if (stat.isSymbolicLink()) continue;
      const childRelative = relativePath ? `${relativePath}/${dirEntry.name}` : dirEntry.name;
      const zipName = normalizeZipEntryName(childRelative);
      if (stat.isDirectory()) {
        entries.push({ name: `${zipName}/`, sourcePath, directory: true, mtime: stat.mtime });
        await walk(sourcePath, childRelative);
      } else if (stat.isFile()) {
        entries.push({ name: zipName, sourcePath, directory: false, mtime: stat.mtime });
      }
    }
  }
  await walk(root);
  return entries;
}

function zipLocalFileHeader({ nameBuffer, method, crc, compressedSize, uncompressedSize, dos }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(ZIP_LOCAL_FILE_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(dos.time, 10);
  header.writeUInt16LE(dos.date, 12);
  header.writeUInt32LE(crc >>> 0, 14);
  header.writeUInt32LE(compressedSize >>> 0, 18);
  header.writeUInt32LE(uncompressedSize >>> 0, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function zipCentralDirectoryHeader({
  nameBuffer,
  method,
  crc,
  compressedSize,
  uncompressedSize,
  dos,
  localHeaderOffset,
  directory,
}) {
  const header = Buffer.alloc(46 + nameBuffer.length);
  header.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(dos.time, 12);
  header.writeUInt16LE(dos.date, 14);
  header.writeUInt32LE(crc >>> 0, 16);
  header.writeUInt32LE(compressedSize >>> 0, 20);
  header.writeUInt32LE(uncompressedSize >>> 0, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(directory ? 0x10 : 0, 38);
  header.writeUInt32LE(localHeaderOffset >>> 0, 42);
  nameBuffer.copy(header, 46);
  return header;
}

function zipEndOfCentralDirectory({ entries, centralDirectorySize, centralDirectoryOffset }) {
  if (entries > 0xffff) throw new Error("备份文件数量过多，无法生成 ZIP。");
  assertZip32Size(centralDirectorySize, "ZIP 中央目录过大。");
  assertZip32Size(centralDirectoryOffset, "ZIP 文件过大。");
  const header = Buffer.alloc(22);
  header.writeUInt32LE(ZIP_EOCD_SIGNATURE, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entries, 8);
  header.writeUInt16LE(entries, 10);
  header.writeUInt32LE(centralDirectorySize >>> 0, 12);
  header.writeUInt32LE(centralDirectoryOffset >>> 0, 16);
  header.writeUInt16LE(0, 20);
  return header;
}

function readZipCentralDirectory(zipBuffer) {
  const eocdOffset = findZipEndOfCentralDirectory(zipBuffer);
  const diskNumber = zipBuffer.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = zipBuffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = zipBuffer.readUInt16LE(eocdOffset + 8);
  const entries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entries) {
    throw new Error("不支持分卷 ZIP 备份文件。");
  }
  if (centralDirectoryOffset + centralDirectorySize > zipBuffer.length) {
    throw new Error("ZIP 备份文件结构不完整。");
  }

  const result = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > zipBuffer.length || zipBuffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("ZIP 备份文件中央目录不正确。");
    }
    const flags = zipBuffer.readUInt16LE(offset + 8);
    const method = zipBuffer.readUInt16LE(offset + 10);
    const crc = zipBuffer.readUInt32LE(offset + 16);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 24);
    const nameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > zipBuffer.length) throw new Error("ZIP 备份文件条目名称不完整。");
    if (flags & 0x0001) throw new Error("不支持加密 ZIP 备份文件。");
    if (method !== ZIP_COMPRESSION_STORE && method !== ZIP_COMPRESSION_DEFLATE) {
      throw new Error("ZIP 备份文件包含不支持的压缩格式。");
    }
    const name = zipBuffer.subarray(nameStart, nameEnd).toString(flags & ZIP_UTF8_FLAG ? "utf8" : "utf8");
    result.push({
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      directory: name.endsWith("/"),
    });
    offset = nameEnd + extraLength + commentLength;
  }
  return result;
}

function readZipEntryContent(zipBuffer, entry) {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > zipBuffer.length || zipBuffer.readUInt32LE(offset) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error("ZIP 备份文件本地条目不正确。");
  }
  const nameLength = zipBuffer.readUInt16LE(offset + 26);
  const extraLength = zipBuffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > zipBuffer.length) throw new Error("ZIP 备份文件条目数据不完整。");
  const compressed = zipBuffer.subarray(dataStart, dataEnd);
  const content =
    entry.method === ZIP_COMPRESSION_STORE ? Buffer.from(compressed) : zlib.inflateRawSync(compressed);
  if (content.length !== entry.uncompressedSize) {
    throw new Error("ZIP 备份文件条目大小校验失败。");
  }
  if (crc32(content) !== entry.crc) {
    throw new Error("ZIP 备份文件条目校验失败。");
  }
  return content;
}

function findZipEndOfCentralDirectory(zipBuffer) {
  const minOffset = Math.max(0, zipBuffer.length - 0xffff - 22);
  for (let offset = zipBuffer.length - 22; offset >= minOffset; offset -= 1) {
    if (zipBuffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  throw new Error("所选文件不是有效的 ZIP 备份。");
}

function safeZipEntryTarget(destinationRoot, entryName) {
  const normalized = normalizeZipEntryName(entryName);
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized)) {
    throw new Error("ZIP 备份文件包含不安全路径。");
  }
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error("ZIP 备份文件包含不安全路径。");
  }
  const target = path.join(path.resolve(destinationRoot), ...parts);
  if (!isSamePathOrInside(target, path.resolve(destinationRoot))) {
    throw new Error("ZIP 备份文件路径越界。");
  }
  return target;
}

function normalizeZipEntryName(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, (match) => (match ? "/" : ""));
}

function dateToDos(value) {
  const date = value instanceof Date && Number.isFinite(value.getTime()) ? value : new Date();
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

async function writeZipBuffer(handle, offset, buffer) {
  if (!buffer.length) return offset;
  await handle.write(buffer, 0, buffer.length, offset);
  return offset + buffer.length;
}

function assertZip32Size(value, message) {
  if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) {
    throw new Error(message);
  }
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function executeExportPlan({ plan, productName, appVersion }) {
  const destinationParent = path.resolve(plan.destinationParent);
  await fs.promises.mkdir(destinationParent, { recursive: true });
  const exportPath = await uniqueFilePath(path.join(destinationParent, `${plan.exportDirName || `Haolo-user-data-${timestampForFileName()}`}.zip`));
  const tempRoot = path.join(destinationParent, `.${path.basename(exportPath, ".zip")}.tmp-${process.pid}`);
  const tempZipPath = `${exportPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  await fs.promises.rm(tempZipPath, { force: true }).catch(() => {});
  try {
    const result = await createUserDataSnapshot({
      destinationRoot: tempRoot,
      userDataPath: plan.userDataPath,
      externalWorkspaces: plan.externalWorkspaces,
      productName,
      appVersion,
      kind: "export",
    });
    await createSnapshotZipArchive({ sourceRoot: tempRoot, zipPath: tempZipPath });
    await fs.promises.rename(tempZipPath, exportPath);
    return {
      ok: true,
      operation: "export",
      completedAt: new Date().toISOString(),
      exportPath,
      files: result.totals.files,
      bytes: result.totals.bytes,
    };
  } catch (error) {
    await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(tempZipPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function executeImportPlan({ app, plan, productName, appVersion }) {
  const transferRoot = userDataTransferRoot(app, productName);
  const backupRoot = path.join(transferRoot, "backups", `before-import-${timestampForFileName()}`);
  const userDataPath = path.resolve(plan.userDataPath || app.getPath("userData"));
  const stagedManifest = await readSnapshotManifest(plan.stagingRoot);
  validateSnapshotManifest(stagedManifest, plan.stagingRoot);
  const importedExternalWorkspaces = stagedManifest.data.externalWorkspaces || [];
  const backupExternalWorkspaces = mergeExternalWorkspaceDescriptors(plan.currentExternalWorkspaces || [], importedExternalWorkspaces);

  await createUserDataSnapshot({
    destinationRoot: backupRoot,
    userDataPath,
    externalWorkspaces: backupExternalWorkspaces,
    productName,
    appVersion,
    kind: "pre-import-backup",
    sourceRoot: userDataPath,
  });

  try {
    await restoreUserDataSnapshot({
      snapshotRoot: plan.stagingRoot,
      userDataPath,
      externalWorkspaces: importedExternalWorkspaces,
    });
  } catch (error) {
    try {
      const backupManifest = await readSnapshotManifest(backupRoot);
      await restoreUserDataSnapshot({
        snapshotRoot: backupRoot,
        userDataPath,
        externalWorkspaces: backupManifest.data.externalWorkspaces || [],
      });
    } catch (rollbackError) {
      throw new Error(`导入失败，且自动回滚失败：${errorMessage(error)}；回滚错误：${errorMessage(rollbackError)}`);
    }
    throw error;
  } finally {
    await fs.promises.rm(plan.stagingRoot, { recursive: true, force: true }).catch(() => {});
  }

  return {
    ok: true,
    operation: "import",
    completedAt: new Date().toISOString(),
    backupPath: backupRoot,
    sourceRoot: plan.sourceRoot || stagedManifest.source?.root || "",
  };
}

async function copyExternalWorkspaceSnapshot(snapshotRoot, workspace) {
  const sourceRoot = path.resolve(workspace.path);
  const copiedDirs = [];
  const totals = emptyCopyTotals();
  const snapshotId = workspace.snapshotId || safeWorkspaceSnapshotId(workspace);
  const targetRoot = path.join(snapshotRoot, SNAPSHOT_EXTERNAL_WORKSPACES_DIR, snapshotId);

  for (const dirName of MANAGED_EXTERNAL_WORKSPACE_DIRS) {
    const source = path.join(sourceRoot, dirName);
    if (!(await pathExists(source))) continue;
    const options = dirName === "haolo-ai-home" ? { filter: includeHaoloAiHomeEntry } : {};
    const dirTotals = await copyTree(source, path.join(targetRoot, dirName), options);
    addCopyTotals(totals, dirTotals);
    copiedDirs.push(dirName);
  }

  if (!copiedDirs.length) return null;
  return {
    id: snapshotId,
    groupId: workspace.groupId || null,
    groupName: workspace.groupName || null,
    workspaceSlug: workspace.workspaceSlug || null,
    targetPath: sourceRoot,
    snapshotPath: normalizeManifestPath(path.join(SNAPSHOT_EXTERNAL_WORKSPACES_DIR, snapshotId)),
    directories: copiedDirs,
    totals,
  };
}

async function restoreExternalWorkspace(snapshotRoot, entry) {
  const targetRoot = path.resolve(String(entry.targetPath || ""));
  if (!targetRoot) return;
  const snapshotPath = String(entry.snapshotPath || "");
  if (!snapshotPath || path.isAbsolute(snapshotPath) || snapshotPath.includes("..")) {
    throw new Error("备份清单包含不安全的外部工作区路径。");
  }
  const sourceRoot = path.join(path.resolve(snapshotRoot), snapshotPath);
  if (!isSamePathOrInside(sourceRoot, path.resolve(snapshotRoot))) {
    throw new Error("外部工作区备份路径越界。");
  }

  const directories = Array.isArray(entry.directories) ? entry.directories.filter((item) => MANAGED_EXTERNAL_WORKSPACE_DIRS.includes(item)) : [];
  await fs.promises.mkdir(targetRoot, { recursive: true });
  for (const dirName of MANAGED_EXTERNAL_WORKSPACE_DIRS) {
    const target = path.join(targetRoot, dirName);
    const source = path.join(sourceRoot, dirName);
    await assertManagedExternalTarget(target, targetRoot, dirName);
    if (directories.includes(dirName) && (await pathExists(source))) {
      await replaceDirectoryContents(target, source);
    } else {
      await fs.promises.rm(target, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function replaceDirectoryContents(target, source, options = {}) {
  const resolvedTarget = path.resolve(target);
  const resolvedSource = path.resolve(source);
  if (normalizePathKey(resolvedTarget) === normalizePathKey(resolvedSource)) {
    throw new Error("源目录和目标目录相同，已取消操作。");
  }
  await assertSafeDirectoryTarget(resolvedTarget);
  await assertDirectoryExists(resolvedSource, "备份目录不存在。");
  await fs.promises.mkdir(resolvedTarget, { recursive: true });
  const preserved = new Set(
    [...(options.preserveTopLevelEntries || [])].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean),
  );
  const entries = await fs.promises.readdir(resolvedTarget, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (preserved.has(entry.name.toLowerCase())) continue;
    await removePathWithRetry(path.join(resolvedTarget, entry.name), { recursive: true, force: true });
  }
  await copyTree(resolvedSource, resolvedTarget, {
    filter: (relativePath) => {
      if (!relativePath || !preserved.size) return true;
      const [first] = relativePath.split(/[\\/]+/).filter(Boolean);
      return !preserved.has(String(first || "").toLowerCase());
    },
  });
}

async function removePathWithRetry(target, options = {}) {
  for (let attempt = 1; attempt <= REMOVE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await fs.promises.rm(target, options);
      return;
    } catch (error) {
      if (attempt >= REMOVE_RETRY_ATTEMPTS || !isTransientRemoveError(error)) throw error;
      await delay(REMOVE_RETRY_DELAY_MS);
    }
  }
}

function isTransientRemoveError(error) {
  return ["EBUSY", "EPERM", "ENOTEMPTY"].includes(String(error?.code || ""));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function copyTree(source, target, options = {}) {
  const resolvedSource = path.resolve(source);
  const resolvedTarget = path.resolve(target);
  const totals = emptyCopyTotals();
  await assertDirectoryExists(resolvedSource, `源目录不存在：${resolvedSource}`);
  await copyTreeEntry(resolvedSource, resolvedTarget, "", totals, options);
  return totals;
}

async function copyTreeEntry(source, target, relativePath, totals, options) {
  const stat = await fs.promises.lstat(source);
  if (typeof options.filter === "function" && !options.filter(relativePath, stat)) {
    totals.skipped += 1;
    return;
  }
  if (stat.isSymbolicLink()) {
    totals.skipped += 1;
    return;
  }
  if (stat.isDirectory()) {
    await fs.promises.mkdir(target, { recursive: true });
    totals.directories += 1;
    const entries = await fs.promises.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      const childRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;
      await copyTreeEntry(path.join(source, entry.name), path.join(target, entry.name), childRelative, totals, options);
    }
    return;
  }
  if (!stat.isFile()) {
    totals.skipped += 1;
    return;
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.copyFile(source, target);
  await fs.promises.utimes(target, stat.atime, stat.mtime).catch(() => {});
  totals.files += 1;
  totals.bytes += stat.size;
}

function includeUserDataEntry(relativePath) {
  if (!relativePath) return true;
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  const first = (parts[0] || "").toLowerCase();
  if (USER_DATA_FULL_TOP_LEVEL_DIRS.has(first) || USER_DATA_FULL_TOP_LEVEL_FILES.has(first)) return true;
  if (first === "thread-groups") return includeThreadGroupsEntry(parts.slice(1));
  if (first === "haolo-ai-home") return includeHaoloAiHomeParts(parts.slice(1));
  if (first === "default-haolo-ai") return includeExactRelativeFile(parts.slice(1), "auth.json");
  if (first === "automation") return includeExactRelativeFile(parts.slice(1), "automation-store.json");
  return false;
}

function includeThreadGroupsEntry(parts) {
  if (!parts.length) return true;
  if (parts.length === 1) return true;
  const entry = (parts[1] || "").toLowerCase();
  if (entry === "outputs") return true;
  if (entry === "haolo-ai-home") return includeHaoloAiHomeParts(parts.slice(2));
  return false;
}

function includeHaoloAiHomeEntry(relativePath) {
  if (!relativePath) return true;
  return includeHaoloAiHomeParts(relativePath.split(/[\\/]+/).filter(Boolean));
}

function includeHaoloAiHomeParts(parts) {
  if (!parts.length) return true;
  const first = (parts[0] || "").toLowerCase();
  if (HAOLO_AI_HOME_FULL_DIRS.has(first)) return true;
  if (parts.length > 1) return false;
  if (HAOLO_AI_HOME_FULL_FILES.has(first)) return true;
  return HAOLO_AI_HOME_SQLITE_PREFIXES.some((prefix) => first.startsWith(prefix) && /^.+\.sqlite(?:-(?:wal|shm))?$/i.test(first));
}

function includeExactRelativeFile(parts, fileName) {
  if (!parts.length) return true;
  return parts.length === 1 && (parts[0] || "").toLowerCase() === fileName;
}

function normalizeExternalWorkspaces(workspaces = [], userDataPath = "") {
  const userDataRoot = userDataPath ? path.resolve(userDataPath) : null;
  const seen = new Set();
  const result = [];
  for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
    const workspacePath = firstString(workspace?.cwd, workspace?.path, workspace?.targetPath);
    if (!workspacePath) continue;
    const resolved = path.resolve(workspacePath);
    if (userDataRoot && isSamePathOrInside(resolved, userDataRoot)) continue;
    const key = normalizePathKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    const descriptor = {
      path: resolved,
      targetPath: resolved,
      groupId: firstString(workspace?.groupId, workspace?.group_id) || null,
      groupName: firstString(workspace?.groupName, workspace?.group_name) || null,
      workspaceSlug: firstString(workspace?.workspaceSlug, workspace?.workspace_slug) || null,
    };
    descriptor.snapshotId = safeWorkspaceSnapshotId(descriptor);
    result.push(descriptor);
  }
  return result;
}

function mergeExternalWorkspaceDescriptors(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    for (const item of normalizeExternalWorkspaces(list, "")) {
      const key = normalizePathKey(item.targetPath || item.path);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

async function assertNoPendingTransfer(app, productName) {
  if (await pathExists(pendingUserDataTransferPath(app, productName))) {
    throw new Error("已有用户数据导入/导出任务正在等待重启完成。");
  }
}

async function assertNotSameOrInside(candidate, root, message) {
  if (isSamePathOrInside(path.resolve(candidate), path.resolve(root))) {
    throw new Error(message);
  }
}

async function assertManagedExternalTarget(target, workspaceRoot, dirName) {
  const resolved = path.resolve(target);
  const root = path.resolve(workspaceRoot);
  if (path.basename(resolved) !== dirName || !isSamePathOrInside(resolved, root) || normalizePathKey(resolved) === normalizePathKey(root)) {
    throw new Error("外部工作区目标路径不安全，已取消导入。");
  }
}

async function assertSafeDirectoryTarget(target) {
  const parsed = path.parse(path.resolve(target));
  if (normalizePathKey(parsed.root) === normalizePathKey(path.resolve(target))) {
    throw new Error("目标目录不安全，已取消操作。");
  }
}

async function assertDirectoryExists(dirPath, message) {
  const stat = await fs.promises.stat(dirPath).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(message);
}

async function uniqueDirectoryPath(basePath) {
  let candidate = path.resolve(basePath);
  let index = 2;
  while (await pathExists(candidate)) {
    candidate = `${path.resolve(basePath)}-${index}`;
    index += 1;
  }
  return candidate;
}

async function uniqueFilePath(basePath) {
  const parsed = path.parse(path.resolve(basePath));
  let candidate = path.resolve(basePath);
  let index = 2;
  while (await pathExists(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

async function pathExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.promises.rename(tempPath, filePath);
}

function safeWorkspaceSnapshotId(workspace) {
  const base = safeFileName(firstString(workspace.groupId, workspace.workspaceSlug, path.basename(workspace.path), "workspace"));
  const hash = crypto.createHash("sha256").update(path.resolve(workspace.path || workspace.targetPath || "")).digest("hex").slice(0, 10);
  return `${base}-${hash}`.slice(0, 96);
}

function safeFileName(value) {
  return (
    String(value || "")
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "haolo"
  );
}

function timestampForFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function normalizeManifestPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isSamePathOrInside(candidate, root) {
  const candidateKey = normalizePathKey(path.resolve(candidate));
  const rootKey = normalizePathKey(path.resolve(root));
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}/`);
}

function normalizePathKey(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text;
  }
  return "";
}

function emptyCopyTotals() {
  return { files: 0, directories: 0, bytes: 0, skipped: 0 };
}

function addCopyTotals(target, source) {
  target.files += source.files || 0;
  target.directories += source.directories || 0;
  target.bytes += source.bytes || 0;
  target.skipped += source.skipped || 0;
}

function stripTotals(entry) {
  const { totals: _totals, ...rest } = entry;
  return rest;
}

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "未知错误");
}
