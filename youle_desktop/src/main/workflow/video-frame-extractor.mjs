import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function extractVideoFramesWithBrowserWindow({
  BrowserWindow,
  localPath,
  timestampsSeconds,
  timeoutMs = 45_000,
  maxWidth = 1920,
  maxHeight = 1080,
  signal,
} = {}) {
  throwIfVideoFrameExtractionAborted(signal);
  if (typeof BrowserWindow !== "function") {
    throw new Error("视频帧提取器缺少 Electron BrowserWindow");
  }
  const sourcePath = localVideoSourcePath(localPath);
  let stats;
  try {
    stats = await fs.promises.stat(sourcePath);
  } catch {
    throw new Error("Haolo 选中的视频源文件已不存在，无法提取真实帧图");
  }
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error("Haolo 选中的视频源不是有效文件，无法提取真实帧图");
  }
  throwIfVideoFrameExtractionAborted(signal);
  const requestedTimestamps = normalizedTimestamps(timestampsSeconds);
  if (!requestedTimestamps.length) {
    throw new Error("没有可用于视频帧提取的有效时间点");
  }
  const extractionWindow = new BrowserWindow({
    width: 320,
    height: 240,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      sandbox: true,
      webSecurity: false,
    },
  });
  let timeoutTimer = null;
  let onAbort = null;
  try {
    await extractionWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        "<!doctype html><html><body><video id=\"source\" muted playsinline preload=\"auto\"></video><canvas id=\"frame\"></canvas></body></html>",
      )}`,
    );
    throwIfVideoFrameExtractionAborted(signal);
    const extraction = await Promise.race([
      extractionWindow.webContents.executeJavaScript(
        videoFrameExtractionScript({
          sourceUrl: pathToFileURL(sourcePath).href,
          timestampsSeconds: requestedTimestamps,
          maxWidth,
          maxHeight,
        }),
        true,
      ),
      new Promise((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(new Error("视频帧提取超时，请确认原视频可以在本机正常播放"));
        }, positiveInteger(timeoutMs, 45_000));
        timeoutTimer.unref?.();
      }),
      new Promise((_, reject) => {
        onAbort = () => {
          if (!extractionWindow.isDestroyed()) extractionWindow.destroy();
          reject(videoFrameExtractionAbortError());
        };
        signal?.addEventListener?.("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      }),
    ]);
    throwIfVideoFrameExtractionAborted(signal);
    if (
      !Array.isArray(extraction?.frames)
      || extraction.frames.length !== requestedTimestamps.length
    ) {
      throw new Error("未能从所选原视频提取全部目标画面");
    }
    return extraction;
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") {
      throw videoFrameExtractionAbortError();
    }
    const message = String(error?.message || error || "").trim();
    if (message.includes("视频帧") || message.includes("原视频") || message.includes("选中的视频源")) {
      throw error;
    }
    throw new Error(`无法从所选原视频提取真实帧图：${message || "视频解码失败"}`);
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (onAbort) signal?.removeEventListener?.("abort", onAbort);
    if (!extractionWindow.isDestroyed()) extractionWindow.destroy();
  }
}

export function videoFrameExtractionScript({
  sourceUrl,
  timestampsSeconds,
  maxWidth = 1920,
  maxHeight = 1080,
} = {}) {
  return `
    (async () => {
      const video = document.getElementById("source");
      const canvas = document.getElementById("frame");
      const sourceUrl = ${JSON.stringify(String(sourceUrl || ""))};
      const requestedTimestamps = ${JSON.stringify(normalizedTimestamps(timestampsSeconds))};
      const maxWidth = ${positiveInteger(maxWidth, 1920)};
      const maxHeight = ${positiveInteger(maxHeight, 1080)};
      const waitForEvent = (eventName, timeoutMs = 15000) => new Promise((resolve, reject) => {
        let timer = null;
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          video.removeEventListener(eventName, onSuccess);
          video.removeEventListener("error", onError);
        };
        const onSuccess = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error(video.error?.message || "Video decode failed"));
        };
        timer = setTimeout(() => {
          cleanup();
          reject(new Error("Timed out while decoding video"));
        }, timeoutMs);
        video.addEventListener(eventName, onSuccess, { once: true });
        video.addEventListener("error", onError, { once: true });
      });
      video.src = sourceUrl;
      video.load();
      if (video.readyState < 1) await waitForEvent("loadedmetadata");
      if (video.readyState < 2) await waitForEvent("loadeddata");
      const durationSeconds = Number.isFinite(video.duration) ? video.duration : null;
      const frames = [];
      for (const requestedTimestamp of requestedTimestamps) {
        const maximumTimestamp = durationSeconds == null
          ? requestedTimestamp
          : Math.max(0, durationSeconds - 0.04);
        const timestampSeconds = Math.min(Math.max(0, requestedTimestamp), maximumTimestamp);
        if (Math.abs(video.currentTime - timestampSeconds) > 0.002) {
          const seeked = waitForEvent("seeked");
          video.currentTime = timestampSeconds;
          await seeked;
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const sourceWidth = Math.max(1, video.videoWidth || 1);
        const sourceHeight = Math.max(1, video.videoHeight || 1);
        const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas context is unavailable");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push({
          requestedTimestampSeconds: requestedTimestamp,
          timestampSeconds,
          width: canvas.width,
          height: canvas.height,
          dataUrl: canvas.toDataURL("image/png"),
        });
      }
      video.pause();
      video.removeAttribute("src");
      video.load();
      return { durationSeconds, frames };
    })()
  `;
}

function localVideoSourcePath(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (source.toLowerCase().startsWith("file:")) {
    try {
      return fileURLToPath(source);
    } catch {
      return source;
    }
  }
  return path.resolve(source);
}

function normalizedTimestamps(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= 86_400)
        .map((value) => Math.round(value * 1_000) / 1_000),
    ),
  ].slice(0, 8);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

function videoFrameExtractionAbortError() {
  const error = new Error("Video frame extraction was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfVideoFrameExtractionAborted(signal) {
  if (signal?.aborted) throw videoFrameExtractionAbortError();
}
