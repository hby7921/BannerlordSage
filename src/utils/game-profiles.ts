import { basename, dirname, join, relative, resolve } from 'node:path'
import { readFile, readdir, stat } from 'node:fs/promises'

export type XmlImportScope = 'official' | 'all'
export type DllImportScope = 'core' | 'modding' | 'official' | 'all'

export type XmlCollectionOptions = {
  xmlScope?: XmlImportScope
}

export type DllCollectionOptions = {
  dllScope?: DllImportScope
}

export type XmlModuleClassification = {
  moduleName: string
  moduleId: string
  moduleType: string | null
  officialFlag: boolean | null
  metadataSuggestsOfficial: boolean
  isOfficial: boolean
  reason: string
  moduleDir: string
}

export type XmlCollectionResult = {
  files: string[]
  includedModules: XmlModuleClassification[]
  skippedModules: XmlModuleClassification[]
}

export type GameProfile = {
  id: string
  displayName: string
  kind: 'csharp-local-assets'
  requiresSource: boolean
  requiresXml: boolean
  requiresDb: boolean
  defaultDlls: string[]
  detectGameDir: () => Promise<string | undefined>
  looksLikeGameDir: (gameDir: string) => Promise<boolean>
  collectDllCandidates: (gameDir: string, options?: DllCollectionOptions) => Promise<string[]>
  collectXmlFiles: (gameDir: string, options?: XmlCollectionOptions) => Promise<XmlCollectionResult>
  getXmlRelativeOutputPath: (gameDir: string, sourceFile: string) => string
  getDecompileOutputSegments: (gameDir: string, dllPath: string) => string[]
  scoreDllPath: (dllPath: string) => number
}

const BANNERLORD_STEAM_APP_ID = '261550'
const BANNERLORD_STEAM_DIR_NAMES = [
  'Mount & Blade II Bannerlord',
  'Mount & Blade II Bannerlord - Beta',
]
const BANNERLORD_OFFICIAL_MODULE_IDS = new Set([
  'Native',
  'SandBoxCore',
  'Sandbox',
  'SandBox',
  'StoryMode',
  'CustomBattle',
  'BirthAndDeath',
  'FastMode',
  'Multiplayer',
  'NavalDLC',
])
const BANNERLORD_ROOT_BIN_DLL_PREFIXES = [
  'TaleWorlds.',
  'SandBox',
  'StoryMode',
  'CustomBattle',
  'NavalDLC',
]
const BANNERLORD_MODDING_SUPPORT_DLLS = new Set([
  'Newtonsoft.Json.dll',
  'Steamworks.NET.dll',
  'StbSharp.dll',
  'System.Management.dll',
  'System.Numerics.Vectors.dll',
].map(name => name.toLowerCase()))
const BANNERLORD_MODDING_ROOT_BIN_EXCLUDES = [
  /^taleworlds\.diamond\.accessprovider\./,
  /^taleworlds\.mountandblade\.launcher\./,
  /^taleworlds\.platformservice(\.|\.dll$)/,
  /^taleworlds\.servicediscovery\.client\.dll$/,
  /^taleworlds\.starter\.library\.dll$/,
  /\.test\.dll$/,
]
const BANNERLORD_ROOT_BIN_DLL_DENYLIST = new Set([
  'Bannerlord.BLSE.Shared.dll',
  'TaleWorlds.Native.dll',
].map(name => name.toLowerCase()))
const BANNERLORD_CORE_DLL_INPUTS = [
  'TaleWorlds.CampaignSystem.dll',
  'TaleWorlds.Core.dll',
  'TaleWorlds.Engine.dll',
  'TaleWorlds.GauntletUI.dll',
  'TaleWorlds.GauntletUI.Data.dll',
  'TaleWorlds.Library.dll',
  'TaleWorlds.Localization.dll',
  'TaleWorlds.MountAndBlade.dll',
  'TaleWorlds.ObjectSystem.dll',
  'TaleWorlds.ScreenSystem.dll',
  'Modules/SandBox/bin/Win64_Shipping_Client/SandBox.dll',
  'Modules/StoryMode/bin/Win64_Shipping_Client/StoryMode.dll',
  'Modules/CustomBattle/bin/Win64_Shipping_Client/TaleWorlds.MountAndBlade.CustomBattle.dll',
  'Modules/Multiplayer/bin/Win64_Shipping_Client/TaleWorlds.MountAndBlade.Multiplayer.dll',
  'Modules/NavalDLC/bin/Win64_Shipping_Client/NavalDLC.dll',
  'Modules/Native/bin/Win64_Shipping_Client/TaleWorlds.MountAndBlade.View.dll',
]

