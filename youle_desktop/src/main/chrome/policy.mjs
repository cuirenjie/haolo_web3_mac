import crypto from "node:crypto";
import {
  CHROME_EFFECT_LEVELS,
  canonicalChromeOperationHash,
  chromeToolDefinition,
  chromeToolEffectLevel,
  chromeToolRequiresEphemeralApproval,
  chromeToolRequiresTwoPhase,
  validateChromeToolCall,
} from "./contract.mjs";

const SAFE_KEY_CHORDS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End",
  "PageUp", "PageDown", "Escape", "Enter", "Tab", "Shift+Tab",
  "Backspace", "Delete", "Ctrl+A", "Ctrl+C", "Ctrl+F", "Ctrl+L",
]);
const SENSITIVE_INPUT_TYPES = new Set(["password", "hidden"]);
const SENSITIVE_AUTOCOMPLETE = /(?:cc-|current-password|new-password|one-time-code|webauthn|transaction-)/i;
const BLOCKED_URL_SCHEMES = new Set(["chrome:", "chrome-extension:", "devtools:", "file:", "javascript:", "data:"]);

export function normalizeChromeOrigin(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw policyError("CHROME_URL_INVALID", "Chrome tools require a valid HTTP(S) URL.");
  }
  if (BLOCKED_URL_SCHEMES.has(url.protocol) || !["http:", "https:"].includes(url.protocol)) {
    throw policyError("CHROME_SCHEME_BLOCKED", `Chrome tools cannot access ${url.protocol || "this URL scheme"}.`);
  }
  url.username = "";
  url.password = "";
  return url.origin.toLowerCase();
}

export function normalizeChromeUrl(value) {
  const url = new URL(String(value || ""));
  normalizeChromeOrigin(url.href);
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.href;
}

export function validateChromeTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw policyError("CHROME_TARGET_INVALID", "Chrome action requires a structured target.");
  }
  const hasSemanticTarget = [target.element_id, target.role, target.name, target.text]
    .some((entry) => String(entry || "").trim());
  const hasCoordinates = Number.isFinite(target.x) && Number.isFinite(target.y);
  if (!hasSemanticTarget && !hasCoordinates) {
    throw policyError("CHROME_TARGET_INVALID", "Chrome action target is empty.");
  }
  return structuredClone(target);
}

export function isSensitiveChromeControl(control = {}) {
  const type = String(control.type || "").trim().toLowerCase();
  const autocomplete = String(control.autocomplete || "").trim();
  const role = String(control.role || "").trim().toLowerCase();
  return SENSITIVE_INPUT_TYPES.has(type)
    || SENSITIVE_AUTOCOMPLETE.test(autocomplete)
    || role === "password";
}

export function sanitizePageSnapshot(snapshot = {}, options = {}) {
  const maxChars = clampInteger(options.maxChars, 1_000, 50_000, 20_000);
  const sanitized = {
    url: safeUrl(snapshot.url),
    origin: safeOrigin(snapshot.url || snapshot.origin),
    title: boundedText(snapshot.title, 1_000),
    text: boundedText(snapshot.text, maxChars),
    selection: boundedText(snapshot.selection, Math.min(maxChars, 10_000)),
    truncated: Boolean(snapshot.truncated),
    viewport: sanitizeViewport(snapshot.viewport),
    headings: [],
    elements: [],
    links: [],
    forms: [],
    provenance: {
      trust: "untrusted_web_content",
      instructionAuthority: "none",
      capturedAt: new Date().toISOString(),
    },
  };
  const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];
  for (const element of elements.slice(0, 2_000)) {
    if (!element || typeof element !== "object" || isSensitiveChromeControl(element)) continue;
    sanitized.elements.push({
      element_id: boundedText(element.element_id || element.id, 200),
      role: boundedText(element.role, 100),
      name: boundedText(element.name || element.label, 500),
      text: boundedText(element.text, 1_000),
      tag: boundedText(element.tag, 50),
      type: boundedText(element.type, 100),
      disabled: Boolean(element.disabled),
      editable: Boolean(element.editable),
      href: safeUrl(element.href),
      rect: sanitizeRect(element.rect),
      options: sanitizeOptions(element.options),
    });
  }
  const headings = Array.isArray(snapshot.headings) ? snapshot.headings : [];
  sanitized.headings = headings.slice(0, 100).map((heading) => ({
    level: clampInteger(heading?.level, 1, 6, 1),
    text: boundedText(heading?.text, 500),
  })).filter((heading) => heading.text);
  const links = Array.isArray(snapshot.links) ? snapshot.links : [];
  sanitized.links = links.slice(0, 250).map((link) => ({
    element_id: boundedText(link?.element_id, 200),
    text: boundedText(link?.text, 1_000),
    href: safeUrl(link?.href),
  })).filter((link) => link.href);
  const forms = Array.isArray(snapshot.forms) ? snapshot.forms : [];
  sanitized.forms = forms.slice(0, 100).filter((control) => !isSensitiveChromeControl(control)).map((control) => ({
    element_id: boundedText(control?.element_id, 200),
    role: boundedText(control?.role, 100),
    name: boundedText(control?.name, 500),
    tag: boundedText(control?.tag, 50),
    type: boundedText(control?.type, 100),
    required: Boolean(control?.required),
    disabled: Boolean(control?.disabled),
    value_present: Boolean(control?.value_present),
  }));
  return sanitized;
}

