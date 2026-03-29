import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { computeFileMd5, ensureGameDir, loadSetupStateForGame } from './bannerlord-setup'
import { parser } from './xml-utils'

export type BannerlordModuleRefMetadata = {
  moduleId: string
  order: string | null
  optional: boolean
  version: string | null
}

export type BannerlordSubModuleInfo = {
  name: string | null
  dllName: string | null
  classType: string | null
  assemblies: string[]
  tags: string[]
}

export type BannerlordModuleDllInfo = {
  fileName: string
  relativePath: string
  md5: string | null
}

export type BannerlordModuleInfo = {
  moduleId: string
  moduleName: string
  version: string | null
  moduleType: string | null
  moduleCategory: string | null
  officialFlag: boolean | null
  defaultModule: boolean | null
  isOfficial: boolean
  moduleDir: string
  subModulePath: string
  dependencies: string[]
  loadAfter: string[]
  incompatible: string[]
  dependencyMetadata: BannerlordModuleRefMetadata[]
  subModules: BannerlordSubModuleInfo[]
  dllFiles: BannerlordModuleDllInfo[]
}

export type BannerlordDoctorIssue = {
  severity: 'error' | 'warning' | 'info'
  issueType: string
  moduleId: string | null
  relatedModuleId: string | null
  filePath: string | null
  dllName: string | null
  detail: string
}

