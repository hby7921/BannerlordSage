// src/utils/db.ts
import { Database } from 'bun:sqlite'
import { getGamePaths } from './env'
import { ensureRuntimeRevisionFresh, registerRuntimeInvalidator } from './runtime-revision'

let _runtimeDb: Database | null = null
let _runtimeDbPath: string | null = null

export function getDb(gameId?: string): Database {
  ensureRuntimeRevisionFresh(gameId)
  const resolvedDbPath = getGamePaths(gameId).dbPath

  if (_runtimeDb && _runtimeDbPath !== resolvedDbPath) {
    _runtimeDb.close()
    _runtimeDb = null
    _runtimeDbPath = null
  }

  if (!_runtimeDb) {
    _runtimeDb = new Database(resolvedDbPath)
    _runtimeDbPath = resolvedDbPath
    _runtimeDb.run('PRAGMA busy_timeout = 5000;')
  }
  return _runtimeDb
}

export function closeDb(): void {
  if (_runtimeDb) {
    _runtimeDb.close()
    _runtimeDb = null
    _runtimeDbPath = null
  }
}

registerRuntimeInvalidator(() => {
  closeDb()
})

export function databaseHasTable(path: string, tableName: string): boolean {
  const db = new Database(path, { create: false, readonly: true })
  try {
    const row = db
      .query<{ name: string }, { $tableName: string }>(
        `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = $tableName
      `
      )
      .get({ $tableName: tableName })

    return Boolean(row)
  } catch {
    return false
  } finally {
    db.close()
  }
}

export function databaseHasColumns(path: string, tableName: string, expectedColumns: string[]): boolean {
  const db = new Database(path, { create: false, readonly: true })
  try {
    const rows = db
      .query<{ name: string }, never>(
        `
        PRAGMA table_info(${escapeSqlIdentifier(tableName)})
      `
      )
      .all()

    const available = new Set(rows.map(row => row.name))
    return expectedColumns.every(column => available.has(column))
  } catch {
    return false
  } finally {
    db.close()
  }
}

function escapeSqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
