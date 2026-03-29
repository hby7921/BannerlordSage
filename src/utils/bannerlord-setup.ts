import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { activeGameId, distPath, getGamePaths, root } from './env'
import { getGameProfile, type DllImportScope, type XmlImportScope } from './game-profiles'

export const EULA_DISCLAIMER = [
  'BannerlordSage Setup Disclaimer',
  '',
  'This tool only automates indexing of game data from a lawfully owned copy of',
  'a supported game for personal learning, research, and modding.',
  'It does not ship or redistribute third-party game assets.',
  '',
  'By continuing you confirm that:',
  '1. You own a legitimate copy of the game.',
  '2. You will comply with the game EULA and local law.',
  '3. You understand the extracted data stays on your local machine.',
].join('\n')

export type SetupState = {
  version: 2
  initializedAt?: string
  gameDir?: string
  dllScope?: DllImportScope
  xmlScope?: XmlImportScope
  dlls: Record<
    string,
    {
      md5: string
      sourceFile: string
      outputDir: string
      size?: number
      mtimeMs?: number
      updatedAt: string
    }
  >
  xmlFiles: Record<
    string,
    {
      sourceFile: string
      size: number
      mtimeMs: number
      updatedAt: string
    }
  >
}

export type XmlCopySummary = {
  xmlScope: XmlImportScope
  fileCount: number
  copiedFileCount: number
  skippedUnchangedFileCount: number
  removedFileCount: number
  moduleCount: number
  modules: string[]
  skippedModuleCount: number
  skippedModules: string[]
  changed: boolean
  xmlFilesState: SetupState['xmlFiles']
}

export async function ensureSetupDirectoriesForGame(gameId: string): Promise<void> {
  const paths = getGamePaths(gameId)
  await mkdir(distPath, { recursive: true })
  await mkdir(paths.gameDistPath, { recursive: true })
  await mkdir(paths.reportsPath, { recursive: true })
  await mkdir(paths.sourcePath, { recursive: true })
  await mkdir(paths.defsPath, { recursive: true })
}

export async function ensureSetupDirectories(): Promise<void> {
  await ensureSetupDirectoriesForGame(activeGameId)
}

export async function promptForDisclaimerConfirmation(acceptedViaFlag: boolean): Promise<void> {
  if (
    acceptedViaFlag ||
    process.env.BANNERSAGE_EULA_ACCEPTED === 'true' ||
    process.env.BANNERLORD_EULA_ACCEPTED === 'true'
  ) {
    console.log(EULA_DISCLAIMER)
    console.log('\nDisclaimer accepted via flag or environment variable.\n')
    return
  }

  console.log(EULA_DISCLAIMER)
  const rl = createInterface({ input, output })
  try {
    const answer = (await rl.question('\nType "y" to continue: ')).trim().toLowerCase()
    if (answer !== 'y') {
      throw new Error('Setup aborted because the ownership confirmation was not accepted.')
    }
  } finally {
    rl.close()
  }
}

export async function loadSetupStateForGame(gameId: string): Promise<SetupState> {
  const paths = getGamePaths(gameId)

  try {
    const raw = await readFile(paths.setupStatePath, 'utf8')
    const parsed = JSON.parse(raw) as SetupState
    return {
      version: 2,
      dlls: {},
      xmlFiles: {},
      ...parsed,
    }
  } catch {
    return {
      version: 2,
      dlls: {},
      xmlFiles: {},
    }
  }
}

export async function loadSetupState(): Promise<SetupState> {
  return loadSetupStateForGame(activeGameId)
}

export async function saveSetupStateForGame(gameId: string, state: SetupState): Promise<void> {
  const paths = getGamePaths(gameId)
  await ensureSetupDirectoriesForGame(gameId)
  await writeFile(paths.setupStatePath, JSON.stringify(state, null, 2), 'utf8')
}