const OFFICIAL_MODULE_IDS = new Set([
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

const SHARED_DEPENDENCY_DLL_TO_MODULE = new Map<string, string>([
  ['0harmony.dll', 'Bannerlord.Harmony'],
  ['bannerlord.blse.shared.dll', 'Bannerlord.BLSE'],
  ['bannerlord.butterlib.dll', 'Bannerlord.ButterLib'],
  ['bannerlord.moduleloader.bannerlord.mboptionscreen.dll', 'Bannerlord.MBOptionScreen'],
  ['bannerlord.mboptionscreen.dll', 'Bannerlord.MBOptionScreen'],
  ['bannerlord.uiextenderex.dll', 'Bannerlord.UIExtenderEx'],
])

export async function resolveBannerlordDoctorGameDir(gameDir?: string): Promise<string> {
  if (gameDir?.trim()) {
    return await ensureGameDir('bannerlord', gameDir)
  }

  const state = await loadSetupStateForGame('bannerlord')
  if (state.gameDir?.trim()) {
    return await ensureGameDir('bannerlord', state.gameDir)
  }

  return await ensureGameDir('bannerlord')
}

export async function loadBannerlordModules(gameDir: string): Promise<BannerlordModuleInfo[]> {
  const modulesDir = join(gameDir, 'Modules')
  const entries = await readdir(modulesDir, { withFileTypes: true })
  const modules: BannerlordModuleInfo[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const moduleDir = join(modulesDir, entry.name)
    const subModulePath = join(moduleDir, 'SubModule.xml')
    if (!(await pathExists(subModulePath))) {
      continue
    }

    modules.push(await loadBannerlordModule(moduleDir, subModulePath))
  }

  return modules.sort((left, right) => {
    const officialDelta = Number(right.isOfficial) - Number(left.isOfficial)
    return officialDelta !== 0 ? officialDelta : left.moduleId.localeCompare(right.moduleId)
  })
}

export function computeDoctorFocusModules(
  modules: BannerlordModuleInfo[],
  moduleId?: string,
  modulePath?: string
): BannerlordModuleInfo[] {
  if (modulePath?.trim()) {
    const resolvedPath = resolve(modulePath)
    return modules.filter(moduleInfo => resolve(moduleInfo.moduleDir) === resolvedPath)
  }

  if (moduleId?.trim()) {
    return modules.filter(moduleInfo => moduleInfo.moduleId === moduleId.trim())
  }

  const nonOfficial = modules.filter(moduleInfo => !moduleInfo.isOfficial)
  return nonOfficial.length > 0 ? nonOfficial : modules
}

export function buildRecommendedLoadOrder(
  modules: BannerlordModuleInfo[]
): {
  orderedModuleIds: string[]
  cycleDetected: boolean
  unresolvedModuleIds: string[]
} {
  const moduleIds = modules.map(moduleInfo => moduleInfo.moduleId)
  const moduleSet = new Set(moduleIds)
  const indegree = new Map<string, number>()
  const outgoing = new Map<string, Set<string>>()

  for (const moduleId of moduleIds) {
    indegree.set(moduleId, 0)
    outgoing.set(moduleId, new Set<string>())
  }

  for (const moduleInfo of modules) {
    const edges = collectModuleEdges(moduleInfo, moduleSet)
    for (const [from, to] of edges) {
      const fromSet = outgoing.get(from)
      if (!fromSet || fromSet.has(to)) continue

      fromSet.add(to)
      indegree.set(to, (indegree.get(to) ?? 0) + 1)
    }
  }

  const queue = moduleIds
    .filter(moduleId => (indegree.get(moduleId) ?? 0) === 0)
    .sort((left, right) => compareModuleOrder(modules, left, right))

  const ordered: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    ordered.push(current)

    const next = [...(outgoing.get(current) ?? [])]
    for (const target of next) {
      const remaining = (indegree.get(target) ?? 0) - 1
      indegree.set(target, remaining)
      if (remaining === 0) {
        queue.push(target)
      }
    }

    queue.sort((left, right) => compareModuleOrder(modules, left, right))
  }

  const unresolvedModuleIds = moduleIds.filter(moduleId => !ordered.includes(moduleId))
  return {
    orderedModuleIds: ordered,
    cycleDetected: unresolvedModuleIds.length > 0,
    unresolvedModuleIds,
  }
}

export async function collectDoctorIssues(
  modules: BannerlordModuleInfo[]
): Promise<BannerlordDoctorIssue[]> {
  const issues: BannerlordDoctorIssue[] = []
  const modulesById = new Map<string, BannerlordModuleInfo[]>()

  for (const moduleInfo of modules) {
    const list = modulesById.get(moduleInfo.moduleId) ?? []
    list.push(moduleInfo)
    modulesById.set(moduleInfo.moduleId, list)
  }

  for (const [moduleId, duplicates] of modulesById) {
    if (duplicates.length > 1) {
      for (const duplicate of duplicates) {
        issues.push({
          severity: 'error',
          issueType: 'duplicate_module_id',
          moduleId,
          relatedModuleId: null,
          filePath: duplicate.subModulePath,
          dllName: null,
          detail: `Multiple modules declare the same module id '${moduleId}'. Bannerlord load order and dependency resolution will be ambiguous.`,
        })
      }
    }
  }

  for (const moduleInfo of modules) {
    for (const dependencyId of moduleInfo.dependencies) {
      if (!modulesById.has(dependencyId)) {
        issues.push({
          severity: 'error',
          issueType: 'missing_dependency',
          moduleId: moduleInfo.moduleId,
          relatedModuleId: dependencyId,
          filePath: moduleInfo.subModulePath,
          dllName: null,
          detail: `Declared dependency '${dependencyId}' was not found under the Bannerlord Modules directory.`,
        })
      }
    }

    for (const metadata of moduleInfo.dependencyMetadata) {
      if (!modulesById.has(metadata.moduleId) && !metadata.optional) {
        issues.push({
          severity: 'warning',
          issueType: 'missing_dependency_metadata_target',
          moduleId: moduleInfo.moduleId,
          relatedModuleId: metadata.moduleId,
          filePath: moduleInfo.subModulePath,
          dllName: null,
          detail: `Community dependency metadata references '${metadata.moduleId}', but no installed module with that id was found.`,
        })
      }
    }

    for (const incompatibleId of moduleInfo.incompatible) {
      if (modulesById.has(incompatibleId)) {
        issues.push({
          severity: 'warning',
          issueType: 'incompatible_module_present',
          moduleId: moduleInfo.moduleId,
          relatedModuleId: incompatibleId,
          filePath: moduleInfo.subModulePath,
          dllName: null,
          detail: `Module '${moduleInfo.moduleId}' marks '${incompatibleId}' as incompatible, but that module is installed.`,
        })
      }
    }

    for (const subModule of moduleInfo.subModules) {
      if (!subModule.dllName) {
        issues.push({
          severity: 'error',
          issueType: 'missing_submodule_dll_name',
          moduleId: moduleInfo.moduleId,
          relatedModuleId: null,
          filePath: moduleInfo.subModulePath,
          dllName: null,
          detail: `A SubModule entry in '${moduleInfo.moduleId}' does not declare DLLName.`,
        })
        continue
      }

      if (!subModule.classType) {
        issues.push({
          severity: 'error',
          issueType: 'missing_submodule_class_type',
          moduleId: moduleInfo.moduleId,
          relatedModuleId: null,
          filePath: moduleInfo.subModulePath,
          dllName: subModule.dllName,
          detail: `SubModule '${subModule.dllName}' does not declare SubModuleClassType.`,
        })
      }

      const hasDll = moduleInfo.dllFiles.some(dll => dll.fileName.toLowerCase() === subModule.dllName!.toLowerCase())
      if (!hasDll) {
        issues.push({
          severity: 'warning',
          issueType: 'missing_declared_submodule_dll',
          moduleId: moduleInfo.moduleId,
          relatedModuleId: null,
          filePath: moduleInfo.subModulePath,
          dllName: subModule.dllName,
          detail: `SubModule '${subModule.dllName}' is declared in SubModule.xml but no matching DLL was found under the module bin directories.`,
        })
      }
    }

    if (!moduleInfo.isOfficial) {
      for (const dll of moduleInfo.dllFiles) {
        if (dll.fileName.startsWith('TaleWorlds.')) {
          issues.push({
            severity: 'warning',
            issueType: 'ships_official_taleworlds_dll',
            moduleId: moduleInfo.moduleId,
            relatedModuleId: null,
            filePath: join(moduleInfo.moduleDir, dll.relativePath),
            dllName: dll.fileName,
            detail: `Module '${moduleInfo.moduleId}' ships '${dll.fileName}'. Bundling TaleWorlds assemblies inside a community module often causes version drift and hard-to-debug crashes.`,
          })
        }
      }
    }
  }

  const sharedDllGroups = new Map<string, Array<{ moduleId: string; filePath: string; md5: string | null }>>()
  for (const moduleInfo of modules.filter(moduleInfo => !moduleInfo.isOfficial)) {
    for (const dll of moduleInfo.dllFiles) {
      const canonicalModuleId = SHARED_DEPENDENCY_DLL_TO_MODULE.get(dll.fileName.toLowerCase())
      if (!canonicalModuleId) continue

      const list = sharedDllGroups.get(dll.fileName.toLowerCase()) ?? []
      list.push({
        moduleId: moduleInfo.moduleId,
        filePath: join(moduleInfo.moduleDir, dll.relativePath),
        md5: dll.md5,
      })
      sharedDllGroups.set(dll.fileName.toLowerCase(), list)

      if (moduleInfo.moduleId !== canonicalModuleId) {
        issues.push({
          severity: 'warning',
          issueType: 'bundled_shared_dependency',
          moduleId: moduleInfo.moduleId,
          relatedModuleId: canonicalModuleId,
          filePath: join(moduleInfo.moduleDir, dll.relativePath),
          dllName: dll.fileName,
          detail: `Module '${moduleInfo.moduleId}' bundles shared dependency '${dll.fileName}'. Prefer declaring '${canonicalModuleId}' as a dependency instead of shipping a private copy.`,
        })
      }
    }
  }

  for (const [dllName, entries] of sharedDllGroups) {
    const uniqueHashes = new Set(entries.map(entry => entry.md5 || `${entry.moduleId}:${entry.filePath}`))
    if (entries.length > 1 && uniqueHashes.size > 1) {
      const canonicalModuleId = SHARED_DEPENDENCY_DLL_TO_MODULE.get(dllName) ?? 'unknown'
      for (const entry of entries) {
        issues.push({
          severity: 'error',
          issueType: 'conflicting_shared_dependency_variants',
          moduleId: entry.moduleId,
          relatedModuleId: canonicalModuleId,
          filePath: entry.filePath,
          dllName: dllName,
          detail: `Multiple modules ship different variants of '${dllName}'. This usually produces loader conflicts or runtime patch instability.`,
        })
      }
    }
  }

  return issues
}

async function loadBannerlordModule(moduleDir: string, subModulePath: string): Promise<BannerlordModuleInfo> {
  const raw = await readFile(subModulePath, 'utf8')
  const parsed = parser.parse(raw) as any
  const moduleNode = parsed?.Module ?? parsed

  const moduleId = getNodeValue(moduleNode?.Id) || basename(moduleDir)
  const moduleName = getNodeValue(moduleNode?.Name) || moduleId
  const moduleType = getNodeValue(moduleNode?.ModuleType)
  const moduleCategory = getNodeValue(moduleNode?.ModuleCategory)
  const officialFlag = parseBoolean(getNodeValue(moduleNode?.Official))
  const defaultModule = parseBoolean(getNodeValue(moduleNode?.DefaultModule))
  const dependencies = collectModuleIds(moduleNode?.DependedModules)
  const loadAfter = collectModuleIds(moduleNode?.ModulesToLoadAfterThis)
  const incompatible = collectModuleIds(moduleNode?.IncompatibleModules)
  const dependencyMetadata = collectDependencyMetadata(moduleNode?.DependedModuleMetadatas)
  const subModules = collectSubModules(moduleNode?.SubModules)
  const dllFiles = await scanModuleDlls(moduleDir)

  return {
    moduleId,
    moduleName,
    version: getNodeValue(moduleNode?.Version),
    moduleType,
    moduleCategory,
    officialFlag,
    defaultModule,
    isOfficial: officialFlag === true || moduleType?.toLowerCase() === 'official' || OFFICIAL_MODULE_IDS.has(moduleId),
    moduleDir,
    subModulePath,
    dependencies,
    loadAfter,
    incompatible,
    dependencyMetadata,
    subModules,
    dllFiles,
  }
}

function collectSubModules(subModulesNode: any): BannerlordSubModuleInfo[] {
  return asArray(subModulesNode?.SubModule).map((subModuleNode: any) => ({
    name: getNodeValue(subModuleNode?.Name),
    dllName: getNodeValue(subModuleNode?.DLLName),
    classType: getNodeValue(subModuleNode?.SubModuleClassType),
    assemblies: asArray(subModuleNode?.Assemblies?.Assembly)
      .map((assemblyNode: any) => getNodeValue(assemblyNode))
      .filter((value: string | null): value is string => Boolean(value)),
    tags: asArray(subModuleNode?.Tags?.Tag)
      .map((tagNode: any) => {
        const key = getAttributeValue(tagNode, 'key')
        const value = getAttributeValue(tagNode, 'value')
        return [key, value].filter(Boolean).join('=')
      })
      .filter(Boolean),
  }))
}

function collectDependencyMetadata(metadataNode: any): BannerlordModuleRefMetadata[] {
  return asArray(metadataNode?.DependedModuleMetadata)
    .map((entry: any) => {
      const moduleId = getAttributeValue(entry, 'id') || getAttributeValue(entry, 'Id')
      if (!moduleId) return null
      return {
        moduleId,
        order: getAttributeValue(entry, 'order') || null,
        optional: parseBoolean(getAttributeValue(entry, 'optional')) === true,
        version: getAttributeValue(entry, 'version') || null,
      }
    })
    .filter((value: BannerlordModuleRefMetadata | null): value is BannerlordModuleRefMetadata => Boolean(value))
}

function collectModuleIds(container: any): string[] {
  if (!container || typeof container !== 'object') return []

  const ids = new Set<string>()
  for (const value of Object.values(container)) {
    for (const entry of asArray(value)) {
      const id = getAttributeValue(entry, 'Id') || getAttributeValue(entry, 'id') || getNodeValue(entry)
      if (id) {
        ids.add(id)
      }
    }
  }

  return [...ids]
}

function collectModuleEdges(moduleInfo: BannerlordModuleInfo, moduleSet: Set<string>): Array<[string, string]> {
  const edges: Array<[string, string]> = []

  for (const dependencyId of moduleInfo.dependencies) {
    if (moduleSet.has(dependencyId)) {
      edges.push([dependencyId, moduleInfo.moduleId])
    }
  }

  for (const dependencyInfo of moduleInfo.dependencyMetadata) {
    if (!moduleSet.has(dependencyInfo.moduleId)) continue
    if (dependencyInfo.order === 'LoadBeforeThis') {
      edges.push([dependencyInfo.moduleId, moduleInfo.moduleId])
    }
  }

  for (const targetId of moduleInfo.loadAfter) {
    if (moduleSet.has(targetId)) {
      edges.push([moduleInfo.moduleId, targetId])
    }
  }

  for (const dependencyInfo of moduleInfo.dependencyMetadata) {
    if (!moduleSet.has(dependencyInfo.moduleId)) continue
    if (dependencyInfo.order === 'LoadAfterThis') {
      edges.push([moduleInfo.moduleId, dependencyInfo.moduleId])
    }
  }

  return edges
}

function compareModuleOrder(modules: BannerlordModuleInfo[], leftId: string, rightId: string): number {
  const left = modules.find(moduleInfo => moduleInfo.moduleId === leftId)
  const right = modules.find(moduleInfo => moduleInfo.moduleId === rightId)
  if (!left || !right) {
    return leftId.localeCompare(rightId)
  }

  const officialDelta = Number(right.isOfficial) - Number(left.isOfficial)
  if (officialDelta !== 0) return officialDelta

  return left.moduleId.localeCompare(right.moduleId)
}

async function scanModuleDlls(moduleDir: string): Promise<BannerlordModuleDllInfo[]> {
  const binDir = join(moduleDir, 'bin')
  if (!(await pathExists(binDir))) {
    return []
  }

  const dlls: BannerlordModuleDllInfo[] = []
  for await (const filePath of walkFiles(binDir)) {
    if (!filePath.toLowerCase().endsWith('.dll')) continue

    const fileName = basename(filePath)
    const lowerName = fileName.toLowerCase()
    dlls.push({
      fileName,
      relativePath: relative(moduleDir, filePath).replaceAll('\\', '/'),
      md5: SHARED_DEPENDENCY_DLL_TO_MODULE.has(lowerName) ? await computeFileMd5(filePath) : null,
    })
  }

  return dlls.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function getNodeValue(node: any): string | null {
  if (typeof node === 'string') {
    const trimmed = node.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (!node || typeof node !== 'object') {
    return null
  }

  for (const key of ['@_value', '@_Value', '@_Path', '@_path', '@_Id', '@_id']) {
    const value = node[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function getAttributeValue(node: any, attributeName: string): string | null {
  if (!node || typeof node !== 'object') return null
  const value = node[`@_${attributeName}`]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseBoolean(value: string | null): boolean | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return null
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
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