export function redactChromeLogValue(value, depth = 0) {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactChromeLogValue(entry, depth + 1));
  if (!value || typeof value !== "object") return boundedText(value, 2_000);
  const output = {};
  for (const [key, entry] of Object.entries(value).slice(0, 200)) {
    if (/(?:password|passwd|secret|token|cookie|authorization|credit|card|cvv|cvc|otp|one.?time|private.?key|file.?path|local.?path)/i.test(key)) {
      output[key] = "[redacted]";
    } else {
      output[key] = redactChromeLogValue(entry, depth + 1);
    }
  }
  return output;
}

export class ChromeSitePolicyStore {
  constructor(initial = {}) {
    this.allow = new Set(normalizeOriginList(initial.allow));
    this.block = new Set(normalizeOriginList(initial.block));
  }

  decide(url, sessionAllow = []) {
    const origin = normalizeChromeOrigin(url);
    if (this.block.has(origin)) return { decision: "block", origin, source: "persistent_block" };
    if (this.allow.has(origin)) return { decision: "allow", origin, source: "persistent_allow" };
    if (normalizeOriginList(sessionAllow).includes(origin)) return { decision: "allow", origin, source: "session_allow" };
    return { decision: "prompt", origin, source: "default" };
  }

  set(originOrUrl, decision) {
    const origin = normalizeChromeOrigin(originOrUrl);
    this.allow.delete(origin);
    this.block.delete(origin);
    if (decision === "allow") this.allow.add(origin);
    else if (decision === "block") this.block.add(origin);
    else if (decision !== "prompt") throw policyError("CHROME_SITE_DECISION_INVALID", "Site decision must be allow, block, or prompt.");
    return this.snapshot();
  }

  snapshot() {
    return { allow: [...this.allow].sort(), block: [...this.block].sort() };
  }
}