export async function saveSetupState(state: SetupState): Promise<void> {
  await saveSetupStateForGame(activeGameId, state)
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function ensureGameDir(gameId: string, candidate?: string): Promise<string> {
  const profile = getGameProfile(gameId)
  const detected =
    candidate ||
    getConfiguredGameDir(gameId) ||
    (await profile.detectGameDir())

  if (!detected) {
    throw new Error(
      [
        `Could not detect the installation directory for game profile '${gameId}'.`,
        'Pass --game-dir "<path-to-game-root>"',
        `or set ${getPrimaryGameDirEnvName(gameId)} before running bun run setup.`,
      ].join('\n')
    )
  }

  const normalized = resolve(detected)
  if (!(await profile.looksLikeGameDir(normalized))) {
    throw new Error(`Invalid ${profile.displayName} game directory: ${normalized}`)
  }

  return normalized
}

export async function ensureBannerlordGameDir(candidate?: string): Promise<string> {
  return ensureGameDir('bannerlord', candidate)
}

export async function computeFileMd5(path: string): Promise<string> {
  const buffer = await readFile(path)
  return createHash('md5').update(buffer).digest('hex')
}

export function getIlspyExecutable(provided?: string): string {
  return (
    provided ||
    process.env.BANNERSAGE_ILSPYCMD_EXE ||
    process.env.BANNERLORD_ILSPYCMD_EXE ||
    'ilspycmd'
  )
}

export async function ensureIlspyExecutable(provided?: string): Promise<string> {
  const preferred = getIlspyExecutable(provided)
  for (const candidate of getIlspyCommandCandidates(preferred)) {
    if (await canExecuteIlspy(candidate)) {
      return candidate
    }
  }

  console.warn([
    'ILSpyCmd was not found.',
    'BannerlordSage can install it for you with: dotnet tool install --global ilspycmd',
  ].join('\n'))

  if (process.stdin.isTTY && process.stdout.isTTY) {
    const rl = createInterface({ input, output })
    try {
      const answer = (
        await rl.question('\nInstall ilspycmd globally now? [y/N]: ')
      ).trim().toLowerCase()

      if (answer === 'y' || answer === 'yes') {
        await installIlspyCmd()
        for (const candidate of getIlspyCommandCandidates(preferred)) {
          if (await canExecuteIlspy(candidate)) {
            return candidate
          }
        }
      }
    } finally {
      rl.close()
    }
  }

  throw new Error(
    [
      'ILSpyCmd is required for DLL decompilation but could not be found.',
      'Install it with: dotnet tool install --global ilspycmd',
      'Or pass --ilspycmd <path-to-ilspycmd> to bun run setup.',
    ].join('\n')
  )
}

export async function resolveDllInputs(
  gameId: string,
  gameDir: string,
  dllInputs?: string[],
  allDlls = false,
  dllScope: DllImportScope = 'core'
): Promise<{ resolvedPaths: string[]; missingInputs: string[] }> {
  const profile = getGameProfile(gameId)
  const candidateDlls = await profile.collectDllCandidates(gameDir, { dllScope })

  if (allDlls) {
    return {
      resolvedPaths: [...new Set(candidateDlls.map(item => resolve(item)))],
      missingInputs: [],
    }
  }

  if ((!dllInputs || dllInputs.length === 0) && dllScope !== 'core') {
    return {
      resolvedPaths: [...new Set(candidateDlls.map(item => resolve(item)))],
      missingInputs: [],
    }
  }

  const basenameMap = new Map<string, string[]>()
  for (const dllPath of candidateDlls) {
    const key = basename(dllPath).toLowerCase()
    const list = basenameMap.get(key) ?? []
    list.push(dllPath)
    basenameMap.set(key, list)
  }

  const requested = dllInputs && dllInputs.length > 0 ? dllInputs : profile.defaultDlls
  const resolvedPaths: string[] = []
  const missingInputs: string[] = []

  for (const item of requested) {
    const trimmed = item.trim()
    if (!trimmed) continue

    if (isAbsolute(trimmed)) {
      if (await fileExists(trimmed)) {
        resolvedPaths.push(resolve(trimmed))
      } else {
        missingInputs.push(trimmed)
      }
      continue
    }

    const explicitRelative = resolve(gameDir, trimmed)
    if ((trimmed.includes('/') || trimmed.includes('\\')) && (await fileExists(explicitRelative))) {
      resolvedPaths.push(explicitRelative)
      continue
    }

    const matches = basenameMap.get(basename(trimmed).toLowerCase()) ?? []
    if (matches.length === 0) {
      missingInputs.push(trimmed)
      continue
    }

    const sortedMatches = [...matches].sort((left, right) => {
      const scoreDelta = profile.scoreDllPath(right) - profile.scoreDllPath(left)
      return scoreDelta !== 0 ? scoreDelta : left.localeCompare(right)
    })

    if (sortedMatches.length > 1) {
      console.warn(
        [
          `Multiple DLL candidates matched '${trimmed}'. Using the highest-ranked path:`,
          `- chosen: ${toWorkspaceRelative(sortedMatches[0])}`,
          ...sortedMatches.slice(1, 5).map(item => `- alt: ${toWorkspaceRelative(item)}`),
        ].join('\n')
      )
    }

    resolvedPaths.push(resolve(sortedMatches[0]))
  }

  return {
    resolvedPaths: [...new Set(resolvedPaths)],
    missingInputs,
  }
}

export function getDecompileOutputDirForGame(gameId: string, gameDir: string, dllPath: string): string {
  const profile = getGameProfile(gameId)
  const paths = getGamePaths(gameId)
  return join(paths.sourcePath, ...profile.getDecompileOutputSegments(gameDir, dllPath))
}

export async function clearDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
  await mkdir(path, { recursive: true })
}

