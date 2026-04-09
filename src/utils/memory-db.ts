import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Database } from 'bun:sqlite'
import { getGamePaths, normalizeGameId } from './env'

let memoryDb: Database | null = null
let memoryDbPath: string | null = null

export function getMemoryDb(gameId?: string): Database {
  const resolvedGameId = normalizeGameId(gameId)
  const resolvedPath = getGamePaths(resolvedGameId).memoryDbPath

  if (memoryDb && memoryDbPath !== resolvedPath) {
    memoryDb.close()
    memoryDb = null
    memoryDbPath = null
  }

  if (!memoryDb) {
    mkdirSync(dirname(resolvedPath), { recursive: true })
    memoryDb = new Database(resolvedPath)
    memoryDbPath = resolvedPath
    memoryDb.run('PRAGMA busy_timeout = 5000;')
    initializeMemoryDb(memoryDb)
  }

  return memoryDb
}

export function closeMemoryDb(): void {
  if (memoryDb) {
    memoryDb.close()
    memoryDb = null
    memoryDbPath = null
  }
}

function initializeMemoryDb(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      workspace TEXT NOT NULL,
      topic TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT,
      text TEXT NOT NULL,
      source TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      tags_text TEXT NOT NULL DEFAULT '',
      importance INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'active',
      invalidation_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      invalidated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_project_memories_workspace
      ON project_memories (workspace, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_memories_topic
      ON project_memories (topic, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_memories_kind
      ON project_memories (kind, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_memories_status
      ON project_memories (status, updated_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS project_memories_fts USING fts5(
      public_id UNINDEXED,
      workspace,
      topic,
      kind,
      summary,
      text,
      tags_text,
      tokenize = 'unicode61'
    );
  `)
}
