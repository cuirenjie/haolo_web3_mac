import { app, BrowserWindow, ipcMain, screen } from "electron/main";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { TASKBAR_GEOMETRY_SCRIPT } from "./taskbar-market-quote-native.mjs";
import { normalizeTaskbarMarketQuote, taskbarMarketQuoteBounds, taskbarMarketQuoteHtml } from "./taskbar-market-quote-view.mjs";

export class TaskbarMarketQuote {
  constructor(getOwner) {
    this.getOwner = getOwner;
    this.quote = null;
    this.window = null;
    this.helper = null;
    this.layout = null;
    this.ready = false;
    this.disposed = false;
    this.retryAfter = 0;
    this.lastQuoteAt = 0;
    this.lastLayoutAt = 0;
    this.activate = (event) => {
      if (event.sender !== this.window?.webContents) return;
      const owner = this.getOwner();
      if (!owner || owner.isDestroyed()) return;
      if (owner.isMinimized()) owner.restore();
      owner.show();
      owner.focus();
    };
    ipcMain.on("taskbar-market-quote:activate", this.activate);
  }

  update(value) {
    if (this.disposed || process.platform !== "win32") return false;
    const wasEnabled = !!this.quote;
    this.quote = normalizeTaskbarMarketQuote(value);
    this.lastQuoteAt = Date.now();
    const owner = this.getOwner();
    if (wasEnabled !== !!this.quote && owner && !owner.isDestroyed()) {
      // Chromium otherwise freezes/minimizes renderer timers and the visible
      // taskbar quote stops receiving market updates.
      owner.webContents.setBackgroundThrottling(!this.quote);
    }
    if (!this.quote) {
      this.stop();
      return true;
    }
    this.ensureStarted();
    this.render();
    return true;
  }

  ensureStarted() {
    if (this.disposed || !this.quote) return;
    if (!this.window) {
      const window = new BrowserWindow({
        width: 176, height: 40, show: false, frame: false, transparent: true,
        resizable: false, movable: false, minimizable: false, maximizable: false,
        skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true,
        title: "HaoLo Market Quote",
        webPreferences: {
          preload: fileURLToPath(new URL("./taskbar-market-quote-preload.cjs", import.meta.url)),
          contextIsolation: true, nodeIntegration: false, sandbox: true,
          backgroundThrottling: false,
        },
      });
      this.window = window;
      this.ready = false;
      window.setAlwaysOnTop(true, "screen-saver");
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.once("closed", () => {
        if (this.window === window) { this.window = null; this.ready = false; }
      });
      void window.loadURL(`data:text/html;base64,${Buffer.from(taskbarMarketQuoteHtml()).toString("base64")}`)
        .then(() => {
          if (this.window !== window || window.isDestroyed()) return;
          this.ready = true;
          this.render();
        }).catch(() => {});
    }
    if (!this.timer) {
      this.timer = setInterval(() => {
        if (Date.now() - this.lastQuoteAt > 10_000) {
          this.update(null);
          return;
        }
        if (this.helper && Date.now() - this.helperStartedAt > 15_000 && Date.now() - this.lastLayoutAt > 10_000) {
          this.helper.kill();
        }
        this.ensureStarted();
        this.render();
      }, 1000);
      this.timer.unref();
    }
    if (this.helper || Date.now() < this.retryAfter) return;
    try {
      const hash = createHash("sha256").update(TASKBAR_GEOMETRY_SCRIPT).digest("hex").slice(0, 16);
      const folder = path.join(app.getPath("userData"), "taskbar-market-quote");
      const script = path.join(folder, `geometry-${hash}.ps1`);
      fs.mkdirSync(folder, { recursive: true });
      const source = `\ufeff${TASKBAR_GEOMETRY_SCRIPT}`;
      if (!fs.existsSync(script) || fs.readFileSync(script, "utf8") !== source) fs.writeFileSync(script, source, "utf8");
      const helper = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-OwnerProcessId", String(process.pid)],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      this.helper = helper;
      this.helperStartedAt = Date.now();
      const lines = createInterface({ input: helper.stdout });
      lines.on("line", (line) => {
        if (this.helper !== helper || line.length > 64_000) return;
        try {
          this.layout = JSON.parse(line);
          this.lastLayoutAt = Date.now();
          this.render();
        } catch {}
      });
      this.lastNativeError = "";
      helper.stderr.on("data", (data) => { this.lastNativeError = (this.lastNativeError + data.toString()).slice(-2000); });
      helper.stdin.on("error", () => {});
      const finished = () => {
        lines.close();
        if (this.helper !== helper) return;
        this.helper = null;
        this.layout = null;
        this.retryAfter = Date.now() + 30_000;
        this.render();
      };
      helper.once("error", finished);
      helper.once("exit", finished);
    } catch {
      this.retryAfter = Date.now() + 30_000;
    }
  }

  render() {
    if (!this.window || this.window.isDestroyed()) return;
    const owner = this.getOwner();
    let bounds = null;
    if (this.quote && this.ready && owner && !owner.isDestroyed()
      && (owner.isVisible() || owner.isMinimized()) && !owner.isFullScreen()
      && Date.now() - this.lastLayoutAt < 4000 && this.layout?.visible) {
      const dip = (rect) => screen.screenToDipRect(null, {
        x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height),
      });
      try {
        bounds = taskbarMarketQuoteBounds({
          visible: true, bar: dip(this.layout.bar), anchor: dip(this.layout.anchor),
          occupied: this.layout.occupied.map(dip),
        });
      } catch {}
    }
    if (!bounds) { this.window.hide(); return; }
    const current = this.window.getBounds();
    if (Object.keys(bounds).some((key) => bounds[key] !== current[key])) this.window.setBounds(bounds);
    this.window.webContents.send("taskbar-market-quote:render", { ...this.quote, dark: this.layout.dark, language: app.getLocale() });
    if (!this.window.isVisible()) this.window.showInactive();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    const helper = this.helper;
    this.helper = null;
    helper?.stdin.end();
    helper?.kill();
    this.layout = null;
    const window = this.window;
    this.window = null;
    this.ready = false;
    if (window && !window.isDestroyed()) window.destroy();
  }

  dispose() {
    this.update(null);
    this.disposed = true;
    this.stop();
    ipcMain.removeListener("taskbar-market-quote:activate", this.activate);
  }
}
