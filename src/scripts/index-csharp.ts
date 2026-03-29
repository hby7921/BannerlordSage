import { Database } from 'bun:sqlite'
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { getGamePaths, root } from '../utils/env'

type CSharpTypeRow = {
  typeName: string
  fullName: string
  namespaceName: string
  containingType?: string | null
  filePath: string
  startLine: number
  endLine: number
  typeKind: string
  accessibility: string
  modifiers: string
}

type CSharpMemberRow = {
  id: string
  typeFullName: string
  memberName: string
  memberKind: string
  signature: string
  returnType?: string | null
  filePath: string
  startLine: number
  endLine: number
  accessibility: string
  isStatic: boolean
}

type SourceLocalizationRow = {
  stringId: string
  fallbackText: string
  normalizedFallback: string
  filePath: string
  moduleName: string
  assemblyName: string
  typeFullName?: string | null
  memberName?: string | null
  lineNumber: number
  columnNumber: number
  contextKind: string
  sourcePriority: number
  rawLiteral: string
}

type CSharpIndexPayload = {
  filesScanned: number
  indexedFiles?: string[]
  types: CSharpTypeRow[]
  members: CSharpMemberRow[]
  sourceLocalizations?: SourceLocalizationRow[]
}

type CSharpSourceFileSnapshot = {
  relativePath: string
  absolutePath: string
  size: number
  mtimeMs: number
}

type IndexedFileRow = {
  filePath: string
  fileSize: number
  fileMtimeMs: number
}

type CSharpWorkspaceIndexOptions = {
  sourcePath: string
  dbPath: string
  csharpAstDumpPath: string
  label?: string
  ignoreDirectoryNames?: string[]
}

