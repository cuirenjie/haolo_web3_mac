import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { downloadFileWithResume } from "./app-update-downloader.mjs";
import { extractTarGzipArchive } from "./runtime-archive.mjs";

export const TOOL_RUNTIME_CATALOG_SCHEMA_VERSION = 1;
export const TOOL_RUNTIME_PACKAGE_SCHEMA_VERSION = 1;
export const TOOL_RUNTIME_PACKAGE_MANIFEST = "haolo-runtime-package.json";
export const TOOL_RUNTIME_READY_MARKER = ".haolo-tool-runtime-ready.json";
export const TOOL_RUNTIME_CURRENT_FILE = "current.json";

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SAFE_VERSION_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,95}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const DEFAULT_CONNECT_TIMEOUT_MS = 120_000;
const DEFAULT_STALL_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MIN_FREE_SPACE_RESERVE_BYTES = 256 * 1024 * 1024;
const MANAGED_ENVIRONMENT_KEYS = [
  "PYTHON",
  "PYTHON_EXECUTABLE",
  "PYTHONIOENCODING",
  "PYTHONUTF8",
  "PYTHONNOUSERSITE",
  "PIP_DISABLE_PIP_VERSION_CHECK",
  "NODE",
  "NODE_EXECUTABLE",
  "RIPGREP_PATH",
  "GIT_EXECUTABLE",
  "UV",
  "PNPM",
  "CODEX_WORKSPACE_DEPENDENCIES_NODE_MODULES",
  "HAOLO_TOOL_RUNTIME_ROOT",
  "HAOLO_TOOL_RUNTIME_SOURCE",
];

