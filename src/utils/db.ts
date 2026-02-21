// src/utils/db.ts
import { Database } from 'bun:sqlite'
import { dbPath } from './env'

let _runtimeDb: Database | null = null

export function getDb(): Database {
  if (!_runtimeDb) {
    _runtimeDb = new Database(dbPath)
    _runtimeDb.run('PRAGMA journal_mode = WAL;')
  }
  return _runtimeDb
}

export function closeDb(): void {
  if (_runtimeDb) {
    _runtimeDb.close()
    _runtimeDb = null
  }
}