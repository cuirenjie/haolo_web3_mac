import { spawnSync } from "node:child_process";

export function verifyPackagedAppTrust(appPath, options = {}) {
  const run = options.run || spawnSync;
  const signature = run("/usr/bin/codesign", ["-dv", "--verbose=4", appPath], { encoding: "utf8" });
  const signatureDetails = commandDetails(signature);
  if (signature.error || signature.status !== 0 || /Signature=adhoc|TeamIdentifier=not set/i.test(signatureDetails)) {
    throw new Error("Refusing to publish an ad-hoc or unsigned app. Sign and notarize the app first.");
  }

  const assessment = run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", appPath], { encoding: "utf8" });
  const assessmentDetails = commandDetails(assessment);
  if (assessment.error || assessment.status !== 0 || !/source=Notarized Developer ID/i.test(assessmentDetails)) {
    throw new Error(`Refusing to publish an app not accepted as a notarized Developer ID artifact${assessmentDetails ? `: ${assessmentDetails}` : "."}`);
  }
}

export function verifyPackagedDmgTrust(dmgPath, options = {}) {
  const run = options.run || spawnSync;
  const staple = run("/usr/bin/xcrun", ["stapler", "validate", dmgPath], { encoding: "utf8" });
  if (staple.error || staple.status !== 0) {
    const details = commandDetails(staple);
    throw new Error(`Refusing to publish a DMG without a valid stapled notarization ticket${details ? `: ${details}` : "."}`);
  }

  const assessment = run(
    "/usr/sbin/spctl",
    ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=4", dmgPath],
    { encoding: "utf8" },
  );
  const assessmentDetails = commandDetails(assessment);
  if (assessment.error || assessment.status !== 0 || !/source=Notarized Developer ID/i.test(assessmentDetails)) {
    throw new Error(`Refusing to publish a DMG not accepted as a notarized Developer ID artifact${assessmentDetails ? `: ${assessmentDetails}` : "."}`);
  }
}

function commandDetails(result) {
  return [result?.error?.message, result?.stdout, result?.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
}