export async function buildCsharpIndexForWorkspace(options: CSharpWorkspaceIndexOptions): Promise<{
  filesScanned: number
  typesIndexed: number
  membersIndexed: number
  sourceLocalizationsIndexed: number
  changedFiles: number
  removedFiles: number
  totalTypeCount: number
  totalMemberCount: number
  totalSourceLocalizationCount: number
}> {
  const {
    sourcePath,
    dbPath,
    csharpAstDumpPath,
    label = 'C# AST index',
    ignoreDirectoryNames = [],
  } = options
  console.log(`Building ${label} from ${sourcePath}`)

  const db = new Database(dbPath)

  try {
    db.run('PRAGMA busy_timeout = 5000;')
    db.run('PRAGMA journal_mode = WAL;')

    const sourceFiles = await collectCSharpSourceFiles(sourcePath, ignoreDirectoryNames)
    const hasIncrementalSchema =
      tableExists(db, 'csharp_files') &&
      tableExists(db, 'csharp_index') &&
      tableExists(db, 'csharp_types') &&
      tableExists(db, 'csharp_methods')

    if (!hasIncrementalSchema) {
      resetCsharpSchema(db)
    } else {
      ensureCsharpSchema(db)
    }

    const indexedFiles = hasIncrementalSchema ? loadIndexedFiles(db) : new Map<string, IndexedFileRow>()
    const newOrChangedFiles = sourceFiles.filter(file => {
      const previous = indexedFiles.get(file.relativePath)
      return !previous || previous.fileSize !== file.size || previous.fileMtimeMs !== file.mtimeMs
    })
    const currentFileSet = new Set(sourceFiles.map(file => file.relativePath))
    const removedFiles = [...indexedFiles.keys()].filter(filePath => !currentFileSet.has(filePath))

    if (newOrChangedFiles.length === 0 && removedFiles.length === 0) {
      console.log('No C# source changes detected. Skipping rebuild.')
      return {
        filesScanned: 0,
        typesIndexed: 0,
        membersIndexed: 0,
        sourceLocalizationsIndexed: 0,
        changedFiles: 0,
        removedFiles: 0,
        totalTypeCount: getScalarCount(db, 'csharp_types'),
        totalMemberCount: getScalarCount(db, 'csharp_methods'),
        totalSourceLocalizationCount: getScalarCount(db, 'source_localization_entries'),
      }
    }

    let payload: CSharpIndexPayload = {
      filesScanned: 0,
      indexedFiles: [],
      types: [],
      members: [],
      sourceLocalizations: [],
    }

    if (newOrChangedFiles.length > 0) {
      await runRoslynIndexer(sourcePath, csharpAstDumpPath, newOrChangedFiles.map(file => file.absolutePath))
      payload = await loadIndexerPayload(csharpAstDumpPath)
    }

    const deleteIndexByFile = db.prepare(`DELETE FROM csharp_index WHERE filePath = $filePath`)
    const deleteTypesByFile = db.prepare(`DELETE FROM csharp_types WHERE filePath = $filePath`)
    const deleteMethodsByFile = db.prepare(`DELETE FROM csharp_methods WHERE filePath = $filePath`)
    const deleteSourceLocalizationsByFile = db.prepare(
      `DELETE FROM source_localization_entries WHERE filePath = $filePath`
    )
    const deleteTrackedFile = db.prepare(`DELETE FROM csharp_files WHERE filePath = $filePath`)
    const upsertTrackedFile = db.prepare(`
      INSERT OR REPLACE INTO csharp_files (filePath, fileSize, fileMtimeMs, indexedAt)
      VALUES ($filePath, $fileSize, $fileMtimeMs, $indexedAt)
    `)
    const insertIndex = db.prepare(`
      INSERT INTO csharp_index (typeName, fullName, filePath, startLine, endLine, typeKind)
      VALUES ($typeName, $fullName, $filePath, $startLine, $endLine, $typeKind)
    `)
    const insertType = db.prepare(`
      INSERT INTO csharp_types (
        fullName, typeName, namespaceName, containingType, filePath,
        startLine, endLine, typeKind, accessibility, modifiers
      ) VALUES (
        $fullName, $typeName, $namespaceName, $containingType, $filePath,
        $startLine, $endLine, $typeKind, $accessibility, $modifiers
      )
    `)
    const insertMethod = db.prepare(`
      INSERT OR REPLACE INTO csharp_methods (
        id, typeFullName, memberName, memberKind, signature, returnType,
        filePath, startLine, endLine, accessibility, isStatic
      ) VALUES (
        $id, $typeFullName, $memberName, $memberKind, $signature, $returnType,
        $filePath, $startLine, $endLine, $accessibility, $isStatic
      )
    `)
    const insertSourceLocalization = db.prepare(`
      INSERT INTO source_localization_entries (
        stringId, fallbackText, normalizedFallback, filePath, moduleName, assemblyName,
        typeFullName, memberName, lineNumber, columnNumber, contextKind, sourcePriority, rawLiteral
      ) VALUES (
        $stringId, $fallbackText, $normalizedFallback, $filePath, $moduleName, $assemblyName,
        $typeFullName, $memberName, $lineNumber, $columnNumber, $contextKind, $sourcePriority, $rawLiteral
      )
    `)

    const affectedFiles = [...new Set([...newOrChangedFiles.map(file => file.relativePath), ...removedFiles])]

    const transaction = db.transaction(() => {
      for (const filePath of affectedFiles) {
        deleteIndexByFile.run({ $filePath: filePath })
        deleteTypesByFile.run({ $filePath: filePath })
        deleteMethodsByFile.run({ $filePath: filePath })
        deleteSourceLocalizationsByFile.run({ $filePath: filePath })
      }

      for (const filePath of removedFiles) {
        deleteTrackedFile.run({ $filePath: filePath })
      }

      for (const row of dedupeTypes(payload.types)) {
        const normalizedFilePath = normalizeFilePath(sourcePath, row.filePath)
        insertIndex.run({
          $typeName: row.typeName,
          $fullName: row.fullName,
          $filePath: normalizedFilePath,
          $startLine: row.startLine,
          $endLine: row.endLine,
          $typeKind: row.typeKind,
        })

        insertType.run({
          $fullName: row.fullName,
          $typeName: row.typeName,
          $namespaceName: row.namespaceName,
          $containingType: row.containingType || null,
          $filePath: normalizedFilePath,
          $startLine: row.startLine,
          $endLine: row.endLine,
          $typeKind: row.typeKind,
          $accessibility: row.accessibility,
          $modifiers: row.modifiers,
        })
      }

      for (const row of dedupeMembers(payload.members)) {
        insertMethod.run({
          $id: row.id,
          $typeFullName: row.typeFullName,
          $memberName: row.memberName,
          $memberKind: row.memberKind,
          $signature: row.signature,
          $returnType: row.returnType || null,
          $filePath: normalizeFilePath(sourcePath, row.filePath),
          $startLine: row.startLine,
          $endLine: row.endLine,
          $accessibility: row.accessibility,
          $isStatic: row.isStatic ? 1 : 0,
        })
      }

      for (const row of dedupeSourceLocalizations(payload.sourceLocalizations || [])) {
        insertSourceLocalization.run({
          $stringId: row.stringId,
          $fallbackText: row.fallbackText,
          $normalizedFallback: row.normalizedFallback,
          $filePath: normalizeFilePath(sourcePath, row.filePath),
          $moduleName: row.moduleName,
          $assemblyName: row.assemblyName,
          $typeFullName: row.typeFullName || null,
          $memberName: row.memberName || null,
          $lineNumber: row.lineNumber,
          $columnNumber: row.columnNumber,
          $contextKind: row.contextKind,
          $sourcePriority: row.sourcePriority,
          $rawLiteral: row.rawLiteral,
        })
      }

      const indexedAt = new Date().toISOString()
      for (const file of newOrChangedFiles) {
        upsertTrackedFile.run({
          $filePath: file.relativePath,
          $fileSize: file.size,
          $fileMtimeMs: file.mtimeMs,
          $indexedAt: indexedAt,
        })
      }
    })

    transaction()

    console.log(
      `Indexed ${payload.types.length} types, ${payload.members.length} members, and ${
        payload.sourceLocalizations?.length || 0
      } source localization literals from ${payload.filesScanned} changed files. Removed ${removedFiles.length} stale files.`
    )

    return {
      filesScanned: payload.filesScanned,
      typesIndexed: payload.types.length,
      membersIndexed: payload.members.length,
      sourceLocalizationsIndexed: payload.sourceLocalizations?.length || 0,
      changedFiles: newOrChangedFiles.length,
      removedFiles: removedFiles.length,
      totalTypeCount: getScalarCount(db, 'csharp_types'),
      totalMemberCount: getScalarCount(db, 'csharp_methods'),
      totalSourceLocalizationCount: getScalarCount(db, 'source_localization_entries'),
    }
  } finally {
    db.close()
  }
}

