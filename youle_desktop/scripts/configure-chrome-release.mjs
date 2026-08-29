import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeChromeReleasePolicy } from "../src/main/chrome/release-policy.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = path.join(repoRoot, "resources", "chrome-release-policy.json");
const options = parseOptions(process.argv.slice(2));
const current = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const next = normalizeChromeReleasePolicy({
  ...current,
  ...(options.extensionId ? { productionExtensionId: options.extensionId } : {}),
  ...(options.channel ? { channel: options.channel } : {}),
  ...(options.rolloutPercent != null ? { rolloutPercent: options.rolloutPercent } : {}),
  ...(options.emergencyDisabled != null ? { emergencyDisabled: options.emergencyDisabled } : {}),
  ...(options.emergencyWriteDisabled != null ? { emergencyWriteDisabled: options.emergencyWriteDisabled } : {}),
});
fs.writeFileSync(policyPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ policyPath, policy: next }, null, 2));

function parseOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--extension-id") result.extensionId = requiredValue(flag, value), index += 1;
    else if (flag === "--channel") result.channel = requiredValue(flag, value), index += 1;
    else if (flag === "--rollout") result.rolloutPercent = Number(requiredValue(flag, value)), index += 1;
    else if (flag === "--emergency-disabled") result.emergencyDisabled = parseBoolean(requiredValue(flag, value)), index += 1;
    else if (flag === "--emergency-write-disabled") result.emergencyWriteDisabled = parseBoolean(requiredValue(flag, value)), index += 1;
    else if (flag === "--help") {
      console.log("Usage: node scripts/configure-chrome-release.mjs [--extension-id <id>] [--channel internal|beta|production] [--rollout 0-100] [--emergency-disabled true|false] [--emergency-write-disabled true|false]");
      process.exit(0);
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (!Object.keys(result).length) throw new Error("At least one release option is required. Use --help for usage.");
  return result;
}

function requiredValue(flag, value) {
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseBoolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected true or false, received: ${value}`);
}
