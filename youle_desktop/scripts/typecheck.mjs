import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const candidates = [
  path.join(packageRoot, "node_modules", "typescript", "bin", "tsc"),
  path.join(packageRoot, "..", "node_modules", "typescript", "bin", "tsc"),
];
const tsc = candidates.find((candidate) => fs.existsSync(candidate));
if (!tsc) {
  console.error("Could not find TypeScript. Run pnpm install first.");
  process.exit(1);
}
const result = spawnSync(process.execPath, [tsc, "--noEmit"], {
  cwd: packageRoot,
  stdio: "inherit",
});
process.exit(result.status ?? 1);