export class ToolRuntimeManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.rootDir = path.resolve(requiredString(options.rootDir, "rootDir"));
    this.platform = String(options.platform || process.platform);
    this.arch = String(options.arch || process.arch);
    this.catalogUrl = optionalString(options.catalogUrl);
    this.catalogPath = optionalString(options.catalogPath);
    this.fetchImpl = options.fetchImpl;
    this.systemEnvironment = {
      ...(options.systemEnvironment && typeof options.systemEnvironment === "object"
        ? options.systemEnvironment
        : process.env),
    };
    this.appliedBinDirs = [];
    this.sharedRuntimeRoots = uniquePaths([
      ...(Array.isArray(options.sharedRuntimeRoots) ? options.sharedRuntimeRoots : []),
      process.env.HAOLO_TOOL_RUNTIME_SHARED_ROOT,
      path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime"),
    ]);
    this.allowLocalPackageSources = options.allowLocalPackageSources === true;
    this.operationPromise = null;
    this.catalog = null;
    this.resolved = emptyResolvedRuntime();
    this.status = {
      state: "checking",
      phase: "checking",
      source: "unavailable",
      rootDir: this.rootDir,
      catalogConfigured: Boolean(this.catalogUrl || this.catalogPath),
      packages: [],
      capabilities: publicCapabilities(this.resolved),
      progress: null,
      error: null,
      message: "正在检查 Haolo 运行环境…",
      updatedAt: new Date().toISOString(),
    };
  }

  async initialize() {
    await fs.promises.mkdir(this.packagesDir(), { recursive: true });
    await fs.promises.mkdir(this.downloadsDir(), { recursive: true });
    return this.inspect();
  }

  async inspect({ verify = false } = {}) {
    const pointers = await readJsonFile(this.currentFilePath());
    const installedPackages = [];
    const packageResolutions = [];
    const currentPackages = pointers?.schemaVersion === 1 && pointers.packages && typeof pointers.packages === "object"
      ? pointers.packages
      : {};

    for (const [id, version] of Object.entries(currentPackages)) {
      if (!safeId(id) || !safeVersion(version)) continue;
      const packageRoot = this.packageDir(id, version);
      const inspected = await inspectManagedPackage(packageRoot, {
        id,
        version,
        platform: this.platform,
        arch: this.arch,
        verify,
      });
      installedPackages.push(publicPackageStatus(inspected));
      if (inspected.ready) packageResolutions.push(inspected.resolution);
    }

    let source = packageResolutions.length ? "managed" : "unavailable";
    let resolved = mergeRuntimeResolutions(packageResolutions);
    const shared = await discoverSharedRuntime(this.sharedRuntimeRoots, {
      platform: this.platform,
    });
    if (shared) {
      if (!hasUsefulRuntime(resolved)) source = "shared-cache";
      resolved = mergeMissingRuntimeResolution(resolved, shared);
    }
    const system = discoverSystemRuntime(this.systemEnvironment, { platform: this.platform });
    if (hasUsefulRuntime(system)) {
      if (!hasUsefulRuntime(resolved)) source = "system";
      resolved = mergeMissingRuntimeResolution(resolved, system);
    }

    this.resolved = resolved;
    const capabilities = publicCapabilities(resolved);
    const ready = Boolean(capabilities.python && capabilities.node);
    const partial = !ready && Object.values(capabilities).some(Boolean);
    this.setStatus({
      state: ready ? "ready" : partial ? "partial" : "unavailable",
      phase: "idle",
      source,
      packages: installedPackages,
      capabilities,
      progress: null,
      error: null,
      message: ready
        ? runtimeReadyMessage(source)
        : partial
          ? "已发现部分工具；后台运行时可补齐缺少的能力。"
          : this.status.catalogConfigured
            ? "尚未安装 Haolo 工具运行时，可在后台下载。"
            : "未发现完整工具运行时，且当前版本未配置运行时下载清单。",
    });
    return this.getStatus();
  }

  async prewarm({ force = false } = {}) {
    return this.runExclusive(async () => {
      this.setStatus({
        phase: "checking",
        state: "checking",
        error: null,
        message: "正在检查运行时更新…",
        progress: null,
      });
      const catalog = await this.loadCatalog();
      if (!catalog) {
        await this.inspect({ verify: force });
        return this.getStatus();
      }
      this.catalog = catalog;
      const desiredPackages = catalog.packages.filter((entry) => entry.preload !== false);
      if (!desiredPackages.length) {
        await this.inspect({ verify: force });
        return this.getStatus();
      }

      const pointers = await readJsonFile(this.currentFilePath());
      const currentPackages =
        pointers?.schemaVersion === 1 && pointers.packages && typeof pointers.packages === "object"
          ? { ...pointers.packages }
          : {};

      for (const descriptor of desiredPackages) {
        const currentVersion = currentPackages[descriptor.id];
        const currentRoot = currentVersion ? this.packageDir(descriptor.id, currentVersion) : null;
        const currentStatus =
          currentRoot && currentVersion === descriptor.version
            ? await inspectManagedPackage(currentRoot, {
                id: descriptor.id,
                version: descriptor.version,
                platform: this.platform,
                arch: this.arch,
                verify: force,
              })
            : null;
        if (currentStatus?.ready && !force) continue;

        await this.installPackage(descriptor);
        currentPackages[descriptor.id] = descriptor.version;
        await writeJsonAtomic(this.currentFilePath(), {
          schemaVersion: 1,
          packages: currentPackages,
          updatedAt: new Date().toISOString(),
        });
      }

      await this.inspect({ verify: force });
      await this.pruneSupersededPackages(currentPackages);
      return this.getStatus();
    });
  }

  async repair() {
    return this.prewarm({ force: true });
  }

  getStatus() {
    return structuredCloneSafe(this.status);
  }

  environment(baseEnv = {}) {
    return buildToolRuntimeEnvironment(baseEnv, this.resolved, {
      rootDir: this.status.source === "managed" ? this.rootDir : this.resolved.rootDir,
      source: this.status.source,
    });
  }

  applyEnvironment(targetEnv = process.env) {
    const pathKey = Object.keys(targetEnv).find((key) => key.toLowerCase() === "path")
      || (this.platform === "win32" ? "Path" : "PATH");
    const previousBinDirs = new Set(this.appliedBinDirs.map(comparablePath));
    const baseEnv = { ...targetEnv };
    baseEnv[pathKey] = String(targetEnv[pathKey] || "")
      .split(path.delimiter)
      .filter((entry) => entry && !previousBinDirs.has(comparablePath(entry)))
      .join(path.delimiter);
    for (const key of MANAGED_ENVIRONMENT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(this.systemEnvironment, key)) {
        baseEnv[key] = this.systemEnvironment[key];
      } else {
        delete baseEnv[key];
      }
    }

    const next = this.environment(baseEnv);
    targetEnv[pathKey] = next[pathKey] || "";
    for (const key of MANAGED_ENVIRONMENT_KEYS) {
      if (next[key] == null) delete targetEnv[key];
      else targetEnv[key] = next[key];
    }
    this.appliedBinDirs = uniquePaths([
      ...(this.resolved.binDirs || []),
      ...Object.values(this.resolved.executables || {}).map((value) => (value ? path.dirname(value) : null)),
    ]);
    return next;
  }

  async loadCatalog() {
    let payload = null;
    if (this.catalogUrl) {
      if (typeof this.fetchImpl !== "function") {
        throw runtimeManagerError("运行时下载器不可用。", "HAOLO_TOOL_RUNTIME_FETCH_UNAVAILABLE");
      }
      assertHttpsUrl(this.catalogUrl, "运行时清单");
      const response = await this.fetchImpl(this.catalogUrl, {
        method: "GET",
        redirect: "follow",
        headers: { Accept: "application/json" },
      });
      if (!response?.ok) {
        throw runtimeManagerError(
          `运行时清单获取失败：HTTP ${response?.status || 0}`,
          "HAOLO_TOOL_RUNTIME_CATALOG_FETCH_FAILED",
        );
      }
      payload = await response.json();
    } else if (this.catalogPath && fs.existsSync(this.catalogPath)) {
      payload = await readJsonFile(this.catalogPath);
    } else {
      return null;
    }
    return validateRuntimeCatalog(payload, {
      platform: this.platform,
      arch: this.arch,
      allowLocalPackageSources: this.allowLocalPackageSources,
    });
  }

  async installPackage(descriptor) {
    const packageLabel = descriptor.displayName || descriptor.id;
    const archivePath = path.join(this.downloadsDir(), `${descriptor.id}-${descriptor.version}.tar.gz`);
    const stagingDir = path.join(
      this.rootDir,
      `.staging-${descriptor.id}-${descriptor.version}-${process.pid}-${Date.now()}`,
    );
    const targetDir = this.packageDir(descriptor.id, descriptor.version);
    await safeRemoveInside(this.rootDir, stagingDir);
    await ensureAvailableDiskSpace(
      this.rootDir,
      descriptor.sizeBytes
        + (descriptor.uncompressedSizeBytes || 0)
        + MIN_FREE_SPACE_RESERVE_BYTES,
    );

    try {
      if (descriptor.archivePath) {
        await copyLocalArchive(descriptor.archivePath, archivePath, descriptor);
      } else {
        this.setStatus({
          phase: "downloading",
          state: "downloading",
          error: null,
          message: `正在下载${packageLabel}…`,
          progress: {
            packageId: descriptor.id,
            packageName: packageLabel,
            downloadedBytes: 0,
            totalBytes: descriptor.sizeBytes,
            percent: 0,
          },
        });
        await downloadFileWithResume({
          url: descriptor.url,
          destinationPath: archivePath,
          partialPath: `${archivePath}.part`,
          expectedSize: descriptor.sizeBytes,
          expectedSha256: descriptor.sha256,
          fetchImpl: this.fetchImpl,
          maxAttempts: descriptor.maxAttempts || DEFAULT_MAX_ATTEMPTS,
          connectTimeoutMs: descriptor.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS,
          stallTimeoutMs: descriptor.stallTimeoutMs || DEFAULT_STALL_TIMEOUT_MS,
          onProgress: (progress) => {
            const totalBytes = progress.totalBytes || descriptor.sizeBytes || 0;
            const percent = totalBytes > 0 ? Math.min(100, (progress.downloadedBytes / totalBytes) * 100) : 0;
            this.setStatus({
              phase: "downloading",
              state: "downloading",
              message: `正在下载${packageLabel}…`,
              progress: {
                packageId: descriptor.id,
                packageName: packageLabel,
                downloadedBytes: progress.downloadedBytes,
                totalBytes,
                percent,
              },
            });
          },
        });
      }

      this.setStatus({
        phase: "installing",
        state: "installing",
        message: `正在验证并安装${packageLabel}…`,
        progress: {
          packageId: descriptor.id,
          packageName: packageLabel,
          downloadedBytes: descriptor.sizeBytes,
          totalBytes: descriptor.sizeBytes,
          percent: 100,
        },
      });
      await fs.promises.mkdir(stagingDir, { recursive: true });
      await extractTarGzipArchive({
        archivePath,
        destinationRoot: stagingDir,
        maxUncompressedBytes: descriptor.uncompressedSizeBytes || undefined,
      });
      const installed = await validateExtractedPackage(stagingDir, descriptor, {
        platform: this.platform,
        arch: this.arch,
      });
      const manifestSha256 = await sha256File(path.join(stagingDir, TOOL_RUNTIME_PACKAGE_MANIFEST));
      const fileMetadata = await packageFileMetadata(stagingDir, installed.files);
      await writeJsonAtomic(path.join(stagingDir, TOOL_RUNTIME_READY_MARKER), {
        schemaVersion: 1,
        id: descriptor.id,
        version: descriptor.version,
        archiveSha256: descriptor.sha256,
        manifestSha256,
        installedAt: new Date().toISOString(),
        files: installed.files,
        fileMetadata,
        layout: installed.layout,
      });
      await replaceDirectoryAtomic(this.rootDir, stagingDir, targetDir);
    } finally {
      await fs.promises.rm(archivePath, { force: true }).catch(() => {});
      await fs.promises.rm(`${archivePath}.part`, { force: true }).catch(() => {});
      await safeRemoveInside(this.rootDir, stagingDir);
    }
  }

  async pruneSupersededPackages(currentPackages) {
    const packagesRoot = this.packagesDir();
    const ids = await fs.promises.readdir(packagesRoot, { withFileTypes: true }).catch(() => []);
    for (const idEntry of ids) {
      if (!idEntry.isDirectory() || !safeId(idEntry.name)) continue;
      const keepVersion = currentPackages[idEntry.name];
      const versionsRoot = path.join(packagesRoot, idEntry.name);
      const versions = await fs.promises.readdir(versionsRoot, { withFileTypes: true }).catch(() => []);
      const superseded = versions
        .filter((entry) => entry.isDirectory() && safeVersion(entry.name) && entry.name !== keepVersion)
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(1);
      for (const entry of superseded) {
        await safeRemoveInside(this.rootDir, path.join(versionsRoot, entry.name));
      }
    }
  }

  runExclusive(operation) {
    if (this.operationPromise) return this.operationPromise;
    this.operationPromise = Promise.resolve()
      .then(operation)
      .catch(async (error) => {
        await this.inspect().catch(() => {});
        this.setStatus({
          state: hasUsefulRuntime(this.resolved) ? this.status.state : "error",
          phase: "idle",
          error: error?.message || String(error),
          message: `运行时准备失败：${error?.message || String(error)}`,
          progress: null,
        });
        throw error;
      })
      .finally(() => {
        this.operationPromise = null;
      });
    return this.operationPromise;
  }

  setStatus(patch) {
    this.status = {
      ...this.status,
      ...patch,
      catalogConfigured: Boolean(this.catalogUrl || this.catalogPath),
      rootDir: this.rootDir,
      updatedAt: new Date().toISOString(),
    };
    this.emit("status", this.getStatus());
  }

  packagesDir() {
    return path.join(this.rootDir, "packages");
  }

  downloadsDir() {
    return path.join(this.rootDir, "downloads");
  }

  currentFilePath() {
    return path.join(this.rootDir, TOOL_RUNTIME_CURRENT_FILE);
  }

  packageDir(id, version) {
    if (!safeId(id) || !safeVersion(version)) {
      throw runtimeManagerError("运行时包标识不安全。", "HAOLO_TOOL_RUNTIME_INVALID_ID");
    }
    return path.join(this.packagesDir(), id, version);
  }
}

