import { AiTextBlock, renderAiTextReport } from '../utils/ai-text'
import {
  buildRecommendedLoadOrder,
  collectDoctorIssues,
  computeDoctorFocusModules,
  loadBannerlordModules,
  resolveBannerlordDoctorGameDir,
} from '../utils/bannerlord-module-tooling'

export async function bannerlordDoctor(
  gameDir?: string,
  moduleId?: string,
  modulePath?: string,
  includeOfficialDetails = false
) {
  const resolvedGameDir = await resolveBannerlordDoctorGameDir(gameDir)
  const modules = await loadBannerlordModules(resolvedGameDir)
  if (modules.length === 0) {
    return {
      content: [{ type: 'text' as const, text: `No Bannerlord modules with SubModule.xml were found under: ${resolvedGameDir}` }],
    }
  }

  const focusedModules = computeDoctorFocusModules(modules, moduleId, modulePath)
  if (focusedModules.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `No Bannerlord module matched moduleId='${moduleId || ''}' modulePath='${modulePath || ''}'.`,
        },
      ],
    }
  }

  const loadOrder = buildRecommendedLoadOrder(modules)
  const allIssues = await collectDoctorIssues(modules)
  const focusedIds = new Set(focusedModules.map(moduleInfo => moduleInfo.moduleId))
  const issues = allIssues.filter(
    issue =>
      !issue.moduleId ||
      focusedIds.has(issue.moduleId) ||
      (issue.relatedModuleId != null && focusedIds.has(issue.relatedModuleId))
  )

  const blocks: AiTextBlock[] = [
    {
      header: 'doctor_summary',
      fields: [
        { key: 'game_dir', value: resolvedGameDir },
        { key: 'modules_scanned', value: modules.length },
        { key: 'focused_modules', value: focusedModules.length },
        { key: 'non_official_modules_scanned', value: modules.filter(moduleInfo => !moduleInfo.isOfficial).length },
        { key: 'issue_count', value: issues.length },
        { key: 'cycle_detected', value: loadOrder.cycleDetected },
      ],
      listFields: [
        { key: 'focused_module_ids', values: focusedModules.map(moduleInfo => moduleInfo.moduleId) },
        { key: 'recommended_load_order', values: loadOrder.orderedModuleIds },
        { key: 'unresolved_cycle_module_ids', values: loadOrder.unresolvedModuleIds },
      ],
    },
  ]

  for (const moduleInfo of focusedModules) {
    if (!includeOfficialDetails && moduleInfo.isOfficial && focusedModules.length > 1) {
      continue
    }

    blocks.push({
      header: `module_${moduleInfo.moduleId}`,
      fields: [
        { key: 'module_id', value: moduleInfo.moduleId },
        { key: 'module_name', value: moduleInfo.moduleName },
        { key: 'version', value: moduleInfo.version },
        { key: 'module_type', value: moduleInfo.moduleType },
        { key: 'module_category', value: moduleInfo.moduleCategory },
        { key: 'is_official', value: moduleInfo.isOfficial },
        { key: 'submodule_xml_path', value: moduleInfo.subModulePath },
        { key: 'module_dir', value: moduleInfo.moduleDir },
        { key: 'submodule_count', value: moduleInfo.subModules.length },
        { key: 'dll_count', value: moduleInfo.dllFiles.length },
      ],
      listFields: [
        { key: 'declared_dependencies', values: moduleInfo.dependencies },
        { key: 'load_after_targets', values: moduleInfo.loadAfter },
        { key: 'incompatible_modules', values: moduleInfo.incompatible },
        {
          key: 'dependency_metadata',
          values: moduleInfo.dependencyMetadata.map(
            item =>
              `${item.moduleId}:${item.order || 'unknown'}${item.optional ? ':optional' : ''}${item.version ? `:${item.version}` : ''}`
          ),
        },
        {
          key: 'declared_submodule_dlls',
          values: moduleInfo.subModules
            .map(subModule => subModule.dllName)
            .filter((value): value is string => Boolean(value)),
        },
        {
          key: 'shared_dependency_dlls',
          values: moduleInfo.dllFiles
            .filter(dll => isSharedDependencyDll(dll.fileName))
            .map(dll => `${dll.fileName} (${dll.relativePath})`),
        },
      ],
    })
  }

  if (loadOrder.cycleDetected) {
    blocks.push({
      header: 'load_order_cycle',
      fields: [
        { key: 'severity', value: 'error' },
        { key: 'issue_type', value: 'load_order_cycle_detected' },
      ],
      listFields: [{ key: 'unresolved_module_ids', values: loadOrder.unresolvedModuleIds }],
      multilineFields: [
        {
          key: 'detail',
          value:
            'The module graph contains a cycle. At least one dependency or load-after rule conflicts with another declared ordering rule.',
        },
      ],
    })
  }

  for (const issue of issues) {
    blocks.push({
      header: `${issue.severity}_${issue.issueType}`,
      fields: [
        { key: 'severity', value: issue.severity },
        { key: 'issue_type', value: issue.issueType },
        { key: 'module_id', value: issue.moduleId },
        { key: 'related_module_id', value: issue.relatedModuleId },
        { key: 'file_path', value: issue.filePath },
        { key: 'dll_name', value: issue.dllName },
      ],
      multilineFields: [{ key: 'detail', value: issue.detail }],
    })
  }

  const report = renderAiTextReport(
    'bannerlord_doctor',
    'doctor_target',
    moduleId || modulePath || 'auto_non_official_modules',
    blocks
  )

  return { content: [{ type: 'text' as const, text: report }] }
}

function isSharedDependencyDll(fileName: string): boolean {
  const normalized = fileName.toLowerCase()
  return (
    normalized === '0harmony.dll' ||
    normalized === 'bannerlord.blse.shared.dll' ||
    normalized === 'bannerlord.butterlib.dll' ||
    normalized === 'bannerlord.mboptionscreen.dll' ||
    normalized === 'bannerlord.moduleloader.bannerlord.mboptionscreen.dll' ||
    normalized === 'bannerlord.uiextenderex.dll'
  )
}