export class ChromeGrantStore {
  constructor({ ttlMs = 30 * 60_000, clock = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.grants = new Map();
  }

  issue({ threadId, turnId, taskId, profileId, tabIds = [], origins = [], tools = [], artifactIds = [] } = {}) {
    const now = this.clock();
    const normalizedTools = uniqueText(tools);
    for (const name of normalizedTools) {
      if (!chromeToolDefinition(name)) throw policyError("CHROME_TOOL_UNKNOWN", `Unknown Chrome tool: ${name}`);
    }
    const grant = Object.freeze({
      protocolVersion: 1,
      id: `chrome_grant_${crypto.randomUUID()}`,
      status: "active",
      issuedBy: "root-codex",
      threadId: requiredText(threadId, "threadId"),
      turnId: requiredText(turnId, "turnId"),
      taskId: requiredText(taskId, "taskId"),
      profileId: requiredText(profileId, "profileId"),
      tabIds: uniqueInteger(tabIds),
      origins: normalizeOriginList(origins),
      tools: normalizedTools,
      artifactIds: uniqueText(artifactIds),
      delegation: false,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
    });
    this.grants.set(grant.id, grant);
    return grant;
  }

  validate(grantId, request = {}) {
    const grant = this.grants.get(String(grantId || ""));
    if (!grant || grant.status !== "active") throw policyError("CHROME_GRANT_INVALID", "Chrome CapabilityGrant is missing or inactive.");
    if (Date.parse(grant.expiresAt) <= this.clock()) {
      this.grants.delete(grant.id);
      throw policyError("CHROME_GRANT_EXPIRED", "Chrome CapabilityGrant has expired.");
    }
    for (const field of ["threadId", "turnId", "taskId", "profileId"]) {
      if (request[field] !== undefined && String(request[field]) !== String(grant[field])) {
        throw policyError("CHROME_GRANT_SCOPE_MISMATCH", `Chrome CapabilityGrant ${field} does not match.`);
      }
    }
    const tool = String(request.tool || "").trim();
    if (tool && !grant.tools.includes(tool)) throw policyError("CHROME_TOOL_NOT_GRANTED", `Chrome tool ${tool} is not granted.`);
    const tabId = Number(request.tabId);
    if (Number.isInteger(tabId) && !grant.tabIds.includes(tabId)) throw policyError("CHROME_TAB_NOT_GRANTED", "Chrome tab is outside the CapabilityGrant.");
    if (request.url) {
      const origin = normalizeChromeOrigin(request.url);
      if (!grant.origins.includes(origin)) throw policyError("CHROME_SITE_NOT_GRANTED", `Chrome origin ${origin} is outside the CapabilityGrant.`);
    }
    if (request.artifactId && !grant.artifactIds.includes(String(request.artifactId))) {
      throw policyError("CHROME_ARTIFACT_NOT_GRANTED", "Chrome upload artifact is outside the CapabilityGrant.");
    }
    return grant;
  }

  revoke(grantId) {
    return this.grants.delete(String(grantId || ""));
  }

  revokeForTurn(turnId) {
    let count = 0;
    for (const [id, grant] of this.grants) {
      if (grant.turnId === String(turnId || "")) {
        this.grants.delete(id);
        count += 1;
      }
    }
    return count;
  }
}

export class ChromeEffectStore {
  constructor({ ttlMs = 5 * 60_000, clock = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.operations = new Map();
  }

  prepare({ grantId, tool, arguments: args, summary, tabId, origin } = {}) {
    validateChromeToolCall(tool, args || {});
    if (!chromeToolRequiresTwoPhase(tool)) throw policyError("CHROME_PREPARE_NOT_REQUIRED", `${tool} is not a two-phase Chrome tool.`);
    const createdAt = this.clock();
    const operation = {
      protocolVersion: 1,
      id: `chrome_op_${crypto.randomUUID()}`,
      status: "prepared",
      grantId: requiredText(grantId, "grantId"),
      tool,
      arguments: structuredClone(args || {}),
      tabId: Number(tabId),
      origin: normalizeChromeOrigin(origin),
      summary: boundedText(summary, 2_000),
      effectLevel: chromeToolEffectLevel(tool),
      idempotencyKey: canonicalChromeOperationHash({ grantId, tool, args, tabId, origin: normalizeChromeOrigin(origin) }),
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + this.ttlMs).toISOString(),
      approvalTokenHash: null,
      commitTokenHash: null,
      committedAt: null,
      result: null,
    };
    this.operations.set(operation.id, operation);
    return publicOperation(operation);
  }

  approve(operationId) {
    const operation = this.#active(operationId, "prepared");
    const token = crypto.randomBytes(32).toString("base64url");
    operation.status = "approved";
    operation.approvalTokenHash = tokenHash(token);
    return { operation: publicOperation(operation), approvalToken: token };
  }

  commit(operationId, approvalToken) {
    const operation = this.#existing(operationId);
    const actual = tokenHash(String(approvalToken || ""));
    if (operation.status === "committed") {
      const replayExpected = operation.commitTokenHash;
      if (!replayExpected || actual.length !== replayExpected.length || !crypto.timingSafeEqual(actual, replayExpected)) {
        throw policyError("CHROME_APPROVAL_TOKEN_INVALID", "Chrome approval token is invalid.");
      }
      return { ...publicOperation(operation), replayed: true };
    }
    if (operation.status !== "approved") {
      throw policyError("CHROME_OPERATION_STATE_INVALID", `Chrome operation is ${operation.status}, expected approved.`);
    }
    const expected = operation.approvalTokenHash;
    if (!expected || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw policyError("CHROME_APPROVAL_TOKEN_INVALID", "Chrome approval token is invalid.");
    }
    operation.status = "committing";
    operation.commitTokenHash = expected;
    operation.approvalTokenHash = null;
    return { ...publicOperation(operation), replayed: false };
  }

  complete(operationId, result) {
    const operation = this.#active(operationId, "committing");
    operation.status = "committed";
    operation.committedAt = new Date(this.clock()).toISOString();
    operation.result = redactChromeLogValue(result);
    return publicOperation(operation);
  }

  fail(operationId, error) {
    const operation = this.operations.get(String(operationId || ""));
    if (!operation) return null;
    operation.status = "failed";
    operation.result = { error: redactChromeLogValue({ code: error?.code, message: error?.message }) };
    return publicOperation(operation);
  }

