import { stat } from 'node:fs/promises'
import { basename, relative } from 'node:path'
import { availableParallelism } from 'node:os'
import {
  clearDirectory,
  computeFileMd5,
  copyGameXmls,
  directoryHasFiles,
  fileExists,
  decompileDll,
  ensureGameDir,
  ensureIlspyExecutable,
  ensureSetupDirectoriesForGame,
  getDecompileOutputDirForGame,
  loadSetupStateForGame,
  promptForDisclaimerConfirmation,
  resolveDllInputs,
  saveSetupStateForGame,
  splitCliList,
} from '../utils/bannerlord-setup'
import { DEFAULT_GAME_ID, getGamePaths } from '../utils/env'
import { databaseHasColumns, databaseHasTable } from '../utils/db'
import { getGameProfile, listGameProfiles, type DllImportScope, type XmlImportScope } from '../utils/game-profiles'
import { writeRuntimeRevision } from '../utils/runtime-revision'

type CliArgs = {
  game: string
  gameDir?: string
  ilspyCmd?: string
  dlls: string[]
  allDlls: boolean
  dllScope: DllImportScope
  xmlScope: XmlImportScope
  acceptDisclaimer: boolean
  clean: boolean
  skipDecompile: boolean
  skipXml: boolean
  reindex: boolean
  decompileJobs?: number
}

