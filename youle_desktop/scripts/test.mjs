import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Keep archived release snapshots and test/support executables out of discovery.
// Explicit arguments still support focused runs: npm test -- test/example.test.mjs.
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [
  "--test",
  ...(args.length ? args : ["test/**/*.test.mjs", "test/**/*.test.cjs"]),
], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "inherit",
});
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
