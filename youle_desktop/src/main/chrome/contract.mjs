import crypto from "node:crypto";

export const HAOLO_CHROME_PROTOCOL_VERSION = 1;
export const HAOLO_CHROME_SERVER_NAME = "haolo-chrome-mcp";
export const HAOLO_CHROME_SERVER_VERSION = "0.1.0";

export const CHROME_EFFECT_LEVELS = Object.freeze({
  OBSERVE: "observe",
  NAVIGATE: "navigate",
  EDIT: "edit",
  EXTERNAL_WRITE: "external_write",
  HIGH_IMPACT: "high_impact",
});

export const CHROME_TOOL_DEFINITIONS = Object.freeze([
  defineTool("chrome_status", "Read Chrome extension, profile, host, and broker health.", {}, [], "observe"),
  defineTool("cancel_task", "Cancel one active Haolo Chrome task and revoke its active grants.", {
    task_id: requiredString("Active Haolo Chrome task id."),
  }, ["task_id"], "observe"),
  defineTool("list_tabs", "List tabs visible to connected Haolo Chrome profile instances.", {
    profile_id: optionalString("Connected profile instance id."),
    window_id: optionalInteger("Chrome window id."),
  }, [], "observe"),
  defineTool("read_page", "Read a bounded, structured snapshot of one authorized page.", {
    tab_id: requiredInteger("Target Chrome tab id."),
    include_links: optionalBoolean("Include visible links."),
    include_forms: optionalBoolean("Include non-sensitive form metadata."),
    max_chars: { type: "integer", minimum: 1_000, maximum: 50_000 },
  }, ["tab_id"], "observe"),
  defineTool("read_selection", "Read the user's current text selection in one authorized tab.", {
    tab_id: requiredInteger("Target Chrome tab id."),
  }, ["tab_id"], "observe"),
  defineTool("capture_view", "Capture a visible-tab screenshot from one authorized tab.", {
    tab_id: requiredInteger("Target Chrome tab id."),
  }, ["tab_id"], "observe"),
  defineTool("navigate", "Navigate an authorized task tab to an HTTP(S) URL.", {
    tab_id: requiredInteger("Target Chrome tab id."),
    url: requiredString("Destination HTTP(S) URL."),
  }, ["tab_id", "url"], "navigate"),
  defineTool("click", "Click one element in an authorized tab and verify the result.", {
    tab_id: requiredInteger("Target Chrome tab id."),
    target: targetSchema(),
  }, ["tab_id", "target"], "edit"),
  defineTool("type_text", "Type non-secret text into one authorized form control.", {
    tab_id: requiredInteger("Target Chrome tab id."),
    target: targetSchema(),
    text: { type: "string", minLength: 1, maxLength: 20_000 },
    replace: optionalBoolean("Replace the current value instead of appending."),
  }, ["tab_id", "target", "text"], "edit"),
  defineTool("select_option", "Select an option in one authorized form control.", {
    tab_id: requiredInteger("Target Chrome tab id."),
    target: targetSchema(),
    value: { type: "string", minLength: 1, maxLength: 2_000 },
  }, ["tab_id", "target", "value"], "edit"),
  defineTool("scroll", "Scroll an authorized tab or element.", {
    tab_id: requiredInteger("Target Chrome tab id."),
    delta_x: { type: "integer", minimum: -10_000, maximum: 10_000 },
    delta_y: { type: "integer", minimum: -10_000, maximum: 10_000 },
    target: targetSchema(false),
  }, ["tab_id"], "navigate"),
  defineTool("press_key", "Send an allowlisted navigation or editing key chord to an authorized tab.", {
    tab_id: requiredInteger("Target Chrome tab id."),
    key: { type: "string", minLength: 1, maxLength: 64 },
  }, ["tab_id", "key"], "edit"),
  defineTool("wait_for", "Wait for a bounded URL, text, or element condition in an authorized tab.", {
    tab_id: requiredInteger("Target Chrome tab id."),
    condition: {
      type: "object",
      properties: {
        url_matches: optionalString("Expected URL substring."),
        text_present: optionalString("Expected visible text."),
        target: targetSchema(false),
      },
      additionalProperties: false,
    },
    timeout_ms: { type: "integer", minimum: 100, maximum: 30_000 },
  }, ["tab_id", "condition"], "observe"),
  defineTool("prepare_external_action", "Prepare a concrete external write without committing it.", {
    tab_id: requiredInteger("Target Chrome tab id."),
    action: { type: "string", enum: ["submit", "send", "publish", "delete", "purchase"] },
    target: targetSchema(),
    summary: { type: "string", minLength: 1, maxLength: 2_000 },
  }, ["tab_id", "action", "target", "summary"], "external_write", { twoPhase: true }),
  defineTool("commit_external_action", "Commit one prepared external action after explicit approval.", {
    operation_id: requiredString("Prepared operation id."),
    approval_token: requiredString("Short-lived approval token issued by Haolo."),
  }, ["operation_id", "approval_token"], "external_write", { twoPhase: true }),
  defineTool("upload_file", "Upload one explicitly authorized local file to an authorized file input.", {
    tab_id: requiredInteger("Target Chrome tab id."),
    target: targetSchema(),
    artifact_id: requiredString("Haolo artifact id selected for this task."),
  }, ["tab_id", "target", "artifact_id"], "external_write", { twoPhase: true }),
  defineTool("download", "Download one explicitly identified resource from an authorized tab.", {
    tab_id: requiredInteger("Target Chrome tab id."),
    url: requiredString("HTTP(S) download URL."),
    filename: optionalString("Suggested filename."),
  }, ["tab_id", "url"], "external_write", { twoPhase: true }),
  defineTool("read_history", "Read a bounded browser history result after one-time approval.", {
    query: { type: "string", minLength: 1, maxLength: 500 },
    max_results: { type: "integer", minimum: 1, maximum: 50 },
  }, ["query"], "high_impact", { ephemeralOnly: true }),
]);

