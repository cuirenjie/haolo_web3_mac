import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MANAGED_MARKETPLACES_START = "# >>> haolo_desktop managed builtin plugin marketplaces";
const MANAGED_MARKETPLACES_END = "# <<< haolo_desktop managed builtin plugin marketplaces";
const PLUGIN_COMMAND_OUTPUT_LIMIT = 4 * 1024 * 1024;
const PLUGIN_COMMAND_TIMEOUT_MS = 30_000;
const PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const HAOLO_BUILTIN_PLUGIN_MARKETPLACES = Object.freeze([
  Object.freeze({
    name: "haolo-bundled",
    relativeRoot: path.join("cache", "haolo-bundled"),
    plugins: Object.freeze([
      Object.freeze({ name: "chrome", version: "0.1.0" }),
      Object.freeze({ name: "latex", version: "0.2.2" }),
    ]),
  }),
  Object.freeze({
    name: "haolo-primary-runtime",
    relativeRoot: path.join("cache", "haolo-primary-runtime"),
    plugins: Object.freeze([
      Object.freeze({ name: "documents", version: "26.601.10930" }),
      Object.freeze({ name: "presentations", version: "26.601.10930" }),
      Object.freeze({ name: "spreadsheets", version: "26.601.10930" }),
    ]),
  }),
]);

export const HAOLO_BUILTIN_PLUGIN_IDS = new Set(
  HAOLO_BUILTIN_PLUGIN_MARKETPLACES.flatMap((marketplace) =>
    marketplace.plugins.map((plugin) => `${plugin.name}@${marketplace.name}`),
  ),
);

export function syncBuiltinPluginRegistration(codexHome, pluginsSourceRoot) {
  if (!codexHome || !pluginsSourceRoot) {
    return { action: "missing-path", pluginIds: [] };
  }

  const marketplaces = availableBuiltinMarketplaces(pluginsSourceRoot);
  if (!marketplaces.length) {
    return { action: "missing-marketplaces", pluginIds: [] };
  }

  const configPath = path.join(codexHome, "config.toml");
  let current = "";
  try {
    current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  } catch (error) {
    return { action: "read-failed", configPath, pluginIds: [], error: error.message };
  }

  let next;
  const pluginIds = [];
  try {
    next = removeManagedMarketplaceBlock(current);
    next = removeTomlTables(
      next,
      marketplaces.map((marketplace) => `marketplaces.${marketplace.name}`),
    );
    for (const marketplace of marketplaces) {
      for (const plugin of marketplace.plugins) {
        const pluginId = `${plugin.name}@${marketplace.name}`;
        pluginIds.push(pluginId);
        next = ensurePluginEnabledSetting(next, pluginId, true);
      }
    }
    next = appendTomlBlock(next, buildManagedMarketplaceBlock(marketplaces));
  } catch (error) {
    return { action: "invalid-config", configPath, pluginIds: [], error: error.message };
  }

  if (next === current) {
    return { action: "unchanged", configPath, pluginIds };
  }

  try {
    writeTextFileAtomic(configPath, next);
  } catch (error) {
    return { action: "write-failed", configPath, pluginIds, error: error.message };
  }
  return { action: "updated", configPath, pluginIds };
}

export function setPluginEnabledInConfig(configPath, pluginId, enabled) {
  if (!configPath || !pluginId) throw new Error("Missing plugin config target");
  assertValidPluginId(pluginId);
  const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const next = ensurePluginEnabledSetting(current, pluginId, enabled === true, { replaceExisting: true });
  if (next !== current) writeTextFileAtomic(configPath, next);
  return { action: next === current ? "unchanged" : "updated", configPath, pluginId, enabled: enabled === true };
}

export async function listInstalledCodexPlugins({ command, codexHome, cwd, timeoutMs }) {
  const payload = await runCodexPluginCommand({
    command,
    codexHome,
    cwd,
    args: ["plugin", "list", "--json", "--disable", "remote_plugin"],
    timeoutMs,
  });
  return {
    installed: Array.isArray(payload?.installed) ? payload.installed : [],
    available: Array.isArray(payload?.available) ? payload.available : [],
  };
}

