// src/utils/env.ts
import { join } from 'path'

export const DEFAULT_GAME_ID = 'bannerlord'

export const root = join(import.meta.dir, '../../')
export const distPath = join(root, 'dist')
export const gamesDistPath = join(distPath, 'games')

export function normalizeGameId(gameId?: string): string {
  const normalized = gameId?.trim().toLowerCase() || DEFAULT_GAME_ID
  return normalized || DEFAULT_GAME_ID
}

export function getActiveGameId(): string {
  return normalizeGameId(process.env.BANNERSAGE_GAME || process.env.BANNERLORDSAGE_GAME)
}

export function getGamePaths(gameId = getActiveGameId()) {
  const normalizedGameId = normalizeGameId(gameId)
  const gameDistPath = join(gamesDistPath, normalizedGameId)
  const assetsPath = join(gameDistPath, 'assets')
  const reportsPath = join(gameDistPath, 'reports')

  return {
    gameId: normalizedGameId,
    gameDistPath,
    assetsPath,
    reportsPath,
    versionPath: join(gameDistPath, 'Version.txt'),
    defsPath: join(assetsPath, 'Xmls'),
    sourcePath: join(assetsPath, 'Source'),
    dbPath: join(gameDistPath, `${normalizedGameId}.db`),
    setupStatePath: join(gameDistPath, 'setup-state.json'),
    csharpAstDumpPath: join(gameDistPath, 'csharp-index.json'),
    xmlParseReportPath: join(reportsPath, 'xml-parse-report.json'),
    xmlParseReportMarkdownPath: join(reportsPath, 'xml-parse-report.md'),
  }
}

export const activeGameId = getActiveGameId()
export const activeGamePaths = getGamePaths(activeGameId)
export const assetsPath = activeGamePaths.assetsPath
export const versionPath = activeGamePaths.versionPath
export const defsPath = activeGamePaths.defsPath
export const sourcePath = activeGamePaths.sourcePath
export const dbPath = activeGamePaths.dbPath
export const setupStatePath = activeGamePaths.setupStatePath
export const csharpAstDumpPath = activeGamePaths.csharpAstDumpPath
