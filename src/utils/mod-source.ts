import { createHash } from 'node:crypto'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { distPath } from './env'

export type ModSourcePaths = {
  sourceDir: string
  sourceRoot: string
  workspaceId: string
  workspacePath: string
  cacheRoot: string
  dbPath: string
  csharpAstDumpPath: string
  versionPath: string
}

export type ModSourceWorkspace = ModSourcePaths & {
  workspaceRoot: string
}

export const MOD_SOURCE_IGNORED_DIRECTORY_NAMES = ['.git', '.idea', '.vs', '.vscode', 'bin', 'obj'] as const

export function getConfiguredModSourceDir(): string | undefined {
  return (
    process.env.BANNERSAGE_BANNERLORD_MOD_SOURCE_DIR ||
    process.env.BANNERSAGE_MOD_SOURCE_DIR
  )?.trim()
}

export async function ensureModSourceDir(candidate?: string): Promise<string> {
  return (await resolveModSourceWorkspace(candidate)).sourceRoot
}

export function resolveModSourceDir(candidate?: string): string {
  const configured = candidate?.trim() || getConfiguredModSourceDir()
  if (!configured) {
    throw new Error('Missing mod source directory. Pass --source-dir "<path>" or set BANNERSAGE_MOD_SOURCE_DIR.')
  }

  return resolve(configured)
}

export async function resolveModSourceWorkspace(candidate?: string): Promise<ModSourceWorkspace> {
  const workspaceRoot = resolveModSourceDir(candidate)
  const workspaceStats = await safeStat(workspaceRoot)
  if (!workspaceStats?.isDirectory()) {
    throw new Error(`Mod source path is not a directory: ${workspaceRoot}`)
  }

  const sourceRoot = await resolveEffectiveSourceRoot(workspaceRoot)
  const paths = getModSourcePaths(sourceRoot)

  await mkdir(paths.workspacePath, { recursive: true })

  return {
    ...paths,
    workspaceRoot,
  }
}

export function getModSourcePaths(sourceDir: string): ModSourcePaths {
  const normalizedSourceDir = resolve(sourceDir)
  const workspaceId = createHash('sha1')
    .update(normalizedSourceDir.replaceAll('\\', '/').toLowerCase())
    .digest('hex')
    .slice(0, 12)
  const workspacePath = join(distPath, 'mod-sources', workspaceId)

  return {
    sourceDir: normalizedSourceDir,
    sourceRoot: normalizedSourceDir,
    workspaceId,
    workspacePath,
    cacheRoot: workspacePath,
    dbPath: join(workspacePath, 'mod-source.db'),
    csharpAstDumpPath: join(workspacePath, 'csharp-index.json'),
    versionPath: join(workspacePath, 'Version.txt'),
  }
}

export async function countModSourceCSharpFiles(sourceRoot: string): Promise<number> {
  let count = 0

  for await (const _filePath of walkModSourceCSharpFiles(sourceRoot)) {
    count += 1
  }

  return count
}

export async function* walkModSourceCSharpFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (shouldSkipModSourceDirectory(entry.name)) {
        continue
      }

      yield* walkModSourceCSharpFiles(fullPath)
      continue
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.cs')) {
      yield fullPath
    }
  }
}

export function shouldSkipModSourceDirectory(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return MOD_SOURCE_IGNORED_DIRECTORY_NAMES.some(candidate => candidate === normalized)
}

async function resolveEffectiveSourceRoot(workspaceRoot: string): Promise<string> {
  if (basename(workspaceRoot).toLowerCase() === 'src') {
    return workspaceRoot
  }

  const srcCandidate = join(workspaceRoot, 'src')
  const sourceStats = await safeStat(srcCandidate)
  if (sourceStats?.isDirectory()) {
    return srcCandidate
  }

  return workspaceRoot
}

async function safeStat(path: string) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}