export async function removeInstalledCodexPlugin({ command, codexHome, cwd, pluginId, timeoutMs }) {
  assertValidPluginId(pluginId);
  return runCodexPluginCommand({
    command,
    codexHome,
    cwd,
    args: ["plugin", "remove", pluginId, "--json"],
    timeoutMs,
  });
}

export function installedPluginRoot(codexHome, plugin) {
  const marketplace = firstString(plugin?.marketplaceName, plugin?.marketplace_name);
  const name = firstString(plugin?.name);
  const version = firstString(plugin?.version);
  if (!codexHome || !marketplace || !name || !version) return null;
  if (![marketplace, name, version].every(isSafeWindowsPathSegment)) return null;
  const cacheRoot = path.resolve(codexHome, "plugins", "cache");
  const pluginRoot = path.resolve(cacheRoot, marketplace, name, version);
  if (!isPathWithin(cacheRoot, pluginRoot)) return null;
  try {
    if (fs.existsSync(cacheRoot) && fs.existsSync(pluginRoot)) {
      const realCacheRoot = fs.realpathSync.native(cacheRoot);
      const realPluginRoot = fs.realpathSync.native(pluginRoot);
      if (!isPathWithin(realCacheRoot, realPluginRoot)) return null;
    }
  } catch {
    return null;
  }
  return pluginRoot;
}

