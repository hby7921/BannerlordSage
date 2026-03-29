import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { getGamePaths, normalizeGameId } from './env'

type RuntimeInvalidator = () => void

const invalidators = new Set<RuntimeInvalidator>()
const observedRevisionByGame = new Map<string, string>()
const observedRevisionByPath = new Map<string, string>()

export function registerRuntimeInvalidator(invalidator: RuntimeInvalidator): () => void {
  invalidators.add(invalidator)
  return () => invalidators.delete(invalidator)
}

export function ensureRuntimeRevisionFresh(gameId?: string): boolean {
  const normalizedGameId = normalizeGameId(gameId)
  return ensureRevisionFreshForKey(normalizedGameId, getGamePaths(normalizedGameId).versionPath, observedRevisionByGame)
}

export function readRuntimeRevision(gameId?: string): string {
  return readRevisionFile(getGamePaths(gameId).versionPath)
}

export async function writeRuntimeRevision(gameId: string, revision: string): Promise<void> {
  const normalizedGameId = normalizeGameId(gameId)
  await writeRevisionFile(getGamePaths(normalizedGameId).versionPath, revision)
  observedRevisionByGame.set(normalizedGameId, revision.trim())
}

export function ensureRevisionFresh(versionPath: string): boolean {
  return ensureRevisionFreshForKey(versionPath, versionPath, observedRevisionByPath)
}

export function readRevisionFile(versionPath: string): string {
  if (!existsSync(versionPath)) {
    return ''
  }

  try {
    return readFileSync(versionPath, 'utf8').trim()
  } catch {
    return ''
  }
}

export async function writeRevisionFile(versionPath: string, revision: string): Promise<void> {
  await writeFile(versionPath, `${revision.trim()}\n`, 'utf8')
  observedRevisionByPath.set(versionPath, revision.trim())
}

function ensureRevisionFreshForKey(
  observationKey: string,
  versionPath: string,
  observedRevisions: Map<string, string>
): boolean {
  const revision = readRevisionFile(versionPath)
  const previous = observedRevisions.get(observationKey)

  if (previous === undefined) {
    observedRevisions.set(observationKey, revision)
    return false
  }

  if (previous === revision) {
    return false
  }

  observedRevisions.set(observationKey, revision)
  for (const invalidator of invalidators) {
    invalidator()
  }

  return true
}