export async function runSetup(args = process.argv.slice(2)): Promise<{ runtimeChanged: boolean }> {
  const cli = parseCliArgs(args)
  process.env.BANNERSAGE_GAME = cli.game
  const profile = getGameProfile(cli.game)
  const gameDir = await ensureGameDir(cli.game, cli.gameDir)
  const gamePaths = getGamePaths(cli.game)

  await ensureSetupDirectoriesForGame(cli.game)
  await promptForDisclaimerConfirmation(cli.acceptDisclaimer)
  const ilspyCmd = cli.skipDecompile ? undefined : await ensureIlspyExecutable(cli.ilspyCmd)
  if (ilspyCmd) {
    console.log(`Using ILSpyCmd: ${ilspyCmd}`)
  }

  const state = await loadSetupStateForGame(cli.game)
  state.gameDir = gameDir
  state.dllScope = cli.dllScope
  state.xmlScope = cli.xmlScope

  if (cli.clean) {
    state.dlls = {}
    state.xmlFiles = {}
    console.log('Cleaning previous output for this game profile...')
    await clearDirectory(gamePaths.assetsPath)
    await ensureSetupDirectoriesForGame(cli.game)
  }

  const dllResolution = cli.skipDecompile
    ? { resolvedPaths: [] as string[], missingInputs: [] as string[] }
    : await resolveDllInputs(cli.game, gameDir, cli.dlls, cli.allDlls, cli.dllScope)
  const { resolvedPaths: resolvedDlls, missingInputs } = dllResolution
  const decompiledDlls: string[] = []
  const skippedDllsByFingerprint: string[] = []
  const skippedDllsByMd5: string[] = []
  const failedDlls: string[] = []
  const decompileJobCount = cli.skipDecompile ? 0 : resolveDecompileJobCount(cli.decompileJobs, resolvedDlls.length)

  const usedExplicitDllSelection = cli.allDlls || cli.dlls.length > 0
  if (missingInputs.length > 0) {
    if (usedExplicitDllSelection) {
      throw new Error(`DLLs not found for profile '${cli.game}': ${missingInputs.join(', ')}`)
    }

    console.warn(`Skipping optional DLLs not found for profile '${cli.game}': ${missingInputs.join(', ')}`)
  }

  if (!cli.skipDecompile) {
    const ilspyCommand = ilspyCmd
    if (!ilspyCommand) {
      throw new Error('ILSpyCmd resolution unexpectedly failed.')
    }

    console.log(`Decompile jobs: ${decompileJobCount}`)
    const decompileResults = await mapWithConcurrency(resolvedDlls, decompileJobCount, async (dllPath, index) => {
      const sourceStats = await stat(dllPath)
      const outputDir = getDecompileOutputDirForGame(cli.game, gameDir, dllPath)
      const cacheKey = relative(gameDir, dllPath).replaceAll('\\', '/')
      const previous = state.dlls[cacheKey]
      const dllName = basename(dllPath)
      const hasReusableOutput = !cli.clean && previous ? await directoryHasFiles(outputDir) : false

      const previousMatchesSource =
        previous?.sourceFile === dllPath &&
        previous?.outputDir === outputDir &&
        previous.size === sourceStats.size &&
        previous.mtimeMs === sourceStats.mtimeMs

      if (previousMatchesSource && hasReusableOutput) {
        return {
          status: 'skipped-fingerprint' as const,
          dllPath,
          dllName,
          cacheKey,
          outputDir,
          size: sourceStats.size,
          mtimeMs: sourceStats.mtimeMs,
        }
      }

      const md5 = await computeFileMd5(dllPath)
      if (
        !cli.clean &&
        previous?.sourceFile === dllPath &&
        previous?.outputDir === outputDir &&
        previous.md5 === md5 &&
        hasReusableOutput
      ) {
        return {
          status: 'skipped-md5' as const,
          dllPath,
          dllName,
          cacheKey,
          outputDir,
          md5,
          size: sourceStats.size,
          mtimeMs: sourceStats.mtimeMs,
        }
      }

      await clearDirectory(outputDir)
      console.log(`[decompile ${index + 1}/${resolvedDlls.length}] ${dllName}`)

      try {
        await decompileDll(ilspyCommand, dllPath, outputDir)
      } catch (error) {
        return {
          status: 'failed' as const,
          dllPath,
          dllName,
          error,
        }
      }

      return {
        status: 'decompiled' as const,
        dllPath,
        dllName,
        md5,
        outputDir,
        cacheKey,
        size: sourceStats.size,
        mtimeMs: sourceStats.mtimeMs,
      }
    })

    for (const result of decompileResults) {
      if (result.status === 'skipped-fingerprint') {
        skippedDllsByFingerprint.push(result.dllName)
        state.dlls[result.cacheKey] = {
          md5: state.dlls[result.cacheKey]?.md5 || '',
          outputDir: result.outputDir,
          sourceFile: result.dllPath,
          size: result.size,
          mtimeMs: result.mtimeMs,
          updatedAt: state.dlls[result.cacheKey]?.updatedAt || new Date().toISOString(),
        }
        continue
      }

      if (result.status === 'skipped-md5') {
        skippedDllsByMd5.push(result.dllName)
        state.dlls[result.cacheKey] = {
          md5: result.md5,
          outputDir: result.outputDir,
          sourceFile: result.dllPath,
          size: result.size,
          mtimeMs: result.mtimeMs,
          updatedAt: state.dlls[result.cacheKey]?.updatedAt || new Date().toISOString(),
        }
        continue
      }

      if (result.status === 'failed') {
        if (cli.allDlls) {
          failedDlls.push(result.dllName)
          console.warn(`Skipping failed DLL during --all-dlls sweep: ${result.dllPath}`)
          console.warn(result.error)
          continue
        }

        throw result.error
      }

      state.dlls[result.cacheKey] = {
        md5: result.md5,
        outputDir: result.outputDir,
        sourceFile: result.dllPath,
        size: result.size,
        mtimeMs: result.mtimeMs,
        updatedAt: new Date().toISOString(),
      }
      decompiledDlls.push(result.dllName)
    }
  }

  let copiedXmlFiles = 0
  let changedXmlFiles = 0
  let removedXmlFiles = 0
  let copiedXmlModules = 0
  let skippedXmlModules = 0
  let xmlChanged = false
  let shouldBuildCsharpIndex = false
  let shouldBuildXmlIndex = false
  let shouldBuildGameplayIndex = false
  if (!cli.skipXml) {
    console.log(`Copying ${cli.xmlScope} XML data into ${gamePaths.defsPath}...`)
    const xmlSummary = await copyGameXmls(cli.game, gameDir, cli.clean, cli.xmlScope, state.xmlFiles)
    copiedXmlFiles = xmlSummary.fileCount
    changedXmlFiles = xmlSummary.copiedFileCount
    removedXmlFiles = xmlSummary.removedFileCount
    copiedXmlModules = xmlSummary.moduleCount
    skippedXmlModules = xmlSummary.skippedModuleCount
    xmlChanged = xmlSummary.changed
    state.xmlFiles = xmlSummary.xmlFilesState
    console.log(
      `XML sync summary: ${xmlSummary.copiedFileCount} changed, ${xmlSummary.skippedUnchangedFileCount} unchanged, ${xmlSummary.removedFileCount} removed.`
    )
  }

  await saveSetupStateForGame(cli.game, state)

  if (cli.reindex) {
    const dbExists = await fileExists(gamePaths.dbPath)
    const hasCsharpIndex =
      dbExists &&
      ['csharp_types', 'csharp_methods', 'csharp_files', 'source_localization_entries'].every(tableName =>
        databaseHasTable(gamePaths.dbPath, tableName)
      )
    const hasXmlIndex =
      dbExists &&
      [
        'xml_index_meta',
        'xml_entities',
        'xml_files',
        'xml_parse_failures',
        'localization_entries',
        'bannerlord_items',
        'bannerlord_troops',
        'bannerlord_heroes',
        'bannerlord_clans',
        'bannerlord_kingdoms',
        'bannerlord_settlements',
        'bannerlord_cultures',
        'bannerlord_skills',
      ].every(tableName =>
        databaseHasTable(gamePaths.dbPath, tableName)
      ) &&
      databaseHasColumns(gamePaths.dbPath, 'xml_files', ['fileSize', 'fileMtimeMs', 'indexedAt']) &&
      databaseHasColumns(gamePaths.dbPath, 'bannerlord_kingdoms', ['policyIdsJson']) &&
      databaseHasColumns(gamePaths.dbPath, 'bannerlord_cultures', ['defaultPolicyIdsJson', 'defaultPolicyCount'])
    const hasGameplayIndex =
      cli.game === 'bannerlord' &&
      dbExists &&
      databaseHasTable(gamePaths.dbPath, 'bannerlord_policies') &&
      databaseHasTable(gamePaths.dbPath, 'bannerlord_perks') &&
      databaseHasColumns(gamePaths.dbPath, 'bannerlord_kingdoms', ['policyIdsJson']) &&
      databaseHasColumns(gamePaths.dbPath, 'bannerlord_cultures', ['defaultPolicyIdsJson', 'defaultPolicyCount'])

    shouldBuildCsharpIndex =
      !cli.skipDecompile && (cli.clean || decompiledDlls.length > 0 || !hasCsharpIndex)
    shouldBuildXmlIndex =
      !cli.skipXml && (cli.clean || xmlChanged || !hasXmlIndex)
    shouldBuildGameplayIndex =
      cli.game === 'bannerlord' && (shouldBuildCsharpIndex || shouldBuildXmlIndex || !hasGameplayIndex)

    if (shouldBuildCsharpIndex || shouldBuildXmlIndex || shouldBuildGameplayIndex) {
      console.log('Rebuilding SQLite indexes...')
    } else {
      console.log('Skipping SQLite rebuild because the indexed inputs are unchanged.')
    }

    if (shouldBuildCsharpIndex) {
      const { buildCsharpIndex } = await import('./index-csharp')
      await buildCsharpIndex(cli.game)
    }

    if (shouldBuildXmlIndex) {
      const { buildXmlIndex } = await import('./index-xml')
      await buildXmlIndex(cli.game)
    }

    if (shouldBuildGameplayIndex) {
      const { buildBannerlordGameplayIndex } = await import('./index-bannerlord-gameplay')
      await buildBannerlordGameplayIndex(cli.game)
    }
  }

  const initializedAt = new Date().toISOString()
  state.initializedAt = initializedAt
  await saveSetupStateForGame(cli.game, state)
  const runtimeChanged =
    cli.clean ||
    decompiledDlls.length > 0 ||
    changedXmlFiles > 0 ||
    removedXmlFiles > 0 ||
    shouldBuildCsharpIndex ||
    shouldBuildXmlIndex ||
    shouldBuildGameplayIndex ||
    !(await fileExists(gamePaths.versionPath))

  if (runtimeChanged) {
    await writeRuntimeRevision(cli.game, initializedAt)
  }

  console.log('\nSetup complete.')
  console.log(`Game profile: ${profile.id} (${profile.displayName})`)
  console.log(`Game directory: ${gameDir}`)
  console.log(`DLLs decompiled: ${decompiledDlls.length}`)
  console.log(`DLLs skipped by size/mtime: ${skippedDllsByFingerprint.length}`)
  console.log(`DLLs skipped by MD5: ${skippedDllsByMd5.length}`)
  console.log(`DLL scope: ${cli.dllScope}`)
  console.log(`XML scope: ${cli.xmlScope}`)
  if (failedDlls.length > 0) {
    console.log(`DLLs skipped after failed decompile: ${failedDlls.length}`)
  }
  console.log(`XML files synchronized: ${copiedXmlFiles}`)
  if (!cli.skipXml) {
    console.log(`XML modules copied: ${copiedXmlModules}`)
    console.log(`XML files changed: ${changedXmlFiles}`)
    if (removedXmlFiles > 0) {
      console.log(`Stale XML outputs removed: ${removedXmlFiles}`)
    }
    if (skippedXmlModules > 0) {
      console.log(`Community XML modules skipped: ${skippedXmlModules}`)
    }
  }
  if (!cli.skipDecompile) {
    console.log(`Decompile layout: ${gamePaths.sourcePath}\\...`)
  }
  if (!cli.skipXml) {
    console.log(`XML layout: ${gamePaths.defsPath}\\...`)
  }
  console.log(`Database: ${gamePaths.dbPath}`)
  console.log(`Runtime revision updated: ${runtimeChanged ? 'true' : 'false'}`)

  return { runtimeChanged }
}