export function validateRuntimeCatalog(
  payload,
  { platform = process.platform, arch = process.arch, allowLocalPackageSources = false } = {},
) {
  if (!payload || payload.schemaVersion !== TOOL_RUNTIME_CATALOG_SCHEMA_VERSION || !Array.isArray(payload.packages)) {
    throw runtimeManagerError("运行时清单格式不兼容。", "HAOLO_TOOL_RUNTIME_CATALOG_INVALID");
  }
  const seen = new Set();
  const packages = [];
  for (const raw of payload.packages) {
    const id = String(raw?.id || "").trim().toLowerCase();
    const version = String(raw?.version || "").trim();
    const targetPlatform = String(raw?.platform || platform);
    const targetArch = String(raw?.arch || arch);
    if (!safeId(id) || !safeVersion(version)) {
      throw runtimeManagerError("运行时清单包含无效包标识或版本。", "HAOLO_TOOL_RUNTIME_CATALOG_INVALID");
    }
    const targetKey = `${id}:${targetPlatform}:${targetArch}`;
    if (seen.has(targetKey)) {
      throw runtimeManagerError(`运行时清单重复声明 ${id}。`, "HAOLO_TOOL_RUNTIME_CATALOG_INVALID");
    }
    seen.add(targetKey);
    if (targetPlatform !== platform || targetArch !== arch) continue;

    const archivePath = optionalString(raw.archivePath);
    const url = optionalString(raw.url);
    if (archivePath) {
      if (!allowLocalPackageSources || !path.isAbsolute(archivePath)) {
        throw runtimeManagerError("运行时清单不允许本地包来源。", "HAOLO_TOOL_RUNTIME_CATALOG_INVALID");
      }
    } else {
      assertHttpsUrl(url, `${id} 下载地址`);
    }
    const sizeBytes = positiveInteger(raw.sizeBytes);
    const sha256 = normalizedSha256(raw.sha256);
    if (!sizeBytes || !sha256) {
      throw runtimeManagerError(`运行时包 ${id} 缺少大小或 SHA-256。`, "HAOLO_TOOL_RUNTIME_CATALOG_INVALID");
    }
    packages.push({
      id,
      version,
      displayName: optionalString(raw.displayName) || id,
      platform: targetPlatform,
      arch: targetArch,
      url,
      archivePath,
      sizeBytes,
      uncompressedSizeBytes: positiveInteger(raw.uncompressedSizeBytes) || 0,
      sha256,
      preload: raw.preload !== false,
      maxAttempts: positiveInteger(raw.maxAttempts) || DEFAULT_MAX_ATTEMPTS,
      connectTimeoutMs: positiveInteger(raw.connectTimeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS,
      stallTimeoutMs: positiveInteger(raw.stallTimeoutMs) || DEFAULT_STALL_TIMEOUT_MS,
    });
  }
  return {
    schemaVersion: TOOL_RUNTIME_CATALOG_SCHEMA_VERSION,
    generatedAt: optionalString(payload.generatedAt) || null,
    packages,
  };
}

export function buildToolRuntimeEnvironment(baseEnv = {}, resolution = {}, meta = {}) {
  const next = { ...baseEnv };
  const binDirs = uniquePaths([
    ...(Array.isArray(resolution.binDirs) ? resolution.binDirs : []),
    ...Object.values(resolution.executables || {}).map((value) => (value ? path.dirname(value) : null)),
  ]);
  const pathKey = Object.keys(next).find((key) => key.toLowerCase() === "path")
    || (process.platform === "win32" ? "Path" : "PATH");
  const existingPath = String(next[pathKey] || "");
  const existingDirs = existingPath.split(path.delimiter).filter(Boolean);
  next[pathKey] = uniquePaths([...binDirs, ...existingDirs]).join(path.delimiter);

  const executables = resolution.executables || {};
  if (executables.python) {
    next.PYTHON = executables.python;
    next.PYTHON_EXECUTABLE = executables.python;
    next.PYTHONIOENCODING = "utf-8";
    next.PYTHONUTF8 = "1";
    if (resolution.isolated !== false) {
      next.PYTHONNOUSERSITE = "1";
      next.PIP_DISABLE_PIP_VERSION_CHECK = "1";
    }
  }
  if (executables.node) {
    next.NODE = executables.node;
    next.NODE_EXECUTABLE = executables.node;
  }
  if (executables.rg) next.RIPGREP_PATH = executables.rg;
  if (executables.git) next.GIT_EXECUTABLE = executables.git;
  if (executables.uv) next.UV = executables.uv;
  if (executables.pnpm) next.PNPM = executables.pnpm;
  if (resolution.nodeModules) {
    next.CODEX_WORKSPACE_DEPENDENCIES_NODE_MODULES = resolution.nodeModules;
  }
  if (hasUsefulRuntime(resolution)) {
    next.HAOLO_TOOL_RUNTIME_ROOT = meta.rootDir || resolution.rootDir || "";
    next.HAOLO_TOOL_RUNTIME_SOURCE = meta.source || resolution.source || "managed";
  }
  return next;
}

async function inspectManagedPackage(packageRoot, { id, version, platform, arch, verify }) {
  const marker = await readJsonFile(path.join(packageRoot, TOOL_RUNTIME_READY_MARKER));
  const manifest = await readJsonFile(path.join(packageRoot, TOOL_RUNTIME_PACKAGE_MANIFEST));
  if (
    !marker
    || marker.schemaVersion !== 1
    || marker.id !== id
    || marker.version !== version
    || !manifest
  ) {
    return { id, version, ready: false, state: "invalid", error: "运行时包缺少有效就绪标记。" };
  }
  try {
    const validated = validatePackageManifest(manifest, { id, version, platform, arch });
    const manifestSha256 = await sha256File(path.join(packageRoot, TOOL_RUNTIME_PACKAGE_MANIFEST));
    if (!marker.manifestSha256 || marker.manifestSha256 !== manifestSha256) {
      throw runtimeManagerError("运行时包内部清单已变化。", "HAOLO_TOOL_RUNTIME_FILE_INVALID");
    }
    if (verify) {
      await verifyPackageFiles(packageRoot, validated.files);
    } else {
      await verifyPackageFileMetadata(packageRoot, validated.files, marker.fileMetadata);
    }
    await verifyLayoutTargets(packageRoot, validated.layout);
    return {
      id,
      version,
      ready: true,
      state: "ready",
      installedAt: marker.installedAt || null,
      resolution: resolutionFromPackage(packageRoot, validated.layout, id, version),
    };
  } catch (error) {
    return {
      id,
      version,
      ready: false,
      state: "invalid",
      error: error?.message || String(error),
    };
  }
}

async function validateExtractedPackage(packageRoot, descriptor, target) {
  const manifestPath = path.join(packageRoot, TOOL_RUNTIME_PACKAGE_MANIFEST);
  const manifest = await readJsonFile(manifestPath);
  const validated = validatePackageManifest(manifest, {
    id: descriptor.id,
    version: descriptor.version,
    platform: target.platform,
    arch: target.arch,
  });
  await verifyPackageFiles(packageRoot, validated.files);
  await verifyPackageFileInventory(packageRoot, validated.files);
  await verifyLayoutTargets(packageRoot, validated.layout);
  return validated;
}

function validatePackageManifest(payload, { id, version, platform, arch }) {
  if (
    !payload
    || payload.schemaVersion !== TOOL_RUNTIME_PACKAGE_SCHEMA_VERSION
    || payload.id !== id
    || payload.version !== version
    || payload.platform !== platform
    || payload.arch !== arch
    || !payload.layout
    || typeof payload.layout !== "object"
    || !Array.isArray(payload.files)
  ) {
    throw runtimeManagerError("运行时包内部清单不匹配。", "HAOLO_TOOL_RUNTIME_PACKAGE_INVALID");
  }
  const seenFiles = new Set();
  const files = payload.files.map((entry) => {
    const relativePath = safeRelativePath(entry?.path);
    const sha256 = normalizedSha256(entry?.sha256);
    if (!relativePath || !sha256 || !Number.isSafeInteger(Number(entry?.size)) || Number(entry.size) < 0) {
      throw runtimeManagerError("运行时包文件清单无效。", "HAOLO_TOOL_RUNTIME_PACKAGE_INVALID");
    }
    const comparable = process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
    if (seenFiles.has(comparable)) {
      throw runtimeManagerError(`运行时包重复声明文件：${relativePath}`, "HAOLO_TOOL_RUNTIME_PACKAGE_INVALID");
    }
    seenFiles.add(comparable);
    return { path: relativePath, size: Number(entry.size), sha256 };
  });
  const layout = normalizeRuntimeLayout(payload.layout);
  for (const relativePath of Object.values(layout.executables)) {
    const comparable = process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
    if (!seenFiles.has(comparable)) {
      throw runtimeManagerError(`运行时入口未列入文件清单：${relativePath}`, "HAOLO_TOOL_RUNTIME_PACKAGE_INVALID");
    }
  }
  return { ...payload, files, layout };
}

function normalizeRuntimeLayout(layout) {
  const executables = {};
  for (const key of ["python", "node", "rg", "git", "uv", "pnpm"]) {
    const value = safeRelativePath(layout.executables?.[key]);
    if (value) executables[key] = value;
  }
  const nodeModules = safeRelativePath(layout.nodeModules);
  const binDirs = Array.isArray(layout.binDirs)
    ? layout.binDirs.map(safeRelativePath).filter(Boolean)
    : [];
  if (!Object.keys(executables).length && !nodeModules) {
    throw runtimeManagerError("运行时包没有声明可用工具。", "HAOLO_TOOL_RUNTIME_PACKAGE_INVALID");
  }
  return { executables, nodeModules, binDirs };
}

async function verifyPackageFiles(packageRoot, files) {
  for (const entry of files) {
    const filePath = resolvePackagePath(packageRoot, entry.path);
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size !== entry.size) {
      throw runtimeManagerError(`运行时文件缺失或大小不符：${entry.path}`, "HAOLO_TOOL_RUNTIME_FILE_INVALID");
    }
    const sha256 = await sha256File(filePath);
    if (sha256 !== entry.sha256) {
      throw runtimeManagerError(`运行时文件哈希不符：${entry.path}`, "HAOLO_TOOL_RUNTIME_FILE_INVALID");
    }
  }
}