export async function decompileDll(ilspyCmd: string, dllPath: string, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  const proc = Bun.spawn([ilspyCmd, '-p', '-o', outputDir, dllPath], {
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
        `ILSpyCmd failed for ${dllPath}.`,
        stderrText.trim(),
        stdoutText.trim(),
        `Executable: ${ilspyCmd}`,
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
}

export async function collectXmlFiles(
  gameId: string,
  gameDir: string,
  xmlScope: XmlImportScope = 'official'
) {
  return getGameProfile(gameId).collectXmlFiles(gameDir, { xmlScope })
}

export async function copyGameXmls(
  gameId: string,
  gameDir: string,
  clean: boolean,
  xmlScope: XmlImportScope = 'official',
  previousXmlFiles: SetupState['xmlFiles'] = {}
): Promise<XmlCopySummary> {
  const profile = getGameProfile(gameId)
  const paths = getGamePaths(gameId)

  if (clean) {
    await clearDirectory(paths.defsPath)
  } else {
    await mkdir(paths.defsPath, { recursive: true })
  }

  let copied = 0
  let skippedUnchanged = 0
  let removed = 0
  const ensuredDirectories = new Set<string>()
  const modules = new Set<string>()
  const xmlCollection = await profile.collectXmlFiles(gameDir, { xmlScope })
  const nextXmlFiles: SetupState['xmlFiles'] = {}
  const targetRelativePaths = new Set<string>()

  for (const sourceFile of xmlCollection.files) {
    const relativePath = profile.getXmlRelativeOutputPath(gameDir, sourceFile).replaceAll('\\', '/')
    const destination = join(paths.defsPath, relativePath)
    const sourceStats = await stat(sourceFile)
    const previous = previousXmlFiles[relativePath]
    const hasUnchangedCopy =
      !clean &&
      previous &&
      previous.sourceFile === sourceFile &&
      previous.size === sourceStats.size &&
      previous.mtimeMs === sourceStats.mtimeMs &&
      (await fileExists(destination))

    if (hasUnchangedCopy) {
      skippedUnchanged += 1
    } else {
      const destinationDir = dirname(destination)
      if (!ensuredDirectories.has(destinationDir)) {
        await mkdir(destinationDir, { recursive: true })
        ensuredDirectories.add(destinationDir)
      }

      await copyFile(sourceFile, destination)
      copied += 1
    }

    targetRelativePaths.add(relativePath)
    nextXmlFiles[relativePath] = {
      sourceFile,
      size: sourceStats.size,
      mtimeMs: sourceStats.mtimeMs,
      updatedAt: new Date().toISOString(),
    }

    const logicalModuleName = getLogicalModuleName(relativePath)
    if (logicalModuleName) {
      modules.add(logicalModuleName)
    }
  }

  if (!clean) {
    const previousOutputPaths = Object.keys(previousXmlFiles)
    if (previousOutputPaths.length > 0) {
      for (const relativeOutputPath of previousOutputPaths) {
        if (targetRelativePaths.has(relativeOutputPath)) continue

        await rm(join(paths.defsPath, relativeOutputPath), { force: true })
        removed += 1
      }
    } else {
      for await (const existingFile of walkFiles(paths.defsPath)) {
        if (!existingFile.toLowerCase().endsWith('.xml')) continue
        const relativeOutputPath = relative(paths.defsPath, existingFile).replaceAll('\\', '/')
        if (targetRelativePaths.has(relativeOutputPath)) continue

        await rm(existingFile, { force: true })
        removed += 1
      }
    }
  }

  return {
    xmlScope,
    fileCount: xmlCollection.files.length,
    copiedFileCount: copied,
    skippedUnchangedFileCount: skippedUnchanged,
    removedFileCount: removed,
    moduleCount: modules.size,
    modules: [...modules].sort(),
    skippedModuleCount: xmlCollection.skippedModules.length,
    skippedModules: xmlCollection.skippedModules.map(item => item.moduleName),
    changed: clean || copied > 0 || removed > 0,
    xmlFilesState: nextXmlFiles,
  }
}

export async function copyBannerlordXmls(gameDir: string, clean: boolean): Promise<XmlCopySummary> {
  return copyGameXmls('bannerlord', gameDir, clean, 'official')
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath)
    } else if (entry.isFile()) {
      yield fullPath
    }
  }
}