function availableBuiltinMarketplaces(pluginsSourceRoot) {
  return HAOLO_BUILTIN_PLUGIN_MARKETPLACES.filter((marketplace) => {
    const marketplaceRoot = path.join(pluginsSourceRoot, marketplace.relativeRoot);
    if (!fs.existsSync(path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json"))) return false;
    return marketplace.plugins.every((plugin) =>
      fs.existsSync(path.join(marketplaceRoot, plugin.name, plugin.version, ".codex-plugin", "plugin.json")),
    );
  }).map((marketplace) => {
    const root = path.resolve(pluginsSourceRoot, marketplace.relativeRoot);
    const manifestPath = path.join(root, ".agents", "plugins", "marketplace.json");
    return { ...marketplace, root, lastUpdated: fs.statSync(manifestPath).mtime.toISOString() };
  });
}

function buildManagedMarketplaceBlock(marketplaces) {
  const lines = [MANAGED_MARKETPLACES_START];
  for (const marketplace of marketplaces) {
    lines.push(
      `[marketplaces.${marketplace.name}]`,
      `last_updated = "${tomlString(marketplace.lastUpdated)}"`,
      'source_type = "local"',
      `source = "${tomlString(marketplace.root)}"`,
      "",
    );
  }
  while (lines.at(-1) === "") lines.pop();
  lines.push(MANAGED_MARKETPLACES_END);
  return lines.join("\n");
}

function removeManagedMarketplaceBlock(text) {
  const document = splitTomlDocument(text);
  const output = [];
  let inside = false;
  for (const line of document.lines) {
    const trimmed = line.trim();
    if (trimmed === MANAGED_MARKETPLACES_START) {
      if (inside) throw new Error("Nested managed plugin marketplace block");
      inside = true;
      continue;
    }
    if (trimmed === MANAGED_MARKETPLACES_END) {
      if (!inside) throw new Error("Managed plugin marketplace block has an unmatched end marker");
      inside = false;
      continue;
    }
    if (!inside) output.push(line);
  }
  if (inside) throw new Error("Managed plugin marketplace block has no end marker");
  return joinTomlDocument(document, output).trimEnd();
}

function removeTomlTables(text, tableNames) {
  const names = new Set(
    tableNames.map((tableName) => {
      const keys = parseTomlDottedKey(tableName);
      if (!keys) throw new Error(`Invalid managed TOML table name: ${tableName}`);
      return tomlKeySignature(keys);
    }),
  );
  const document = splitTomlDocument(text);
  const output = [];
  let skipping = false;
  for (const line of document.lines) {
    const table = parseTomlTableHeader(line);
    if (table) {
      skipping = table.array !== true && names.has(tomlKeySignature(table.keys));
    } else if (skipping && /^\s*\[/.test(line)) {
      throw new Error("Invalid TOML table header after managed marketplace table");
    }
    if (!skipping) output.push(line);
  }
  return joinTomlDocument(document, output).trimEnd();
}

function ensurePluginEnabledSetting(text, pluginId, enabled, options = {}) {
  assertValidPluginId(pluginId);
  const document = splitTomlDocument(text);
  const header = `[plugins."${tomlString(pluginId)}"]`;
  const matchingHeaders = [];
  for (let index = 0; index < document.lines.length; index += 1) {
    const table = parseTomlTableHeader(document.lines[index]);
    if (table?.array !== true && tomlKeysEqual(table?.keys, ["plugins", pluginId])) matchingHeaders.push(index);
  }
  if (matchingHeaders.length > 1) throw new Error(`Duplicate plugin table for ${pluginId}`);
  const headerIndex = matchingHeaders[0] ?? -1;
  const assignment = `enabled = ${enabled ? "true" : "false"}`;
  if (headerIndex === -1) {
    return appendTomlBlock(String(text || ""), `${header}\n${assignment}`);
  }

  const nextHeaderIndex = document.lines.findIndex(
    (line, index) => index > headerIndex && parseTomlTableHeader(line) !== null,
  );
  const end = nextHeaderIndex === -1 ? document.lines.length : nextHeaderIndex;
  const enabledIndex = document.lines.findIndex(
    (line, index) => index > headerIndex && index < end && /^\s*enabled\s*=/.test(line),
  );
  if (enabledIndex !== -1) {
    if (options.replaceExisting !== true || document.lines[enabledIndex].trim() === assignment) return String(text || "");
    const existing = /^(\s*)enabled\s*=\s*(?:true|false)(\s*(?:#.*)?)$/.exec(document.lines[enabledIndex]);
    document.lines[enabledIndex] = existing ? `${existing[1]}${assignment}${existing[2]}` : assignment;
  } else {
    document.lines.splice(headerIndex + 1, 0, assignment);
  }
  return `${document.bom}${document.lines.join(document.newline)}`;
}

function appendTomlBlock(text, block) {
  const document = splitTomlDocument(text);
  const trimmedText = String(text || "").trimEnd();
  const trimmedBlock = String(block || "").trim().replace(/\r?\n/g, document.newline);
  return `${trimmedText}${trimmedText ? `${document.newline}${document.newline}` : ""}${trimmedBlock}${document.newline}`;
}

function splitTomlDocument(text) {
  const current = String(text || "");
  const newline = current.includes("\r\n") ? "\r\n" : "\n";
  const bom = current.startsWith("\uFEFF") ? "\uFEFF" : "";
  return { bom, newline, lines: current.slice(bom.length).split(/\r?\n/) };
}

function joinTomlDocument(document, lines) {
  return `${document.bom}${lines.join(document.newline)}`;
}

function writeTextFileAtomic(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, text, "utf8");
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failure and retain the original write error.
    }
    throw error;
  }
}

export async function runCodexPluginCommand({
  command,
  codexHome,
  cwd,
  args,
  timeoutMs = PLUGIN_COMMAND_TIMEOUT_MS,
  spawnImpl = spawn,
}) {
  if (!command) throw new Error("Plugin runtime command is unavailable");
  if (!codexHome) throw new Error("Plugin runtime home is unavailable");
  await fs.promises.mkdir(codexHome, { recursive: true });
  const runtimeHome = path.join(codexHome, "runtime-home");
  await fs.promises.mkdir(runtimeHome, { recursive: true });
  const effectiveTimeoutMs = normalizeCommandTimeout(timeoutMs);
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd: cwd || process.cwd(),
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        HOME: runtimeHome,
        USERPROFILE: runtimeHome,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let settled = false;
    let timeoutHandle = null;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(error);
    };
    timeoutHandle = setTimeout(() => {
      child.kill();
      fail(new Error(`Plugin command timed out after ${effectiveTimeoutMs}ms`));
    }, effectiveTimeoutMs);
    timeoutHandle.unref?.();
    child.stdout?.on("data", (chunk) => {
      stdoutSize += chunk.length;
      if (stdoutSize > PLUGIN_COMMAND_OUTPUT_LIMIT) {
        child.kill();
        fail(new Error("Plugin command output exceeded the safety limit"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderrSize += chunk.length;
      if (stderrSize <= PLUGIN_COMMAND_OUTPUT_LIMIT) stderr.push(chunk);
    });
    child.once("error", fail);
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(errorOutput || output || `Plugin command exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}`));
        return;
      }
      if (!output) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error("Plugin command returned invalid JSON"));
      }
    });
  });
}