async function verifyPackageFileInventory(packageRoot, files) {
  const expected = new Set(
    files.map((entry) => process.platform === "win32" ? entry.path.toLowerCase() : entry.path),
  );
  const actual = new Set();
  const pending = [packageRoot];
  while (pending.length) {
    const current = pending.pop();
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(filePath);
        continue;
      }
      if (!entry.isFile()) {
        throw runtimeManagerError(`运行时包包含不支持的文件类型：${entry.name}`, "HAOLO_TOOL_RUNTIME_PACKAGE_INVALID");
      }
      const relativePath = path.relative(packageRoot, filePath).split(path.sep).join("/");
      if (relativePath === TOOL_RUNTIME_PACKAGE_MANIFEST) continue;
      actual.add(process.platform === "win32" ? relativePath.toLowerCase() : relativePath);
    }
  }
  if (
    actual.size !== expected.size
    || [...actual].some((entry) => !expected.has(entry))
  ) {
    throw runtimeManagerError("运行时包实际文件与内部清单不一致。", "HAOLO_TOOL_RUNTIME_PACKAGE_INVALID");
  }
}

async function packageFileMetadata(packageRoot, files) {
  const metadata = [];
  for (const entry of files) {
    const stat = await fs.promises.stat(resolvePackagePath(packageRoot, entry.path));
    metadata.push({
      path: entry.path,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: entry.sha256,
    });
  }
  return metadata;
}