export async function buildCsharpIndex(gameId?: string): Promise<{
  filesScanned: number
  typesIndexed: number
  membersIndexed: number
  sourceLocalizationsIndexed: number
  changedFiles: number
  removedFiles: number
  totalTypeCount: number
  totalMemberCount: number
  totalSourceLocalizationCount: number
}> {
  const { sourcePath, dbPath, csharpAstDumpPath } = getGamePaths(gameId)
  return buildCsharpIndexForWorkspace({
    sourcePath,
    dbPath,
    csharpAstDumpPath,
    label: 'C# AST index',
  })
}

async function runRoslynIndexer(
  sourcePath: string,
  csharpAstDumpPath: string,
  filePaths?: string[]
): Promise<void> {
  const projectPath = join(root, 'tools', 'BannerlordSage.CSharpIndexer', 'BannerlordSage.CSharpIndexer.csproj')
  const indexerCommand = await ensureBuiltRoslynIndexer(projectPath)
  const extraArgs: string[] = []
  const fileListPath = `${csharpAstDumpPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.files.txt`

  try {
    if (filePaths && filePaths.length > 0) {
      await writeFile(fileListPath, filePaths.join('\n'), 'utf8')
      extraArgs.push('--file-list', fileListPath)
    }

    const proc = Bun.spawn([...indexerCommand, sourcePath, csharpAstDumpPath, ...extraArgs], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    if (exitCode !== 0) {
      throw new Error(
        [
          'Roslyn indexer failed.',
          stderrText.trim(),
          stdoutText.trim(),
        ]
          .filter(Boolean)
          .join('\n')
      )
    }
  } finally {
    if (filePaths && filePaths.length > 0) {
      await rm(fileListPath, { force: true }).catch(() => undefined)
    }
  }
}

async function ensureBuiltRoslynIndexer(projectPath: string): Promise<string[]> {
  const projectDir = dirname(projectPath)
  const releaseDir = join(projectDir, 'bin', 'Release', 'net8.0')
  const releaseExe = join(releaseDir, 'BannerlordSage.CSharpIndexer.exe')
  const releaseDll = join(releaseDir, 'BannerlordSage.CSharpIndexer.dll')
  const latestSourceMtime = await getLatestProjectSourceMtime(projectDir)
  const outputMtime = await getNewestExistingMtime([releaseExe, releaseDll])

  if (outputMtime < latestSourceMtime) {
    console.log('Building Roslyn indexer tool...')
    const buildProc = Bun.spawn(
      ['dotnet', 'build', projectPath, '--configuration', 'Release', '/nologo'],
      {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
      }
    )

    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(buildProc.stdout).text(),
      new Response(buildProc.stderr).text(),
      buildProc.exited,
    ])

    if (exitCode !== 0) {
      throw new Error(
        [
          'Failed to build the Roslyn indexer tool.',
          stderrText.trim(),
          stdoutText.trim(),
        ]
          .filter(Boolean)
          .join('\n')
      )
    }
  }

  if (await pathExists(releaseExe)) {
    return [releaseExe]
  }

  if (await pathExists(releaseDll)) {
    return ['dotnet', releaseDll]
  }

  throw new Error(`Roslyn indexer output was not found after build: ${releaseDir}`)
}

