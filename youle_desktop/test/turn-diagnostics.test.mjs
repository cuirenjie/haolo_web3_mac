// HAOLO-TURN-DIAGNOSTICS-TEST
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TurnDiagnosticRecorder,
  classifyTurnFailure,
  createTurnDiagnosticId,
  failureDiagnosticsFromNotification,
  normalizeTurnDiagnosticId,
  redactDiagnosticText,
} from "../src/main/turn-diagnostics.mjs";

test("creates compact searchable diagnostic ids", () => {
  const id = createTurnDiagnosticId(
    new Date("2026-07-27T08:30:12.000Z"),
    Buffer.from([0x1a, 0x2b, 0x3c, 0x4d]),
  );
  assert.equal(id, "H-20260727083012-1A2B3C4D");
  assert.equal(normalizeTurnDiagnosticId(id.toLowerCase()), id);
  assert.equal(normalizeTurnDiagnosticId("not-a-diagnostic-id"), "");
});

test("extracts nested stream and concurrency diagnostics without exposing credentials", () => {
  const result = failureDiagnosticsFromNotification({
    method: "turn/failed",
    params: {
      error: {
        message: "Reconnecting... 5/5",
        codexErrorInfo: {
          responseStreamDisconnected: { httpStatusCode: 429 },
          additionalDetails:
            "stream disconnected before completion: Concurrency limit exceeded for account; Bearer secret-token-value",
        },
      },
    },
  });
  assert.equal(result.errorClass, "concurrency_limit");
  assert.equal(result.httpStatus, 429);
  assert.match(result.detail, /Concurrency limit exceeded/);
  assert.doesNotMatch(result.detail, /secret-token-value/);
});

test("classifies the failure families needed by the desktop UI", () => {
  assert.equal(classifyTurnFailure("stream disconnected before completion"), "stream_disconnected");
  assert.equal(classifyTurnFailure("request timed out"), "timeout");
  assert.equal(classifyTurnFailure("Too Many Requests", 429), "rate_limit");
  assert.equal(classifyTurnFailure("bad gateway", 502), "upstream_5xx");
  assert.equal(classifyTurnFailure("Authentication expired", 401), "authentication");
  assert.equal(classifyTurnFailure("ECONNREFUSED 127.0.0.1"), "connection_refused");
});

test("redacts local paths, emails, bearer tokens, and API keys", () => {
  const text = redactDiagnosticText(
    "C:\\Users\\Alice\\secret.txt alice@example.com Bearer abc.def.ghi sk-exampleSecret123",
  );
  assert.doesNotMatch(text, /Alice|alice@example|abc\.def\.ghi|exampleSecret/);
  assert.match(text, /\[REDACTED_PATH\]/);
  assert.match(text, /\[REDACTED_EMAIL\]/);
});

test("records and exports a bounded privacy-safe diagnostic report", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-turn-diagnostics-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logPath = path.join(directory, "turn-diagnostics.jsonl");
  const reportPath = path.join(directory, "report.json");
  const timestamps = [
    new Date("2026-07-27T08:30:00.000Z"),
    new Date("2026-07-27T08:30:01.000Z"),
    new Date("2026-07-27T08:30:02.000Z"),
  ];
  const recorder = new TurnDiagnosticRecorder({
    logPath,
    appVersion: "0.1.160",
    sessionId: "session-test",
    now: () => timestamps.shift() || new Date("2026-07-27T08:30:03.000Z"),
  });
  const diagnosticId = "H-20260727083000-AABBCCDD";
  recorder.record("send.requested", {
    diagnosticId,
    model: "gpt-5.6-terra",
    textChars: 42,
    prompt: "must never be exported",
    cwd: "C:\\Users\\Alice\\private-project",
  });
  recorder.record("turn.terminal", {
    diagnosticId,
    model: "gpt-5.6-terra",
    status: "failed",
    errorClass: "timeout",
    detail: "request timed out for alice@example.com",
  });
  const exported = recorder.exportReport(
    reportPath,
    {
      runtime: { platform: "win32" },
      credentials: "must never be exported",
    },
    { windowMs: 60 * 60_000 },
  );
  assert.equal(exported.eventCount, 2);
  assert.equal(exported.report.summary.turnCount, 1);
  assert.equal(exported.report.summary.failureClasses.timeout, 1);
  assert.equal(exported.report.privacy.includesPromptText, false);
  const serialized = fs.readFileSync(reportPath, "utf8");
  assert.doesNotMatch(serialized, /must never be exported|alice@example|private-project/);
  assert.match(serialized, /\[REDACTED_EMAIL\]/);
});

test("exports the complete bounded event timeline without the nested array cap", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-turn-diagnostics-timeline-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logPath = path.join(directory, "turn-diagnostics.jsonl");
  const reportPath = path.join(directory, "report.json");
  const now = new Date("2026-08-03T15:13:43.823Z");
  const recorder = new TurnDiagnosticRecorder({
    logPath,
    appVersion: "0.1.162",
    sessionId: "session-timeline-test",
    now: () => now,
  });

  for (let sequence = 0; sequence < 75; sequence += 1) {
    recorder.record("turn.timeline", {
      diagnosticId: `H-2026080315${String(sequence).padStart(4, "0")}-AABBCCDD`,
      sequence,
      detail: `event ${sequence} for alice@example.com`,
    });
  }

  const exported = recorder.exportReport(reportPath, {
    nestedValues: Array.from({ length: 60 }, (_, index) => index),
  }, {
    windowMs: 60 * 60_000,
    maxEvents: 64,
  });
  const persisted = JSON.parse(fs.readFileSync(reportPath, "utf8"));

  assert.equal(exported.eventCount, 64);
  assert.equal(exported.report.summary.eventCount, 64);
  assert.equal(exported.report.events.length, 64);
  assert.equal(exported.report.snapshot.nestedValues.length, 40);
  assert.equal(persisted.events.length, 64);
  assert.equal(persisted.events[0].sequence, 11);
  assert.equal(persisted.events.at(-1).sequence, 74);
  assert.doesNotMatch(JSON.stringify(persisted), /alice@example\.com/);
});
