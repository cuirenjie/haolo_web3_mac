#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRuntimeDir = path.resolve(scriptDir, "../resources/bin");
const openAiSigningAuthority = "Developer ID Application: OpenAI OpCo, LLC (2DC432GLL2)";
const openAiTeamIdentifier = "2DC432GLL2";
const sha256Pattern = /^[a-f0-9]{64}$/;
const { runtimeDir, archivesDir } = parseArgs(process.argv.slice(2));
const manifestPath = path.join(runtimeDir, "codex-runtime-macos.json");

if (process.platform !== "darwin") {
  throw new Error("The macOS Codex runtime verifier must run on macOS.");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validateManifest(manifest);

for (const file of manifest.files) {
  await verifyRuntimeFile(file, manifest);
  if (archivesDir) await verifySourceAsset(file);
}
for (const tool of manifest.tools) {
  for (const file of tool.files) {
    await verifyBundledToolFile(file, tool);
    if (archivesDir) await verifySourceAsset(file);
  }
}

console.log(
  `Verified macOS Codex runtime ${manifest.version}: ${manifest.files.length} signed binaries and ${manifest.tools.reduce(
    (count, tool) => count + tool.files.length,
    0,
  )} bundled tool binaries${
    archivesDir ? " and matching official release archives" : ""
  }.`,
);

function parseArgs(args) {
  let resolvedRuntimeDir = defaultRuntimeDir;
  let resolvedArchivesDir = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--runtime-dir" && args[index + 1]) {
      resolvedRuntimeDir = path.resolve(args[index + 1]);
      index += 1;
    } else if (argument === "--archives-dir" && args[index + 1]) {
      resolvedArchivesDir = path.resolve(args[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }

  return { runtimeDir: resolvedRuntimeDir, archivesDir: resolvedArchivesDir };
}

function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1 || manifest.platform !== "darwin") {
    throw new Error(`Not a supported macOS Codex runtime manifest: ${manifestPath}`);
  }
  if (!manifest.version || manifest.versionOutput !== `codex-cli ${manifest.version}`) {
    throw new Error(`Invalid Codex version metadata in ${manifestPath}`);
  }
  if (manifest.releaseTag !== `rust-v${manifest.version}` || !Array.isArray(manifest.files)) {
    throw new Error(`Invalid Codex release metadata in ${manifestPath}`);
  }
  const expectedReleaseUrl = `https://github.com/openai/codex/releases/tag/${manifest.releaseTag}`;
  if (manifest.releaseUrl !== expectedReleaseUrl) {
    throw new Error(`Unexpected official Codex release URL in ${manifestPath}: ${manifest.releaseUrl}`);
  }
  if (
    manifest.signature?.authority !== openAiSigningAuthority ||
    manifest.signature?.teamIdentifier !== openAiTeamIdentifier
  ) {
    throw new Error(`Unexpected Codex signing requirements in ${manifestPath}`);
  }

  const expected = new Map([
    [
      "arm64",
      {
        path: "darwin-arm64/haolo_ai",
        machOArchitecture: "arm64",
        sourceName: "codex-aarch64-apple-darwin",
      },
    ],
    [
      "x64",
      {
        path: "darwin-x64/haolo_ai",
        machOArchitecture: "x86_64",
        sourceName: "codex-x86_64-apple-darwin",
      },
    ],
  ]);
  if (manifest.files.length !== expected.size) {
    throw new Error(`Expected ${expected.size} macOS Codex runtime files, found ${manifest.files.length}`);
  }

  for (const file of manifest.files) {
    const expectedFile = expected.get(file.arch);
    if (
      !expectedFile ||
      file.path !== expectedFile.path ||
      file.machOArchitecture !== expectedFile.machOArchitecture ||
      file.sourceName !== expectedFile.sourceName ||
      file.sourceAsset !== `${expectedFile.sourceName}.tar.gz`
    ) {
      throw new Error(`Unexpected macOS Codex runtime entry: ${JSON.stringify(file)}`);
    }
    expected.delete(file.arch);
    if (
      !sha256Pattern.test(file.sha256) ||
      !sha256Pattern.test(file.sourceAssetSha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0 ||
      !Number.isSafeInteger(file.sourceAssetSize) ||
      file.sourceAssetSize <= 0
    ) {
      throw new Error(`Incomplete macOS Codex runtime entry for ${file.arch}`);
    }
    if (file.sourceAssetUrl !== `${manifest.releaseUrl.replace("/tag/", "/download/")}/${file.sourceAsset}`) {
      throw new Error(`Unexpected official release URL for ${file.arch}: ${file.sourceAssetUrl}`);
    }
  }

  if (expected.size) {
    throw new Error(`Missing macOS Codex runtime entries: ${[...expected.keys()].join(", ")}`);
  }

  validateBundledTools(manifest.tools);
}

function validateBundledTools(tools) {
  if (!Array.isArray(tools) || tools.length !== 1) {
    throw new Error(`Expected one bundled macOS tool in ${manifestPath}`);
  }
  const tool = tools[0];
  if (
    tool.name !== "ripgrep" ||
    tool.version !== "15.1.0" ||
    tool.versionOutput !== "ripgrep 15.1.0 (rev af60c2de9d)" ||
    tool.releaseTag !== tool.version ||
    tool.releaseUrl !== `https://github.com/BurntSushi/ripgrep/releases/tag/${tool.releaseTag}` ||
    tool.license !== "resources/licenses/ripgrep-LICENSE-MIT.txt" ||
    !Array.isArray(tool.files)
  ) {
    throw new Error(`Invalid bundled ripgrep metadata in ${manifestPath}`);
  }

  const expected = new Map([
    ["arm64", { path: "darwin-arm64/rg", machOArchitecture: "arm64", target: "aarch64-apple-darwin" }],
    ["x64", { path: "darwin-x64/rg", machOArchitecture: "x86_64", target: "x86_64-apple-darwin" }],
  ]);
  if (tool.files.length !== expected.size) {
    throw new Error(`Expected ${expected.size} bundled ripgrep files, found ${tool.files.length}`);
  }

  for (const file of tool.files) {
    const expectedFile = expected.get(file.arch);
    const sourceRoot = `ripgrep-${tool.version}-${expectedFile?.target}`;
    if (
      !expectedFile ||
      file.path !== expectedFile.path ||
      file.machOArchitecture !== expectedFile.machOArchitecture ||
      file.sourcePath !== `${sourceRoot}/rg` ||
      file.sourceAsset !== `${sourceRoot}.tar.gz` ||
      file.sourceAssetUrl !== `${tool.releaseUrl.replace("/tag/", "/download/")}/${file.sourceAsset}`
    ) {
      throw new Error(`Unexpected bundled ripgrep entry: ${JSON.stringify(file)}`);
    }
    expected.delete(file.arch);
    if (
      !sha256Pattern.test(file.sha256) ||
      !sha256Pattern.test(file.sourceAssetSha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0 ||
      !Number.isSafeInteger(file.sourceAssetSize) ||
      file.sourceAssetSize <= 0
    ) {
      throw new Error(`Incomplete bundled ripgrep entry for ${file.arch}`);
    }
  }

  if (expected.size) {
    throw new Error(`Missing bundled ripgrep entries: ${[...expected.keys()].join(", ")}`);
  }
}

async function verifyRuntimeFile(file, manifest) {
  const binaryPath = resolveContainedPath(runtimeDir, file.path);
  const binaryStat = await stat(binaryPath);
  await access(binaryPath, constants.X_OK);

  if (!binaryStat.isFile() || binaryStat.size !== file.size) {
    throw new Error(`Unexpected size for ${file.path}: expected ${file.size}, got ${binaryStat.size}`);
  }

  const actualHash = await sha256(binaryPath);
  if (actualHash !== file.sha256) {
    throw new Error(`SHA-256 mismatch for ${file.path}: expected ${file.sha256}, got ${actualHash}`);
  }

  const fileDescription = run("/usr/bin/file", ["-b", binaryPath]).stdout;
  if (!fileDescription.includes(`Mach-O 64-bit executable ${file.machOArchitecture}`)) {
    throw new Error(`Unexpected file architecture for ${file.path}: ${fileDescription}`);
  }

  const lipoArchitectures = run("/usr/bin/lipo", ["-archs", binaryPath]).stdout;
  if (lipoArchitectures !== file.machOArchitecture) {
    throw new Error(`Unexpected Mach-O slices for ${file.path}: ${lipoArchitectures}`);
  }

  run("/usr/bin/codesign", ["--verify", "--strict", "--verbose=4", binaryPath]);
  const signatureDetails = run("/usr/bin/codesign", ["-dvvv", binaryPath]).stderr;
  if (!signatureDetails.includes(`Authority=${manifest.signature.authority}`)) {
    throw new Error(`Unexpected signing authority for ${file.path}`);
  }
  if (!signatureDetails.includes(`TeamIdentifier=${manifest.signature.teamIdentifier}`)) {
    throw new Error(`Unexpected signing team for ${file.path}`);
  }

  const versionOutput = run(binaryPath, ["--version"], 120_000).stdout;
  if (versionOutput !== manifest.versionOutput) {
    throw new Error(`Unexpected version for ${file.path}: expected '${manifest.versionOutput}', got '${versionOutput}'`);
  }

  console.log(`Verified ${file.path}: ${file.machOArchitecture}, ${file.size} bytes, sha256 ${file.sha256}`);
}

async function verifyBundledToolFile(file, tool) {
  const binaryPath = resolveContainedPath(runtimeDir, file.path);
  const binaryStat = await stat(binaryPath);
  await access(binaryPath, constants.X_OK);

  if (!binaryStat.isFile() || binaryStat.size !== file.size) {
    throw new Error(`Unexpected size for ${file.path}: expected ${file.size}, got ${binaryStat.size}`);
  }

  const actualHash = await sha256(binaryPath);
  if (actualHash !== file.sha256) {
    throw new Error(`SHA-256 mismatch for ${file.path}: expected ${file.sha256}, got ${actualHash}`);
  }

  const fileDescription = run("/usr/bin/file", ["-b", binaryPath]).stdout;
  if (!fileDescription.includes(`Mach-O 64-bit executable ${file.machOArchitecture}`)) {
    throw new Error(`Unexpected file architecture for ${file.path}: ${fileDescription}`);
  }

  const lipoArchitectures = run("/usr/bin/lipo", ["-archs", binaryPath]).stdout;
  if (lipoArchitectures !== file.machOArchitecture) {
    throw new Error(`Unexpected Mach-O slices for ${file.path}: ${lipoArchitectures}`);
  }

  const versionOutput = run(binaryPath, ["--version"], 120_000).stdout.split(/\r?\n/, 1)[0];
  if (versionOutput !== tool.versionOutput) {
    throw new Error(`Unexpected version for ${file.path}: expected '${tool.versionOutput}', got '${versionOutput}'`);
  }

  console.log(`Verified ${file.path}: ${file.machOArchitecture}, ${file.size} bytes, sha256 ${file.sha256}`);
}

async function verifySourceAsset(file) {
  const assetPath = resolveContainedPath(archivesDir, file.sourceAsset);
  const assetStat = await stat(assetPath);
  if (!assetStat.isFile() || assetStat.size !== file.sourceAssetSize) {
    throw new Error(`Unexpected size for ${file.sourceAsset}: expected ${file.sourceAssetSize}, got ${assetStat.size}`);
  }

  const actualHash = await sha256(assetPath);
  if (actualHash !== file.sourceAssetSha256) {
    throw new Error(
      `Release digest mismatch for ${file.sourceAsset}: expected ${file.sourceAssetSha256}, got ${actualHash}`,
    );
  }

  console.log(`Verified official asset ${file.sourceAsset}: sha256 ${file.sourceAssetSha256}`);
}

function resolveContainedPath(parentDir, relativePath) {
  const resolvedPath = path.resolve(parentDir, relativePath);
  if (resolvedPath !== parentDir && !resolvedPath.startsWith(`${parentDir}${path.sep}`)) {
    throw new Error(`Path escapes its expected directory: ${relativePath}`);
  }
  return resolvedPath;
}

function run(command, args, timeout = 60_000) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout,
  });
  const stdout = result.stdout?.trim() ?? "";
  const stderr = result.stderr?.trim() ?? "";

  if (result.error || result.status !== 0) {
    throw new Error(
      [`Command failed: ${command} ${args.join(" ")}`, result.error?.message, stdout, stderr]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return { stdout, stderr };
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