async function verifyPackageFileMetadata(packageRoot, files, metadata) {
  if (!Array.isArray(metadata) || metadata.length !== files.length) {
    throw runtimeManagerError("运行时包缺少完整性元数据。", "HAOLO_TOOL_RUNTIME_FILE_INVALID");
  }
  const metadataByPath = new Map(
    metadata.map((entry) => [
      process.platform === "win32" ? String(entry?.path || "").toLowerCase() : String(entry?.path || ""),
      entry,
    ]),
  );
  for (const file of files) {
    const key = process.platform === "win32" ? file.path.toLowerCase() : file.path;
    const recorded = metadataByPath.get(key);
    const stat = await fs.promises.stat(resolvePackagePath(packageRoot, file.path)).catch(() => null);
    if (
      !recorded
      || recorded.sha256 !== file.sha256
      || recorded.size !== file.size
      || !stat?.isFile()
      || stat.size !== recorded.size
      || Math.abs(stat.mtimeMs - Number(recorded.mtimeMs)) >= 2
    ) {
      throw runtimeManagerError(`运行时文件状态已变化：${file.path}`, "HAOLO_TOOL_RUNTIME_FILE_INVALID");
    }
  }
}

async function verifyLayoutTargets(packageRoot, layout) {
  for (const relativePath of Object.values(layout.executables || {})) {
    const stat = await fs.promises.stat(resolvePackagePath(packageRoot, relativePath)).catch(() => null);
    if (!stat?.isFile()) {
      throw runtimeManagerError(`运行时入口不存在：${relativePath}`, "HAOLO_TOOL_RUNTIME_LAYOUT_INVALID");
    }
  }
  if (layout.nodeModules) {
    const stat = await fs.promises.stat(resolvePackagePath(packageRoot, layout.nodeModules)).catch(() => null);
    if (!stat?.isDirectory()) {
      throw runtimeManagerError("运行时 Node.js 依赖目录不存在。", "HAOLO_TOOL_RUNTIME_LAYOUT_INVALID");
    }
  }
  for (const relativePath of layout.binDirs || []) {
    const stat = await fs.promises.stat(resolvePackagePath(packageRoot, relativePath)).catch(() => null);
    if (!stat?.isDirectory()) {
      throw runtimeManagerError(`运行时工具目录不存在：${relativePath}`, "HAOLO_TOOL_RUNTIME_LAYOUT_INVALID");
    }
  }
}

