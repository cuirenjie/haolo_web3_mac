import crypto from "node:crypto";
import { validateStrategyManifest } from "./contracts.mjs";
import { validateDeclarativeStrategyRules } from "./declarative-rules.mjs";

const FIELD_SOURCE_TYPES = new Set(["user-explicit", "system-suggested", "user-confirmed"]);
const DRAFT_STATUSES = new Set(["draft", "needs-clarification", "validated", "confirmed", "private", "published"]);

function fail(message) {
  throw new TypeError(message);
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value;
}

function text(value, field, max = 4_000) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) fail(`${field} is invalid`);
  return normalized;
}

export function validateStrategyDraft(value) {
  const source = object(value, "draft");
  if (Number(source.schemaVersion) !== 1) fail("draft.schemaVersion is unsupported");
  const manifest = validateStrategyManifest(source.manifest);
  if (manifest.implementation.kind !== "declarative-v1") fail("generated strategies must use declarative-v1");
  if (manifest.publisher.type !== "community") fail("generated strategies must use a community publisher");
  const rules = validateDeclarativeStrategyRules(source.rules);
  const status = String(source.status || "draft");
  if (!DRAFT_STATUSES.has(status)) fail("draft.status is invalid");
  const fieldSourcesValue = object(source.fieldSources || {}, "draft.fieldSources");
  const fieldSources = Object.freeze(Object.fromEntries(Object.entries(fieldSourcesValue).map(([field, raw]) => {
    const item = object(raw, `draft.fieldSources.${field}`);
    const type = String(item.type || "");
    if (!FIELD_SOURCE_TYPES.has(type)) fail(`draft.fieldSources.${field}.type is invalid`);
    return [text(field, "draft field path", 180), Object.freeze({
      type,
      rationale: String(item.rationale || "").trim().slice(0, 500),
    })];
  })));
  const ambiguities = Object.freeze((Array.isArray(source.ambiguities) ? source.ambiguities : []).slice(0, 32).map((raw, index) => {
    const item = object(raw, `draft.ambiguities[${index}]`);
    const ambiguityStatus = item.status === "resolved" ? "resolved" : "open";
    return Object.freeze({
      id: text(item.id, `draft.ambiguities[${index}].id`, 80),
      question: text(item.question, `draft.ambiguities[${index}].question`, 600),
      status: ambiguityStatus,
      resolution: ambiguityStatus === "resolved" ? text(item.resolution, `draft.ambiguities[${index}].resolution`, 600) : null,
    });
  }));
  const tests = Object.freeze((Array.isArray(source.tests) ? source.tests : []).slice(0, 64).map((raw, index) => {
    const item = object(raw, `draft.tests[${index}]`);
    const testStatus = ["pending", "passed", "failed"].includes(item.status) ? item.status : "pending";
    return Object.freeze({
      id: text(item.id, `draft.tests[${index}].id`, 80),
      status: testStatus,
      summary: String(item.summary || "").trim().slice(0, 600),
    });
  }));
  const unresolvedAmbiguities = ambiguities.filter((item) => item.status === "open");
  const unconfirmedDefaults = Object.entries(fieldSources).filter(([, item]) => item.type === "system-suggested");
  const failedTests = tests.filter((item) => item.status !== "passed");
  const runnable = ["confirmed", "private", "published"].includes(status)
    && !unresolvedAmbiguities.length
    && !unconfirmedDefaults.length
    && tests.length > 0
    && !failedTests.length;
  if (["confirmed", "private", "published"].includes(status) && !runnable) {
    fail("draft cannot enter a runnable state with ambiguity, unconfirmed defaults, or incomplete tests");
  }
  return Object.freeze({
    schemaVersion: 1,
    draftId: text(source.draftId || `draft-${crypto.randomUUID()}`, "draft.draftId", 160),
    source: Object.freeze({
      naturalLanguage: text(source.source?.naturalLanguage, "draft.source.naturalLanguage", 20_000),
      locale: String(source.source?.locale || "zh-CN").trim().slice(0, 20),
      createdAt: Math.max(1, Number(source.source?.createdAt || Date.now())),
      generator: text(source.source?.generator || "haolo-strategy-draft-v1", "draft.source.generator", 120),
    }),
    status,
    manifest,
    rules,
    fieldSources,
    ambiguities,
    tests,
    publication: Object.freeze({
      visibility: ["private", "unlisted", "public"].includes(source.publication?.visibility)
        ? source.publication.visibility
        : "private",
      version: manifest.version,
      publishedAt: source.publication?.publishedAt ? Math.max(1, Number(source.publication.publishedAt)) : null,
    }),
    runnable,
  });
}

export function compileConfirmedStrategyDraft(value) {
  const draft = validateStrategyDraft(value);
  if (!draft.runnable) fail("strategy draft still requires clarification, confirmation, or replay tests");
  return Object.freeze({
    manifest: draft.manifest,
    rules: draft.rules,
    provenance: Object.freeze({
      draftId: draft.draftId,
      source: draft.source,
      fieldSources: draft.fieldSources,
      tests: draft.tests,
      publication: draft.publication,
    }),
  });
}
