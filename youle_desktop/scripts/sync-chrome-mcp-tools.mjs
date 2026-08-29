import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME_TOOL_DEFINITIONS } from "../src/main/chrome/contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(repoRoot, "resources", "mcp", "chrome-server", "tools.json");
await fs.promises.mkdir(path.dirname(target), { recursive: true });
await fs.promises.writeFile(target, `${JSON.stringify(CHROME_TOOL_DEFINITIONS, null, 2)}\n`, "utf8");
process.stdout.write(`${target}\n`);
