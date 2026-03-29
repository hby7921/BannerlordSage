import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ensureRuntimeRevisionFresh, registerRuntimeInvalidator } from './runtime-revision'

type CachedTextFile = {
  fullPath: string
  mtimeMs: number
  size: number
  lines: string[]
}

type TextSlice = {
  text: string
  startLine: number
  endLineExclusive: number
  totalLines: number
  hasMore: boolean
}

const MAX_CACHED_FILES = 8
const cache = new Map<string, CachedTextFile>()

export async function readTextFileSlice(
  fullPath: string,
  startLine = 0,
  lineCount = 400
): Promise<TextSlice> {
  ensureRuntimeRevisionFresh()
  const entry = await getCachedTextFile(fullPath)
  const safeStart = Math.max(0, startLine)
  const safeCount = Math.max(1, lineCount)
  const endLineExclusive = Math.min(safeStart + safeCount, entry.lines.length)

  return {
    text: entry.lines.slice(safeStart, endLineExclusive).join('\n'),
    startLine: safeStart,
    endLineExclusive,
    totalLines: entry.lines.length,
    hasMore: endLineExclusive < entry.lines.length,
  }
}

export async function readTextFileLines(fullPath: string): Promise<string[]> {
  ensureRuntimeRevisionFresh()
  const entry = await getCachedTextFile(fullPath)
  return entry.lines
}

export function clearTextFileCache(): void {
  cache.clear()
}

async function getCachedTextFile(fullPath: string): Promise<CachedTextFile> {
  const resolvedPath = resolve(fullPath)
  const stats = await stat(resolvedPath)
  const cached = cache.get(resolvedPath)

  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    refreshLru(resolvedPath, cached)
    return cached
  }

  const raw = await readFile(resolvedPath, 'utf8')
  const entry: CachedTextFile = {
    fullPath: resolvedPath,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    lines: raw.split(/\r?\n/),
  }

  refreshLru(resolvedPath, entry)
  return entry
}

function refreshLru(key: string, value: CachedTextFile): void {
  cache.delete(key)
  cache.set(key, value)

  while (cache.size > MAX_CACHED_FILES) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) {
      break
    }
    cache.delete(oldestKey)
  }
}

registerRuntimeInvalidator(() => {
  clearTextFileCache()
})
