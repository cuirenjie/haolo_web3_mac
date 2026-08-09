import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertWorkflowRun, publicWorkflowRun } from "./protocol.mjs";
import {
  normalizeWorkflowDraft,
  normalizeWorkflowSpec,
  validateWorkflowSpec,
  workflowDefinitionHash,
  WorkflowDraftValidationError,
} from "./workflow-spec.mjs";

export class WorkflowRunStore {
  constructor(databasePath) {
    this.databasePath = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        status TEXT NOT NULL,
        spec_id TEXT,
        spec_version INTEGER,
        graph_hash TEXT,
        parent_run_id TEXT,
        parent_node_run_id TEXT,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS workflow_runs_thread_updated
        ON workflow_runs(thread_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS workflow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS workflow_events_run_sequence
        ON workflow_events(run_id, sequence ASC);
      CREATE TABLE IF NOT EXISTS workflow_specs (
        spec_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        workflow_key TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        graph_hash TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        source_run_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY(spec_id, version),
        UNIQUE(workflow_key, version)
      );
      CREATE INDEX IF NOT EXISTS workflow_specs_thread_created
        ON workflow_specs(thread_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS workflow_specs_workflow_version
        ON workflow_specs(workflow_key, version DESC);
      CREATE TABLE IF NOT EXISTS workflow_drafts (
        draft_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        workflow_key TEXT NOT NULL,
        base_spec_id TEXT,
        base_spec_version INTEGER,
        revision INTEGER NOT NULL,
        draft_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS workflow_drafts_thread_updated
        ON workflow_drafts(thread_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS workflow_layouts (
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        layout_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(owner_type, owner_id)
      );
    `);
    ensureColumn(this.database, "workflow_runs", "spec_id", "TEXT");
    ensureColumn(this.database, "workflow_runs", "spec_version", "INTEGER");
    ensureColumn(this.database, "workflow_runs", "graph_hash", "TEXT");
    ensureColumn(this.database, "workflow_runs", "parent_run_id", "TEXT");
    ensureColumn(this.database, "workflow_runs", "parent_node_run_id", "TEXT");
    this.upsertStatement = this.database.prepare(`
      INSERT INTO workflow_runs(
        id, thread_id, status, spec_id, spec_version, graph_hash,
        parent_run_id, parent_node_run_id, snapshot_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        thread_id = excluded.thread_id,
        status = excluded.status,
        spec_id = excluded.spec_id,
        spec_version = excluded.spec_version,
        graph_hash = excluded.graph_hash,
        parent_run_id = excluded.parent_run_id,
        parent_node_run_id = excluded.parent_node_run_id,
        snapshot_json = excluded.snapshot_json,
        updated_at = excluded.updated_at
    `);
    this.eventStatement = this.database.prepare(`
      INSERT OR IGNORE INTO workflow_events(run_id, sequence, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
  }

  save(run, event = null) {
    const snapshot = publicWorkflowRun(assertWorkflowRun(run));
    this.upsertStatement.run(
      snapshot.id,
      snapshot.threadId,
      snapshot.status,
      nullableText(snapshot.specId),
      nullableInteger(snapshot.specVersion),
      nullableText(snapshot.graphHash),
      nullableText(snapshot.parentRunId),
      nullableText(snapshot.parentNodeRunId),
      JSON.stringify(snapshot),
      snapshot.createdAt,
      snapshot.updatedAt,
    );
    if (event) {
      this.eventStatement.run(
        snapshot.id,
        Number(event.sequence) || 0,
        String(event.type || "run.updated"),
        JSON.stringify(publicWorkflowRun(event)),
        event.createdAt || snapshot.updatedAt,
      );
    }
    return snapshot;
  }

  get(runId) {
    const row = this.database.prepare("SELECT snapshot_json FROM workflow_runs WHERE id = ?").get(String(runId || ""));
    return parseSnapshot(row?.snapshot_json);
  }

  latestForThread(threadId) {
    const row = this.database.prepare(`
      SELECT snapshot_json FROM workflow_runs
      WHERE thread_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(String(threadId || ""));
    return parseSnapshot(row?.snapshot_json);
  }

  listRuns(options = {}) {
    const limit = Math.min(500, Math.max(1, Math.floor(Number(options.limit) || 100)));
    const clauses = [];
    const params = [];
    if (options.threadId) {
      clauses.push("thread_id = ?");
      params.push(String(options.threadId));
    }
    if (options.terminalOnly === true) {
      clauses.push("status IN ('succeeded', 'failed', 'cancelled')");
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.database.prepare(`
      SELECT snapshot_json FROM workflow_runs
      ${where}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...params, limit).map((row) => parseSnapshot(row.snapshot_json)).filter(Boolean);
  }

  nonTerminalRuns() {
    return this.database.prepare(`
      SELECT snapshot_json FROM workflow_runs
      WHERE status NOT IN ('succeeded', 'failed', 'cancelled')
      ORDER BY updated_at ASC
    `).all().map((row) => parseSnapshot(row.snapshot_json)).filter(Boolean);
  }

  events(runId) {
    return this.database.prepare(`
      SELECT payload_json FROM workflow_events
      WHERE run_id = ?
      ORDER BY sequence ASC
    `).all(String(runId || "")).map((row) => parseSnapshot(row.payload_json)).filter(Boolean);
  }

  saveDraft(value) {
    const draft = normalizeWorkflowDraft(value);
    if (!draft.id || !draft.threadId || !draft.workflowKey) {
      throw new Error("Workflow draft identity is required.");
    }
    this.database.prepare(`
      INSERT INTO workflow_drafts(
        draft_id, thread_id, workflow_key, base_spec_id, base_spec_version,
        revision, draft_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(draft_id) DO UPDATE SET
        thread_id = excluded.thread_id,
        workflow_key = excluded.workflow_key,
        base_spec_id = excluded.base_spec_id,
        base_spec_version = excluded.base_spec_version,
        revision = excluded.revision,
        draft_json = excluded.draft_json,
        updated_at = excluded.updated_at
    `).run(
      draft.id,
      draft.threadId,
      draft.workflowKey,
      draft.baseSpecId,
      draft.baseSpecVersion,
      draft.revision,
      JSON.stringify(draft),
      draft.createdAt,
      draft.updatedAt,
    );
    return draft;
  }

  saveDraftWithLayout(value, layoutValue) {
    const draft = normalizeWorkflowDraft(value);
    const layout = publicWorkflowRun(
      layoutValue && typeof layoutValue === "object" ? layoutValue : {},
    );
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.saveDraft(draft);
      this.saveLayout("draft", draft.id, layout, draft.updatedAt);
      this.database.exec("COMMIT");
      return { draft, layout };
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original persistence error. A failed rollback is still
        // recoverable by SQLite when this connection is closed.
      }
      throw error;
    }
  }

  getDraft(draftId) {
    const row = this.database.prepare(`
      SELECT draft_json FROM workflow_drafts WHERE draft_id = ?
    `).get(String(draftId || ""));
    const draft = parseSnapshot(row?.draft_json);
    return draft ? normalizeWorkflowDraft(draft) : null;
  }

  latestDraftForThread(threadId) {
    const row = this.database.prepare(`
      SELECT draft_json FROM workflow_drafts
      WHERE thread_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(String(threadId || ""));
    const draft = parseSnapshot(row?.draft_json);
    return draft ? normalizeWorkflowDraft(draft) : null;
  }

  deleteDraft(draftId) {
    const result = this.database.prepare(`
      DELETE FROM workflow_drafts WHERE draft_id = ?
    `).run(String(draftId || ""));
    return Number(result.changes || 0) > 0;
  }

  nextSpecVersion(workflowKey) {
    const row = this.database.prepare(`
      SELECT MAX(version) AS version FROM workflow_specs WHERE workflow_key = ?
    `).get(String(workflowKey || ""));
    return Math.max(0, Number(row?.version) || 0) + 1;
  }

  saveSpec(value) {
    const spec = normalizeWorkflowSpec(value);
    const actualGraphHash = workflowDefinitionHash(spec);
    const existingIdentity = this.getSpec(spec.id, spec.version);
    if (existingIdentity) {
      if (existingIdentity.graphHash !== actualGraphHash) {
        const error = new Error("A frozen workflow spec cannot be overwritten.");
        error.code = "WORKFLOW_SPEC_IMMUTABLE";
        throw error;
      }
      return existingIdentity;
    }
    const validation = validateWorkflowSpec(spec, {
      resolveSpec: (specId, version) => this.getSpec(specId, version),
    });
    if (!validation.valid) throw new WorkflowDraftValidationError(validation);
    const existingVersionRow = this.database.prepare(`
      SELECT spec_json FROM workflow_specs
      WHERE workflow_key = ? AND version = ?
      LIMIT 1
    `).get(spec.workflowKey, spec.version);
    if (existingVersionRow) {
      const error = new Error("Workflow spec version already exists.");
      error.code = "WORKFLOW_SPEC_VERSION_CONFLICT";
      throw error;
    }
    this.database.prepare(`
      INSERT INTO workflow_specs(
        spec_id, version, workflow_key, thread_id, graph_hash,
        spec_json, source_run_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      spec.id,
      spec.version,
      spec.workflowKey,
      spec.threadId,
      spec.graphHash,
      JSON.stringify(spec),
      spec.sourceRunId,
      spec.createdAt,
    );
    return spec;
  }

  getSpec(specId, version = null) {
    const identifier = String(specId || "");
    const row = version == null
      ? this.database.prepare(`
          SELECT spec_json FROM workflow_specs
          WHERE spec_id = ?
          ORDER BY version DESC
          LIMIT 1
        `).get(identifier)
      : this.database.prepare(`
          SELECT spec_json FROM workflow_specs
          WHERE spec_id = ? AND version = ?
          LIMIT 1
        `).get(identifier, Number(version));
    const spec = parseSnapshot(row?.spec_json);
    return spec ? normalizeWorkflowSpec(spec) : null;
  }

  latestSpecForThread(threadId) {
    const row = this.database.prepare(`
      SELECT spec_json FROM workflow_specs
      WHERE thread_id = ?
      ORDER BY created_at DESC, version DESC
      LIMIT 1
    `).get(String(threadId || ""));
    const spec = parseSnapshot(row?.spec_json);
    return spec ? normalizeWorkflowSpec(spec) : null;
  }

  listReusableSpecs(options = {}) {
    const limit = Math.min(200, Math.max(1, Math.floor(Number(options.limit) || 50)));
    const rows = options.threadId
      ? this.database.prepare(`
          SELECT spec_json FROM workflow_specs
          WHERE thread_id = ?
          ORDER BY created_at DESC, version DESC
          LIMIT ?
        `).all(String(options.threadId), limit)
      : this.database.prepare(`
          SELECT spec_json FROM workflow_specs
          ORDER BY created_at DESC, version DESC
          LIMIT ?
        `).all(limit);
    return rows
      .map((row) => parseSnapshot(row.spec_json))
      .filter(Boolean)
      .map((spec) => normalizeWorkflowSpec(spec));
  }

  saveLayout(ownerType, ownerId, value, updatedAt = new Date().toISOString()) {
    const type = String(ownerType || "").trim();
    const id = String(ownerId || "").trim();
    if (!type || !id) throw new Error("Workflow layout owner is required.");
    const layout = publicWorkflowRun(value && typeof value === "object" ? value : {});
    this.database.prepare(`
      INSERT INTO workflow_layouts(owner_type, owner_id, layout_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(owner_type, owner_id) DO UPDATE SET
        layout_json = excluded.layout_json,
        updated_at = excluded.updated_at
    `).run(type, id, JSON.stringify(layout), updatedAt);
    return layout;
  }

  getLayout(ownerType, ownerId) {
    const row = this.database.prepare(`
      SELECT layout_json FROM workflow_layouts
      WHERE owner_type = ? AND owner_id = ?
    `).get(String(ownerType || ""), String(ownerId || ""));
    return parseSnapshot(row?.layout_json);
  }

  close() {
    this.database?.close();
    this.database = null;
  }
}

function ensureColumn(database, tableName, columnName, definition) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function nullableText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function nullableInteger(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseSnapshot(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
