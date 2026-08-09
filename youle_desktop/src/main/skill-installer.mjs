import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

const inflateRawAsync = promisify(zlib.inflateRaw);

export async function installSkillPackage(payload, apiClient, options = {}) {
  const task = normalizeInstallPayload(payload, options);
  let tempDir = null;
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "youle-skill-"));
    const zipPath = path.join(tempDir, `${task.skillId}.zip`);
    await downloadFile(task.downloadUrl, zipPath);
    await verifySha256(zipPath, task.sha256);
    const extractDir = path.join(tempDir, "extract");
    await fs.mkdir(extractDir, { recursive: true });
    await extractZip(zipPath, extractDir);
    const sourceRoot = await resolveSkillRoot(extractDir);
    const targetDir = safeTargetDir(task);
    await replaceDirectory(sourceRoot, targetDir);
    await apiClient.completeSkillInstall({
      skillId: task.skillId,
      installId: task.installId,
      version: task.version,
      localPath: targetDir,
    });
    return {
      ok: true,
      install_id: task.installId,
      skill_id: task.skillId,
      version: task.version,
      local_path: targetDir,
      install_status: "installed",
    };
  } catch (error) {
    await reportInstallFailure(apiClient, task, error);
    throw error;
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function uninstallSkillPackage(payload, apiClient, options = {}) {
  const task = normalizeUninstallPayload(payload, options);
  const targetDir = safeUninstallTargetDir(task);
  await fs.rm(targetDir, { recursive: true, force: true });
  if (apiClient?.uninstallSkillInstall && !task.localOnly) {
    await apiClient.uninstallSkillInstall({
      skillId: task.skillId,
      version: task.version,
      localPath: targetDir,
    });
  }
  return {
    ok: true,
    skill_id: task.skillId,
    version: task.version,
    local_path: targetDir,
    install_status: "uninstalled",
  };
}

function normalizeInstallPayload(payload, options = {}) {
  const source = installPayloadObject(payload);
  const installId = firstString(source.install_id, source.installId, source.id);
  const skillId = firstString(source.skill_id, source.skillId);
  const version = firstString(source.version);
  const downloadUrl = firstString(source.download_url, source.downloadUrl);
  const sha256 = firstString(source.sha256, source.package?.sha256);
  const targetDir = firstString(source.target_dir, source.targetDir);
  const installBaseDir = firstString(options.installBaseDir);
  if (!installId) throw new Error("安装响应缺少 install_id");
  if (!skillId) throw new Error("安装响应缺少 skill_id");
  if (!downloadUrl) throw new Error("安装响应缺少 download_url");
  if (!sha256) throw new Error("安装响应缺少 sha256");
  return { installId, skillId, version, downloadUrl, sha256, targetDir, installBaseDir };
}

function normalizeUninstallPayload(payload, options = {}) {
  const source = installPayloadObject(payload);
  const rawSkillId = firstString(source.skill_id, source.skillId, source.id);
  const localOnly = Boolean(rawSkillId?.startsWith("local:"));
  const skillId = localOnly ? rawSkillId.slice("local:".length) : rawSkillId;
  const version = firstString(source.version);
  const targetDir = firstString(source.local_path, source.localPath, source.target_dir, source.targetDir);
  const installBaseDir = firstString(options.installBaseDir);
  if (!skillId) throw new Error("卸载响应缺少 skill_id");
  return { skillId, version, targetDir, installBaseDir, localOnly };
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`技能包下载失败：HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("技能包下载失败：返回内容不是 zip 文件");
  }
  await fs.writeFile(destination, bytes);
}

async function verifySha256(filePath, expectedHash) {
  const bytes = await fs.readFile(filePath);
  const actualHash = crypto.createHash("sha256").update(bytes).digest("hex").toLowerCase();
  if (actualHash !== String(expectedHash).toLowerCase()) {
    throw new Error(`技能包 sha256 校验失败：${actualHash}`);
  }
}

async function extractZip(zipPath, destination) {
  await fs.mkdir(destination, { recursive: true });
  const bytes = await fs.readFile(zipPath);
  const entries = readZipEntries(bytes);
  if (!entries.length) {
    throw new Error("技能包解压失败：zip 文件为空");
  }
  for (const entry of entries) {
    const target = safeZipEntryTarget(destination, entry.name);
    if (entry.directory) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, await zipEntryBytes(entry));
  }
}

function readZipEntries(bytes) {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) {
    throw new Error("技能包解压失败：zip 文件不完整或已损坏");
  }
  const totalEntries = bytes.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = bytes.readUInt32LE(eocdOffset + 12);
  let centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  const centralDirectoryEnd = centralOffset + centralDirectorySize;
  const entries = [];
  for (let index = 0; index < totalEntries; index += 1) {
    if (centralOffset + 46 > bytes.length || bytes.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("技能包解压失败：zip 目录结构不完整");
    }
    const flags = bytes.readUInt16LE(centralOffset + 8);
    const method = bytes.readUInt16LE(centralOffset + 10);
    const compressedSize = bytes.readUInt32LE(centralOffset + 20);
    const uncompressedSize = bytes.readUInt32LE(centralOffset + 24);
    const fileNameLength = bytes.readUInt16LE(centralOffset + 28);
    const extraLength = bytes.readUInt16LE(centralOffset + 30);
    const commentLength = bytes.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = bytes.readUInt32LE(centralOffset + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new Error("技能包解压失败：暂不支持 Zip64 格式");
    }
    const nameStart = centralOffset + 46;
    const nameEnd = nameStart + fileNameLength;
    const name = decodeZipEntryName(bytes.subarray(nameStart, nameEnd), flags).replace(/\\/g, "/");
    const dataStart = zipEntryDataStart(bytes, localHeaderOffset);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) {
      throw new Error("技能包解压失败：zip 条目数据不完整");
    }
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      compressed: bytes.subarray(dataStart, dataEnd),
      directory: name.endsWith("/"),
    });
    centralOffset = nameEnd + extraLength + commentLength;
  }
  if (centralOffset > centralDirectoryEnd) {
    throw new Error("技能包解压失败：zip 目录结构不完整");
  }
  return entries;
}

function findEndOfCentralDirectory(bytes) {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}

function zipEntryDataStart(bytes, localHeaderOffset) {
  if (localHeaderOffset + 30 > bytes.length || bytes.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error("技能包解压失败：zip 文件头不完整");
  }
  const fileNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
  const extraLength = bytes.readUInt16LE(localHeaderOffset + 28);
  return localHeaderOffset + 30 + fileNameLength + extraLength;
}

function decodeZipEntryName(bytes, flags) {
  if (flags & 0x0800) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  try {
    return new TextDecoder("gb18030", { fatal: false }).decode(bytes);
  } catch {
    return Buffer.from(bytes).toString("utf8");
  }
}

function safeZipEntryTarget(destination, entryName) {
  if (!entryName || /^\s*$/.test(entryName)) {
    throw new Error("技能包解压失败：zip 条目名称为空");
  }
  if (entryName.includes("\0") || entryName.split("/").includes("..") || path.isAbsolute(entryName) || /^[A-Za-z]:/.test(entryName)) {
    throw new Error(`技能包包含非法路径：${entryName}`);
  }
  const base = path.resolve(destination);
  const target = path.resolve(base, entryName);
  const relativePath = path.relative(base, target);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`技能包包含非法路径：${entryName}`);
  }
  return target;
}

async function zipEntryBytes(entry) {
  if (entry.method === 0) {
    return entry.compressed;
  }
  if (entry.method !== 8) {
    throw new Error(`技能包解压失败：不支持的压缩方式 ${entry.method}`);
  }
  const bytes = await inflateRawAsync(entry.compressed);
  if (entry.uncompressedSize !== 0xffffffff && bytes.length !== entry.uncompressedSize) {
    throw new Error(`技能包解压失败：${entry.name} 解压大小不匹配`);
  }
  return bytes;
}

async function resolveSkillRoot(extractDir) {
  if (await hasSkillFile(extractDir)) {
    await validateExtractedSkillRoot(extractDir);
    return extractDir;
  }
  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("__MACOSX"));
  if (directories.length !== 1) {
    throw new Error("技能包必须只包含一个技能根目录");
  }
  const root = path.join(extractDir, directories[0].name);
  await validateExtractedSkillRoot(root);
  return root;
}

async function hasSkillFile(directory) {
  const stat = await fs.stat(path.join(directory, "SKILL.md")).catch(() => null);
  return Boolean(stat?.isFile());
}

async function validateExtractedSkillRoot(root) {
  const rootName = path.basename(root);
  if (rootName === ".system") {
    throw new Error("不允许安装到 .system 技能目录");
  }
  const skillFile = path.join(root, "SKILL.md");
  const stat = await fs.stat(skillFile).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error("技能包缺少 SKILL.md");
  }
  await walkSkillFiles(root, root);
}

async function walkSkillFiles(root, current) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    const relativePath = path.relative(root, fullPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error("技能包包含非法路径");
    }
    if (entry.isSymbolicLink()) {
      throw new Error("技能包不允许包含符号链接");
    }
    if (entry.isDirectory()) {
      await walkSkillFiles(root, fullPath);
    }
  }
}

function safeTargetDir(task) {
  const defaultBase = expandUserProfile(task.installBaseDir || path.join(os.homedir(), ".codex", "skills"));
  const allowedBase = path.resolve(defaultBase);
  const fallbackTarget = path.join(allowedBase, safeSkillDirectoryName(task.skillId));
  const candidate = task.targetDir ? path.resolve(expandUserProfile(task.targetDir)) : fallbackTarget;
  const candidateRelativePath = path.relative(allowedBase, candidate);
  const resolved =
    candidateRelativePath && !candidateRelativePath.startsWith("..") && !path.isAbsolute(candidateRelativePath)
      ? candidate
      : fallbackTarget;
  const relativePath = path.relative(allowedBase, resolved);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("安装目标目录非法");
  }
  if (path.basename(resolved) === ".system") {
    throw new Error("不允许安装到 .system 技能目录");
  }
  return resolved;
}

function safeUninstallTargetDir(task) {
  const defaultBase = expandUserProfile(task.installBaseDir || path.join(os.homedir(), ".codex", "skills"));
  const allowedBase = path.resolve(defaultBase);
  const fallbackTarget = path.join(allowedBase, safeSkillDirectoryName(task.skillId));
  const rawCandidate = task.targetDir ? path.resolve(expandUserProfile(task.targetDir)) : fallbackTarget;
  const candidate = path.basename(rawCandidate).toLowerCase() === "skill.md" ? path.dirname(rawCandidate) : rawCandidate;
  const candidateRelativePath = path.relative(allowedBase, candidate);
  const resolved =
    candidateRelativePath && !candidateRelativePath.startsWith("..") && !path.isAbsolute(candidateRelativePath)
      ? candidate
      : fallbackTarget;
  const relativePath = path.relative(allowedBase, resolved);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("卸载目标目录非法");
  }
  if (path.basename(resolved) === ".system") {
    throw new Error("不允许卸载 .system 技能目录");
  }
  return resolved;
}

function safeSkillDirectoryName(skillId) {
  const name = String(skillId || "").trim();
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || path.isAbsolute(name)) {
    throw new Error("安装目标目录非法");
  }
  return name.replace(/[<>:"|?*\x00-\x1F]/g, "_");
}

function expandUserProfile(value) {
  return String(value || "")
    .replace(/^%USERPROFILE%/i, os.homedir())
    .replace(/^\$HOME/i, os.homedir())
    .replace(/^~/, os.homedir());
}

async function replaceDirectory(source, target) {
  const parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true });
  const staging = `${target}.installing-${Date.now()}`;
  await fs.rm(staging, { recursive: true, force: true });
  await fs.cp(source, staging, { recursive: true, force: true });
  await fs.rm(target, { recursive: true, force: true });
  await fs.rename(staging, target);
}

async function reportInstallFailure(apiClient, task, error) {
  if (!task?.skillId || !task?.installId) return;
  await apiClient.failSkillInstall({
    skillId: task.skillId,
    installId: task.installId,
    version: task.version,
    errorMessage: error?.message || String(error),
  }).catch(() => {});
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function installPayloadObject(payload) {
  const candidates = [
    payload?.data?.item,
    payload?.data?.record,
    payload?.data,
    payload?.result?.item,
    payload?.result?.record,
    payload?.result,
    payload,
  ];
  return candidates.find((value) => value && typeof value === "object" && !Array.isArray(value)) || {};
}