const bannerlordProfile: GameProfile = {
  id: 'bannerlord',
  displayName: 'Mount & Blade II: Bannerlord',
  kind: 'csharp-local-assets',
  requiresSource: true,
  requiresXml: true,
  requiresDb: true,
  defaultDlls: BANNERLORD_CORE_DLL_INPUTS,
  detectGameDir: detectBannerlordGameDir,
  looksLikeGameDir: async (gameDir: string) => {
    return (
      (await pathExists(join(gameDir, 'Modules'))) &&
      (await pathExists(join(gameDir, 'bin')))
    )
  },
  collectDllCandidates: async (gameDir: string, options?: DllCollectionOptions) => {
    const dllScope = options?.dllScope ?? 'official'
    const modulesDir = join(gameDir, 'Modules')
    const moduleClassifications = (await pathExists(modulesDir))
      ? await classifyBannerlordModules(modulesDir)
      : []
    const officialModuleNames = new Set(
      moduleClassifications.filter(moduleInfo => moduleInfo.isOfficial).map(moduleInfo => moduleInfo.moduleName.toLowerCase())
    )
    const allCandidates: string[] = []
    const officialCandidates: string[] = []
    const moddingCandidates: string[] = []

    for await (const filePath of walkFiles(gameDir)) {
      if (!filePath.toLowerCase().endsWith('.dll')) continue

      const normalized = filePath.replaceAll('\\', '/').toLowerCase()
      if (!normalized.includes('/bin/')) continue
      const resolvedPath = resolve(filePath)
      allCandidates.push(resolvedPath)

      const moduleName = tryGetBannerlordModuleName(gameDir, filePath)
      if (moduleName) {
        if (!officialModuleNames.has(moduleName.toLowerCase())) {
          continue
        }

        officialCandidates.push(resolvedPath)
        moddingCandidates.push(resolvedPath)
        continue
      }

      if (!isBannerlordRootBinDll(gameDir, filePath)) {
        continue
      }

      if (!isBannerlordOfficialRootBinDll(filePath)) {
        continue
      }

      officialCandidates.push(resolvedPath)
      if (isBannerlordModdingRootBinDll(filePath)) {
        moddingCandidates.push(resolvedPath)
      }
    }

    if (dllScope === 'all') {
      return sortBannerlordDllCandidates(allCandidates)
    }

    if (dllScope === 'official') {
      return sortBannerlordDllCandidates(officialCandidates)
    }

    if (dllScope === 'modding') {
      return sortBannerlordDllCandidates(moddingCandidates)
    }

    return selectBannerlordDllCandidates(
      gameDir,
      sortBannerlordDllCandidates(officialCandidates),
      BANNERLORD_CORE_DLL_INPUTS
    )
  },
  collectXmlFiles: async (gameDir: string, options?: XmlCollectionOptions) => {
    const modulesDir = join(gameDir, 'Modules')

    if (!(await pathExists(modulesDir))) {
      return {
        files: [],
        includedModules: [],
        skippedModules: [],
      }
    }

    const xmlScope = options?.xmlScope ?? 'official'
    const moduleClassifications = await classifyBannerlordModules(modulesDir)
    const includedModules =
      xmlScope === 'all'
        ? moduleClassifications
        : moduleClassifications.filter(moduleInfo => moduleInfo.isOfficial)
    const skippedModules =
      xmlScope === 'all'
        ? []
        : moduleClassifications.filter(moduleInfo => !moduleInfo.isOfficial)

    const files: string[] = []
    for (const moduleInfo of includedModules) {
      for await (const filePath of walkFiles(moduleInfo.moduleDir)) {
        if (filePath.toLowerCase().endsWith('.xml')) {
          files.push(filePath)
        }
      }
    }

    return {
      files,
      includedModules,
      skippedModules,
    }
  },
  getXmlRelativeOutputPath: (gameDir: string, sourceFile: string) => {
    return relative(gameDir, sourceFile).replaceAll('\\', '/')
  },
  getDecompileOutputSegments: (gameDir: string, dllPath: string) => {
    const relativeDir = dirname(relative(gameDir, dllPath)).replaceAll('\\', '/')
    const dllStem = basename(dllPath, '.dll')
    return relativeDir ? [...relativeDir.split('/'), dllStem] : [dllStem]
  },
  scoreDllPath: (dllPath: string) => {
    const normalized = dllPath.replaceAll('\\', '/').toLowerCase()

    if (normalized.includes('/bin/win64_shipping_client/')) {
      return normalized.includes('/modules/') ? 80 : 100
    }

    if (normalized.includes('/bin/')) {
      return normalized.includes('/modules/') ? 60 : 70
    }

    return 10
  },
}

