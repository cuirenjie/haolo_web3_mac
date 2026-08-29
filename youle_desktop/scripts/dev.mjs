import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEV_MANUAL_RESTART_ENV,
  DEV_RESTART_ACK_MESSAGE,
  DEV_RESTART_REQUEST_MESSAGE,
  DEV_SOURCE_UPDATED_MESSAGE,
  DEV_UPDATE_PROMPT_READY_MESSAGE,
} from "../src/main/dev-source-update.mjs";
import { watchDevelopmentSources } from "./dev-source-watcher.mjs";
import restoreWindowsIcon from "./restore-windows-icon.cjs";
import { prepareWindowsDevelopmentExecutable } from "./windows-dev-executable.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..");
const isWindows = process.platform === "win32";

if (isWindows) {
  process.stdout.setDefaultEncoding("utf8");
  process.stderr.setDefaultEncoding("utf8");
  await setWindowsUtf8CodePage();
}

const viteScript = findNodeModuleFile("vite", path.join("bin", "vite.js"));
const electronBin = prepareWindowsDevelopmentExecutable({
  sourceExecutablePath: findElectronBin(),
  iconPath: path.join(packageRoot, "resources", "haolo-logo.ico"),
  setExecutableIcon: restoreWindowsIcon.setWindowsExecutableIcon,
});
const devUrl = "http://127.0.0.1:5177";

const children = [];
const pendingSourceUpdateFiles = new Set();
const vite = spawn(
  process.execPath,
  [viteScript, "--host", "127.0.0.1", "--port", "5177"],
  {
    cwd: packageRoot,
    shell: false,
    stdio: "inherit",
    env: developmentEnv(),
  },
);
children.push(vite);

await waitForHttp(devUrl, 30_000);

let restartingElectron = false;
let quickExitRetries = 0;
const QUICK_EXIT_WINDOW_MS = 3000;
const MAX_QUICK_EXIT_RETRIES = 2;
const GRACEFUL_RESTART_TIMEOUT_MS = 5000;
let sourceWatcher = null;
let electron = startElectron();
sourceWatcher = await watchDevelopmentSources(
  path.join(packageRoot, "src"),
  async (changedFiles) => {
    for (const filePath of changedFiles) pendingSourceUpdateFiles.add(filePath);
    console.log(
      `[dev] Source update detected (${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"}); waiting for restart approval...`,
    );
    await flushSourceUpdateNotification();
  },
  {
    debounceMs: 800,
    onError(error) {
      console.warn("[dev] source watcher failed", error?.message || error);
    },
  },
);

process.on("SIGINT", async () => {
  await stopAll();
  process.exit(130);
});

