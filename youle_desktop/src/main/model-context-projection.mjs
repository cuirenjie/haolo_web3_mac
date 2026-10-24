// Lossless, request-local representation of repeated tool evidence. Never
// rewrite stored history, prompts, tool arguments, or arbitrary message text.
// Every reference resolves to a literal string in this SAME JSON document;
// no disk lookup, previous request, cache hit, or extra model call is needed.
const FORMAT = "$haolo_context";
const REFERENCE = "$haolo_same_text";
const MIN_REPEAT_CHARS = 1_024;
const MAX_DOCUMENT_CHARS = 8 * 1024 * 1024;
const MIN_SAVED_BYTES = 512;
const MAX_DEPTH = 80;
const pointerKey = key => String(key).replace(/~/g, "~0").replace(/\//g, "~1");
const isObject = value => value && typeof value === "object" && !Array.isArray(value);

function projectDocument(text) {
  if (typeof text !== "string" || text.length < MIN_REPEAT_CHARS * 2 || text.length > MAX_DOCUMENT_CHARS) return { text, references: 0 };
  let source;
  try { source = JSON.parse(text); } catch { return { text, references: 0 }; }
  // Keep arbitrary scalar/array outputs and already-projected or colliding
  // schemas unchanged. Bounds also make deeply nested untrusted data a no-op.
  if (!isObject(source)) return { text, references: 0 };
  const strings = new Map();
  let references = 0;
  function visit(value, pointer, depth) {
    if (depth > MAX_DEPTH) throw new Error("projection-depth");
    if (typeof value === "string" && value.length >= MIN_REPEAT_CHARS) {
      const previous = strings.get(value);
      if (previous !== undefined) { references++; return { [REFERENCE]: previous }; }
      strings.set(value, pointer);
    }
    if (!value || typeof value !== "object") return value;
    if (Object.hasOwn(value, FORMAT) || Object.hasOwn(value, REFERENCE)) throw new Error("projection-schema");
    if (Array.isArray(value)) return value.map((item, index) => visit(item, `${pointer}/${index}`, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, `${pointer}/${pointerKey(key)}`, depth + 1)]));
  }
  let projected;
  try { projected = visit(source, "#", 0); } catch { return { text, references: 0 }; }
  if (!references) return { text, references: 0 };
  projected[FORMAT] = {
    version: 1,
    encoding: "same-document-string-references",
    meaning: "Each $haolo_same_text object equals the complete unchanged string at its JSON Pointer in this same result. References only remove identical copies; all facts and observations remain. Do not fetch or rerun tools to resolve them.",
  };
  const next = JSON.stringify(projected);
  return Buffer.byteLength(text) - Buffer.byteLength(next) >= MIN_SAVED_BYTES
    ? { text: next, references } : { text, references: 0 };
}

// MCP tool output can wrap the actual JSON evidence in content[].text.
// Handle that explicit protocol envelope, not JSON-looking strings elsewhere.
function projectToolText(text) {
  if (typeof text !== "string" || text.length > MAX_DOCUMENT_CHARS) return { text, references: 0 };
  let source;
  try { source = JSON.parse(text); } catch { return { text, references: 0 }; }
  if (isObject(source) && !Object.hasOwn(source, FORMAT) && Array.isArray(source.content)) {
    let references = 0;
    const content = source.content.map(block => {
      if (block?.type !== "text" || typeof block.text !== "string") return block;
      const result = projectDocument(block.text);
      references += result.references;
      return result.text === block.text ? block : { ...block, text: result.text };
    });
    return references ? { text: JSON.stringify({ ...source, content }), references } : { text, references: 0 };
  }
  return projectDocument(text);
}

export function projectModelToolContext(payload) {
  const envelope = payload?.type === "response.create" && isObject(payload.response) ? payload.response : payload;
  const metrics = { version: 1, changedOutputs: 0, references: 0, beforeBytes: 0, afterBytes: 0, savedBytes: 0 };
  if (!isObject(envelope)) return { payload, metrics };
  const collection = Array.isArray(envelope.input) ? "input" : Array.isArray(envelope.messages) ? "messages" : null;
  if (!collection) return { payload, metrics };
  function project(text) {
    if (typeof text !== "string") return text;
    const result = projectToolText(text);
    metrics.beforeBytes += Buffer.byteLength(text);
    metrics.afterBytes += Buffer.byteLength(result.text);
    metrics.references += result.references;
    if (result.text !== text) metrics.changedOutputs++;
    return result.text;
  }
  const items = envelope[collection].map(item => {
    if (!isObject(item)) return item;
    if (collection === "input" && ["function_call_output", "mcp_call"].includes(item.type) && typeof item.output === "string") {
      const output = project(item.output);
      return output === item.output ? item : { ...item, output };
    }
    if (collection === "input" && item.type === "function_call_output" && Array.isArray(item.output)) {
      const output = item.output.map(block => {
        if (block?.type !== "input_text" || typeof block.text !== "string") return block;
        const text = project(block.text);
        return text === block.text ? block : { ...block, text };
      });
      return output.some((block, index) => block !== item.output[index]) ? { ...item, output } : item;
    }
    if (collection === "messages" && item.role === "tool" && typeof item.content === "string") {
      const content = project(item.content);
      return content === item.content ? item : { ...item, content };
    }
    return item;
  });
  metrics.savedBytes = metrics.beforeBytes - metrics.afterBytes;
  if (!metrics.changedOutputs) return { payload, metrics };
  const projected = { ...envelope, [collection]: items };
  return { payload: envelope === payload ? projected : { ...payload, response: projected }, metrics };
}
