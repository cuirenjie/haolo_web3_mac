import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { codexHomeHasHistory, migrateLegacyDefaultCodexHome } from "../src/main/legacy-codex-home-migration.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "haolo-legacy-home-"));
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

test("migrates legacy default Codex session history into an empty default group home", () => {
  const root = tempRoot();
  try {
    const legacyHome = path.join(root, "haolo-ai-home");
    const targetHome = path.join(root, "thread-groups", "default", "haolo-ai-home");
    writeText(path.join(legacyHome, "sessions", "2026", "07", "old.jsonl"), "old-session");
    writeText(path.join(legacyHome, "archived_sessions", "archived.jsonl"), "archived-session");
    writeText(path.join(targetHome, "config.toml"), "new-config");

    const result = migrateLegacyDefaultCodexHome({ legacyHomes: [legacyHome], targetHome });

    assert.equal(result.action, "migrated");
    assert.deepEqual(result.copied, ["sessions", "archived_sessions"]);
    assert.equal(fs.readFileSync(path.join(targetHome, "sessions", "2026", "07", "old.jsonl"), "utf8"), "old-session");
    assert.equal(fs.readFileSync(path.join(targetHome, "archived_sessions", "archived.jsonl"), "utf8"), "archived-session");
    assert.equal(fs.readFileSync(path.join(targetHome, "config.toml"), "utf8"), "new-config");
    assert.equal(codexHomeHasHistory(targetHome), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("does not overwrite default group history when it already exists", () => {
  const root = tempRoot();
  try {
    const legacyHome = path.join(root, "haolo-ai-home");
    const targetHome = path.join(root, "thread-groups", "default", "haolo-ai-home");
    writeText(path.join(legacyHome, "sessions", "legacy.jsonl"), "legacy-session");
    writeText(path.join(targetHome, "sessions", "current.jsonl"), "current-session");

    const result = migrateLegacyDefaultCodexHome({ legacyHomes: [legacyHome], targetHome });

    assert.equal(result.action, "skipped");
    assert.equal(result.reason, "target-has-history");
    assert.equal(fs.existsSync(path.join(targetHome, "sessions", "legacy.jsonl")), false);
    assert.equal(fs.readFileSync(path.join(targetHome, "sessions", "current.jsonl"), "utf8"), "current-session");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