const TOOL_BY_NAME = new Map(CHROME_TOOL_DEFINITIONS.map((entry) => [entry.name, entry]));

export function chromeToolDefinition(name) {
  return TOOL_BY_NAME.get(String(name || "").trim()) || null;
}

export function chromeToolNames() {
  return [...TOOL_BY_NAME.keys()];
}

export function chromeToolEffectLevel(name) {
  return chromeToolDefinition(name)?.haolo?.effectLevel || null;
}

export function chromeToolRequiresTwoPhase(name) {
  return chromeToolDefinition(name)?.haolo?.twoPhase === true;
}

export function chromeToolRequiresEphemeralApproval(name) {
  return chromeToolDefinition(name)?.haolo?.ephemeralOnly === true;
}

export function validateChromeToolCall(name, args) {
  const definition = chromeToolDefinition(name);
  if (!definition) throw contractError("CHROME_TOOL_UNKNOWN", `Unknown Chrome tool: ${String(name || "")}`);
  if (!isPlainObject(args)) throw contractError("CHROME_ARGUMENTS_INVALID", "Chrome tool arguments must be an object.");
  const schema = definition.inputSchema;
  for (const required of schema.required || []) {
    if (!Object.hasOwn(args, required)) {
      throw contractError("CHROME_ARGUMENT_REQUIRED", `Chrome tool ${definition.name} requires ${required}.`);
    }
  }
  const allowed = new Set(Object.keys(schema.properties || {}));
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      throw contractError("CHROME_ARGUMENT_UNEXPECTED", `Chrome tool ${definition.name} does not accept ${key}.`);
    }
  }
  const serialized = JSON.stringify(args);
  if (Buffer.byteLength(serialized, "utf8") > 512 * 1024) {
    throw contractError("CHROME_ARGUMENTS_TOO_LARGE", "Chrome tool arguments exceed 512 KiB.");
  }
  return { definition, arguments: structuredClone(args) };
}

export function createChromeEnvelope({
  type,
  requestId = crypto.randomUUID(),
  sessionId,
  profileId = null,
  threadId = null,
  turnId = null,
  taskId = null,
  grantId = null,
  payload = {},
  timestamp = new Date().toISOString(),
} = {}) {
  const normalizedType = nonEmpty(type, "type");
  const normalizedSession = nonEmpty(sessionId, "sessionId");
  if (!isPlainObject(payload)) throw contractError("CHROME_ENVELOPE_INVALID", "Envelope payload must be an object.");
  return {
    protocolVersion: HAOLO_CHROME_PROTOCOL_VERSION,
    type: normalizedType,
    requestId: nonEmpty(requestId, "requestId"),
    sessionId: normalizedSession,
    profileId: nullableText(profileId),
    threadId: nullableText(threadId),
    turnId: nullableText(turnId),
    taskId: nullableText(taskId),
    grantId: nullableText(grantId),
    timestamp,
    payload: structuredClone(payload),
  };
}

export function validateChromeEnvelope(value) {
  if (!isPlainObject(value)) throw contractError("CHROME_ENVELOPE_INVALID", "Chrome envelope must be an object.");
  if (value.protocolVersion !== HAOLO_CHROME_PROTOCOL_VERSION) {
    throw contractError("CHROME_PROTOCOL_UNSUPPORTED", `Unsupported Chrome protocol version: ${value.protocolVersion}`);
  }
  return createChromeEnvelope(value);
}

export function canonicalChromeOperationHash(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function defineTool(name, description, properties, required, effectLevel, options = {}) {
  const readOnly = effectLevel === CHROME_EFFECT_LEVELS.OBSERVE;
  return Object.freeze({
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: effectLevel === CHROME_EFFECT_LEVELS.EXTERNAL_WRITE || effectLevel === CHROME_EFFECT_LEVELS.HIGH_IMPACT,
      idempotentHint: readOnly,
      openWorldHint: true,
    },
    haolo: Object.freeze({
      effectLevel,
      twoPhase: options.twoPhase === true,
      ephemeralOnly: options.ephemeralOnly === true,
    }),
  });
}

function targetSchema(required = true) {
  const schema = {
    type: "object",
    properties: {
      element_id: optionalString("Opaque element id from the latest Haolo page snapshot."),
      role: optionalString("Accessible role."),
      name: optionalString("Accessible name or visible label."),
      text: optionalString("Visible text used to disambiguate the target."),
      x: { type: "number" },
      y: { type: "number" },
    },
    additionalProperties: false,
  };
  return required ? schema : { ...schema };
}

function requiredString(description) {
  return { type: "string", minLength: 1, maxLength: 8_192, description };
}

function optionalString(description) {
  return { type: "string", maxLength: 8_192, description };
}

function requiredInteger(description) {
  return { type: "integer", minimum: 0, description };
}

function optionalInteger(description) {
  return { type: "integer", minimum: 0, description };
}

function optionalBoolean(description) {
  return { type: "boolean", description };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value, field) {
  const text = String(value || "").trim();
  if (!text) throw contractError("CHROME_ENVELOPE_INVALID", `Chrome envelope requires ${field}.`);
  return text;
}

function nullableText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contractError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.category = "protocol";
  error.retryable = false;
  return error;
}
