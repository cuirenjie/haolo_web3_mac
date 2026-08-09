import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  extractVideoFramesWithBrowserWindow,
  videoFrameExtractionScript,
} from "../src/main/workflow/video-frame-extractor.mjs";

test("video frame extractor keeps Electron decoding behind one Host adapter", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "haolo-video-frame-"));
  const videoPath = path.join(directory, "clip.mp4");
  await writeFile(videoPath, Buffer.from("test-video"));
  let windowOptions = null;
  let executedScript = "";
  let destroyed = false;

  class FakeBrowserWindow {
    constructor(options) {
      windowOptions = options;
      this.webContents = {
        executeJavaScript: async (script) => {
          executedScript = script;
          return {
            durationSeconds: 10,
            frames: [
              { timestampSeconds: 1.25, dataUrl: "data:image/png;base64,AA==" },
              { timestampSeconds: 6.7, dataUrl: "data:image/png;base64,AQ==" },
            ],
          };
        },
      };
    }

    async loadURL() {}

    isDestroyed() {
      return destroyed;
    }

    destroy() {
      destroyed = true;
    }
  }

  try {
    const result = await extractVideoFramesWithBrowserWindow({
      BrowserWindow: FakeBrowserWindow,
      localPath: videoPath,
      timestampsSeconds: [1.25, 6.7],
      timeoutMs: 100,
    });

    assert.equal(windowOptions.show, false);
    assert.equal(windowOptions.webPreferences.contextIsolation, true);
    assert.equal(windowOptions.webPreferences.nodeIntegration, false);
    assert.equal(windowOptions.webPreferences.sandbox, true);
    assert.match(executedScript, /requestedTimestamps = \[1\.25,6\.7\]/);
    assert.equal(result.frames.length, 2);
    assert.equal(destroyed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("video frame extraction script contains real seek and canvas capture operations", () => {
  const script = videoFrameExtractionScript({
    sourceUrl: "file:///D:/video.mp4",
    timestampsSeconds: [2.5],
    maxWidth: 1280,
    maxHeight: 720,
  });

  assert.match(script, /video\.currentTime = timestampSeconds/);
  assert.match(script, /context\.drawImage\(video/);
  assert.match(script, /canvas\.toDataURL\("image\/png"\)/);
  assert.match(script, /const maxWidth = 1280/);
  assert.match(script, /const maxHeight = 720/);
});

test("video frame extractor destroys its hidden window when cancelled", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "haolo-video-frame-cancel-"));
  const videoPath = path.join(directory, "clip.mp4");
  await writeFile(videoPath, Buffer.from("test-video"));
  const controller = new AbortController();
  let destroyed = false;
  let markWindowReady;
  const windowReady = new Promise((resolve) => {
    markWindowReady = resolve;
  });

  class FakeBrowserWindow {
    constructor() {
      this.webContents = {
        executeJavaScript: async () => new Promise(() => {}),
      };
      markWindowReady();
    }

    async loadURL() {}

    isDestroyed() {
      return destroyed;
    }

    destroy() {
      destroyed = true;
    }
  }

  try {
    const extraction = extractVideoFramesWithBrowserWindow({
      BrowserWindow: FakeBrowserWindow,
      localPath: videoPath,
      timestampsSeconds: [1],
      signal: controller.signal,
    });
    await windowReady;
    controller.abort();
    await assert.rejects(extraction, (error) => error?.name === "AbortError");
    assert.equal(destroyed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("video frame extractor fails closed before opening Electron when the selected source is missing", async () => {
  let constructed = false;
  class FakeBrowserWindow {
    constructor() {
      constructed = true;
    }
  }

  await assert.rejects(
    extractVideoFramesWithBrowserWindow({
      BrowserWindow: FakeBrowserWindow,
      localPath: path.join(os.tmpdir(), `missing-${Date.now()}.mp4`),
      timestampsSeconds: [1],
    }),
    /视频源文件已不存在/,
  );
  assert.equal(constructed, false);
});
