import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runMigrations,
  migrateAddStreamingAndWebSocketFlags,
} from "../../../src/main/db/migrations";
import path from "path";
import fs from "fs";
import os from "os";
import { createRequire } from "module";

type BetterSqlite3Module = typeof import("better-sqlite3");
type BetterSqlite3Database = import("better-sqlite3").Database;

const require = createRequire(import.meta.url);

let Database: BetterSqlite3Module | null = null;
let sqliteLoadError: Error | null = null;

try {
  Database = require("better-sqlite3") as BetterSqlite3Module;
  const probe = new Database(":memory:");
  probe.close();
} catch (error) {
  sqliteLoadError = error as Error;
  Database = null;
}

const describeDatabaseMigrations = sqliteLoadError ? describe.skip : describe;

describeDatabaseMigrations("Database Migrations", () => {
  let db: BetterSqlite3Database | null = null;
  let dbPath: string;

  beforeEach(() => {
    // Create a temporary database file for testing
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-db-"));
    dbPath = path.join(tmpDir, "test.db");
    db = new Database!(dbPath);

    // Run initial migrations to set up schema
    runMigrations(db);
  });

  afterEach(() => {
    // Clean up
    db?.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    const tmpDir = path.dirname(dbPath);
    if (fs.existsSync(tmpDir)) {
      fs.rmdirSync(tmpDir);
    }
  });

  it("应该成功添加 is_streaming 和 is_websocket 列到 requests 表", () => {
    // Check that columns exist after migration
    const tableInfo = db!.prepare("PRAGMA table_info(requests)").all() as any[];
    const columnNames = tableInfo.map((col: any) => col.name);

    expect(columnNames).toContain("is_streaming");
    expect(columnNames).toContain("is_websocket");
  });

  it("应该可以重复执行迁移而不抛出错误（幂等性）", () => {
    // First execution (already done in beforeEach via runMigrations)
    // Second execution should not throw
    expect(() => {
      migrateAddStreamingAndWebSocketFlags(db!);
    }).not.toThrow();

    // Third execution to ensure idempotency
    expect(() => {
      migrateAddStreamingAndWebSocketFlags(db!);
    }).not.toThrow();

    // Verify columns still exist and have correct defaults
    const tableInfo = db!.prepare("PRAGMA table_info(requests)").all() as any[];
    const isStreamingCol = tableInfo.find(
      (col: any) => col.name === "is_streaming",
    ) as any;
    const isWebsocketCol = tableInfo.find(
      (col: any) => col.name === "is_websocket",
    ) as any;

    expect(isStreamingCol).toBeDefined();
    expect(isWebsocketCol).toBeDefined();
    expect(isStreamingCol.dflt_value).toBe("0");
    expect(isWebsocketCol.dflt_value).toBe("0");
  });

  it("应该保持向后兼容性 - 现有数据应该继续有效", () => {
    // Insert a request without the new columns (simulating old data)
    const sessionId = "session-1";
    const requestId = "req-1";

    // First, create a session
    db!.prepare(
      `
      INSERT INTO sessions (id, name, created_at)
      VALUES (?, ?, ?)
    `,
    ).run(sessionId, "Test Session", Date.now());

    // Insert a request record
    db!.prepare(
      `
      INSERT INTO requests
      (id, session_id, sequence, timestamp, method, url)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(requestId, sessionId, 1, Date.now(), "GET", "https://example.com");

    // Query the request back
    const request = db!
      .prepare("SELECT * FROM requests WHERE id = ?")
      .get(requestId) as any;

    // Verify the record exists and new columns have default values
    expect(request).toBeDefined();
    expect(request.id).toBe(requestId);
    expect(request.is_streaming).toBe(0);
    expect(request.is_websocket).toBe(0);
  });

  it("应该回填 Anthropic 缓存输入 token", () => {
    const sessionId = "session-anthropic-usage";
    db!.prepare(
      "INSERT INTO sessions (id, name, created_at) VALUES (?, ?, ?)",
    ).run(sessionId, "Anthropic Usage", Date.now());
    db!.prepare(`
      INSERT INTO ai_request_logs (
        session_id, report_id, type, provider, model,
        request_url, request_method, request_headers, request_body,
        status_code, response_headers, response_body,
        prompt_tokens, completion_tokens, duration_ms, error, created_at
      ) VALUES (?, NULL, ?, ?, ?, ?, 'POST', '{}', '{}', 200, '{}', ?, ?, ?, 10, NULL, ?)
    `).run(
      sessionId,
      "chat",
      "anthropic",
      "claude-sonnet-4.5",
      "https://api.anthropic.com/v1/messages",
      JSON.stringify({
        usage: {
          input_tokens: 351,
          cache_creation_input_tokens: 15_204,
          cache_read_input_tokens: 0,
          output_tokens: 1_335,
        },
      }),
      351,
      1_335,
      Date.now(),
    );

    runMigrations(db!);

    const log = db!
      .prepare("SELECT prompt_tokens, completion_tokens FROM ai_request_logs WHERE session_id = ?")
      .get(sessionId) as { prompt_tokens: number; completion_tokens: number };
    expect(log.prompt_tokens).toBe(15_555);
    expect(log.completion_tokens).toBe(1_335);
  });

});

if (sqliteLoadError) {
  describe("Database Migrations environment", () => {
    it("应该在原生模块不可用时给出明确信号", () => {
      expect(sqliteLoadError?.message).toBeTruthy();
    });
  });
}
