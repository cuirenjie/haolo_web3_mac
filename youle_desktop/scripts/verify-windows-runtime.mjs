import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyHaoloRuntimeInstallation } from "../src/main/runtime-binaries.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(scriptDir, "../resources/bin");

try {
  const result = verifyHaoloRuntimeInstallation(path.join(runtimeDir, "haolo_ai.exe"), { platform: "win32" });
  console.log(`Verified Windows Codex runtime ${result.runtimeVersion} (${result.files.length} files).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