function findBin(name) {
  const suffix = isWindows ? ".cmd" : "";
  const candidates = [
    path.join(packageRoot, "node_modules", ".bin", `${name}${suffix}`),
    path.join(repoRoot, "node_modules", ".bin", `${name}${suffix}`),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Could not find ${name}; run pnpm install first.`);
  }
  return found;
}

function findNodeModuleFile(packageName, relativePath) {
  const candidates = [
    path.join(packageRoot, "node_modules", packageName, relativePath),
    path.join(repoRoot, "node_modules", packageName, relativePath),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `Could not find ${packageName}/${relativePath}; run pnpm install first.`,
    );
  }
  return found;
}

function findElectronBin() {
  const candidates = [packageRoot, repoRoot].map((root) =>
    path.join(
      root,
      "node_modules",
      "electron",
      "dist",
      isWindows ? "electron.exe" : "Electron",
    ),
  );
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (executable) return executable;
  return findBin("electron");
}

function startElectron() {
  const spawnedAt = Date.now();
  const child = spawn(electronBin, ["."], {
    cwd: packageRoot,
    shell: isWindows && /\.cmd$/i.test(electronBin),
    windowsHide: true,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: developmentEnv(),
  });
  children.push(child);
  child.devUpdatePromptReady = false;
  child.on("message", (message) => {
    if (
      message?.type === DEV_UPDATE_PROMPT_READY_MESSAGE &&
      child === electron
    ) {
      child.devUpdatePromptReady = true;
      console.log("[dev] manual source update prompt is ready.");
      void flushSourceUpdateNotification();
      return;
    }
    if (message?.type !== DEV_RESTART_REQUEST_MESSAGE || child !== electron)
      return;
    void sendElectronMessage(child, {
      type: DEV_RESTART_ACK_MESSAGE,
      requestId: message.requestId,
    }).finally(() => {
      void restartElectron({
        target: child,
        reason: "approved source update",
        graceful: true,
      });
    });
  });
  child.once("exit", async (code) => {
    // Per-child marker set synchronously before we kill a process; the global
    // restartingElectron flag alone races with late exit events on Windows
    // (taskkill resolves before the process tree fully unwinds).
    if (child.expectedExit || restartingElectron) return;
    const ranMs = Date.now() - spawnedAt;
    if (ranMs > QUICK_EXIT_WINDOW_MS) {
      quickExitRetries = 0;
    }
    // An instance dying within seconds of spawn is the restart race (the old
    // instance's teardown races the new one's startup), not a user close.
    if (
      code !== 0 &&
      code != null &&
      ranMs <= QUICK_EXIT_WINDOW_MS &&
      quickExitRetries < MAX_QUICK_EXIT_RETRIES
    ) {
      quickExitRetries += 1;
      console.log(
        `[dev] Electron exited with code ${code} after ${ranMs}ms; retrying (${quickExitRetries}/${MAX_QUICK_EXIT_RETRIES})...`,
      );
      removeChild(child);
      await delay(700);
      electron = startElectron();
      return;
    }
    await stopAll();
    process.exit(code ?? 0);
  });
  return child;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function developmentEnv() {
  const env = {
    ...process.env,
    HAOLO_DESKTOP_DEV_SERVER_URL: devUrl,
    CODEX_DESKTOP_DEV_SERVER_URL: devUrl,
    YOULE_DESKTOP_DEV_SERVER_URL: devUrl,
    // Production remains opt-in. The local development client must keep the
    // confirmation -> Engine monitoring path available for end-to-end QA.
    HAOLO_TRADING_ALERTS_ENABLED: process.env.HAOLO_TRADING_ALERTS_ENABLED || "1",
    [DEV_MANUAL_RESTART_ENV]: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function restartElectron({
  target = electron,
  reason = "manual restart",
  graceful = false,
} = {}) {
  if (restartingElectron || !target || target !== electron) return;
  restartingElectron = true;
  target.expectedExit = true;
  console.log(`[dev] Restarting Electron (${reason})...`);
  if (graceful) {
    const exited = await waitForProcessExit(
      target,
      GRACEFUL_RESTART_TIMEOUT_MS,
    );
    if (!exited) {
      console.warn(
        "[dev] graceful restart timed out; terminating the old Electron process...",
      );
      await stopProcessTree(target);
    }
  } else {
    await stopProcessTree(target);
  }
  removeChild(target);
  // Give the old process tree a beat to release the single-instance lock and
  // ports before the replacement boots.
  await delay(500);
  electron = startElectron();
  restartingElectron = false;
}

function waitForProcessExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", handleExit);
      resolve(exited);
    };
    const handleExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", handleExit);
  });
}

function sendElectronMessage(child, message) {
  if (
    !child ||
    child.exitCode !== null ||
    !child.connected ||
    typeof child.send !== "function"
  ) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    try {
      child.send(message, (error) => resolve(!error));
    } catch {
      resolve(false);
    }
  });
}

async function flushSourceUpdateNotification() {
  if (!pendingSourceUpdateFiles.size || !electron?.devUpdatePromptReady)
    return false;
  const changedFiles = [...pendingSourceUpdateFiles].sort((left, right) =>
    left.localeCompare(right),
  );
  const delivered = await sendElectronMessage(electron, {
    type: DEV_SOURCE_UPDATED_MESSAGE,
    changedFiles,
  });
  if (delivered) pendingSourceUpdateFiles.clear();
  return delivered;
}

function removeChild(child) {
  const index = children.indexOf(child);
  if (index >= 0) children.splice(index, 1);
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function setWindowsUtf8CodePage() {
  await new Promise((resolve) => {
    const child = spawn("cmd.exe", ["/d", "/s", "/c", "chcp 65001 > nul"], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("exit", resolve);
    child.once("error", resolve);
  });
}

async function stopAll() {
  sourceWatcher?.close();
  sourceWatcher = null;
  await Promise.all(children.map(stopProcessTree));
}

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  child.expectedExit = true;
  if (isWindows) {
    await new Promise((resolve) => {
      const killer = spawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { stdio: "ignore" },
      );
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
    return;
  }
  child.kill("SIGTERM");
}
