import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const require = createRequire(import.meta.url);
const splitPackageTargets = [
  { arch: "x64", architectures: ["x64"], directoryNames: ["mac", "mac-x64"] },
  { arch: "arm64", architectures: ["arm64"], directoryNames: ["mac-arm64"] },
];
const universalPackageTarget = {
  arch: "universal",
  architectures: ["arm64", "x64"],
  directoryNames: ["mac-universal"],
};
const electronHelperSuffixes = ["", " (GPU)", " (Plugin)", " (Renderer)"];
const requiredResourceFiles = [
  "bin/haolo_ai",
  "bin/rg",
  "licenses/ripgrep-LICENSE-MIT.txt",
  "haolo-logo.icns",
  "haolo-logo.svg",
  "haolo-tray-icon.png",
];
const requiredResourceDirectories = ["default-haolo-ai", "mcp"];
const requiredSignedEntitlements = [
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.device.audio-input",
];
const forbiddenSignedEntitlements = [
  "com.apple.security.cs.allow-dyld-environment-variables",
  "com.apple.security.cs.disable-library-validation",
];
const requiredRendererFixMarkers = [
  "mac-titlebar",
  "mac-traffic-light-spacer",
];
const forbiddenWindowsExtensions = new Set([
  ".bat",
  ".cmd",
  ".dll",
  ".exe",
  ".msi",
  ".ps1",
]);
const fatMachOMagicEndian = new Map([
  ["bebafeca", "le"],
  ["bfbafeca", "le"],
  ["cafebabe", "be"],
  ["cafebabf", "be"],
]);
const thinMachOMagicHexValues = new Set([
  "cefaedfe",
  "cffaedfe",
  "feedface",
  "feedfacf",
]);
let defaultAsarApi;

export function verifyMacPackages(options = {}) {
  const releaseDir = path.resolve(
    options.releaseDir || path.join(projectRoot, "release"),
  );
  const packageJsonPath = path.resolve(
    options.packageJsonPath || path.join(projectRoot, "package.json"),
  );
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const productName = packageJson.build?.productName || packageJson.name;
  const expectedVersion = String(packageJson.version || "").trim();
  if (!expectedVersion) {
    throw new Error(`Package version is missing from ${packageJsonPath}.`);
  }
  const targetName = normalizePackageTarget(options.target);
  const directAppPath = options.appPath ? path.resolve(options.appPath) : null;
  const targets = directAppPath
    ? [resolveDirectPackageTarget(directAppPath, targetName)]
    : resolvePackageTargets(releaseDir, productName, {
        requireSplit: options.requireSplit,
        requireUniversal: options.requireUniversal,
        target: targetName,
      });
  const verified = [];

  for (const target of targets) {
    const appPath = target.appPath || resolveAppBundle(
      releaseDir,
      productName,
      target.directoryNames,
    );
    verifyPackagedMacApp(appPath, {
      asarApi: options.asarApi,
      expectedArchitectures: target.architectures,
      expectedMain: packageJson.main,
      expectedVersion,
      inspectArchitectures: options.inspectArchitectures,
      productName,
      sourceRoot: options.sourceRoot || path.dirname(packageJsonPath),
      verifyAppAsar: options.verifyAppAsar,
      verifyAppMetadata: options.verifyAppMetadata,
      verifyAppSecurity:
        typeof options.verifyAppSecurity === "function"
          ? options.verifyAppSecurity
          : verifyPackagedAppSecurity,
    });
    verified.push({ arch: target.arch, appPath });
  }

  return verified;
}

