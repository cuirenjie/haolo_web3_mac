import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export function classifyWorkspacePath(workspacePath) {
  const value = String(workspacePath || "").trim();
  if (/^\\\\wsl[.$]?\\/i.test(value) || /^\/\/wsl[.$]?\//i.test(value)) {
    return { kind: "wsl", supported: false, reason: "WSL workspaces need a dedicated Windows/WSL bridge before write automation." };
  }
  if (/^\\\\[^\\]+\\[^\\]+/.test(value) || /^\/\/[^/]+\/[^/]+/.test(value)) {
    return { kind: "unc", supported: true };
  }
  if (/^(ssh|git|https?):\/\//i.test(value) || /^[^@\s]+@[^:\s]+:.+/.test(value)) {
    return { kind: "remote", supported: false, reason: "Remote repositories must be cloned locally before local desktop automation can run." };
  }
  return { kind: "local", supported: true };
}

export async function prepareRunWorkspace({ job, runId, worktreesRoot }) {
  const classification = classifyWorkspacePath(job.workspacePath);
  if (!classification.supported) {
    throw new Error(classification.reason);
  }
  if (job.workspaceMode !== "worktree") {
    return { workspacePath: job.workspacePath, worktreePath: null };
  }
  const worktreePath = path.join(worktreesRoot, sanitizePathPart(job.id), sanitizePathPart(runId));
  await mkdir(path.dirname(worktreePath), { recursive: true });
  const baseRef = job.baseRef || "HEAD";
  await run("git", ["-C", job.workspacePath, "worktree", "add", "--detach", worktreePath, baseRef]);
  if (job.includeDirtyState) {
    const patch = await runCapture("git", ["-C", job.workspacePath, "diff", "--binary", "HEAD"]);
    if (patch.stdout.trim()) {
      const patchPath = path.join(path.dirname(worktreePath), `${sanitizePathPart(runId)}.dirty.patch`);
      await writeFile(patchPath, patch.stdout);
      try {
        await run("git", ["-C", worktreePath, "apply", "--index", patchPath]);
      } finally {
        await rm(patchPath, { force: true });
      }
    }
  }
  return { workspacePath: worktreePath, worktreePath };
}

export async function cleanupRunWorkspace(_workspace) {
  // Retention is intentionally handled outside the hot run path so users can review patches first.
  return { ok: true };
}

function sanitizePathPart(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9_.-]/g, "_");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with ${code}: ${stderr}`));
    });
  });
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed with ${code}: ${stderr}`));
    });
  });
}