const gameProfiles = new Map<string, GameProfile>([
  [bannerlordProfile.id, bannerlordProfile],
])

export function listGameProfiles(): GameProfile[] {
  return [...gameProfiles.values()]
}

export function getGameProfile(gameId: string): GameProfile {
  const profile = gameProfiles.get(gameId.trim().toLowerCase())
  if (!profile) {
    throw new Error(
      `Unknown game profile '${gameId}'. Available profiles: ${listGameProfiles()
        .map(item => item.id)
        .join(', ')}`
    )
  }

  return profile
}

async function detectBannerlordGameDir(): Promise<string | undefined> {
  const candidates = new Set<string>()
  const steamRoots = new Set<string>()
  const programFilesX86 = process.env['ProgramFiles(x86)']
  const programFiles = process.env.ProgramFiles

  for (const base of [programFilesX86, programFiles].filter(Boolean) as string[]) {
    steamRoots.add(join(base, 'Steam'))
    candidates.add(join(base, 'SteamLibrary', 'steamapps', 'common', 'Mount & Blade II Bannerlord'))
    candidates.add(join(base, 'Epic Games', 'MountAndBladeIIBannerlord'))
  }

  for (const driveRoot of await getWindowsDriveRoots()) {
    steamRoots.add(join(driveRoot, 'Steam'))
    candidates.add(join(driveRoot, 'SteamLibrary', 'steamapps', 'common', 'Mount & Blade II Bannerlord'))
    candidates.add(join(driveRoot, 'Games', 'SteamLibrary', 'steamapps', 'common', 'Mount & Blade II Bannerlord'))
    candidates.add(join(driveRoot, 'Epic Games', 'MountAndBladeIIBannerlord'))
  }

  for (const registryPath of await detectSteamInstallDirectoriesFromRegistry()) {
    steamRoots.add(registryPath)
  }

  for (const steamRoot of steamRoots) {
    for (const libraryDir of await collectSteamLibraryDirectories(steamRoot)) {
      const detected = await resolveBannerlordFromSteamLibrary(libraryDir)
      if (detected) {
        return detected
      }
    }
  }

  for (const candidate of candidates) {
    if (await bannerlordProfile.looksLikeGameDir(candidate)) {
      return candidate
    }
  }

  return undefined
}

async function detectSteamInstallDirectoriesFromRegistry(): Promise<string[]> {
  const results = new Set<string>()
  const queries = [
    ['reg', 'query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
    ['reg', 'query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamExe'],
    ['reg', 'query', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', '/v', 'InstallPath'],
    ['reg', 'query', 'HKLM\\SOFTWARE\\Valve\\Steam', '/v', 'InstallPath'],
  ]

  for (const command of queries) {
    const output = await runCommandCapture(command)
    if (!output) continue

    const value = parseRegistryPath(output)
    if (!value) continue

    const steamRoot = value.toLowerCase().endsWith('.exe') ? dirname(value) : value
    results.add(resolve(steamRoot))
  }

  return [...results]
}

async function collectSteamLibraryDirectories(steamRoot: string): Promise<string[]> {
  const normalizedRoot = resolve(steamRoot)
  const results = new Set<string>([normalizedRoot])
  const libraryFoldersPath = join(normalizedRoot, 'steamapps', 'libraryfolders.vdf')

  if (!(await pathExists(libraryFoldersPath))) {
    return [...results]
  }

  try {
    const raw = await readFile(libraryFoldersPath, 'utf8')
    for (const libraryDir of parseSteamLibraryFolders(raw)) {
      results.add(resolve(libraryDir))
    }
  } catch (error) {
    console.warn(`Failed to parse Steam library folders from ${libraryFoldersPath}:`, error)
  }

  return [...results]
}

function parseSteamLibraryFolders(raw: string): string[] {
  const results = new Set<string>()

  for (const match of raw.matchAll(/"path"\s+"([^"]+)"/g)) {
    results.add(unescapeVdfPath(match[1]))
  }

  for (const match of raw.matchAll(/^\s*"\d+"\s+"([A-Za-z]:\\\\[^"]+)"\s*$/gm)) {
    results.add(unescapeVdfPath(match[1]))
  }

  return [...results]
}