export function verifyPackagedMacApp(appPath, options = {}) {
  const productName = String(options.productName || "").trim();
  if (!productName) throw new Error("A packaged macOS product name is required.");
  const expectedVersion = String(options.expectedVersion || "").trim();
  if (!expectedVersion) throw new Error("An expected macOS app version is required.");
  const expectedArchitectures = normalizeExpectedArchitectures(
    options.expectedArchitectures,
  );
  const inspectArchitectures =
    options.inspectArchitectures || inspectMachOArchitectures;
  const verifyAppMetadata =
    options.verifyAppMetadata || verifyPackagedAppMetadata;
  const verifyAppAsar = options.verifyAppAsar || verifyPackagedAppAsar;
  const contentsPath = path.join(appPath, "Contents");
  const resourcesPath = path.join(contentsPath, "Resources");
  const executablePath = path.join(contentsPath, "MacOS", productName);
  const electronFrameworkPath = path.join(
    contentsPath,
    "Frameworks",
    "Electron Framework.framework",
    "Versions",
    "A",
    "Electron Framework",
  );
  const runtimePath = path.join(resourcesPath, "bin", "haolo_ai");
  const ripgrepPath = path.join(resourcesPath, "bin", "rg");
  const architectureFiles = [
    [executablePath, "Electron executable"],
    [electronFrameworkPath, "Electron Framework executable"],
    ...electronHelperExecutablePaths(appPath, productName).map((filePath) => [
      filePath,
      `Electron helper ${path.basename(filePath)}`,
    ]),
    [runtimePath, "Haolo AI runtime"],
    [ripgrepPath, "ripgrep runtime"],
  ];

  assertUsableFile(path.join(contentsPath, "Info.plist"), "app Info.plist");
  for (const [filePath, label] of architectureFiles) {
    assertUsableFile(filePath, label);
  }

  const requiredArchitecturePaths = new Set(
    architectureFiles.map(([filePath]) => path.resolve(filePath)),
  );
  const allMachOFiles = discoverMachOFiles(contentsPath);
  const architecturePaths = [...new Set([
    ...requiredArchitecturePaths,
    ...allMachOFiles.map((filePath) => path.resolve(filePath)),
  ])].sort();
  for (const filePath of architecturePaths) {
    assertExpectedArchitectures(
      filePath,
      expectedArchitectures,
      inspectArchitectures,
    );
  }

  for (const relativePath of requiredResourceFiles) {
    assertUsableFile(
      path.join(resourcesPath, relativePath),
      `resource ${relativePath}`,
    );
  }
  for (const relativePath of requiredResourceDirectories) {
    assertDirectory(
      path.join(resourcesPath, relativePath),
      `resource ${relativePath}`,
    );
  }

  assertNoWindowsOnlyFiles(appPath);
  verifyAppAsar(appPath, {
    asarApi: options.asarApi,
    expectedMain: options.expectedMain,
    expectedVersion,
    sourceRoot: options.sourceRoot || projectRoot,
  });
  verifyAppMetadata(appPath, { expectedVersion });
  options.verifyAppSecurity?.(appPath, { expectedArchitectures, productName });

  return {
    appPath,
    architectureFiles: architecturePaths,
    expectedArchitectures,
    expectedVersion,
  };
}

