const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(packageRoot, "..");
const REQUIRED_PACKAGED_NODE_MODULES = [
  "@larksuiteoapi/node-sdk",
  "axios",
  "call-bind-apply-helpers",
  "dunder-proto",
  "es-define-property",
  "es-object-atoms",
  "es-set-tostringtag",
  "form-data",
  "function-bind",
  "get-intrinsic",
  "get-proto",
  "gopd",
  "hasown",
  "math-intrinsics",
  "qrcode",
  "qs",
  "undici",
  "socks",
  "smart-buffer",
  "ip-address",
  "ws",
];

function restoreWindowsIcon(context = {}) {
  if (process.platform !== "win32") {
    return;
  }

  assertRequiredPackagedDependencies(context);

  const iconPath = path.join(packageRoot, "resources", "haolo-logo.ico");
  if (!fs.existsSync(iconPath)) {
    throw new Error(`Windows icon not found: ${iconPath}`);
  }

  const exePath = resolveExePath(context);
  if (!exePath) {
    throw new Error(`Could not find packaged Windows executable under: ${context.appOutDir || packageRoot}`);
  }

  setWindowsExecutableIcon(exePath, iconPath);

  console.log(`[restore-windows-icon] ${exePath}`);
}

function setWindowsExecutableIcon(exePath, iconPath) {
  const rceditPath = resolveRceditPath();
  const result = spawnSync(rceditPath, [exePath, "--set-icon", iconPath], {
    cwd: packageRoot,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0 || result.error) {
    const details = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join("\n");
    throw new Error(`Failed to restore Windows executable icon with rcedit.\n${details}`);
  }
}

function resolveExePath(context) {
  const appOutDir = context.appOutDir || path.join(packageRoot, "release", "win-unpacked");
  const productFilename = context.packager?.appInfo?.productFilename;
  const productName = context.packager?.appInfo?.productName || readPackageProductName();
  const candidates = [
    productFilename && path.join(appOutDir, `${productFilename}.exe`),
    productName && path.join(appOutDir, `${productName}.exe`),
    path.join(appOutDir, "haolo_desktop.exe"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    return fs
      .readdirSync(appOutDir)
      .filter((name) => path.extname(name).toLowerCase() === ".exe")
      .map((name) => path.join(appOutDir, name))
      .find((candidate) => !/uninstall/i.test(path.basename(candidate)));
  } catch {
    return null;
  }
}

function readPackageProductName() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  return packageJson.build?.productName || packageJson.name;
}

function resolveRceditPath() {
  const candidates = [
    path.join(packageRoot, "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
    path.join(workspaceRoot, "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
    ...findPnpmRceditCandidates(packageRoot),
    ...findPnpmRceditCandidates(workspaceRoot),
  ];

  const rceditPath = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!rceditPath) {
    throw new Error("Could not find electron-winstaller/vendor/rcedit.exe");
  }
  return rceditPath;
}

function assertRequiredPackagedDependencies(context = {}) {
  const appAsarPath = path.join(context.appOutDir || path.join(packageRoot, "release", "win-unpacked"), "resources", "app.asar");
  if (!fs.existsSync(appAsarPath)) {
    throw new Error(`Packaged app.asar not found: ${appAsarPath}`);
  }

  const asarList = listAsarFiles(appAsarPath);
  const missing = REQUIRED_PACKAGED_NODE_MODULES.filter((moduleName) => !asarHasNodeModule(asarList, moduleName));
  if (missing.length) {
    throw new Error(
      [
        "Packaged app.asar is missing runtime node_modules:",
        ...missing.map((moduleName) => `- ${moduleName}`),
        "These modules must be declared in dependencies and included before shipping the installer.",
      ].join("\n"),
    );
  }
  console.log(`[package-deps] verified ${REQUIRED_PACKAGED_NODE_MODULES.length} runtime modules in ${appAsarPath}`);
}

function listAsarFiles(appAsarPath) {
  const asarCli = resolveAsarCliPath();
  const result = spawnSync(process.execPath, [asarCli, "list", appAsarPath], {
    cwd: packageRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    const details = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join("\n");
    throw new Error(`Failed to list packaged app.asar.\n${details}`);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function asarHasNodeModule(asarList, moduleName) {
  const normalizedModulePath = `\\node_modules\\${moduleName.replace(/\//g, "\\")}`;
  return asarList.some((entry) => entry === normalizedModulePath || entry.startsWith(`${normalizedModulePath}\\`));
}

function resolveAsarCliPath() {
  const candidates = [
    path.join(packageRoot, "node_modules", "@electron", "asar", "bin", "asar.js"),
    path.join(workspaceRoot, "node_modules", "@electron", "asar", "bin", "asar.js"),
    ...findPnpmPackageFileCandidates(packageRoot, "@electron+asar@", path.join("node_modules", "@electron", "asar", "bin", "asar.js")),
    ...findPnpmPackageFileCandidates(workspaceRoot, "@electron+asar@", path.join("node_modules", "@electron", "asar", "bin", "asar.js")),
  ];
  const asarCli = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!asarCli) {
    throw new Error("Could not find @electron/asar/bin/asar.js for packaged dependency verification.");
  }
  return asarCli;
}

function findPnpmPackageFileCandidates(root, packageEntryPrefix, relativePath) {
  const pnpmDir = path.join(root, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmDir)) {
    return [];
  }

  return fs
    .readdirSync(pnpmDir)
    .filter((entry) => entry.startsWith(packageEntryPrefix))
    .map((entry) => path.join(pnpmDir, entry, relativePath));
}

function findPnpmRceditCandidates(root) {
  const pnpmDir = path.join(root, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmDir)) {
    return [];
  }

  return fs
    .readdirSync(pnpmDir)
    .filter((entry) => entry.startsWith("electron-winstaller@"))
    .map((entry) =>
      path.join(pnpmDir, entry, "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
    );
}

if (require.main === module) {
  const exePath = process.argv[2];
  restoreWindowsIcon(exePath ? { appOutDir: path.dirname(path.resolve(exePath)) } : {});
}

module.exports = restoreWindowsIcon;
module.exports.setWindowsExecutableIcon = setWindowsExecutableIcon;
