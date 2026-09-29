import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("packages the complete versioned Codex Windows runtime", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../resources/bin/codex-runtime.json", import.meta.url), "utf8"));
  const mainSource = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const mappings = new Map(packageJson.build.win.extraResources.map((entry) => [entry.from, entry.to]));

  assert.equal(manifest.version, "0.157.1");
  assert.equal(manifest.releaseTag, `rust-v${manifest.version}`);
  const config = await readFile(new URL("../resources/default-haolo-ai/config.toml", import.meta.url), "utf8");
  const clientSource = await readFile(new URL("../src/main/app-server-client.mjs", import.meta.url), "utf8");
  assert.equal([...config.matchAll(/http_headers = \{ version = "([^"]+)"/g)].length, 2);
  for (const match of config.matchAll(/http_headers = \{ version = "([^"]+)"/g)) {
    assert.equal(match[1], manifest.version);
  }
  assert.ok(clientSource.includes(`const DEFAULT_PROVIDER_CODEX_VERSION = "${manifest.version}";`));
  assert.deepEqual(
    manifest.files.map((file) => file.name).sort(),
    ["codex-command-runner.exe", "codex-windows-sandbox-setup.exe", "haolo_ai.exe"],
  );
  assert.equal(mappings.get("resources/bin/haolo_ai.exe"), "bin/haolo_ai.exe");
  assert.equal(mappings.get("resources/bin/codex-command-runner.exe"), "bin/codex-command-runner.exe");
  assert.equal(mappings.get("resources/bin/codex-windows-sandbox-setup.exe"), "bin/codex-windows-sandbox-setup.exe");
  assert.equal(mappings.get("resources/bin/codex-runtime.json"), "bin/codex-runtime.json");
  assert.match(mainSource, /materializeHaoloRuntime\(\{[\s\S]*?sourceBinDir,[\s\S]*?targetBinDir:\s*binDir/);
  assert.match(mainSource, /isolateHaoloRuntimeEnvironment\(process\.env,\s*binDir\)/);
  assert.match(mainSource, /ensureRuntimeBinariesPrepared\(\)/);
});