export function verifyPackagedAppAsar(appPath, options = {}) {
  const expectedVersion = String(options.expectedVersion || "").trim();
  if (!expectedVersion) throw new Error("An expected app.asar version is required.");
  const sourceRoot = path.resolve(options.sourceRoot || projectRoot);
  const sourcePackagePath = path.join(sourceRoot, "package.json");
  const sourcePackage = JSON.parse(fs.readFileSync(sourcePackagePath, "utf8"));
  const expectedMain = String(options.expectedMain || sourcePackage.main || "").trim();
  if (!expectedMain) throw new Error(`Package main entry is missing from ${sourcePackagePath}.`);

  const appAsarPath = path.join(appPath, "Contents", "Resources", "app.asar");
  assertUsableFile(appAsarPath, "packaged app.asar");
  const asarApi = options.asarApi || loadAsarApi();
  asarApi.uncache?.(appAsarPath);
  const entries = asarApi.listPackage(appAsarPath).map(normalizeAsarEntry).filter(Boolean);
  const entrySet = new Set(entries);
  const requiredEntries = [
    "package.json",
    expectedMain,
    "src/main/wechat-external-channel-server.mjs",
    "dist/renderer/index.html",
  ];
  const missingEntries = requiredEntries.filter((entry) => !entrySet.has(entry));
  if (missingEntries.length) {
    throw new Error(
      `Packaged app.asar is missing required entries:\n${missingEntries.map((entry) => `- ${entry}`).join("\n")}`,
    );
  }

  const packagedPackageJson = parseJsonObject(
    extractAsarFile(asarApi, appAsarPath, "package.json").toString("utf8"),
    `Invalid packaged package.json in ${appAsarPath}`,
  );
  if (String(packagedPackageJson.version || "").trim() !== expectedVersion) {
    throw new Error(
      `Packaged app.asar version mismatch: expected ${expectedVersion}, found ${String(packagedPackageJson.version || "missing").trim() || "missing"}`,
    );
  }
  if (String(packagedPackageJson.main || "").trim() !== expectedMain) {
    throw new Error(
      `Packaged app.asar main mismatch: expected ${expectedMain}, found ${String(packagedPackageJson.main || "missing").trim() || "missing"}`,
    );
  }

  const leakedWindowsEntries = entries.filter(isWindowsOnlyPath);
  if (leakedWindowsEntries.length) {
    throw new Error(
      `Windows-only files leaked into packaged app.asar:\n${leakedWindowsEntries.map((entry) => `- ${entry}`).join("\n")}`,
    );
  }

  const sourceFiles = ["src/main", "dist/renderer"].flatMap((relativeDirectory) => {
    const directoryPath = path.join(sourceRoot, relativeDirectory);
    assertDirectory(directoryPath, `packaging source ${relativeDirectory}`);
    return listFiles(directoryPath)
      .filter((filePath) => !filePath.endsWith(".d.ts"))
      .map((filePath) => ({
        archivePath: toArchivePath(path.relative(sourceRoot, filePath)),
        filePath,
      }));
  });
  const missingSourceFiles = [];
  const mismatchedSourceFiles = [];
  for (const sourceFile of sourceFiles) {
    if (!entrySet.has(sourceFile.archivePath)) {
      missingSourceFiles.push(sourceFile.archivePath);
      continue;
    }
    const sourceContents = fs.readFileSync(sourceFile.filePath);
    const packagedContents = extractAsarFile(asarApi, appAsarPath, sourceFile.archivePath);
    if (!sourceContents.equals(packagedContents)) {
      mismatchedSourceFiles.push(sourceFile.archivePath);
    }
  }
  if (missingSourceFiles.length || mismatchedSourceFiles.length) {
    const details = [
      ...missingSourceFiles.map((entry) => `- missing ${entry}`),
      ...mismatchedSourceFiles.map((entry) => `- stale ${entry}`),
    ];
    throw new Error(
      `Packaged app.asar does not match the current main/renderer build:\n${details.join("\n")}`,
    );
  }

  const rendererJavaScriptEntries = entries.filter(
    (entry) => entry.startsWith("dist/renderer/") && entry.endsWith(".js"),
  );
  if (!rendererJavaScriptEntries.length) {
    throw new Error(`Packaged app.asar contains no renderer JavaScript: ${appAsarPath}`);
  }
  const rendererJavaScript = rendererJavaScriptEntries
    .map((entry) => extractAsarFile(asarApi, appAsarPath, entry).toString("utf8"))
    .join("\n");
  const missingRendererFixMarkers = requiredRendererFixMarkers.filter(
    (marker) => !rendererJavaScript.includes(marker),
  );
  if (missingRendererFixMarkers.length) {
    throw new Error(
      `Packaged renderer is missing context/sub-agent compatibility markers:\n${missingRendererFixMarkers.map((entry) => `- ${entry}`).join("\n")}`,
    );
  }

  return {
    appAsarPath,
    comparedSourceFiles: sourceFiles.length,
    entries,
    expectedMain,
    expectedVersion,
  };
}