async function loadIndexerPayload(csharpAstDumpPath: string): Promise<CSharpIndexPayload> {
  const raw = await readFile(csharpAstDumpPath, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  return {
    filesScanned: Number(parsed.filesScanned ?? parsed.FilesScanned ?? 0),
    indexedFiles: (parsed.indexedFiles ?? parsed.IndexedFiles ?? []) as string[],
    types: (parsed.types ?? parsed.Types ?? []) as CSharpTypeRow[],
    members: (parsed.members ?? parsed.Members ?? []) as CSharpMemberRow[],
    sourceLocalizations: (parsed.sourceLocalizations ?? parsed.SourceLocalizations ?? []) as SourceLocalizationRow[],
  }
}

async function collectCSharpSourceFiles(
  sourcePath: string,
  ignoreDirectoryNames: string[] = []
): Promise<CSharpSourceFileSnapshot[]> {
  const rows: CSharpSourceFileSnapshot[] = []
  await walkCSharpFiles(sourcePath, async absolutePath => {
    const fileStats = await stat(absolutePath)
    rows.push({
      relativePath: normalizeFilePath(sourcePath, absolutePath),
      absolutePath,
      size: fileStats.size,
      mtimeMs: fileStats.mtimeMs,
    })
  }, new Set(ignoreDirectoryNames.map(name => name.trim().toLowerCase()).filter(Boolean)))
  rows.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return rows
}

async function walkCSharpFiles(
  dir: string,
  visit: (absolutePath: string) => Promise<void>,
  ignoredDirectoryNames: Set<string>
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name.trim().toLowerCase())) {
        continue
      }

      await walkCSharpFiles(fullPath, visit, ignoredDirectoryNames)
      continue
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.cs')) {
      await visit(fullPath)
    }
  }
}

function ensureCsharpSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS csharp_index (
      typeName TEXT NOT NULL,
      fullName TEXT NOT NULL,
      filePath TEXT NOT NULL,
      startLine INTEGER NOT NULL,
      endLine INTEGER NOT NULL,
      typeKind TEXT NOT NULL,
      PRIMARY KEY (fullName, filePath)
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS csharp_types (
      fullName TEXT NOT NULL,
      typeName TEXT NOT NULL,
      namespaceName TEXT NOT NULL,
      containingType TEXT,
      filePath TEXT NOT NULL,
      startLine INTEGER NOT NULL,
      endLine INTEGER NOT NULL,
      typeKind TEXT NOT NULL,
      accessibility TEXT NOT NULL,
      modifiers TEXT NOT NULL,
      PRIMARY KEY (fullName, filePath)
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS csharp_methods (
      id TEXT PRIMARY KEY,
      typeFullName TEXT NOT NULL,
      memberName TEXT NOT NULL,
      memberKind TEXT NOT NULL,
      signature TEXT NOT NULL,
      returnType TEXT,
      filePath TEXT NOT NULL,
      startLine INTEGER NOT NULL,
      endLine INTEGER NOT NULL,
      accessibility TEXT NOT NULL,
      isStatic INTEGER NOT NULL
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS csharp_files (
      filePath TEXT PRIMARY KEY,
      fileSize INTEGER NOT NULL,
      fileMtimeMs REAL NOT NULL,
      indexedAt TEXT NOT NULL
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS source_localization_entries (
      stringId TEXT NOT NULL,
      fallbackText TEXT NOT NULL,
      normalizedFallback TEXT NOT NULL,
      filePath TEXT NOT NULL,
      moduleName TEXT NOT NULL,
      assemblyName TEXT NOT NULL,
      typeFullName TEXT,
      memberName TEXT,
      lineNumber INTEGER NOT NULL,
      columnNumber INTEGER NOT NULL,
      contextKind TEXT NOT NULL,
      sourcePriority INTEGER NOT NULL,
      rawLiteral TEXT NOT NULL,
      PRIMARY KEY (stringId, filePath, lineNumber, columnNumber)
    );
  `)

  db.run('CREATE INDEX IF NOT EXISTS csharp_index_type_name_idx ON csharp_index(typeName);')
  db.run('CREATE INDEX IF NOT EXISTS csharp_index_file_path_idx ON csharp_index(filePath);')
  db.run('CREATE INDEX IF NOT EXISTS csharp_types_type_name_idx ON csharp_types(typeName);')
  db.run('CREATE INDEX IF NOT EXISTS csharp_types_file_path_idx ON csharp_types(filePath);')
  db.run('CREATE INDEX IF NOT EXISTS csharp_methods_type_full_name_idx ON csharp_methods(typeFullName);')
  db.run('CREATE INDEX IF NOT EXISTS csharp_methods_member_name_idx ON csharp_methods(memberName);')
  db.run('CREATE INDEX IF NOT EXISTS csharp_methods_file_path_idx ON csharp_methods(filePath);')
  db.run(
    'CREATE INDEX IF NOT EXISTS source_localization_entries_string_id_idx ON source_localization_entries(stringId, sourcePriority);'
  )
  db.run(
    'CREATE INDEX IF NOT EXISTS source_localization_entries_file_path_idx ON source_localization_entries(filePath);'
  )
}

function resetCsharpSchema(db: Database): void {
  db.run('DROP TABLE IF EXISTS csharp_index;')
  db.run('DROP TABLE IF EXISTS csharp_types;')
  db.run('DROP TABLE IF EXISTS csharp_methods;')
  db.run('DROP TABLE IF EXISTS csharp_files;')
  db.run('DROP TABLE IF EXISTS source_localization_entries;')
  ensureCsharpSchema(db)
}

function tableExists(db: Database, tableName: string): boolean {
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
}

function loadIndexedFiles(db: Database): Map<string, IndexedFileRow> {
  const rows = db
    .query<IndexedFileRow, never>(
      `
      SELECT filePath, fileSize, fileMtimeMs
      FROM csharp_files
    `
    )
    .all()

  return new Map(rows.map(row => [row.filePath, row]))
}

function normalizeFilePath(sourcePath: string, filePath: string): string {
  return relative(sourcePath, filePath).replaceAll('\\', '/')
}

function getScalarCount(db: Database, tableName: string): number {
  return Number(db.query<{ count: number }, never>(`SELECT COUNT(*) AS count FROM ${tableName}`).get()?.count || 0)
}

async function getLatestProjectSourceMtime(dir: string): Promise<number> {
  let latest = 0
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name === 'bin' || entry.name === 'obj') {
      continue
    }

    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      latest = Math.max(latest, await getLatestProjectSourceMtime(fullPath))
      continue
    }

    const fileStats = await stat(fullPath)
    latest = Math.max(latest, fileStats.mtimeMs)
  }

  return latest
}

async function getNewestExistingMtime(paths: string[]): Promise<number> {
  let latest = 0

  for (const candidate of paths) {
    try {
      const fileStats = await stat(candidate)
      latest = Math.max(latest, fileStats.mtimeMs)
    } catch {
      // Ignore missing files.
    }
  }

  return latest
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function dedupeTypes(rows: CSharpTypeRow[]): CSharpTypeRow[] {
  const seen = new Set<string>()
  const result: CSharpTypeRow[] = []

  for (const row of rows) {
    const key = `${row.fullName}@@${row.filePath}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(row)
  }

  return result
}

function dedupeMembers(rows: CSharpMemberRow[]): CSharpMemberRow[] {
  const seen = new Set<string>()
  const result: CSharpMemberRow[] = []

  for (const row of rows) {
    const key = row.id || `${row.typeFullName}@@${row.memberName}@@${row.signature}@@${row.filePath}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(row)
  }

  return result
}

function dedupeSourceLocalizations(rows: SourceLocalizationRow[]): SourceLocalizationRow[] {
  const seen = new Set<string>()
  const result: SourceLocalizationRow[] = []

  for (const row of rows) {
    const key = `${row.stringId}@@${row.filePath}@@${row.lineNumber}@@${row.columnNumber}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(row)
  }

  return result
}

if (import.meta.main) {
  buildCsharpIndex().catch(error => {
    console.error('Fatal error while building the C# index:', error)
    process.exit(1)
  })
}
