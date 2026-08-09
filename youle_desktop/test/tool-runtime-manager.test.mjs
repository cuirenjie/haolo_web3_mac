import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ToolRuntimeManager,
  validateRuntimeCatalog,
} from "../src/main/tool-runtime-manager.mjs";
import { createTarGzip } from "./helpers/runtime-tar.mjs";

test("tool runtime manager reuses the shared Codex workspace runtime without a system install", async (t) => {
  const fixture = await managerFixture(t);
  const sharedRoot = path.join(fixture.root, "shared-runtime");
  const layout = sharedRuntimeLayout(sharedRoot);
  await Promise.all([
    writeFixtureFile(layout.python, "python"),
    writeFixtureFile(layout.node, "node"),
    writeFixtureFile(layout.rg, "rg"),
    writeFixtureFile(layout.git, "git"),
    fs.promises.mkdir(layout.nodeModules, { recursive: true }),
  ]);
  const targetEnvironment = { PATH: "" };
  const manager = new ToolRuntimeManager({
    rootDir: fixture.managerRoot,
    sharedRuntimeRoots: [sharedRoot],
    systemEnvironment: { PATH: "" },
  });

  const status = await manager.initialize();
  manager.applyEnvironment(targetEnvironment);

  assert.equal(status.state, "ready");
  assert.equal(status.source, "shared-cache");
  assert.equal(status.capabilities.python, layout.python);
  assert.equal(status.capabilities.node, layout.node);
  assert.equal(targetEnvironment.PYTHON, layout.python);
  assert.equal(targetEnvironment.NODE, layout.node);
  assert.equal(targetEnvironment.CODEX_WORKSPACE_DEPENDENCIES_NODE_MODULES, layout.nodeModules);
  assert.ok(targetEnvironment.PATH.includes(path.dirname(layout.python)));
  assert.equal(targetEnvironment.HAOLO_TOOL_RUNTIME_SOURCE, "shared-cache");
});

test("tool runtime manager fills missing shared-cache capabilities from system tools", async (t) => {
  const fixture = await managerFixture(t);
  const sharedRoot = path.join(fixture.root, "partial-shared-runtime");
  const layout = sharedRuntimeLayout(sharedRoot);
  const systemBin = path.join(fixture.root, "system-bin");
  const systemNode = path.join(systemBin, process.platform === "win32" ? "node.exe" : "node");
  await Promise.all([
    writeFixtureFile(layout.python, "python"),
    writeFixtureFile(systemNode, "node"),
  ]);
  const manager = new ToolRuntimeManager({
    rootDir: fixture.managerRoot,
    sharedRuntimeRoots: [sharedRoot],
    systemEnvironment: { PATH: systemBin },
  });

  const status = await manager.initialize();

  assert.equal(status.state, "ready");
  assert.equal(status.source, "shared-cache");
  assert.equal(status.capabilities.python, layout.python);
  assert.equal(status.capabilities.node, systemNode);
});

