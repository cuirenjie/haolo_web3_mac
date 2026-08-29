import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resourcesDir = path.join(projectRoot, "resources");
const iconSource = path.join(resourcesDir, "haolo-logo.svg");
const iconSetDir = path.join(resourcesDir, "haolo-logo.iconset");
const iconOutput = path.join(resourcesDir, "haolo-logo.icns");
const iconRasterSource = path.join(os.tmpdir(), "haolo-logo-mac-icon-source.png");
const trayIconOutput = path.join(resourcesDir, "haolo-tray-icon.png");
const trayIconRasterSource = path.join(os.tmpdir(), "haolo-logo-mac-tray-source.png");
const requestedArches = resolveRequestedArches(process.argv.slice(2));
const requiredBinaries = requestedArches.flatMap((arch) =>
  ["haolo_ai", "rg"].map((name) => path.join(resourcesDir, "bin", `darwin-${arch}`, name)),
);

const missingBinaries = requiredBinaries.filter((candidate) => !fs.existsSync(candidate));
if (missingBinaries.length) {
  throw new Error(
    [
      "Missing macOS runtime binary.",
      "Place executable files at:",
      ...missingBinaries.map((candidate) => `- ${path.relative(projectRoot, candidate)}`),
    ].join("\n"),
  );
}

const iconAction = prepareIcon();
const trayIconAction = prepareTrayIcon();
assertPreparedFile(iconOutput, "macOS app icon");
assertPreparedFile(trayIconOutput, "macOS tray icon");

for (const binary of requiredBinaries) {
  assertPreparedFile(binary, `macOS ${path.basename(binary)} runtime binary`);
  fs.chmodSync(binary, 0o755);
}

console.log(
  [
    `prepare-mac-assets: ${iconAction} ${path.relative(projectRoot, iconOutput)}`,
    `${trayIconAction} ${path.relative(projectRoot, trayIconOutput)}`,
    `for ${requestedArches.join(", ")}`,
  ].join(" "),
);

function prepareIcon() {
  if (fs.existsSync(iconOutput)) {
    assertPreparedFile(iconOutput, "macOS app icon");
    return "using";
  }

  if (process.platform !== "darwin") {
    throw new Error(
      [
        "Missing resources/haolo-logo.icns.",
        "Run `pnpm run prepare:mac` on macOS to generate it from resources/haolo-logo.svg,",
        "or add a prepared .icns file at resources/haolo-logo.icns before building mac packages.",
      ].join(" "),
    );
  }

  if (!fs.existsSync(iconSource)) {
    throw new Error(`Missing icon source: ${path.relative(projectRoot, iconSource)}`);
  }

  fs.rmSync(iconSetDir, { recursive: true, force: true });
  fs.mkdirSync(iconSetDir, { recursive: true });
  fs.rmSync(iconRasterSource, { force: true });
  execFileSync("sips", ["-s", "format", "png", iconSource, "--out", iconRasterSource], {
    stdio: "ignore",
  });

  const iconSpecs = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];

  for (const [fileName, size] of iconSpecs) {
    execFileSync("sips", ["-z", String(size), String(size), iconRasterSource, "--out", path.join(iconSetDir, fileName)], {
      stdio: "ignore",
    });
  }

  execFileSync("iconutil", ["-c", "icns", iconSetDir, "-o", iconOutput], { stdio: "inherit" });
  fs.rmSync(iconSetDir, { recursive: true, force: true });
  fs.rmSync(iconRasterSource, { force: true });

  return "generated";
}

function prepareTrayIcon() {
  if (fs.existsSync(trayIconOutput)) {
    assertPreparedFile(trayIconOutput, "macOS tray icon");
    return "using";
  }

  if (process.platform !== "darwin") {
    throw new Error(
      [
        "Missing resources/haolo-tray-icon.png.",
        "Run `pnpm run prepare:mac` on macOS to generate it from resources/haolo-logo.svg,",
        "or add a prepared PNG file at resources/haolo-tray-icon.png before building mac packages.",
      ].join(" "),
    );
  }

  if (!fs.existsSync(iconSource)) {
    throw new Error(`Missing icon source: ${path.relative(projectRoot, iconSource)}`);
  }

  fs.rmSync(trayIconRasterSource, { force: true });
  execFileSync("sips", ["-s", "format", "png", iconSource, "--out", trayIconRasterSource], {
    stdio: "ignore",
  });
  execFileSync("sips", ["-z", "36", "36", trayIconRasterSource, "--out", trayIconOutput], {
    stdio: "ignore",
  });
  fs.rmSync(trayIconRasterSource, { force: true });
  return "generated";
}

function assertPreparedFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${path.relative(projectRoot, filePath)}`);
  }
  if (!isGitLfsPointerFile(filePath)) {
    return;
  }
  throw new Error(
    [
      `${label} is still a Git LFS pointer, not a usable file: ${path.relative(projectRoot, filePath)}.`,
      "Run `git lfs pull` where LFS quota/network access is available, or replace it with the real file before building mac packages.",
    ].join(" "),
  );
}

function isGitLfsPointerFile(filePath) {
  let handle;
  try {
    handle = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(256);
    const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead).toString("utf8");
    return header.startsWith("version https://git-lfs.github.com/spec/v1\n");
  } catch {
    return false;
  } finally {
    if (handle != null) fs.closeSync(handle);
  }
}

function resolveRequestedArches(args) {
  const rawValues = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--arch" && args[index + 1]) {
      rawValues.push(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--arch=")) {
      rawValues.push(arg.slice("--arch=".length));
    }
  }

  if (!rawValues.length) {
    if (process.platform === "darwin") {
      return [normalizeArch(os.arch())];
    }
    return ["x64", "arm64"];
  }

  const arches = [];
  for (const value of rawValues) {
    for (const arch of value.split(",")) {
      const normalized = normalizeArch(arch.trim());
      if (!arches.includes(normalized)) {
        arches.push(normalized);
      }
    }
  }

  if (!arches.length) {
    throw new Error("No macOS architecture was provided. Use --arch=x64, --arch=arm64, or --arch=x64,arm64.");
  }

  return arches;
}

function normalizeArch(arch) {
  if (arch === "x64" || arch === "arm64") {
    return arch;
  }
  if (arch === "all") {
    throw new Error("Use --arch=x64,arm64 instead of --arch=all.");
  }
  throw new Error(`Unsupported macOS architecture: ${arch || "(empty)"}. Use x64 or arm64.`);
}