function unescapeVdfPath(value: string): string {
  return value.replaceAll('\\\\', '\\')
}

async function resolveBannerlordFromSteamLibrary(libraryDir: string): Promise<string | undefined> {
  const manifestPath = join(libraryDir, 'steamapps', `appmanifest_${BANNERLORD_STEAM_APP_ID}.acf`)
  if (await pathExists(manifestPath)) {
    try {
      const raw = await readFile(manifestPath, 'utf8')
      const installDir = parseValveKeyValue(raw, 'installdir')
      if (installDir) {
        const manifestCandidate = join(libraryDir, 'steamapps', 'common', installDir)
        if (await bannerlordProfile.looksLikeGameDir(manifestCandidate)) {
          return manifestCandidate
        }
      }
    } catch (error) {
      console.warn(`Failed to inspect Steam app manifest ${manifestPath}:`, error)
    }
  }

  for (const dirName of BANNERLORD_STEAM_DIR_NAMES) {
    const candidate = join(libraryDir, 'steamapps', 'common', dirName)
    if (await bannerlordProfile.looksLikeGameDir(candidate)) {
      return candidate
    }
  }

  return undefined
}

function parseValveKeyValue(raw: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = raw.match(new RegExp(`"${escapedKey}"\\s+"([^"]+)"`, 'i'))
  return match?.[1]
}

function parseRegistryPath(raw: string): string | undefined {
  for (const line of raw.split(/\r?\n/)) {
    if (!/REG_(SZ|EXPAND_SZ)/i.test(line)) continue

    const parts = line.trim().split(/\s{2,}/)
    const value = parts.at(-1)?.trim()
    if (value) {
      return value
    }
  }

  return undefined
}

