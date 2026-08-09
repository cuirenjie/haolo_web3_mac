import fs from "node:fs";

/**
 * Prepare a global Skill directory before promoting a workspace Skill into it.
 *
 * Plugin managers can leave directory links behind when a cached plugin version
 * is removed. A dangling junction makes mkdirSync({ recursive: true }) fail with
 * ENOENT on Windows. Remove only dangling links; preserve live links because
 * their contents are owned by the plugin that created them.
 */
export function prepareUserSkillPromotionTarget(targetRoot) {
  let linkStat;
  try {
    linkStat = fs.lstatSync(targetRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }

  if (!linkStat.isSymbolicLink()) return true;

  try {
    fs.statSync(targetRoot);
    return false;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  fs.rmSync(targetRoot, { recursive: true, force: true });
  return true;
}