export function splitCliList(values: string[]): string[] {
  return values
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean)
}

export async function countFilesInDirectory(dir: string): Promise<number> {
  if (!(await fileExists(dir))) {
    return 0
  }

  let count = 0
  for await (const _ of walkFiles(dir)) {
    count += 1
  }
  return count
}

export async function directoryHasFiles(dir: string): Promise<boolean> {
  if (!(await fileExists(dir))) {
    return false
  }

  for await (const _ of walkFiles(dir)) {
    return true
  }

  return false
}

export function toWorkspaceRelative(path: string): string {
  return relative(root, path).replaceAll('\\', '/')
}

function getConfiguredGameDir(gameId: string): string | undefined {
  const upperGameId = gameId.trim().replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()
  return (
    process.env[`BANNERSAGE_${upperGameId}_GAME_DIR`] ||
    process.env.BANNERSAGE_GAME_DIR ||
    (gameId === 'bannerlord' ? process.env.BANNERLORD_GAME_DIR : undefined)
  )
}

function getPrimaryGameDirEnvName(gameId: string): string {
  const upperGameId = gameId.trim().replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()
  return `BANNERSAGE_${upperGameId}_GAME_DIR`
}

function getLogicalModuleName(relativePath: string): string | undefined {
  const normalized = relativePath.replaceAll('\\', '/')
  const parts = normalized.split('/').filter(Boolean)

  if (parts[0]?.toLowerCase() === 'modules' && parts[1]) {
    return parts[1]
  }

  return parts[0]
}

function getIlspyCommandCandidates(preferred: string): string[] {
  const candidates = [
    preferred,
    'ilspycmd',
    join(homedir(), '.dotnet', 'tools', 'ilspycmd.exe'),
    join(homedir(), '.dotnet', 'tools', 'ilspycmd'),
  ]

  return [...new Set(candidates.map(candidate => candidate.trim()).filter(Boolean))]
}

async function canExecuteIlspy(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([command, '--help'], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
    const exitCode = await proc.exited
    return exitCode === 0
  } catch {
    return false
  }
}

async function installIlspyCmd(): Promise<void> {
  console.log('\nInstalling ilspycmd with dotnet tool install --global ilspycmd ...')
  const proc = Bun.spawn(['dotnet', 'tool', 'install', '--global', 'ilspycmd'], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(
      [
        'Automatic ilspycmd installation failed.',
        'Please run: dotnet tool install --global ilspycmd',
      ].join('\n')
    )
  }
}
