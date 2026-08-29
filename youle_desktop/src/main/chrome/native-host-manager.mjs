import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

export const HAOLO_CHROME_NATIVE_HOST_NAME = "com.haolo.chrome";
export const HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID = "eigggpflnllomdeppbengffgoealckcb";
const execFile = promisify(execFileCallback);

export class ChromeNativeHostManager {
  constructor({
    userDataPath,
    hostExecutablePath,
    extensionIds = [HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID],
    platform = process.platform,
    commandRunner = runCommand,
  } = {}) {
    if (!userDataPath || !hostExecutablePath) throw new TypeError("ChromeNativeHostManager requires userDataPath and hostExecutablePath");
    this.userDataPath = path.resolve(userDataPath);
    this.hostExecutablePath = path.resolve(hostExecutablePath);
    this.extensionIds = normalizeExtensionIds(extensionIds);
    this.platform = platform;
    this.commandRunner = commandRunner;
  }

  manifestPath() {
    return path.join(this.userDataPath, "chrome-native-host", `${HAOLO_CHROME_NATIVE_HOST_NAME}.json`);
  }

  registryKey() {
    return `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HAOLO_CHROME_NATIVE_HOST_NAME}`;
  }

  manifest() {
    return {
      name: HAOLO_CHROME_NATIVE_HOST_NAME,
      description: "Haolo Chrome secure native bridge",
      path: this.hostExecutablePath,
      type: "stdio",
      allowed_origins: this.extensionIds.map((id) => `chrome-extension://${id}/`),
    };
  }

  async install({ register = true } = {}) {
    if (this.platform !== "win32") return { supported: false, reason: "windows_only" };
    const hostExists = fs.existsSync(this.hostExecutablePath);
    if (!hostExists) throw managerError("CHROME_NATIVE_HOST_MISSING", `Chrome Native Host executable is missing: ${this.hostExecutablePath}`);
    const manifestPath = this.manifestPath();
    await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
    const temp = `${manifestPath}.${process.pid}.tmp`;
    await fs.promises.writeFile(temp, `${JSON.stringify(this.manifest(), null, 2)}\n`, "utf8");
    await fs.promises.rename(temp, manifestPath);
    if (register) {
      await this.commandRunner("reg.exe", ["ADD", this.registryKey(), "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"]);
    }
    return { supported: true, installed: true, registered: register, manifestPath, hostExecutablePath: this.hostExecutablePath };
  }

  async uninstall({ unregister = true } = {}) {
    if (this.platform !== "win32") return { supported: false, reason: "windows_only" };
    if (unregister) {
      await this.commandRunner("reg.exe", ["DELETE", this.registryKey(), "/f"], { acceptExitCodes: [0, 1] });
    }
    await fs.promises.rm(this.manifestPath(), { force: true });
    return { supported: true, installed: false, registered: false };
  }

  async diagnose({ queryRegistry = true } = {}) {
    const manifestPath = this.manifestPath();
    const result = {
      supported: this.platform === "win32",
      hostExecutablePath: this.hostExecutablePath,
      hostExists: fs.existsSync(this.hostExecutablePath),
      manifestPath,
      manifestExists: fs.existsSync(manifestPath),
      manifestValid: false,
      registryKey: this.registryKey(),
      registryRegistered: false,
      issues: [],
    };
    if (!result.supported) {
      result.issues.push("windows_only");
      return result;
    }
    if (!result.hostExists) result.issues.push("host_missing");
    if (!result.manifestExists) result.issues.push("manifest_missing");
    if (result.manifestExists) {
      try {
        const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
        result.manifestValid = manifest?.name === HAOLO_CHROME_NATIVE_HOST_NAME
          && path.resolve(String(manifest?.path || "")) === this.hostExecutablePath
          && this.extensionIds.every((id) => manifest?.allowed_origins?.includes(`chrome-extension://${id}/`));
      } catch {
        result.manifestValid = false;
      }
      if (!result.manifestValid) result.issues.push("manifest_invalid");
    }
    if (queryRegistry) {
      try {
        const query = await this.commandRunner("reg.exe", ["QUERY", this.registryKey(), "/ve"]);
        result.registryRegistered = normalizeWindowsPath(query.stdout).includes(normalizeWindowsPath(manifestPath));
      } catch {
        result.registryRegistered = false;
      }
      if (!result.registryRegistered) result.issues.push("registry_missing");
    }
    result.healthy = result.issues.length === 0;
    return result;
  }

  async repair() {
    const before = await this.diagnose();
    if (before.healthy) return { repaired: false, before, after: before };
    await this.install();
    const after = await this.diagnose();
    return { repaired: after.healthy, before, after };
  }
}
export function chromeExtensionOrigins(extensionIds = [HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID]) {
  return normalizeExtensionIds(extensionIds).map((id) => `chrome-extension://${id}/`);
}

async function runCommand(command, args, options = {}) {
  try {
    return await execFile(command, args, { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  } catch (error) {
    if (options.acceptExitCodes?.includes(error?.code)) return { stdout: error?.stdout || "", stderr: error?.stderr || "" };
    throw error;
  }
}

function normalizeExtensionIds(values) {
  const list = Array.isArray(values) ? values : [values];
  const ids = [...new Set(list.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
  if (!ids.length || ids.some((id) => !/^[a-p]{32}$/.test(id))) {
    throw new TypeError("Chrome extension ids must be 32 characters in the a-p alphabet");
  }
  return ids;
}

function normalizeWindowsPath(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function managerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
