import { app, BrowserWindow } from "electron/main";
import fs from "node:fs/promises";
import path from "node:path";

import { extractVideoFramesWithBrowserWindow } from "../src/main/workflow/video-frame-extractor.mjs";

const [videoPath, outputDirectory, ...rawTimestamps] = process.argv.slice(2);
app.on("window-all-closed", () => {});

if (!videoPath || !outputDirectory || !rawTimestamps.length) {
  console.error(
    "Usage: electron scripts/verify-question-answer-video-frames.mjs <video> <output-directory> <seconds...>",
  );
  process.exitCode = 2;
} else {
  void runVerification().finally(() => {
    app.quit();
  });
}

async function runVerification() {
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(
    path.join(outputDirectory, "verification-started.json"),
    JSON.stringify({ argv: process.argv, videoPath, rawTimestamps }, null, 2),
    "utf8",
  );
  await app.whenReady();
  await fs.writeFile(
    path.join(outputDirectory, "verification-electron-ready.json"),
    JSON.stringify({ readyAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
  try {
    const result = await extractVideoFramesWithBrowserWindow({
      BrowserWindow,
      localPath: videoPath,
      timestampsSeconds: rawTimestamps.map(Number),
    });
    const outputs = [];
    for (const [index, frame] of result.frames.entries()) {
      const filePath = path.join(
        outputDirectory,
        `frame-${index + 1}-${Math.round(frame.timestampSeconds * 1_000)}ms.png`,
      );
      await fs.writeFile(
        filePath,
        Buffer.from(String(frame.dataUrl).replace("data:image/png;base64,", ""), "base64"),
      );
      outputs.push(filePath);
    }
    const summary = {
      durationSeconds: result.durationSeconds,
      outputs,
    };
    await fs.writeFile(
      path.join(outputDirectory, "verification-result.json"),
      JSON.stringify(summary, null, 2),
      "utf8",
    );
    console.log(JSON.stringify(summary));
  } catch (error) {
    await fs.writeFile(
      path.join(outputDirectory, "verification-error.txt"),
      error?.stack || error?.message || String(error),
      "utf8",
    );
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