function tomlString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\u0008/g, "\\b")
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\f/g, "\\f")
    .replace(/\r/g, "\\r");
}

function assertValidPluginId(pluginId) {
  if (typeof pluginId !== "string" || pluginId.length > 255 || !PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new Error("Invalid plugin ID; expected PLUGIN@MARKETPLACE using letters, numbers, dots, underscores, or hyphens");
  }
}

function isSafeWindowsPathSegment(value) {
  if (typeof value !== "string" || !value || value === "." || value === "..") return false;
  if (path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) return false;
  if (/[<>:"/\\|?*\u0000-\u001F]/.test(value) || /[. ]$/.test(value)) return false;
  const baseName = value.split(".")[0].toUpperCase();
  return !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(baseName);
}

function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function normalizeCommandTimeout(timeoutMs) {
  const numeric = Number(timeoutMs);
  return Number.isFinite(numeric) && numeric > 0 ? Math.max(1, Math.floor(numeric)) : PLUGIN_COMMAND_TIMEOUT_MS;
}

function parseTomlTableHeader(line) {
  const source = String(line || "").trimStart();
  const array = source.startsWith("[[");
  if (!array && !source.startsWith("[")) return null;
  const start = array ? 2 : 1;
  let quote = null;
  let escaped = false;
  let end = -1;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if ((!array && character === "]") || (array && character === "]" && source[index + 1] === "]")) {
      end = index;
      break;
    }
  }
  if (end === -1 || quote) return null;
  const remainder = source.slice(end + (array ? 2 : 1)).trim();
  if (remainder && !remainder.startsWith("#")) return null;
  const keys = parseTomlDottedKey(source.slice(start, end));
  return keys ? { array, keys } : null;
}

function parseTomlDottedKey(value) {
  const source = String(value || "");
  const rawSegments = [];
  let quote = null;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ".") {
      rawSegments.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote || escaped) return null;
  rawSegments.push(source.slice(start).trim());
  const segments = rawSegments.map(parseTomlKeySegment);
  return segments.some((segment) => segment === null) ? null : segments;
}

function parseTomlKeySegment(segment) {
  if (/^[A-Za-z0-9_-]+$/.test(segment)) return segment;
  if (segment.startsWith("'") && segment.endsWith("'") && segment.length >= 2) {
    const value = segment.slice(1, -1);
    return value.includes("'") ? null : value;
  }
  if (!segment.startsWith('"') || !segment.endsWith('"') || segment.length < 2) return null;
  const source = segment.slice(1, -1);
  let output = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== "\\") {
      if (character.charCodeAt(0) < 0x20) return null;
      output += character;
      continue;
    }
    const escape = source[++index];
    const simpleEscapes = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
    if (Object.hasOwn(simpleEscapes, escape)) {
      output += simpleEscapes[escape];
      continue;
    }
    if (escape !== "u" && escape !== "U") return null;
    const length = escape === "u" ? 4 : 8;
    const hex = source.slice(index + 1, index + 1 + length);
    if (hex.length !== length || !/^[0-9A-Fa-f]+$/.test(hex)) return null;
    const codePoint = Number.parseInt(hex, 16);
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
    output += String.fromCodePoint(codePoint);
    index += length;
  }
  return output;
}

function tomlKeySignature(keys) {
  return JSON.stringify(keys);
}

function tomlKeysEqual(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((key, index) => key === right[index]);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