export function verifyPackagedAppMetadata(appPath, options = {}) {
  const run = options.run || execFileSync;
  const expectedVersion = String(options.expectedVersion || "").trim();
  if (!expectedVersion) throw new Error("An expected macOS app version is required.");
  const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
  const infoPlist = parsePlistAsJson(infoPlistPath, run);
  for (const key of ["CFBundleVersion", "CFBundleShortVersionString"]) {
    if (String(infoPlist[key] || "").trim() !== expectedVersion) {
      throw new Error(
        `Packaged app version mismatch for ${key}: expected ${expectedVersion}, found ${String(infoPlist[key] || "missing").trim() || "missing"} in ${infoPlistPath}`,
      );
    }
  }
  if (
    typeof infoPlist.NSMicrophoneUsageDescription !== "string" ||
    !infoPlist.NSMicrophoneUsageDescription.trim()
  ) {
    throw new Error(
      `Packaged app is missing NSMicrophoneUsageDescription: ${infoPlistPath}`,
    );
  }
}

export function verifyPackagedAppSecurity(appPath, options = {}) {
  const run = options.run || execFileSync;
  const expectedArchitectures = normalizeExpectedArchitectures(
    options.expectedArchitectures || [process.arch],
  );
  const productName = String(options.productName || "").trim();

  run(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--all-architectures", "--verbose=1", appPath],
    { encoding: "utf8" },
  );

  const signedBundles = [
    ...new Set([
      appPath,
      ...(productName ? requiredElectronHelperAppPaths(appPath, productName) : []),
      ...discoverElectronHelperAppPaths(appPath),
    ]),
  ];
  for (const bundlePath of signedBundles) {
    for (const arch of expectedArchitectures) {
      const entitlements = inspectSignedEntitlements(bundlePath, arch, run);
      for (const entitlement of requiredSignedEntitlements) {
        if (entitlements[entitlement] !== true) {
          throw new Error(
            `Packaged ${arch} bundle signature is missing the ${entitlement} entitlement: ${bundlePath}`,
          );
        }
      }
      for (const entitlement of forbiddenSignedEntitlements) {
        if (entitlements[entitlement] === true) {
          throw new Error(
            `Packaged ${arch} bundle signature contains forbidden entitlement ${entitlement}: ${bundlePath}`,
          );
        }
      }
    }
  }
}

export function inspectMachOArchitectures(filePath) {
  if (process.platform !== "darwin") {
    throw new Error("Mach-O architecture inspection must run on macOS.");
  }
  const output = execFileSync("/usr/bin/lipo", ["-archs", filePath], {
    encoding: "utf8",
  }).trim();
  return output.split(/\s+/).map(normalizeArchitecture).filter(Boolean);
}

export function parseMacPackageVerificationArgs(args) {
  const options = {
    appPath: null,
    requireSplit: false,
    requireUniversal: false,
    target: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--require-split") {
      options.requireSplit = true;
    } else if (argument === "--require-universal") {
      options.requireUniversal = true;
    } else if (argument === "--target" && args[index + 1]) {
      options.target = args[++index];
    } else if (argument.startsWith("--target=")) {
      options.target = argument.slice("--target=".length);
    } else if (argument === "--app" && args[index + 1]) {
      options.appPath = args[++index];
    } else if (argument.startsWith("--app=")) {
      options.appPath = argument.slice("--app=".length);
    } else {
      throw new Error(`Unknown or incomplete macOS package verification argument: ${argument}`);
    }
  }
  options.target = normalizePackageTarget(options.target);
  if (options.target && (options.requireSplit || options.requireUniversal)) {
    throw new Error("Use either --target or --require-split/--require-universal, not both.");
  }
  if (options.appPath && !options.target) {
    throw new Error("A direct --app path requires --target universal, --target x64, or --target arm64.");
  }
  return options;
}