function parseCliArgs(argv: string[]): CliArgs {
  const result: CliArgs = {
    game: DEFAULT_GAME_ID,
    dlls: [],
    allDlls: false,
    dllScope: 'core',
    xmlScope: 'official',
    acceptDisclaimer: false,
    clean: false,
    skipDecompile: false,
    skipXml: false,
    reindex: true,
    decompileJobs: undefined,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--game' && next) {
      result.game = next.trim().toLowerCase()
      i += 1
      continue
    }

    if (arg.startsWith('--game=')) {
      result.game = arg.slice('--game='.length).trim().toLowerCase()
      continue
    }

    if (arg === '--game-dir' && next) {
      result.gameDir = next
      i += 1
      continue
    }

    if (arg.startsWith('--game-dir=')) {
      result.gameDir = arg.slice('--game-dir='.length)
      continue
    }

    if (arg === '--ilspycmd' && next) {
      result.ilspyCmd = next
      i += 1
      continue
    }

    if (arg.startsWith('--ilspycmd=')) {
      result.ilspyCmd = arg.slice('--ilspycmd='.length)
      continue
    }

    if ((arg === '--dll' || arg === '--dlls') && next) {
      result.dlls.push(next)
      i += 1
      continue
    }

    if (arg.startsWith('--dll=')) {
      result.dlls.push(arg.slice('--dll='.length))
      continue
    }

    if (arg.startsWith('--dlls=')) {
      result.dlls.push(arg.slice('--dlls='.length))
      continue
    }

    if (arg === '--all-dlls') {
      result.allDlls = true
      continue
    }

    if (arg === '--dll-scope' && next) {
      result.dllScope = parseScope(next, '--dll-scope')
      i += 1
      continue
    }

    if (arg.startsWith('--dll-scope=')) {
      result.dllScope = parseScope(arg.slice('--dll-scope='.length), '--dll-scope')
      continue
    }

    if (arg === '--xml-scope' && next) {
      result.xmlScope = parseScope(next, '--xml-scope')
      i += 1
      continue
    }

    if (arg.startsWith('--xml-scope=')) {
      result.xmlScope = parseScope(arg.slice('--xml-scope='.length), '--xml-scope')
      continue
    }

    if (arg === '--accept-disclaimer') {
      result.acceptDisclaimer = true
      continue
    }

    if (arg === '--clean') {
      result.clean = true
      continue
    }

    if (arg === '--skip-decompile') {
      result.skipDecompile = true
      continue
    }

    if (arg === '--skip-xml') {
      result.skipXml = true
      continue
    }

    if (arg === '--decompile-jobs' && next) {
      result.decompileJobs = parsePositiveInteger(next, '--decompile-jobs')
      i += 1
      continue
    }

    if (arg.startsWith('--decompile-jobs=')) {
      result.decompileJobs = parsePositiveInteger(arg.slice('--decompile-jobs='.length), '--decompile-jobs')
      continue
    }

    if (arg === '--no-index') {
      result.reindex = false
      continue
    }

    if (arg === '--help' || arg === '-h') {
      printHelpAndExit()
    }

    if (!arg.startsWith('--') && !result.gameDir) {
      result.gameDir = arg
    }
  }

  result.dlls = splitCliList(result.dlls)
  return result
}

