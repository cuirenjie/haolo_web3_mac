import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HAOLO_RUNTIME_MANIFEST,
  HAOLO_RUNTIME_READY_MARKER,
  WINDOWS_HAOLO_RUNTIME_FILES,
  materializeHaoloRuntime,
  prependRuntimeBinToPath,
  verifyHaoloRuntimeInstallation,
} from "../src/main/runtime-binaries.mjs";

test("materializes and verifies the complete versioned Windows runtime", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-runtime-"));
  try {
    const sourceBinDir = path.join(tempRoot, "source");
    const targetBinDir = path.join(tempRoot, "target");
    const manifest = writeFakeWindowsRuntime(sourceBinDir);

    const prepared = materializeHaoloRuntime({
      sourceBinDir,
      targetBinDir,
      platform: "win32",
    });
    assert.equal(prepared.action, "prepared");
    assert.equal(prepared.runtimeVersion, manifest.version);
    assert.deepEqual(
      fs.readdirSync(targetBinDir).sort(),
      [...WINDOWS_HAOLO_RUNTIME_FILES, HAOLO_RUNTIME_MANIFEST, HAOLO_RUNTIME_READY_MARKER].sort(),
    );
    assert.equal(
      verifyHaoloRuntimeInstallation(path.join(targetBinDir, "haolo_ai.exe"), { platform: "win32" }).action,
      "verified",
    );

    const reused = materializeHaoloRuntime({
      sourceBinDir,
      targetBinDir,
      platform: "win32",
    });
    assert.equal(reused.action, "verified");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("repairs a corrupt cached helper and rejects an incomplete source runtime", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-runtime-repair-"));
  try {
    const sourceBinDir = path.join(tempRoot, "source");
    const targetBinDir = path.join(tempRoot, "target");
    const manifest = writeFakeWindowsRuntime(sourceBinDir);
    materializeHaoloRuntime({ sourceBinDir, targetBinDir, platform: "win32" });

    const helperPath = path.join(targetBinDir, "codex-windows-sandbox-setup.exe");
    fs.writeFileSync(helperPath, "corrupt", "utf8");
    const repaired = materializeHaoloRuntime({ sourceBinDir, targetBinDir, platform: "win32" });
    assert.equal(repaired.action, "prepared");
    assert.equal(fileSha256(helperPath), manifest.files.find((entry) => entry.name === path.basename(helperPath)).sha256);

    fs.rmSync(path.join(sourceBinDir, "codex-command-runner.exe"), { force: true });
    fs.rmSync(targetBinDir, { recursive: true, force: true });
    assert.throws(
      () => materializeHaoloRuntime({ sourceBinDir, targetBinDir, platform: "win32" }),
      (error) => error?.code === "HAOLO_RUNTIME_FILE_MISSING",
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("verifies a complete bundled source without a ready marker and rejects missing companions", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-runtime-direct-"));
  try {
    writeFakeWindowsRuntime(tempRoot);
    assert.equal(
      verifyHaoloRuntimeInstallation(path.join(tempRoot, "haolo_ai.exe"), { platform: "win32" }).action,
      "verified-direct",
    );
    fs.rmSync(path.join(tempRoot, "codex-windows-sandbox-setup.exe"), { force: true });
    assert.throws(
      () => verifyHaoloRuntimeInstallation(path.join(tempRoot, "haolo_ai.exe"), { platform: "win32" }),
      (error) => error?.code === "HAOLO_RUNTIME_FILE_MISSING",
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("puts the prepared runtime first on PATH without duplicates", () => {
  const runtimeBin = "C:\\ProgramData\\haolo-runtime\\bin";
  const otherBin = "C:\\Windows\\System32";
  const env = {
    Path: [otherBin, runtimeBin, otherBin].join(path.win32.delimiter),
  };
  prependRuntimeBinToPath(env, runtimeBin, { platform: "win32" });
  assert.deepEqual(env.Path.split(path.win32.delimiter), [runtimeBin, otherBin, otherBin]);
});

function writeFakeWindowsRuntime(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const files = WINDOWS_HAOLO_RUNTIME_FILES.map((name, index) => {
    const content = Buffer.from(`fake-runtime-${index}-${name}`, "utf8");
    fs.writeFileSync(path.join(binDir, name), content);
    return {
      name,
      sourceName: name,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  });
  const manifest = {
    version: "test-0.144.1",
    releaseTag: "test",
    files,
  };
  fs.writeFileSync(path.join(binDir, HAOLO_RUNTIME_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function fileSha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}


test("macOS runtime materialization keeps code-mode and search helpers executable and repairs them", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-mac-runtime-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceBinDir = path.join(root, "source"), targetBinDir = path.join(root, "target");
  fs.mkdirSync(sourceBinDir);
  for (const name of ["haolo_ai", "codex-code-mode-host", "rg"]) {
    fs.writeFileSync(path.join(sourceBinDir, name), `fixture-${name}`, { mode: 0o755 });
  }
  materializeHaoloRuntime({ sourceBinDir, targetBinDir, platform: "darwin" });
  for (const name of ["haolo_ai", "codex-code-mode-host", "rg"]) {
    assert.equal(fs.readFileSync(path.join(targetBinDir, name), "utf8"), `fixture-${name}`);
    assert.ok(fs.statSync(path.join(targetBinDir, name)).mode & 0o111);
  }
  fs.writeFileSync(path.join(targetBinDir, "codex-code-mode-host"), "corrupt");
  assert.equal(materializeHaoloRuntime({ sourceBinDir, targetBinDir, platform: "darwin" }).action, "prepared");
  assert.equal(fs.readFileSync(path.join(targetBinDir, "codex-code-mode-host"), "utf8"), "fixture-codex-code-mode-host");
});