function resolvePackageTargets(releaseDir, productName, options = {}) {
  const splitPresence = splitPackageTargets.map((target) =>
    findAppBundle(releaseDir, productName, target.directoryNames),
  );
  const universalPresence = findAppBundle(
    releaseDir,
    productName,
    universalPackageTarget.directoryNames,
  );
  const hasAnySplitTarget = splitPresence.some(Boolean);
  const hasAllSplitTargets = splitPresence.every(Boolean);

  if (options.target) {
    if (options.target === "universal") {
      if (!universalPresence) {
        throw new Error(`Required mac-universal ${productName}.app is missing under ${releaseDir}.`);
      }
      return [universalPackageTarget];
    }
    if (options.target === "x64" || options.target === "arm64") {
      const targetIndex = options.target === "x64" ? 0 : 1;
      if (!splitPresence[targetIndex]) {
        throw new Error(`Required ${options.target} ${productName}.app is missing under ${releaseDir}.`);
      }
      return [splitPackageTargets[targetIndex]];
    }
    if (options.target === "split") {
      if (!hasAllSplitTargets) {
        throw new Error(`Required x64 and arm64 macOS app bundles are missing under ${releaseDir}.`);
      }
      return splitPackageTargets;
    }
  }

  if (options.requireSplit && !hasAllSplitTargets) {
    throw new Error(`Required x64 and arm64 macOS app bundles are missing under ${releaseDir}.`);
  }
  if (options.requireUniversal && !universalPresence) {
    throw new Error(`Required mac-universal ${productName}.app is missing under ${releaseDir}.`);
  }
  if (options.requireSplit && !options.requireUniversal) return splitPackageTargets;
  if (options.requireUniversal && !options.requireSplit) return [universalPackageTarget];
  if (hasAnySplitTarget && !hasAllSplitTargets) {
    throw new Error(
      `Incomplete split-architecture macOS packages under ${releaseDir}: both x64 and arm64 app bundles are required.`,
    );
  }
  if (!hasAllSplitTargets && !universalPresence) {
    throw new Error(
      `Missing packaged ${productName}.app: expected mac-universal or both x64 and arm64 app bundles under ${releaseDir}.`,
    );
  }

  return [
    ...(hasAllSplitTargets ? splitPackageTargets : []),
    ...(universalPresence ? [universalPackageTarget] : []),
  ];
}

function normalizePackageTarget(value) {
  const target = String(value || "").trim().toLowerCase();
  if (!target) return null;
  if (["all", "arm64", "split", "universal", "x64"].includes(target)) return target;
  throw new Error(`Unsupported macOS package target: ${value}. Use universal, x64, arm64, split, or all.`);
}

function resolveDirectPackageTarget(appPath, targetName) {
  if (!targetName || targetName === "all" || targetName === "split") {
    throw new Error("A direct app path requires target universal, x64, or arm64.");
  }
  const target = targetName === "universal"
    ? universalPackageTarget
    : splitPackageTargets.find((candidate) => candidate.arch === targetName);
  if (!target) throw new Error(`Unsupported direct macOS package target: ${targetName}`);
  if (!fs.existsSync(path.join(appPath, "Contents", "Info.plist"))) {
    throw new Error(`Invalid direct macOS app bundle: ${appPath}`);
  }
  return { ...target, appPath };
}

function resolveAppBundle(releaseDir, productName, directoryNames) {
  const appPath = findAppBundle(releaseDir, productName, directoryNames);
  if (appPath) return appPath;
  throw new Error(
    `Missing packaged ${productName}.app in ${directoryNames.map((entry) => path.join(releaseDir, entry)).join(", ")}`,
  );
}

function findAppBundle(releaseDir, productName, directoryNames) {
  for (const directoryName of directoryNames) {
    const candidate = path.join(
      releaseDir,
      directoryName,
      `${productName}.app`,
    );
    if (fs.existsSync(path.join(candidate, "Contents", "Info.plist"))) {
      return candidate;
    }
  }
  return null;
}