function resolutionFromPackage(packageRoot, layout, id, version) {
  const executables = {};
  for (const [key, relativePath] of Object.entries(layout.executables || {})) {
    executables[key] = resolvePackagePath(packageRoot, relativePath);
  }
  return {
    source: "managed",
    rootDir: packageRoot,
    packages: [{ id, version, rootDir: packageRoot }],
    executables,
    nodeModules: layout.nodeModules ? resolvePackagePath(packageRoot, layout.nodeModules) : null,
    binDirs: uniquePaths((layout.binDirs || []).map((entry) => resolvePackagePath(packageRoot, entry))),
    isolated: true,
  };
}

async function discoverSharedRuntime(roots, { platform }) {
  for (const rootValue of roots) {
    const root = path.resolve(rootValue);
    const dependencies = path.join(root, "dependencies");
    const python = path.join(
      dependencies,
      "python",
      platform === "win32" ? "python.exe" : path.join("bin", "python3"),
    );
    const node = path.join(
      dependencies,
      "node",
      platform === "win32" ? path.join("bin", "node.exe") : path.join("bin", "node"),
    );
    const nodeModules = path.join(dependencies, "node", "node_modules");
    if (!fs.existsSync(python) && !fs.existsSync(node)) continue;
    const executableCandidates = {
      python,
      node,
      rg: path.join(dependencies, "bin", "override", platform === "win32" ? "rg.exe" : "rg"),
      git: path.join(
        dependencies,
        "native",
        "git",
        platform === "win32" ? path.join("cmd", "git.exe") : path.join("bin", "git"),
      ),
      uv: path.join(dependencies, "bin", "fallback", platform === "win32" ? "uv.exe" : "uv"),
      pnpm: path.join(dependencies, "bin", "fallback", platform === "win32" ? "pnpm.cmd" : "pnpm"),
    };
    const executables = Object.fromEntries(
      Object.entries(executableCandidates).filter(([, candidate]) => fs.existsSync(candidate)),
    );
    return {
      source: "shared-cache",
      rootDir: root,
      packages: [],
      executables,
      nodeModules: fs.existsSync(nodeModules) ? nodeModules : null,
      binDirs: uniquePaths(Object.values(executables).map((entry) => path.dirname(entry))),
      isolated: true,
    };
  }
  return null;
}

