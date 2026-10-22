import path from "node:path";

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

// Never run an installer or elevate here. A public desktop that needs administrator
// access remains an explicit repair failure; it is not silently moved to another user.
export async function runDesktopShortcutAction({ action, scriptPath, installDir, runPowerShell }) {
  if (!["Recover", "Restore", "Disable"].includes(action)) throw new Error("Unknown desktop shortcut action");
  const command = [
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    `& ${quote(path.resolve(scriptPath))} -Action ${action} -InstallDir ${quote(path.resolve(installDir))}`,
    "exit $LASTEXITCODE",
  ].join("\r\n");
  let output;
  let failure;
  try {
    output = await runPowerShell(command, 30_000);
  } catch (error) {
    failure = error;
    // The helper's JSON can be on stdout even when it returned an error code.
    output = { stdout: error?.stdout || error?.message || "" };
    if (!output.stdout) throw error;
  }
  const line = String(output.stdout || "").trim().split(/\r?\n/).pop();
  let result;
  try { result = JSON.parse(line || "{}"); } catch (error) { throw failure || error; }
  if (!["verified", "unchanged", "opted-out"].includes(result.Status)
    && !(action === "Recover" && result.Status === "preserved-absent")) {
    throw new Error(result.Error || "Desktop shortcut could not be verified");
  }
  return result;
}
