import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  developmentExecutableFingerprint,
  prepareWindowsDevelopmentExecutable,
} from "../scripts/windows-dev-executable.mjs";

test("Windows development launches a branded copy without modifying electron.exe", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-dev-icon-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const sourceExecutablePath = path.join(fixtureRoot, "electron.exe");
  const iconPath = path.join(fixtureRoot, "haolo-logo.ico");
  fs.writeFileSync(sourceExecutablePath, "electron");
  fs.writeFileSync(iconPath, "haolo-icon");
  let patchCount = 0;
  const setExecutableIcon = (targetPath, targetIconPath) => {
    patchCount += 1;
    assert.equal(targetIconPath, iconPath);
    fs.appendFileSync(targetPath, "+branded");
  };

  const executablePath = prepareWindowsDevelopmentExecutable({
    sourceExecutablePath,
    iconPath,
    setExecutableIcon,
    platform: "win32",
  });

  assert.notEqual(executablePath, sourceExecutablePath);
  assert.match(
    path.basename(executablePath),
    /^haolo_desktop_dev-[a-f0-9]{12}\.exe$/,
  );
  assert.equal(fs.readFileSync(sourceExecutablePath, "utf8"), "electron");
  assert.equal(fs.readFileSync(executablePath, "utf8"), "electron+branded");
  assert.equal(patchCount, 1);

  const cachedExecutablePath = prepareWindowsDevelopmentExecutable({
    sourceExecutablePath,
    iconPath,
    setExecutableIcon,
    platform: "win32",
  });
  assert.equal(cachedExecutablePath, executablePath);
  assert.equal(patchCount, 1);
});

test("development executable cache changes when the Haolo icon changes", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-dev-icon-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const sourceExecutablePath = path.join(fixtureRoot, "electron.exe");
  const iconPath = path.join(fixtureRoot, "haolo-logo.ico");
  fs.writeFileSync(sourceExecutablePath, "electron");
  fs.writeFileSync(iconPath, "first-icon");
  const firstFingerprint = developmentExecutableFingerprint(
    sourceExecutablePath,
    iconPath,
  );

  fs.writeFileSync(iconPath, "second-icon");
  const secondFingerprint = developmentExecutableFingerprint(
    sourceExecutablePath,
    iconPath,
  );

  assert.notEqual(firstFingerprint, secondFingerprint);
});

test("non-Windows development keeps the original Electron launcher", () => {
  const sourceExecutablePath = "/opt/electron/Electron";
  assert.equal(
    prepareWindowsDevelopmentExecutable({
      sourceExecutablePath,
      iconPath: "/unused/icon.ico",
      setExecutableIcon: () => assert.fail("icon patch should not run"),
      platform: "linux",
    }),
    sourceExecutablePath,
  );
});