function printHelpAndExit(): never {
  const profiles = listGameProfiles()
  console.log(`
Usage:
  bun run setup -- --game bannerlord --game-dir "<BANNERLORD_GAME_DIR>"

Options:
  --game <id>                Game profile to initialize. Default: ${DEFAULT_GAME_ID}
  --game-dir <path>          Override auto-detected game directory.
  --ilspycmd <exe>           ILSpyCmd executable or command name on PATH.
  --dll <name>               Restrict decompilation to one or more DLLs.
  --dlls "a.dll,b.dll"       Comma-separated DLL list.
  --all-dlls                 Decompile every DLL candidate discovered by the active profile.
  --dll-scope <core|modding|official|all>
                             Choose the DLL tier: curated core, modding-useful, full official, or everything.
  --xml-scope <official|all> Import only official XML modules by default, or include community mods.
  --accept-disclaimer        Non-interactive confirmation of the disclaimer.
  --clean                    Remove previous copied/decompiled outputs before setup.
  --skip-decompile           Only refresh XML and indexes.
  --skip-xml                 Only refresh decompiled source and indexes.
  --decompile-jobs <count>   Parallel ILSpy decompile workers. Default: auto (1 on single-core, otherwise 2).
  --no-index                 Skip SQLite rebuild after copying assets.

Available profiles:
${profiles.map(profile => `  - ${profile.id}: ${profile.displayName}`).join('\n')}

Output layout:
  dist/games/<game>/assets/Source/<mirrored-dll-path>/<DllName>/...
  dist/games/<game>/assets/Xmls/<mirrored-source-path>/...
`)
  process.exit(0)
}

