import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  verifyMacUpdateArtifactArchitecture,
} from "../src/main/mac-update-artifact.mjs";

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
    throw new Error("缺少 --artifact <DMG或ZIP路径>。");
  }
  if (!options.expectedArch) {
    throw new Error("缺少 --arch <x64|arm64|universal>。");
  }
  options.artifactPath = path.resolve(projectRoot, options.artifactPath);
  return options;
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
