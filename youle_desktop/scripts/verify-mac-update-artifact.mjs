import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyDmgContents } from "./finalize-mac-dmg.mjs";
import { verifyMacPackages } from "./verify-mac-package.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");

export function parseMacUpdateArtifactVerificationArgs(args) {
  const options = { artifactPath: null, declaredArch: null, expectedArch: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    } else if (argument === "--artifact" && args[index + 1]) {
      options.artifactPath = args[++index];
    } else if (argument.startsWith("--artifact=")) {
      options.artifactPath = argument.slice("--artifact=".length);
    } else if (argument === "--arch" && args[index + 1]) {
      options.expectedArch = args[++index];
    } else if (argument.startsWith("--arch=")) {
      options.expectedArch = argument.slice("--arch=".length);
    } else if (argument === "--declared-arch" && args[index + 1]) {
      options.declaredArch = args[++index];
    } else if (argument.startsWith("--declared-arch=")) {
      options.declaredArch = argument.slice("--declared-arch=".length);
    } else {
      throw new Error(`未知或不完整的参数：${argument}`);
    }
  }
  if (!options.artifactPath) {
    throw new Error("缺少 --artifact <DMG路径>。");
  }
  if (!options.expectedArch) {
    throw new Error("缺少 --arch <x64|arm64|universal>。");
  }
  options.artifactPath = path.resolve(projectRoot, options.artifactPath);
  return options;
}

export function verifyMacUpdateArtifactArchitecture(artifactPath, options = {}) {
  const architectures = { x64: ["x64"], arm64: ["arm64"], universal: ["arm64", "x64"] };
  if (!Object.hasOwn(architectures, options.expectedArch)
    || (options.declaredArch && !Object.hasOwn(architectures, options.declaredArch))) {
    throw new Error("架构必须为 x64、arm64 或 universal。");
  }
  const expected = architectures[options.expectedArch];
  const declared = options.declaredArch ? architectures[options.declaredArch] : expected;
  if (!expected.every((arch) => declared.includes(arch))) {
    throw new Error("声明架构未包含要求验证的架构。");
  }
  if (path.extname(artifactPath).toLowerCase() !== ".dmg") {
    throw new Error("此命令验证本地构建的 DMG；ZIP 不是当前 Mac 交付格式。");
  }
  const target = options.declaredArch || options.expectedArch;
  // Reuse the shipping verifier: validate the mounted app, then compare its
  // version, ASAR and per-architecture CDHash with the local signed build.
  const [{ appPath }] = verifyMacPackages({ target });
  const identities = verifyDmgContents(artifactPath, appPath, target);
  return { artifactPath, requiredArchitectures: declared, ...identities };
}

export function verifyMacUpdateArtifactFromCli(args, options = {}) {
  const parsed = parseMacUpdateArtifactVerificationArgs(args);
  const verify = options.verify || verifyMacUpdateArtifactArchitecture;
  return verify(parsed.artifactPath, {
    declaredArch: parsed.declaredArch,
    expectedArch: parsed.expectedArch,
  });
}

function isDirectExecution() {
  return process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
}

if (isDirectExecution()) {
  try {
    const result = verifyMacUpdateArtifactFromCli(process.argv.slice(2));
    console.log(
      `verify-mac-update-artifact: verified ${path.relative(projectRoot, result.artifactPath)} for ${result.requiredArchitectures.join("+")}`,
    );
  } catch (error) {
    console.error(`verify-mac-update-artifact: ${error?.message || error}`);
    process.exitCode = 1;
  }
}
