import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyLaunchCompatibleAdHocSignatures } from "./finalize-mac-dmg.mjs";
import {
  parseMacPackageVerificationArgs,
  verifyMacPackages,
} from "./verify-mac-package.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");

export async function verifyMacAdHocLaunchPackages(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "darwin") {
    throw new Error("Ad-hoc macOS launch-signature verification must run on macOS.");
  }

  const verifyPackages = options.verifyPackages || verifyMacPackages;
  const verifyLaunchSignatures = options.verifyLaunchSignatures || verifyLaunchCompatibleAdHocSignatures;
  const packages = verifyPackages({
    appPath: options.appPath,
    releaseDir: options.releaseDir,
    packageJsonPath: options.packageJsonPath,
    requireSplit: options.requireSplit,
    requireUniversal: options.requireUniversal,
    target: options.target,
  });
  const verified = [];
  for (const item of packages) {
    const signatures = await verifyLaunchSignatures(item.appPath);
    verified.push({ ...item, signatures });
  }
  return verified;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const options = parseMacPackageVerificationArgs(process.argv.slice(2));
    const verified = await verifyMacAdHocLaunchPackages(options);
    for (const item of verified) {
      console.log(
        `verify-mac-adhoc-launch: verified ${item.arch} ${path.relative(projectRoot, item.appPath)} (${item.signatures.length} code objects)`,
      );
    }
  } catch (error) {
    console.error(`verify-mac-adhoc-launch: ${error?.message || error}`);
    process.exitCode = 1;
  }
}