function discoverSystemRuntime(env, { platform }) {
  const pathValue = firstString(env.PATH, env.Path, env.path);
  const names = platform === "win32"
    ? {
        python: ["python.exe", "python3.exe"],
        node: ["node.exe"],
        rg: ["rg.exe"],
        git: ["git.exe"],
        uv: ["uv.exe"],
        pnpm: ["pnpm.cmd", "pnpm.exe"],
      }
    : {
        python: ["python3", "python"],
        node: ["node"],
        rg: ["rg"],
        git: ["git"],
        uv: ["uv"],
        pnpm: ["pnpm"],
      };
  const executables = {};
  for (const [key, candidates] of Object.entries(names)) {
    const resolved = findExecutableOnPath(pathValue, candidates);
    if (resolved) executables[key] = resolved;
  }
  return {
    source: "system",
    rootDir: null,
    packages: [],
    executables,
    nodeModules: null,
    binDirs: uniquePaths(Object.values(executables).map((entry) => path.dirname(entry))),
    isolated: false,
  };
}

function mergeRuntimeResolutions(resolutions) {
  const result = emptyResolvedRuntime();
  result.source = "managed";
  result.isolated = true;
  for (const resolution of resolutions) {
    result.rootDir ||= resolution.rootDir;
    result.packages.push(...(resolution.packages || []));
    Object.assign(result.executables, resolution.executables || {});
    result.nodeModules ||= resolution.nodeModules || null;
    result.binDirs.push(...(resolution.binDirs || []));
  }
  result.binDirs = uniquePaths(result.binDirs);
  return result;
}

function mergeMissingRuntimeResolution(primary, fallback) {
  if (!hasUsefulRuntime(primary)) {
    return {
      ...fallback,
      packages: [...(fallback.packages || [])],
      executables: { ...(fallback.executables || {}) },
      binDirs: [...(fallback.binDirs || [])],
    };
  }
  const result = {
    ...primary,
    packages: [...(primary.packages || [])],
    executables: { ...(primary.executables || {}) },
    binDirs: [...(primary.binDirs || [])],
  };
  for (const [key, value] of Object.entries(fallback.executables || {})) {
    if (!result.executables[key] && value) result.executables[key] = value;
  }
  result.nodeModules ||= fallback.nodeModules || null;
  result.binDirs = uniquePaths([
    ...result.binDirs,
    ...(fallback.binDirs || []),
  ]);
  return result;
}

function emptyResolvedRuntime() {
  return {
    source: "unavailable",
    rootDir: null,
    packages: [],
    executables: {},
    nodeModules: null,
    binDirs: [],
    isolated: false,
  };
}

function publicCapabilities(resolution) {
  const executables = resolution.executables || {};
  return {
    python: executables.python || null,
    node: executables.node || null,
    nodeModules: resolution.nodeModules || null,
    rg: executables.rg || null,
    git: executables.git || null,
    uv: executables.uv || null,
    pnpm: executables.pnpm || null,
  };
}

function publicPackageStatus(value) {
  return {
    id: value.id,
    version: value.version,
    state: value.state,
    ready: value.ready,
    installedAt: value.installedAt || null,
    error: value.error || null,
  };
}

