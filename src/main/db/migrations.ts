import type Database from 'better-sqlite3'

/**
 * Migration 005: Add streaming and WebSocket flags to requests table
 * Safe to call multiple times (handles duplicate column errors)
 */
export function migrateAddStreamingAndWebSocketFlags(db: Database.Database): void {
  const migrations = [
    `ALTER TABLE requests ADD COLUMN is_streaming INTEGER DEFAULT 0`,
    `ALTER TABLE requests ADD COLUMN is_websocket INTEGER DEFAULT 0`,
  ]

  for (const migration of migrations) {
    try {
      db.exec(migration)
    } catch (err) {
      // Ignore error if column already exists
      if (!String(err).includes('duplicate column name')) {
        throw err
      }
    }
  }
}

/**
 * Run all database migrations — create tables and indexes.
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      name        TEXT,
      target_url  TEXT,
      status      TEXT NOT NULL DEFAULT 'stopped',
      created_at  INTEGER NOT NULL,
      stopped_at  INTEGER
    );

    -- HTTP request records
    CREATE TABLE IF NOT EXISTS requests (
      id               TEXT PRIMARY KEY,
      session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      sequence         INTEGER NOT NULL,
      timestamp        INTEGER NOT NULL,
      method           TEXT NOT NULL,
      url              TEXT NOT NULL,
      request_headers  TEXT,
      request_body     TEXT,
      status_code      INTEGER,
      response_headers TEXT,
      response_body    TEXT,
      content_type     TEXT,
      initiator        TEXT,
      duration_ms      INTEGER
    );

    -- JS Hook capture records
    CREATE TABLE IF NOT EXISTS js_hooks (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id         TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      timestamp          INTEGER NOT NULL,
      hook_type          TEXT NOT NULL,
      function_name      TEXT NOT NULL,
      arguments          TEXT,
      result             TEXT,
      call_stack         TEXT,
      related_request_id TEXT
    );

    -- Storage snapshots
    CREATE TABLE IF NOT EXISTS storage_snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      timestamp    INTEGER NOT NULL,
      domain       TEXT NOT NULL,
      storage_type TEXT NOT NULL,
      data         TEXT
    );

    -- AI analysis reports
    CREATE TABLE IF NOT EXISTS analysis_reports (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      created_at        INTEGER NOT NULL,
      llm_provider      TEXT NOT NULL,
      llm_model         TEXT NOT NULL,
      prompt_tokens     INTEGER,
      completion_tokens INTEGER,
      report_content    TEXT
    );

    -- Fingerprint profiles (one per session)
    CREATE TABLE IF NOT EXISTS fingerprint_profiles (
      session_id   TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      profile_json TEXT NOT NULL
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_requests_url ON requests(url);
    CREATE INDEX IF NOT EXISTS idx_js_hooks_session ON js_hooks(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_storage_session ON storage_snapshots(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_reports_session ON analysis_reports(session_id);
  `)

  // Run additional migrations
  migrateAddStreamingAndWebSocketFlags(db)
  migrateAddFilterTokenColumns(db)
  migrateAddSourceColumn(db)
  migrateAddChatMessagesTable(db)
  migrateAddAiRequestLogsTable(db)
  migrateBackfillAnthropicCachedInputTokens(db)
  migrateAddInteractionEventsTable(db)
}

/**
 * Migration 008: Add chat_messages table for persisting follow-up Q&A per report
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
export function migrateAddChatMessagesTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id  TEXT NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_report ON chat_messages(report_id, id);
  `)
}

/**
 * Migration 007: Add source column to requests table for MITM proxy support
 * Safe to call multiple times (handles duplicate column errors)
 */
export function migrateAddSourceColumn(db: Database.Database): void {
  try {
    db.exec(`ALTER TABLE requests ADD COLUMN source TEXT DEFAULT 'cdp'`);
  } catch (err) {
    if (!String(err).includes("duplicate column name")) throw err;
  }
}

/**
 * Migration 006: Add Phase 1 filter token columns to analysis_reports
 * Safe to call multiple times (handles duplicate column errors)
 */
export function migrateAddFilterTokenColumns(db: Database.Database): void {
  const migrations = [
    `ALTER TABLE analysis_reports ADD COLUMN filter_prompt_tokens INTEGER`,
    `ALTER TABLE analysis_reports ADD COLUMN filter_completion_tokens INTEGER`,
  ]

  for (const migration of migrations) {
    try {
      db.exec(migration)
    } catch (err) {
      if (!String(err).includes('duplicate column name')) {
        throw err
      }
    }
  }
}

/**
 * Migration 009: Add ai_request_logs table for recording LLM HTTP requests
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
export function migrateAddAiRequestLogsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_request_logs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      report_id         TEXT REFERENCES analysis_reports(id) ON DELETE SET NULL,
      type              TEXT NOT NULL,
      provider          TEXT NOT NULL,
      model             TEXT NOT NULL,
      request_url       TEXT NOT NULL,
      request_method    TEXT NOT NULL DEFAULT 'POST',
      request_headers   TEXT NOT NULL,
      request_body      TEXT NOT NULL,
      status_code       INTEGER,
      response_headers  TEXT,
      response_body     TEXT,
      prompt_tokens     INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      duration_ms       INTEGER,
      error             TEXT,
      created_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_logs_session ON ai_request_logs(session_id);
    CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_request_logs(created_at);
  `)
}

export function migrateBackfillAnthropicCachedInputTokens(db: Database.Database): void {
  const validResponse = "CASE WHEN json_valid(response_body) THEN response_body ELSE '{}' END"
  const inputTokens = `COALESCE(CAST(json_extract(${validResponse}, '$.usage.input_tokens') AS INTEGER), 0)`
  const cacheCreationTokens = `COALESCE(CAST(json_extract(${validResponse}, '$.usage.cache_creation_input_tokens') AS INTEGER), 0)`
  const cacheReadTokens = `COALESCE(CAST(json_extract(${validResponse}, '$.usage.cache_read_input_tokens') AS INTEGER), 0)`

  db.exec(`
    UPDATE ai_request_logs
    SET prompt_tokens = ${inputTokens} + ${cacheCreationTokens} + ${cacheReadTokens}
    WHERE error IS NULL
      AND response_body IS NOT NULL
      AND json_valid(response_body)
      AND prompt_tokens = ${inputTokens}
      AND (${cacheCreationTokens} > 0 OR ${cacheReadTokens} > 0)
  `)
}

/**
 * Migration 010: Add interaction_events table for recording user interactions
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
export function migrateAddInteractionEventsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS interaction_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      sequence      INTEGER NOT NULL,
      type          TEXT NOT NULL,
      timestamp     INTEGER NOT NULL,
      x             REAL,
      y             REAL,
      viewport_x    REAL,
      viewport_y    REAL,
      selector      TEXT,
      xpath         TEXT,
      tag_name      TEXT,
      element_text  TEXT,
      attributes    TEXT,
      bounding_rect TEXT,
      input_value   TEXT,
      key           TEXT,
      scroll_x      REAL,
      scroll_y      REAL,
      scroll_dx     REAL,
      scroll_dy     REAL,
      url           TEXT NOT NULL,
      page_title    TEXT,
      path          TEXT,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_interactions_session ON interaction_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_interactions_session_seq ON interaction_events(session_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_interactions_type ON interaction_events(session_id, type);
  `)
}