function electronHelperExecutablePaths(appPath, productName) {
  const required = requiredElectronHelperAppPaths(appPath, productName).map((helperAppPath) => {
    const helperName = path.basename(helperAppPath, ".app");
    return path.join(helperAppPath, "Contents", "MacOS", helperName);
  });
  const discovered = discoverElectronHelperAppPaths(appPath)
    .filter((helperAppPath) => path.basename(helperAppPath).startsWith(`${productName} Helper`))
    .map((helperAppPath) => {
      const helperName = path.basename(helperAppPath, ".app");
      return path.join(helperAppPath, "Contents", "MacOS", helperName);
    });
  return [...new Set([...required, ...discovered])];
}

function requiredElectronHelperAppPaths(appPath, productName) {
  return electronHelperSuffixes.map((suffix) =>
    path.join(
      appPath,
      "Contents",
      "Frameworks",
      `${productName} Helper${suffix}.app`,
    ),
  );
}

function discoverElectronHelperAppPaths(appPath) {
  const frameworksPath = path.join(appPath, "Contents", "Frameworks");
  let entries = [];
  try {
    entries = fs.readdirSync(frameworksPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        (entry.isDirectory() || entry.isSymbolicLink()) &&
        entry.name.includes(" Helper") &&
        entry.name.endsWith(".app"),
    )
    .map((entry) => path.join(frameworksPath, entry.name));
}

function inspectSignedEntitlements(bundlePath, arch, run) {
  const codesignArch = arch === "x64" ? "x86_64" : arch;
  const entitlementPlist = run(
    "/usr/bin/codesign",
    ["--display", "--entitlements", "-", "--xml", "--arch", codesignArch, bundlePath],
    { encoding: "utf8" },
  );
  return parsePlistBufferAsJson(entitlementPlist, run);
}

function assertExpectedArchitectures(
  filePath,
  expectedArchitectures,
  inspectArchitectures,
) {
  const architectures = [
    ...new Set(
      inspectArchitectures(filePath).map(normalizeArchitecture).filter(Boolean),
    ),
  ].sort();
  if (architectures.join(",") !== expectedArchitectures.join(",")) {
    throw new Error(
      `Unexpected architecture for ${filePath}: expected ${expectedArchitectures.join("+")}, got ${architectures.join("+") || "none"}`,
    );
  }
}

function normalizeExpectedArchitectures(values) {
  const architectures = [
    ...new Set(
      (Array.isArray(values) ? values : [values])
        .map(normalizeArchitecture)
        .filter(Boolean),
    ),
  ].sort();
  if (!architectures.length) {
    throw new Error("At least one expected macOS architecture is required.");
  }
  return architectures;
}

function normalizeArchitecture(value) {
  const arch = String(value || "")
    .trim()
    .toLowerCase();
  if (arch === "x86_64" || arch === "x64") return "x64";
  if (arch === "arm64" || arch === "aarch64") return "arm64";
  return arch || null;
}

function discoverMachOFiles(contentsPath) {
  const discovered = new Map();
  walkFiles(contentsPath, (filePath) => {
    if (!isRegularFile(filePath) || !isMachOFile(filePath)) return;
    const realPath = fs.realpathSync(filePath);
    if (!discovered.has(realPath)) discovered.set(realPath, filePath);
  });
  return [...discovered.values()];
}

function isMachOFile(filePath) {
  const header = readFilePrefix(filePath, 8);
  if (header.length < 4) return false;
  const magic = header.subarray(0, 4).toString("hex");
  if (thinMachOMagicHexValues.has(magic)) return true;
  const fatEndian = fatMachOMagicEndian.get(magic);
  if (!fatEndian || header.length < 8) return false;
  const architectureCount = fatEndian === "le"
    ? header.readUInt32LE(4)
    : header.readUInt32BE(4);
  return architectureCount > 0 && architectureCount <= 16;
}

function assertNoWindowsOnlyFiles(appPath) {
  const leaked = [];
  walkFiles(appPath, (filePath) => {
    if (isWindowsOnlyPath(filePath)) leaked.push(filePath);
  });
  if (leaked.length) {
    throw new Error(
      `Windows-only files leaked into macOS package:\n${leaked.map((entry) => `- ${entry}`).join("\n")}`,
    );
  }
}

function isWindowsOnlyPath(filePath) {
  const name = path.basename(String(filePath)).toLowerCase();
  return name === "codex-runtime.json" || forbiddenWindowsExtensions.has(path.extname(name));
}

function walkFiles(directoryPath, visit) {
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, visit);
    } else {
      visit(entryPath);
    }
  }
}

