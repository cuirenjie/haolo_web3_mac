import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const digest = value => createHash("sha256").update(value.replace(/\r\n/g, "\n")).digest("hex");
const legacyExpert = "35cc10107de36c7e6889df42b7bbedf3136545e460ed192bd47ca19471cfe181";
export function syncManagedTradingSkill(source, target) {
  const name = path.basename(source);
  if (!/^trading-(?:analysis-|account-|market-|chart-|plan-|preferences$|alerts$|simulation$|personal-strategy$|expert$)/.test(name)) return null;
  const sourceFile = path.join(source, "SKILL.md"), targetFile = path.join(target, "SKILL.md");
  const marker = path.join(target, ".haolo-bundled-skill.json");
  const desired = fs.readFileSync(sourceFile, "utf8"), hash = digest(desired);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error(`Custom linked skill preserved: ${name}`);
  let previous;
  try { previous = JSON.parse(fs.readFileSync(marker, "utf8")); } catch { /* Existing copy-once installation. */ }
  if (fs.existsSync(targetFile)) {
    if (fs.lstatSync(target).isSymbolicLink() || fs.lstatSync(targetFile).isSymbolicLink()) throw new Error(`Custom linked skill preserved: ${name}`);
    const current = digest(fs.readFileSync(targetFile, "utf8"));
    if (current !== hash && current !== previous?.hash && !(name === "trading-expert" && current === legacyExpert)) {
      throw new Error(`Custom skill preserved; bundled update not applied: ${name}`);
    }
  }
  fs.mkdirSync(target, { recursive: true });
  // Keep the previous vendor content for recovery without making it discoverable.
  if (fs.existsSync(targetFile) && digest(fs.readFileSync(targetFile, "utf8")) !== hash) {
    fs.copyFileSync(targetFile, path.join(target, ".haolo-previous-skill.txt"));
  }
  const changed = !fs.existsSync(targetFile) || digest(fs.readFileSync(targetFile, "utf8")) !== hash;
  if (changed) {
    const temporary = `${targetFile}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, desired); fs.renameSync(temporary, targetFile); }
    finally { fs.rmSync(temporary, { force: true }); }
  }
  fs.writeFileSync(marker, JSON.stringify({ version: 1, name, hash }));
  return { changed, name };
}