function runtimeReadyMessage(source) {
  if (source === "managed") return "Haolo 私有运行时已就绪，任务无需安装系统 Python 或 Node.js。";
  if (source === "shared-cache") return "已复用本机受管工作区运行时。";
  return "已发现系统 Python 和 Node.js；Haolo 私有运行时将在可用时替换它们。";
}

function hasUsefulRuntime(resolution) {
  return Boolean(
    resolution?.executables
    && (resolution.executables.python || resolution.executables.node || resolution.nodeModules),
  );
}

async function copyLocalArchive(sourcePath, targetPath, descriptor) {
  const source = path.resolve(sourcePath);
  const stat = await fs.promises.stat(source).catch(() => null);
  if (!stat?.isFile() || stat.size !== descriptor.sizeBytes) {
    throw runtimeManagerError("本地运行时包不存在或大小不符。", "HAOLO_TOOL_RUNTIME_LOCAL_PACKAGE_INVALID");
  }
  const actualSha256 = await sha256File(source);
  if (actualSha256 !== descriptor.sha256) {
    throw runtimeManagerError("本地运行时包 SHA-256 不匹配。", "HAOLO_TOOL_RUNTIME_LOCAL_PACKAGE_INVALID");
  }
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.copyFile(source, targetPath);
}

async function ensureAvailableDiskSpace(directory, requiredBytes) {
  if (typeof fs.promises.statfs !== "function") return;
  const stats = await fs.promises.statfs(directory).catch(() => null);
  if (!stats) return;
  const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  if (
    Number.isFinite(availableBytes)
    && availableBytes > 0
    && availableBytes < requiredBytes
  ) {
    throw runtimeManagerError(
      `磁盘空间不足：至少需要 ${formatBytes(requiredBytes)}，当前可用 ${formatBytes(availableBytes)}。`,
      "HAOLO_TOOL_RUNTIME_DISK_SPACE_LOW",
    );
  }
}

async function replaceDirectoryAtomic(rootDir, stagingDir, targetDir) {
  assertPathInside(rootDir, stagingDir);
  assertPathInside(rootDir, targetDir);
  await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });
  const backupDir = `${targetDir}.backup-${process.pid}-${Date.now()}`;
  let movedExisting = false;
  try {
    if (await pathExists(targetDir)) {
      await fs.promises.rename(targetDir, backupDir);
      movedExisting = true;
    }
    await fs.promises.rename(stagingDir, targetDir);
    if (movedExisting) await safeRemoveInside(rootDir, backupDir);
  } catch (error) {
    if (movedExisting && !(await pathExists(targetDir)) && (await pathExists(backupDir))) {
      await fs.promises.rename(backupDir, targetDir).catch(() => {});
    }
    throw error;
  }
}

async function safeRemoveInside(rootDir, targetPath) {
  const target = path.resolve(targetPath);
  assertPathInside(rootDir, target);
  await fs.promises.rm(target, { recursive: true, force: true });
}

function assertPathInside(rootDir, targetPath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw runtimeManagerError("运行时文件操作目标不安全。", "HAOLO_TOOL_RUNTIME_UNSAFE_PATH");
  }
}

function resolvePackagePath(packageRoot, relativePath) {
  const safe = safeRelativePath(relativePath);
  if (!safe) {
    throw runtimeManagerError("运行时包路径无效。", "HAOLO_TOOL_RUNTIME_UNSAFE_PATH");
  }
  const target = path.resolve(packageRoot, ...safe.split("/"));
  assertPathInside(packageRoot, target);
  return target;
}

function safeRelativePath(value) {
  const text = String(value || "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!text || text.startsWith("/") || /^[a-z]:/i.test(text)) return "";
  const parts = text.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) return "";
  return parts.join("/");
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(
    fs.createReadStream(filePath),
    new Writable({
      write(chunk, _encoding, callback) {
        hash.update(chunk);
        callback();
      },
    }),
  );
  return hash.digest("hex").toLowerCase();
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
  try {
    await fs.promises.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.promises.rename(tempPath, filePath);
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
  }
}

function findExecutableOnPath(pathValue, names) {
  for (const dir of String(pathValue || "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return null;
}

function uniquePaths(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const text = optionalString(value);
    if (!text) continue;
    const resolved = path.resolve(text);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

function comparablePath(value) {
  const resolved = path.resolve(String(value || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw runtimeManagerError(`${label}无效。`, "HAOLO_TOOL_RUNTIME_URL_INVALID");
  }
  if (parsed.protocol !== "https:") {
    throw runtimeManagerError(`${label}必须使用 HTTPS。`, "HAOLO_TOOL_RUNTIME_URL_INVALID");
  }
}

function safeId(value) {
  return SAFE_ID_PATTERN.test(String(value || ""));
}

function safeVersion(value) {
  return SAFE_VERSION_PATTERN.test(String(value || ""));
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function normalizedSha256(value) {
  const text = String(value || "").trim().toLowerCase();
  return SHA256_PATTERN.test(text) ? text : "";
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes;
  let index = -1;
  do {
    amount /= 1024;
    index += 1;
  } while (amount >= 1024 && index < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[index]}`;
}

function requiredString(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function firstString(...values) {
  for (const value of values) {
    const text = optionalString(value);
    if (text) return text;
  }
  return "";
}

async function pathExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function runtimeManagerError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
