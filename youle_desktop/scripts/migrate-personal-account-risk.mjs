import fs from "node:fs";
import path from "node:path";

import { app, safeStorage } from "electron/main";

import { migrateLegacyStopPreferenceToAccountRisk } from "../src/main/personal-context/risk-memory-migration.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function atomicWrite(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function run() {
  const storagePath = path.resolve(requiredArgument("--storage"));
  const accountRiskPercent = Number(requiredArgument("--account-risk-percent"));
  const expectedLegacyPercent = Number(requiredArgument("--expected-legacy-percent"));
  const verifyOnly = process.argv.includes("--verify-only");
  if (path.basename(storagePath).toLowerCase() !== "personal-memory.json") {
    throw new Error("--storage must target personal-memory.json exactly");
  }
  app.setPath("userData", path.dirname(storagePath));
  await app.whenReady();
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Electron safeStorage is unavailable");
  const state = JSON.parse(await fs.promises.readFile(storagePath, "utf8"));
  if (Number(state?.version) !== 1 || !state.memories || typeof state.memories !== "object") {
    throw new Error("unsupported personal memory store");
  }
  const matches = [];
  const decryptedProfiles = [];
  for (const [ownerHash, saved] of Object.entries(state.memories)) {
    const plaintext = safeStorage.decryptString(Buffer.from(saved.encryptedProfile, "base64"));
    const profile = JSON.parse(plaintext);
    decryptedProfiles.push({ ownerHash, profile });
    const legacy = profile.entries?.find((entry) => (
      entry?.scope === "trading.exit"
      && entry?.key === "preferred_stop_loss_percent"
      && Number(entry?.value) === expectedLegacyPercent
    ));
    if (legacy) matches.push({ ownerHash, saved, profile });
  }
  if (verifyOnly) {
    const verified = decryptedProfiles.filter(({ profile }) => {
      const accountRisk = profile.entries?.find((entry) => (
        entry?.scope === "trading.risk" && entry?.key === "max_loss_per_trade_percent"
      ));
      const legacy = profile.entries?.some((entry) => entry?.key === "preferred_stop_loss_percent");
      return Number(accountRisk?.value) === accountRiskPercent && !legacy;
    });
    if (verified.length !== 1) throw new Error(`expected exactly one verified profile, found ${verified.length}`);
    process.stdout.write(`${JSON.stringify({
      verified: true,
      accountRiskPercent,
      legacyStopPreferencePresent: false,
      revision: verified[0].profile.revision,
      entryCount: verified[0].profile.entries.length,
    })}\n`);
    return;
  }
  if (matches.length !== 1) {
    throw new Error(`expected exactly one matching encrypted profile, found ${matches.length}`);
  }
  const match = matches[0];
  const updatedAt = new Date().toISOString();
  const migrated = migrateLegacyStopPreferenceToAccountRisk(match.profile, {
    accountRiskPercent,
    expectedLegacyPercent,
    updatedAt,
  });
  state.memories[match.ownerHash] = {
    encryptedProfile: safeStorage.encryptString(JSON.stringify(migrated)).toString("base64"),
    entryCount: migrated.entries.length,
    updatedAt,
  };
  const backupPath = `${storagePath}.before-account-risk-${Date.now()}.bak`;
  await fs.promises.copyFile(storagePath, backupPath, fs.constants.COPYFILE_EXCL);
  await atomicWrite(storagePath, state);
  process.stdout.write(`${JSON.stringify({
    migrated: true,
    accountRiskPercent,
    removedLegacyStopPreference: true,
    revision: migrated.revision,
    entryCount: migrated.entries.length,
    backupPath,
  })}\n`);
}

run()
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${String(error?.stack || error)}\n`);
    app.exit(1);
  });