if (import.meta.main) {
  runSetup().catch(error => {
    console.error(formatCliError('Setup failed', error))
    process.exit(1)
  })
}

function parseScope(value: string, flagName: string): DllImportScope | XmlImportScope {
  const normalized = value.trim().toLowerCase()
  if (flagName === '--dll-scope') {
    if (
      normalized === 'core' ||
      normalized === 'modding' ||
      normalized === 'official' ||
      normalized === 'all'
    ) {
      return normalized
    }
  } else if (normalized === 'official' || normalized === 'all') {
    return normalized
  }

  if (flagName === '--dll-scope') {
    throw new Error(`Unsupported ${flagName} '${value}'. Use 'core', 'modding', 'official', or 'all'.`)
  }

  throw new Error(`Unsupported ${flagName} '${value}'. Use 'official' or 'all'.`)
}

function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Unsupported ${flagName} '${value}'. Use a positive integer.`)
  }

  return parsed
}

function resolveDecompileJobCount(requestedJobs: number | undefined, dllCount: number): number {
  if (dllCount <= 1) {
    return 1
  }

  if (requestedJobs) {
    return Math.min(requestedJobs, dllCount)
  }

  const cpuCount = Math.max(1, availableParallelism())
  return Math.min(cpuCount, dllCount, cpuCount > 1 ? 2 : 1)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex
      if (currentIndex >= items.length) {
        return
      }

      nextIndex += 1
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}

function formatCliError(prefix: string, error: unknown): string {
  if (isSqliteBusyError(error)) {
    return `${prefix}: SQLite database is locked. Stop any running BannerlordSage MCP server or other processes using the local database, then try again.`
  }

  return `${prefix}: ${error instanceof Error ? error.stack || error.message : String(error)}`
}

function isSqliteBusyError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /SQLITE_BUSY|database is locked/i.test(text)
}