  get(operationId) {
    return publicOperation(this.#existing(operationId));
  }

  list({ statuses = null } = {}) {
    const allowed = Array.isArray(statuses) ? new Set(statuses.map(String)) : null;
    return [...this.operations.values()]
      .filter((operation) => !allowed || allowed.has(operation.status))
      .map(publicOperation);
  }

  #existing(operationId) {
    const operation = this.operations.get(String(operationId || ""));
    if (!operation) throw policyError("CHROME_OPERATION_NOT_FOUND", "Chrome operation was not found.");
    if (Date.parse(operation.expiresAt) <= this.clock() && !["committed", "failed"].includes(operation.status)) {
      operation.status = "expired";
      throw policyError("CHROME_OPERATION_EXPIRED", "Chrome operation has expired.");
    }
    return operation;
  }

  #active(operationId, expectedStatus) {
    const operation = this.#existing(operationId);
    if (operation.status !== expectedStatus) {
      throw policyError("CHROME_OPERATION_STATE_INVALID", `Chrome operation is ${operation.status}, expected ${expectedStatus}.`);
    }
    return operation;
  }
}

export function authorizeChromeToolCall({ grantStore, grantId, tool, arguments: args, context = {}, ephemeralApproval = false } = {}) {
  const validated = validateChromeToolCall(tool, args || {});
  const tabId = Number(args?.tab_id);
  const request = {
    ...context,
    tool,
    tabId: Number.isInteger(tabId) ? tabId : undefined,
    url: args?.url || context.url,
    artifactId: args?.artifact_id,
  };
  const grant = grantStore.validate(grantId, request);
  if (chromeToolRequiresEphemeralApproval(tool) && ephemeralApproval !== true) {
    throw policyError("CHROME_EPHEMERAL_APPROVAL_REQUIRED", `${tool} requires one-time approval.`);
  }
  if (tool === "press_key" && !SAFE_KEY_CHORDS.has(String(args?.key || ""))) {
    throw policyError("CHROME_KEY_BLOCKED", "Chrome key chord is not allowlisted.");
  }
  if (["click", "type_text", "select_option", "scroll", "prepare_external_action", "upload_file"].includes(tool) && args?.target) {
    validateChromeTarget(args.target);
  }
  return { grant, definition: validated.definition, arguments: validated.arguments };
}

function publicOperation(operation) {
  const { approvalTokenHash: _approvalSecret, commitTokenHash: _commitSecret, ...publicFields } = operation;
  return structuredClone(publicFields);
}

function tokenHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest();
}

function normalizeOriginList(values) {
  const list = Array.isArray(values) ? values : typeof values === "string" ? [values] : [];
  return [...new Set(list.map(normalizeChromeOrigin))].sort();
}

function uniqueText(values) {
  const list = Array.isArray(values) ? values : typeof values === "string" ? [values] : [];
  return [...new Set(list.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 100);
}

function uniqueInteger(values) {
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map(Number).filter(Number.isInteger))].slice(0, 500);
}

function requiredText(value, name) {
  const text = String(value || "").trim();
  if (!text) throw policyError("CHROME_GRANT_INVALID", `Chrome grant requires ${name}.`);
  return text;
}

function safeUrl(value) {
  try {
    return normalizeChromeUrl(value);
  } catch {
    return null;
  }
}

function safeOrigin(value) {
  try {
    return normalizeChromeOrigin(value);
  } catch {
    return null;
  }
}

function sanitizeViewport(viewport) {
  if (!viewport || typeof viewport !== "object" || Array.isArray(viewport)) return null;
  const result = {};
  for (const key of ["width", "height", "scrollX", "scrollY", "documentWidth", "documentHeight"]) {
    const value = Number(viewport[key]);
    result[key] = Number.isFinite(value) ? Math.round(value) : 0;
  }
  return result;
}

function sanitizeRect(rect) {
  if (!rect || typeof rect !== "object" || Array.isArray(rect)) return null;
  const result = {};
  for (const key of ["x", "y", "width", "height"]) {
    const value = Number(rect[key]);
    result[key] = Number.isFinite(value) ? Math.round(value) : 0;
  }
  return result;
}

function sanitizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.slice(0, 100).map((option) => ({
    value: boundedText(option?.value, 500),
    label: boundedText(option?.label, 500),
    selected: Boolean(option?.selected),
  }));
}

function boundedText(value, maxLength) {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function policyError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.category = "policy";
  error.retryable = false;
  return error;
}