function listFiles(directoryPath) {
  const files = [];
  walkFiles(directoryPath, (filePath) => {
    if (isRegularFile(filePath)) files.push(filePath);
  });
  return files.sort();
}

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function loadAsarApi() {
  if (defaultAsarApi) return defaultAsarApi;
  try {
    defaultAsarApi = require("@electron/asar");
  } catch (error) {
    throw new Error(`Could not load @electron/asar for package verification: ${error?.message || error}`);
  }
  if (
    typeof defaultAsarApi?.listPackage !== "function" ||
    typeof defaultAsarApi?.extractFile !== "function"
  ) {
    throw new Error("Installed @electron/asar does not expose listPackage and extractFile.");
  }
  return defaultAsarApi;
}

function normalizeAsarEntry(entry) {
  return toArchivePath(String(entry || "").replace(/^[/\\]+/, ""));
}

function toArchivePath(filePath) {
  return String(filePath || "").split(path.sep).join("/").replaceAll("\\", "/");
}

function extractAsarFile(asarApi, appAsarPath, archivePath) {
  let contents;
  try {
    contents = asarApi.extractFile(appAsarPath, archivePath);
  } catch (error) {
    throw new Error(`Could not extract ${archivePath} from ${appAsarPath}: ${error?.message || error}`);
  }
  return Buffer.isBuffer(contents) ? contents : Buffer.from(contents || "");
}

function parsePlistAsJson(plistPath, run) {
  const output = run(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", plistPath],
    { encoding: "utf8" },
  );
  return parseJsonObject(output, `Invalid property list: ${plistPath}`);
}

function parsePlistBufferAsJson(plist, run) {
  const output = run(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", "-"],
    { encoding: "utf8", input: plist },
  );
  return parseJsonObject(output, "Invalid signed entitlements property list");
}

function parseJsonObject(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(String(value || ""));
  } catch (error) {
    throw new Error(`${label}: ${error?.message || error}`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${label}: expected an object.`);
  }
  return parsed;
}

function assertUsableFile(filePath, label) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  if (!stats.isFile() || stats.size === 0) {
    throw new Error(`Invalid ${label}: ${filePath}`);
  }
  const header = readFilePrefix(filePath, 256).toString("utf8");
  if (header.startsWith("version https://git-lfs.github.com/spec/v1\n")) {
    throw new Error(`${label} is still a Git LFS pointer: ${filePath}`);
  }
}

function readFilePrefix(filePath, length) {
  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(handle);
  }
}

function assertDirectory(directoryPath, label) {
  let stats;
  try {
    stats = fs.statSync(directoryPath);
  } catch {
    throw new Error(`Missing ${label}: ${directoryPath}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Invalid ${label}: ${directoryPath}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const verified = verifyMacPackages(
      parseMacPackageVerificationArgs(process.argv.slice(2)),
    );
    for (const item of verified) {
      console.log(
        `verify-mac-package: verified ${item.arch} ${path.relative(projectRoot, item.appPath)}`,
      );
    }
  } catch (error) {
    console.error(`verify-mac-package: ${error?.message || error}`);
    process.exitCode = 1;
  }
}