async function runCommandCapture(command: string[]): Promise<string | undefined> {
  try {
    const proc = Bun.spawn(command, {
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const [stdoutText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ])

    if (exitCode !== 0) {
      return undefined
    }

    return stdoutText
  } catch {
    return undefined
  }
}

async function getWindowsDriveRoots(): Promise<string[]> {
  const roots: string[] = []

  for (let code = 67; code <= 90; code += 1) {
    const driveRoot = `${String.fromCharCode(code)}:\\`
    if (await pathExists(driveRoot)) {
      roots.push(driveRoot)
    }
  }

  return roots
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function classifyBannerlordModules(modulesDir: string): Promise<XmlModuleClassification[]> {
  const results: XmlModuleClassification[] = []
  const entries = await readdir(modulesDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const moduleDir = join(modulesDir, entry.name)
    const subModulePath = join(moduleDir, 'SubModule.xml')
    const raw = (await pathExists(subModulePath)) ? await readFile(subModulePath, 'utf8') : ''
    const moduleId = getXmlValue(raw, 'Id') || entry.name
    const moduleType = getXmlValue(raw, 'ModuleType')
    const officialFlagRaw = getXmlValue(raw, 'Official')
    const officialFlag =
      officialFlagRaw == null ? null : officialFlagRaw.trim().toLowerCase() === 'true'
    const normalizedModuleType = moduleType?.trim().toLowerCase() ?? null

    const isOfficialByType =
      normalizedModuleType === 'official' || normalizedModuleType === 'officialoptional'
    const isOfficialByFlag = officialFlag === true
    const isOfficialByAllowlist =
      BANNERLORD_OFFICIAL_MODULE_IDS.has(entry.name) || BANNERLORD_OFFICIAL_MODULE_IDS.has(moduleId)
    const metadataSuggestsOfficial = isOfficialByType || isOfficialByFlag

    let reason = 'community-or-unknown'
    if (isOfficialByAllowlist) {
      reason = 'official-allowlist'
    } else if (isOfficialByType) {
      reason = `metadata-only:${moduleType}`
    } else if (isOfficialByFlag) {
      reason = 'metadata-only:official-flag:true'
    }

    results.push({
      moduleName: entry.name,
      moduleId,
      moduleType,
      officialFlag,
      metadataSuggestsOfficial,
      isOfficial: isOfficialByAllowlist,
      reason,
      moduleDir,
    })
  }

  return results.sort((left, right) => left.moduleName.localeCompare(right.moduleName))
}

function tryGetBannerlordModuleName(gameDir: string, filePath: string): string | null {
  const normalized = relative(gameDir, filePath).replaceAll('\\', '/')
  const parts = normalized.split('/').filter(Boolean)

  if (parts[0]?.toLowerCase() !== 'modules') {
    return null
  }

  return parts[1] || null
}

function isBannerlordRootBinDll(gameDir: string, filePath: string): boolean {
  const normalized = relative(gameDir, filePath).replaceAll('\\', '/').toLowerCase()
  return normalized.startsWith('bin/')
}

function isBannerlordOfficialRootBinDll(filePath: string): boolean {
  const fileName = basename(filePath).toLowerCase()
  if (BANNERLORD_ROOT_BIN_DLL_DENYLIST.has(fileName)) {
    return false
  }

  return BANNERLORD_ROOT_BIN_DLL_PREFIXES.some(prefix =>
    fileName.startsWith(prefix.toLowerCase())
  )
}

function isBannerlordModdingRootBinDll(filePath: string): boolean {
  const fileName = basename(filePath).toLowerCase()
  if (BANNERLORD_MODDING_SUPPORT_DLLS.has(fileName)) {
    return true
  }

  if (!isBannerlordOfficialRootBinDll(filePath)) {
    return false
  }

  return !BANNERLORD_MODDING_ROOT_BIN_EXCLUDES.some(pattern => pattern.test(fileName))
}

function sortBannerlordDllCandidates(candidateDlls: string[]): string[] {
  return [...new Set(candidateDlls.map(item => resolve(item)))].sort((left, right) => {
    const scoreDelta = bannerlordProfile.scoreDllPath(right) - bannerlordProfile.scoreDllPath(left)
    return scoreDelta !== 0 ? scoreDelta : left.localeCompare(right)
  })
}

function selectBannerlordDllCandidates(
  gameDir: string,
  candidateDlls: string[],
  requested: string[]
): string[] {
  const relativeMap = new Map<string, string>()
  const basenameMap = new Map<string, string[]>()

  for (const dllPath of candidateDlls) {
    const relativePath = relative(gameDir, dllPath).replaceAll('\\', '/').toLowerCase()
    relativeMap.set(relativePath, dllPath)

    const key = basename(dllPath).toLowerCase()
    const matches = basenameMap.get(key) ?? []
    matches.push(dllPath)
    basenameMap.set(key, matches)
  }

  const resolvedPaths: string[] = []
  for (const item of requested) {
    const trimmed = item.trim()
    if (!trimmed) continue

    const normalizedRelative = trimmed.replaceAll('\\', '/').replace(/^\.\/+/, '').toLowerCase()
    if (normalizedRelative.includes('/') && relativeMap.has(normalizedRelative)) {
      resolvedPaths.push(relativeMap.get(normalizedRelative)!)
      continue
    }

    const matches = basenameMap.get(basename(trimmed).toLowerCase()) ?? []
    if (matches.length > 0) {
      resolvedPaths.push(sortBannerlordDllCandidates(matches)[0])
    }
  }

  return sortBannerlordDllCandidates(resolvedPaths)
}

function getXmlValue(raw: string, tagName: string): string | null {
  if (!raw) return null

  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = raw.match(new RegExp(`<${escapedTagName}\\b[^>]*\\bvalue\\s*=\\s*["']([^"']+)["']`, 'i'))
  return match?.[1] ?? null
}
