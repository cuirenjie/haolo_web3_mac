import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export class WorkerLock {
  constructor({ lockDir, userKey = "default" }) {
    this.lockPath = path.join(lockDir, `${sanitize(userKey)}.lock`);
    this.acquired = false;
  }

  async acquire() {
    await mkdir(path.dirname(this.lockPath), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await mkdir(this.lockPath, { recursive: false });
        await writeFile(path.join(this.lockPath, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        this.acquired = true;
        return true;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        if (!(await this.removeIfStale())) return false;
      }
    }
    return false;
  }

  async release() {
    if (!this.acquired) return;
    await rm(this.lockPath, { recursive: true, force: true });
    this.acquired = false;
  }

  async removeIfStale() {
    const owner = await this.readOwner();
    if (!owner?.pid || isProcessAlive(owner.pid)) return false;
    await rm(this.lockPath, { recursive: true, force: true });
    return true;
  }

  async readOwner() {
    try {
      return JSON.parse(await readFile(path.join(this.lockPath, "owner.json"), "utf8"));
    } catch {
      return null;
    }
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function sanitize(value) {
  return String(value || "default").replace(/[^A-Za-z0-9_.-]/g, "_");
}
