import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

export const WORKSPACE_UNAVAILABLE_ERROR_CODE = "HAOLO_WORKSPACE_UNAVAILABLE";

export function isPathInsideOrSame(rootPath, candidatePath) {
  if (!rootPath || !candidatePath) return false;
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function workspaceDirectoryStatus(workspacePath, managedRoot) {
  const workspace = path.resolve(String(workspacePath || ""));
  const managed = isPathInsideOrSame(managedRoot, workspace);
  try {
    const stats = fs.statSync(workspace);
    return {
      workspace,
      managed,
      available: stats.isDirectory(),
      reason: stats.isDirectory() ? null : "not-directory",
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { workspace, managed, available: false, reason: "missing" };
  }
}

export function ensureWorkspaceDirectory(workspacePath, managedRoot) {
  const status = workspaceDirectoryStatus(workspacePath, managedRoot);
  if (status.available) return status;
  if (status.managed && status.reason === "missing") {
    fs.mkdirSync(status.workspace, { recursive: true });
    return { ...status, available: true, reason: null, created: true };
  }

  const reason = status.reason === "not-directory" ? "不是文件夹" : "已不存在";
  const error = new Error(`工作区${reason}，请重新选择文件夹：${status.workspace}`);
  error.code = WORKSPACE_UNAVAILABLE_ERROR_CODE;
  error.workspace = status.workspace;
  error.reason = status.reason;
  throw error;
}

export function workspaceCodexHomePath(workspacePath, options = {}) {
  const workspace = path.resolve(String(workspacePath || ""));
  const managedRoot = path.resolve(String(options.managedRoot || ""));
  const externalHomeRoot = path.resolve(String(options.externalHomeRoot || managedRoot));
  const homeDirectoryName = String(options.homeDirectoryName || "haolo-ai-home");
  const colocatedHome = path.join(workspace, homeDirectoryName);

  if (
    isPathInsideOrSame(managedRoot, workspace) ||
    (fs.existsSync(colocatedHome) && !/[^\x00-\x7f]/.test(workspace))
  ) {
    return colocatedHome;
  }

  const identity = process.platform === "win32"
    ? workspace.replace(/\\/g, "/").toLowerCase()
    : workspace;
  const workspaceHash = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24);
  return path.join(externalHomeRoot, `.external-home-${workspaceHash}`, homeDirectoryName);
}