test("tool runtime manager installs, verifies, activates, and repairs a versioned private package", async (t) => {
  const fixture = await managerFixture(t);
  const packageId = "haolo-core";
  const version = "1.2.3";
  const pythonRelative = process.platform === "win32" ? "python/python.exe" : "python/bin/python3";
  const nodeRelative = process.platform === "win32" ? "node/node.exe" : "node/bin/node";
  const toolFiles = [
    { path: pythonRelative, content: Buffer.from("private-python") },
    { path: nodeRelative, content: Buffer.from("private-node") },
    { path: "node/node_modules/office/index.js", content: Buffer.from("export default true;") },
  ];
  const manifest = {
    schemaVersion: 1,
    id: packageId,
    version,
    platform: process.platform,
    arch: process.arch,
    layout: {
      executables: {
        python: pythonRelative,
        node: nodeRelative,
      },
      nodeModules: "node/node_modules",
      binDirs: [path.posix.dirname(pythonRelative), path.posix.dirname(nodeRelative)],
    },
    files: toolFiles.map((entry) => ({
      path: entry.path,
      size: entry.content.length,
      sha256: sha256(entry.content),
    })),
  };
  const archive = createTarGzip([
    ...toolFiles.map((entry) => ({ name: entry.path, content: entry.content })),
    { name: "haolo-runtime-package.json", content: `${JSON.stringify(manifest)}\n` },
  ]);
  const archivePath = path.join(fixture.root, "haolo-core.tar.gz");
  const catalogPath = path.join(fixture.root, "catalog.json");
  await fs.promises.writeFile(archivePath, archive);
  await fs.promises.writeFile(
    catalogPath,
    JSON.stringify({
      schemaVersion: 1,
      packages: [{
        id: packageId,
        version,
        displayName: "Haolo Core Runtime",
        platform: process.platform,
        arch: process.arch,
        archivePath,
        sizeBytes: archive.length,
        uncompressedSizeBytes: 1024 * 1024,
        sha256: sha256(archive),
      }],
    }),
  );
  const manager = new ToolRuntimeManager({
    rootDir: fixture.managerRoot,
    catalogPath,
    allowLocalPackageSources: true,
    sharedRuntimeRoots: [],
    systemEnvironment: { PATH: "" },
  });

  await manager.initialize();
  const installed = await manager.prewarm();
  const packageRoot = path.join(fixture.managerRoot, "packages", packageId, version);
  const pythonPath = path.join(packageRoot, ...pythonRelative.split("/"));

  assert.equal(installed.state, "ready");
  assert.equal(installed.source, "managed");
  assert.equal(installed.packages[0].ready, true);
  assert.equal(installed.capabilities.python, pythonPath);
  assert.equal(
    JSON.parse(await fs.promises.readFile(path.join(fixture.managerRoot, "current.json"), "utf8")).packages[packageId],
    version,
  );

  await fs.promises.writeFile(pythonPath, "corrupt");
  const repaired = await manager.repair();
  assert.equal(repaired.state, "ready");
  assert.equal(await fs.promises.readFile(pythonPath, "utf8"), "private-python");
});

test("runtime catalogs require pinned HTTPS packages and reject duplicate IDs", () => {
  assert.throws(
    () => validateRuntimeCatalog({
      schemaVersion: 1,
      packages: [{
        id: "core",
        version: "1.0.0",
        url: "http://downloads.example.test/core.tar.gz",
        sizeBytes: 1,
        sha256: "a".repeat(64),
      }],
    }),
    { code: "HAOLO_TOOL_RUNTIME_URL_INVALID" },
  );
  assert.throws(
    () => validateRuntimeCatalog({
      schemaVersion: 1,
      packages: [
        {
          id: "core",
          version: "1.0.0",
          url: "https://downloads.example.test/core.tar.gz",
          sizeBytes: 1,
          sha256: "a".repeat(64),
        },
        {
          id: "core",
          version: "1.0.1",
          url: "https://downloads.example.test/core-2.tar.gz",
          sizeBytes: 1,
          sha256: "b".repeat(64),
        },
      ],
    }),
    { code: "HAOLO_TOOL_RUNTIME_CATALOG_INVALID" },
  );
  assert.doesNotThrow(() => validateRuntimeCatalog({
    schemaVersion: 1,
    packages: [
      {
        id: "core",
        version: "1.0.0",
        platform: process.platform,
        arch: process.arch,
        url: "https://downloads.example.test/core.tar.gz",
        sizeBytes: 1,
        sha256: "a".repeat(64),
      },
      {
        id: "core",
        version: "1.0.0",
        platform: process.platform === "win32" ? "darwin" : "win32",
        arch: "x64",
        url: "https://downloads.example.test/core-other.tar.gz",
        sizeBytes: 1,
        sha256: "b".repeat(64),
      },
    ],
  }));
});

async function managerFixture(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-tool-runtime-test-"));
  t.after(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });
  return {
    root,
    managerRoot: path.join(root, "managed"),
  };
}

function sharedRuntimeLayout(root) {
  const dependencies = path.join(root, "dependencies");
  return {
    python: path.join(dependencies, "python", process.platform === "win32" ? "python.exe" : path.join("bin", "python3")),
    node: path.join(dependencies, "node", "bin", process.platform === "win32" ? "node.exe" : "node"),
    nodeModules: path.join(dependencies, "node", "node_modules"),
    rg: path.join(dependencies, "bin", "override", process.platform === "win32" ? "rg.exe" : "rg"),
    git: path.join(dependencies, "native", "git", process.platform === "win32" ? path.join("cmd", "git.exe") : path.join("bin", "git")),
  };
}

async function writeFixtureFile(filePath, content) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
