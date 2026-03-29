import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { type AiTextBlock, renderAiTextReport } from '../utils/ai-text'
import {
  loadBannerlordModules,
  resolveBannerlordDoctorGameDir,
  type BannerlordModuleInfo,
} from '../utils/bannerlord-module-tooling'

type CreateModWorkspaceOptions = {
  workspaceRoot: string
  moduleId: string
  moduleName?: string
  namespace?: string
  authors?: string
  version?: string
  url?: string
  updateInfo?: string
  gameDir?: string
  includeCampaignBehavior?: boolean
  includeHarmonyExample?: boolean
  includeButterLib?: boolean
  includeUiExtenderEx?: boolean
  includeMcm?: boolean
}

type ModuleDependency = {
  moduleId: string
  version: string | null
}

type ProjectReference = {
  include: string
  hintPath: string
}

type FeatureFlags = {
  campaignBehavior: boolean
  harmonyExample: boolean
  butterLib: boolean
  uiExtenderEx: boolean
  mcm: boolean
}

const GAME_REFERENCE_FILE_NAMES = [
  'TaleWorlds.Core.dll',
  'TaleWorlds.Library.dll',
  'TaleWorlds.Localization.dll',
  'TaleWorlds.ObjectSystem.dll',
  'TaleWorlds.MountAndBlade.dll',
]

const CAMPAIGN_REFERENCE_FILE_NAMES = ['TaleWorlds.CampaignSystem.dll']

const COMMUNITY_MODULE_IDS = {
  harmony: 'Bannerlord.Harmony',
  butterLib: 'Bannerlord.ButterLib',
  uiExtenderEx: 'Bannerlord.UIExtenderEx',
  mcm: 'Bannerlord.MBOptionScreen',
} as const

export async function createModWorkspace(options: CreateModWorkspaceOptions) {
  const resolvedGameDir = await resolveBannerlordDoctorGameDir(options.gameDir)
  const modules = await loadBannerlordModules(resolvedGameDir)
  const modulesById = new Map(modules.map(moduleInfo => [moduleInfo.moduleId, moduleInfo]))

  const normalizedModuleId = options.moduleId.trim()
  const moduleName = options.moduleName?.trim() || humanizeModuleId(normalizedModuleId)
  const namespaceName = options.namespace?.trim() || buildDefaultNamespace(normalizedModuleId)
  const authors = options.authors?.trim() || 'Unknown'
  const moduleVersion = normalizeSubModuleVersion(options.version)
  const projectVersion = normalizeProjectVersion(moduleVersion)
  const includeCampaignBehavior = options.includeCampaignBehavior ?? true
  const moduleRoot = resolve(options.workspaceRoot, normalizedModuleId)
  const srcRoot = join(moduleRoot, 'src')
  const projectPath = join(srcRoot, `${normalizedModuleId}.csproj`)
  const languageRoot = join(moduleRoot, 'ModuleData', 'Languages')
  const behaviorClassName = `${namespaceName.split('.').at(-1) || 'Bannerlord'}CampaignBehavior`
  const featureFlags: FeatureFlags = {
    campaignBehavior: includeCampaignBehavior,
    harmonyExample: false,
    butterLib: false,
    uiExtenderEx: false,
    mcm: false,
  }

  await ensureDirectoryIsWritable(moduleRoot)

  const warnings: string[] = []
  const officialDependencies = resolveOfficialDependencies(modulesById, includeCampaignBehavior, warnings)
  const communityDependencies: ModuleDependency[] = []
  const projectReferences: ProjectReference[] = []

  const addProjectReference = (filePath: string) => {
    projectReferences.push({
      include: stripDllExtension(filePath.split(/[\\/]/).at(-1) || filePath),
      hintPath: toMsBuildPath(srcRoot, filePath),
    })
  }

  for (const fileName of GAME_REFERENCE_FILE_NAMES) {
    addProjectReference(join(resolvedGameDir, 'bin', 'Win64_Shipping_Client', fileName))
  }

  const needMcm = options.includeMcm ?? false
  const needButterLib = (options.includeButterLib ?? false) || needMcm
  const needUiExtenderEx = (options.includeUiExtenderEx ?? false) || needMcm
  const needHarmony = (options.includeHarmonyExample ?? false) || needButterLib || needUiExtenderEx || needMcm

  if (includeCampaignBehavior || (options.includeHarmonyExample ?? false)) {
    for (const fileName of CAMPAIGN_REFERENCE_FILE_NAMES) {
      addProjectReference(join(resolvedGameDir, 'bin', 'Win64_Shipping_Client', fileName))
    }
  }

  const harmonyModule = needHarmony
    ? requireInstalledModule(modulesById, COMMUNITY_MODULE_IDS.harmony, 'Harmony support', warnings)
    : null
  const butterLibModule =
    needButterLib && harmonyModule
      ? requireInstalledModule(modulesById, COMMUNITY_MODULE_IDS.butterLib, 'ButterLib support', warnings)
      : null
  const uiExtenderExModule =
    needUiExtenderEx && harmonyModule
      ? requireInstalledModule(modulesById, COMMUNITY_MODULE_IDS.uiExtenderEx, 'UIExtenderEx support', warnings)
      : null
  const mcmModule =
    needMcm && harmonyModule && butterLibModule && uiExtenderExModule
      ? requireInstalledModule(modulesById, COMMUNITY_MODULE_IDS.mcm, 'MCM support', warnings)
      : null

  if ((options.includeHarmonyExample ?? false) && harmonyModule) {
    featureFlags.harmonyExample = true
  } else if (options.includeHarmonyExample ?? false) {
    warnings.push('Harmony example was requested but Bannerlord.Harmony is not installed. The patch scaffold was skipped.')
  }

  if ((options.includeButterLib ?? false) && butterLibModule && harmonyModule) {
    featureFlags.butterLib = true
  } else if (options.includeButterLib ?? false) {
    warnings.push('ButterLib support was requested but required local modules were not available. ButterLib wiring was skipped.')
  }

  if ((options.includeUiExtenderEx ?? false) && uiExtenderExModule && harmonyModule) {
    featureFlags.uiExtenderEx = true
  } else if (options.includeUiExtenderEx ?? false) {
    warnings.push(
      'UIExtenderEx support was requested but required local modules were not available. UIExtenderEx wiring was skipped.'
    )
  }

  if (needMcm && mcmModule && harmonyModule && butterLibModule && uiExtenderExModule) {
    featureFlags.mcm = true
    featureFlags.butterLib = true
    featureFlags.uiExtenderEx = true
  } else if (needMcm) {
    warnings.push(
      'MCM support was requested but Bannerlord.MBOptionScreen, Bannerlord.ButterLib, Bannerlord.UIExtenderEx, and Bannerlord.Harmony were not all available. MCM wiring was skipped.'
    )
  }

  if (harmonyModule && (featureFlags.harmonyExample || featureFlags.butterLib || featureFlags.uiExtenderEx || featureFlags.mcm)) {
    communityDependencies.push({
      moduleId: harmonyModule.moduleId,
      version: harmonyModule.version,
    })

    const harmonyDllPath = findModuleDllPath(harmonyModule, ['0Harmony.dll'])
    if (featureFlags.harmonyExample && harmonyDllPath) {
      addProjectReference(harmonyDllPath)
    }
  }

  if (featureFlags.butterLib && butterLibModule) {
    communityDependencies.push({
      moduleId: butterLibModule.moduleId,
      version: butterLibModule.version,
    })

    const butterLibDllPath = findModuleDllPath(butterLibModule, ['Bannerlord.ButterLib.dll'])
    if (butterLibDllPath) {
      addProjectReference(butterLibDllPath)
    }
  }

  if (featureFlags.uiExtenderEx && uiExtenderExModule) {
    communityDependencies.push({
      moduleId: uiExtenderExModule.moduleId,
      version: uiExtenderExModule.version,
    })

    const uiExtenderExDllPath = findModuleDllPath(uiExtenderExModule, ['Bannerlord.UIExtenderEx.dll'])
    if (uiExtenderExDllPath) {
      addProjectReference(uiExtenderExDllPath)
    }
  }

  if (featureFlags.mcm && mcmModule) {
    communityDependencies.push({
      moduleId: mcmModule.moduleId,
      version: mcmModule.version,
    })

    const mcmDllPath = findModuleDllPath(mcmModule, ['MCMv5.dll'])
    if (mcmDllPath) {
      addProjectReference(mcmDllPath)
    } else {
      warnings.push('Bannerlord.MBOptionScreen is installed, but MCMv5.dll was not found in its bin directory.')
    }
  }

  const dedupedReferences = dedupeProjectReferences(projectReferences)
  const dependencyList = dedupeDependencies([...communityDependencies, ...officialDependencies])
  const targetFramework =
    featureFlags.harmonyExample || featureFlags.butterLib || featureFlags.uiExtenderEx || featureFlags.mcm
      ? 'net6.0'
      : 'netstandard2.0'
  const localizationTokens = {
    moduleName: `${sanitizeTokenPrefix(normalizedModuleId)}_module_name`,
    sessionReady: `${sanitizeTokenPrefix(normalizedModuleId)}_session_ready`,
  }

  const generatedFiles = new Map<string, string>([
    [join(moduleRoot, '.gitignore'), buildGitignore()],
    [
      join(moduleRoot, 'README.md'),
      buildWorkspaceReadme({
        moduleId: normalizedModuleId,
        moduleName,
        namespaceName,
        authors,
        projectPath,
        targetFramework,
        featureFlags,
        officialDependencies,
        communityDependencies,
        warnings,
      }),
    ],
    [
      join(moduleRoot, 'SubModule.xml'),
      buildSubModuleXml({
        moduleId: normalizedModuleId,
        moduleName,
        moduleVersion,
        subModuleClassType: `${namespaceName}.SubModule`,
        dllName: `${normalizedModuleId}.dll`,
        dependencies: dependencyList,
        url: options.url?.trim(),
        updateInfo: options.updateInfo?.trim(),
        includeCampaignTags: includeCampaignBehavior,
      }),
    ],
    [
      join(languageRoot, 'language_data.xml'),
      buildLanguageDataXml(),
    ],
    [
      join(languageRoot, 'std_module_strings_xml.xml'),
      buildModuleStringsXml({
        moduleNameTokenId: localizationTokens.moduleName,
        moduleName,
        sessionReadyTokenId: localizationTokens.sessionReady,
        sessionReadyText: `${moduleName} campaign behavior is active.`,
      }),
    ],
    [
      projectPath,
      buildCsproj({
        moduleId: normalizedModuleId,
        namespaceName,
        moduleName,
        authors,
        projectVersion,
        targetFramework,
        references: dedupedReferences,
      }),
    ],
    [
      join(srcRoot, 'SubModule.cs'),
      buildSubModuleClass({
        namespaceName,
        moduleId: normalizedModuleId,
        includeCampaignBehavior,
        includeHarmonyExample: featureFlags.harmonyExample,
        behaviorClassName,
      }),
    ],
  ])

  if (includeCampaignBehavior) {
    generatedFiles.set(
      join(srcRoot, 'Behaviors', `${behaviorClassName}.cs`),
      buildCampaignBehaviorClass({
        namespaceName,
        behaviorClassName,
        sessionReadyTokenId: localizationTokens.sessionReady,
      })
    )
  }

  if (featureFlags.harmonyExample) {
    generatedFiles.set(
      join(srcRoot, 'Patches', 'HeroCanBecomePrisonerPatch.cs'),
      buildHarmonyPatchClass({
        namespaceName,
      })
    )
  }

  for (const [filePath, content] of generatedFiles) {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf8')
  }

  const blocks: AiTextBlock[] = [
    {
      header: 'workspace_summary',
      fields: [
        { key: 'module_id', value: normalizedModuleId },
        { key: 'module_name', value: moduleName },
        { key: 'namespace', value: namespaceName },
        { key: 'module_root', value: moduleRoot },
        { key: 'game_dir', value: resolvedGameDir },
        { key: 'submodule_version', value: moduleVersion },
        { key: 'target_framework', value: targetFramework },
        { key: 'campaign_behavior', value: featureFlags.campaignBehavior },
        { key: 'harmony_example', value: featureFlags.harmonyExample },
        { key: 'butterlib_support', value: featureFlags.butterLib },
        { key: 'uiextenderex_support', value: featureFlags.uiExtenderEx },
        { key: 'mcm_support', value: featureFlags.mcm },
        { key: 'created_file_count', value: generatedFiles.size },
        { key: 'warning_count', value: warnings.length },
      ],
      listFields: [
        { key: 'created_files', values: [...generatedFiles.keys()].map(filePath => relative(moduleRoot, filePath) || '.') },
        { key: 'official_dependencies', values: officialDependencies.map(item => formatDependency(item)) },
        { key: 'community_dependencies', values: communityDependencies.map(item => formatDependency(item)) },
        { key: 'warnings', values: warnings },
      ],
      multilineFields: [
        {
          key: 'build_command',
          value: `dotnet build "${projectPath}" -c Release`,
        },
      ],
    },
  ]

  const report = renderAiTextReport('create_mod_workspace', 'module_id', normalizedModuleId, blocks)
  return { content: [{ type: 'text' as const, text: report }] }
}

function buildGitignore(): string {
  return `bin/
obj/
.vs/
.idea/
*.user
*.suo
*.pdb
`
}

function buildWorkspaceReadme(input: {
  moduleId: string
  moduleName: string
  namespaceName: string
  authors: string
  projectPath: string
  targetFramework: string
  featureFlags: FeatureFlags
  officialDependencies: ModuleDependency[]
  communityDependencies: ModuleDependency[]
  warnings: string[]
}): string {
  const dependencyLines = [
    ...input.communityDependencies.map(item => `- ${formatDependency(item)}`),
    ...input.officialDependencies.map(item => `- ${formatDependency(item)}`),
  ]
  const warningLines = input.warnings.length > 0 ? input.warnings.map(item => `- ${item}`) : ['- none']

  return `# ${input.moduleName}

Generated by BannerlordSage for Bannerlord mod authors who want a compilable starting point instead of a blank folder.

## Build

\`\`\`powershell
dotnet build ".\\src\\${input.moduleId}.csproj" -c Release
\`\`\`

The output DLL is written to \`bin\\Win64_Shipping_Client\\${input.moduleId}.dll\`, which already matches \`SubModule.xml\`.

## Generated Features

- Namespace: \`${input.namespaceName}\`
- Authors: \`${input.authors}\`
- Target framework: \`${input.targetFramework}\`
- Campaign behavior scaffold: \`${input.featureFlags.campaignBehavior}\`
- Harmony example scaffold: \`${input.featureFlags.harmonyExample}\`
- ButterLib wiring: \`${input.featureFlags.butterLib}\`
- UIExtenderEx wiring: \`${input.featureFlags.uiExtenderEx}\`
- MCM wiring: \`${input.featureFlags.mcm}\`

## Declared Dependencies

${dependencyLines.join('\n')}

## Notes

- \`SubModule.xml\` is emitted in the modern community style with \`DependedModuleMetadatas\`.
- Localization tokens live in \`ModuleData\\Languages\\std_module_strings_xml.xml\`.
- If your Bannerlord install path changes later, update the \`HintPath\` entries in \`src\\${input.moduleId}.csproj\`.

## Generator Warnings

${warningLines.join('\n')}
`
}

function buildSubModuleXml(input: {
  moduleId: string
  moduleName: string
  moduleVersion: string
  subModuleClassType: string
  dllName: string
  dependencies: ModuleDependency[]
  url?: string
  updateInfo?: string
  includeCampaignTags: boolean
}): string {
  const dependedModulesXml =
    input.dependencies.length === 0
      ? '  <DependedModules />'
      : [
          '  <DependedModules>',
          ...input.dependencies.map(item => `    <DependedModule Id="${escapeXml(item.moduleId)}" />`),
          '  </DependedModules>',
        ].join('\n')

  const dependencyMetadataXml =
    input.dependencies.length === 0
      ? '  <DependedModuleMetadatas />'
      : [
          '  <DependedModuleMetadatas>',
          ...input.dependencies.map(item => {
            const versionAttribute = item.version ? ` version="${escapeXml(item.version)}"` : ''
            return `    <DependedModuleMetadata id="${escapeXml(item.moduleId)}" order="LoadBeforeThis"${versionAttribute} />`
          }),
          '  </DependedModuleMetadatas>',
        ].join('\n')

  const optionalMetadataLines = [
    input.url ? `  <Url value="${escapeXml(input.url)}" />` : null,
    input.updateInfo ? `  <UpdateInfo value="${escapeXml(input.updateInfo)}" />` : null,
  ].filter((value): value is string => Boolean(value))

  const tagLines = input.includeCampaignTags
    ? ['        <Tag key="Campaign" />', '        <Tag key="CampaignSystem" />']
    : []

  return `<?xml version="1.0" encoding="utf-8"?>
<Module xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:noNamespaceSchemaLocation="https://raw.githubusercontent.com/BUTR/Bannerlord.XmlSchemas/master/SubModule.xsd">
  <Id value="${escapeXml(input.moduleId)}" />
  <Name value="${escapeXml(input.moduleName)}" />
  <Version value="${escapeXml(input.moduleVersion)}" />
  <DefaultModule value="false" />
  <ModuleCategory value="Singleplayer" />
  <ModuleType value="Community" />
${optionalMetadataLines.join('\n')}
${dependedModulesXml}
${dependencyMetadataXml}
  <SubModules>
    <SubModule>
      <Name value="${escapeXml(input.moduleName)}" />
      <DLLName value="${escapeXml(input.dllName)}" />
      <SubModuleClassType value="${escapeXml(input.subModuleClassType)}" />
      <Assemblies>
        <Assembly Path="bin/Win64_Shipping_Client/${escapeXml(input.dllName)}" />
      </Assemblies>
      <Tags${tagLines.length === 0 ? ' />' : '>'}
${tagLines.join('\n')}
${tagLines.length === 0 ? '' : '      </Tags>'}
    </SubModule>
  </SubModules>
</Module>
`
}

function buildLanguageDataXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<LanguageData xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
              xsi:noNamespaceSchemaLocation="https://raw.githubusercontent.com/BUTR/Bannerlord.XmlSchemas/master/ModuleLanguageData.xsd"
              id="English"
              name="English"
              subtitle_extension="en-GB"
              supported_iso="en-GB,en-US,en,eng,en-us,en-gb,en-au,en-bz,en-ca,en-ie,en-jm,en-nz,en-za,en-tt"
              under_development="false">
  <LanguageFile xml_path="std_module_strings_xml.xml" />
</LanguageData>
`
}

function buildModuleStringsXml(input: {
  moduleNameTokenId: string
  moduleName: string
  sessionReadyTokenId: string
  sessionReadyText: string
}): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<base xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:noNamespaceSchemaLocation="https://raw.githubusercontent.com/BUTR/Bannerlord.XmlSchemas/master/ModuleLanguage.xsd">
  <tags>
    <tag language="English" />
  </tags>
  <strings>
    <string id="${escapeXml(input.moduleNameTokenId)}" text="${escapeXml(input.moduleName)}" />
    <string id="${escapeXml(input.sessionReadyTokenId)}" text="${escapeXml(input.sessionReadyText)}" />
  </strings>
</base>
`
}

function buildCsproj(input: {
  moduleId: string
  namespaceName: string
  moduleName: string
  authors: string
  projectVersion: string
  targetFramework: string
  references: ProjectReference[]
}): string {
  const referenceXml = input.references
    .map(
      item => `    <Reference Include="${escapeXml(item.include)}">
      <HintPath>${escapeXml(item.hintPath)}</HintPath>
      <Private>false</Private>
    </Reference>`
    )
    .join('\n')

  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>${escapeXml(input.targetFramework)}</TargetFramework>
    <LangVersion>latest</LangVersion>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>${escapeXml(input.moduleId)}</AssemblyName>
    <RootNamespace>${escapeXml(input.namespaceName)}</RootNamespace>
    <Description>${escapeXml(input.moduleName)}</Description>
    <Authors>${escapeXml(input.authors)}</Authors>
    <Version>${escapeXml(input.projectVersion)}</Version>
    <OutputPath>..\\bin\\Win64_Shipping_Client\\</OutputPath>
    <AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath>
  </PropertyGroup>

  <ItemGroup>
${referenceXml}
  </ItemGroup>
</Project>
`
}

function buildSubModuleClass(input: {
  namespaceName: string
  moduleId: string
  includeCampaignBehavior: boolean
  includeHarmonyExample: boolean
  behaviorClassName: string
}): string {
  const usings = ['using TaleWorlds.Library;', 'using TaleWorlds.MountAndBlade;']

  if (input.includeCampaignBehavior) {
    usings.unshift('using TaleWorlds.Core;', 'using TaleWorlds.CampaignSystem;')
  }

  if (input.includeHarmonyExample) {
    usings.unshift('using System.Reflection;', 'using HarmonyLib;')
  }

  const fields = input.includeHarmonyExample
    ? [
        `\tprivate const string HarmonyId = "${input.moduleId}";`,
        '',
        '\tprivate Harmony _harmony;',
        '',
      ].join('\n')
    : ''

  const onLoadLines = input.includeHarmonyExample
    ? [
        '_harmony = new Harmony(HarmonyId);',
        '_harmony.PatchAll(Assembly.GetExecutingAssembly());',
        `Debug.Print("${input.moduleId}: Harmony patches applied.");`,
      ]
    : [`Debug.Print("${input.moduleId}: OnSubModuleLoad");`]

  const onUnloadMethod = input.includeHarmonyExample
    ? `
\tprotected override void OnSubModuleUnloaded()
\t{
\t\t_harmony?.UnpatchAll(HarmonyId);
\t\t_harmony = null;
\t\tbase.OnSubModuleUnloaded();
\t}
`
    : ''

  const onGameStartMethod = input.includeCampaignBehavior
    ? `
\tprotected override void OnGameStart(Game game, IGameStarter gameStarterObject)
\t{
\t\tbase.OnGameStart(game, gameStarterObject);
\t\tif (game.GameType is Campaign && gameStarterObject is CampaignGameStarter campaignGameStarter)
\t\t{
\t\t\tcampaignGameStarter.AddBehavior(new Behaviors.${input.behaviorClassName}());
\t\t}
\t}
`
    : ''

  return `${usings.join('\n')}

namespace ${input.namespaceName};

public sealed class SubModule : MBSubModuleBase
{
${fields}\tprotected override void OnSubModuleLoad()
\t{
\t\tbase.OnSubModuleLoad();
\t\t${onLoadLines.join('\n\t\t')}
\t}
${onUnloadMethod}${onGameStartMethod}}
`
}

function buildCampaignBehaviorClass(input: {
  namespaceName: string
  behaviorClassName: string
  sessionReadyTokenId: string
}): string {
  return `using TaleWorlds.CampaignSystem;
using TaleWorlds.Library;
using TaleWorlds.Localization;

namespace ${input.namespaceName}.Behaviors;

public sealed class ${input.behaviorClassName} : CampaignBehaviorBase
{
\tpublic override void RegisterEvents()
\t{
\t\tCampaignEvents.OnSessionLaunchedEvent.AddNonSerializedListener(this, OnSessionLaunched);
\t}

\tpublic override void SyncData(IDataStore dataStore)
\t{
\t}

\tprivate void OnSessionLaunched(CampaignGameStarter campaignGameStarter)
\t{
\t\tInformationManager.DisplayMessage(
\t\t\tnew InformationMessage(new TextObject("{=${input.sessionReadyTokenId}}Campaign behavior is active.").ToString())
\t\t);
\t}
}
`
}

function buildHarmonyPatchClass(input: { namespaceName: string }): string {
  return `using HarmonyLib;
using TaleWorlds.CampaignSystem;

namespace ${input.namespaceName}.Patches;

[HarmonyPatch(typeof(Hero), nameof(Hero.CanBecomePrisoner))]
internal static class HeroCanBecomePrisonerPatch
{
\tprivate static void Postfix(Hero __instance, ref bool __result)
\t{
\t\tif (__instance == Hero.MainHero)
\t\t{
\t\t\t// Replace this no-op scaffold with your real patch logic.
\t\t}
\t}
}
`
}

function resolveOfficialDependencies(
  modulesById: Map<string, BannerlordModuleInfo>,
  includeCampaignBehavior: boolean,
  warnings: string[]
): ModuleDependency[] {
  const dependencies: ModuleDependency[] = []
  const officialDependencyCandidates = includeCampaignBehavior
    ? [['Native'], ['SandBoxCore'], ['Sandbox', 'SandBox'], ['StoryMode']]
    : [['Native']]

  for (const candidates of officialDependencyCandidates) {
    const moduleInfo = resolveInstalledModule(modulesById, candidates)
    if (!moduleInfo) {
      warnings.push(`Could not resolve official dependency '${candidates[0]}' from the local Bannerlord install.`)
      continue
    }

    dependencies.push({
      moduleId: moduleInfo.moduleId,
      version: toOfficialVersionRange(moduleInfo.version),
    })
  }

  return dependencies
}

function requireInstalledModule(
  modulesById: Map<string, BannerlordModuleInfo>,
  moduleId: string,
  label: string,
  warnings: string[]
): BannerlordModuleInfo | null {
  const moduleInfo = modulesById.get(moduleId)
  if (!moduleInfo) {
    warnings.push(`${label} requires '${moduleId}', but that module was not found under the local Bannerlord Modules directory.`)
    return null
  }

  return moduleInfo
}

function resolveInstalledModule(
  modulesById: Map<string, BannerlordModuleInfo>,
  candidateIds: string[]
): BannerlordModuleInfo | null {
  for (const candidateId of candidateIds) {
    const moduleInfo = modulesById.get(candidateId)
    if (moduleInfo) {
      return moduleInfo
    }
  }

  return null
}

function findModuleDllPath(moduleInfo: BannerlordModuleInfo, preferredFileNames: string[]): string | null {
  for (const preferredFileName of preferredFileNames) {
    const dll = moduleInfo.dllFiles.find(item => item.fileName.toLowerCase() === preferredFileName.toLowerCase())
    if (dll) {
      return join(moduleInfo.moduleDir, dll.relativePath.replaceAll('/', '\\'))
    }
  }

  return null
}

function dedupeProjectReferences(references: ProjectReference[]): ProjectReference[] {
  const seen = new Set<string>()
  const deduped: ProjectReference[] = []

  for (const reference of references) {
    const key = `${reference.include}|${reference.hintPath}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(reference)
  }

  return deduped
}

function dedupeDependencies(dependencies: ModuleDependency[]): ModuleDependency[] {
  const seen = new Set<string>()
  const deduped: ModuleDependency[] = []

  for (const dependency of dependencies) {
    const key = dependency.moduleId.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(dependency)
  }

  return deduped
}

function humanizeModuleId(moduleId: string): string {
  const withSpaces = moduleId
    .replaceAll('.', ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()

  return withSpaces.length > 0 ? withSpaces : moduleId
}

function buildDefaultNamespace(moduleId: string): string {
  return moduleId
    .split('.')
    .filter(Boolean)
    .map(segment => sanitizeNamespaceSegment(segment))
    .join('.')
}

function sanitizeNamespaceSegment(segment: string): string {
  const cleaned = segment.replace(/[^A-Za-z0-9_]/g, '_')
  if (cleaned.length === 0) {
    return 'BannerlordMod'
  }

  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned
}

function sanitizeTokenPrefix(moduleId: string): string {
  return moduleId.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'bannerlord_mod'
}

function normalizeSubModuleVersion(version?: string): string {
  const trimmed = version?.trim() || 'v1.0.0'
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`
}

function normalizeProjectVersion(moduleVersion: string): string {
  return moduleVersion.replace(/^v/i, '')
}

function toOfficialVersionRange(version: string | null): string | null {
  if (!version) return null
  if (version.includes('*')) return version
  return `${version}.*`
}

function toMsBuildPath(fromDir: string, targetPath: string): string {
  const relativePath = relative(fromDir, targetPath)
  const normalized = relativePath.length > 0 ? relativePath : targetPath
  return normalized.replaceAll('/', '\\')
}

function stripDllExtension(fileName: string): string {
  return fileName.replace(/\.dll$/i, '')
}

function formatDependency(dependency: ModuleDependency): string {
  return dependency.version ? `${dependency.moduleId}:${dependency.version}` : dependency.moduleId
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

async function ensureDirectoryIsWritable(path: string): Promise<void> {
  if (!(await pathExists(path))) {
    return
  }

  const entries = await readdir(path)
  if (entries.length > 0) {
    throw new Error(`Target mod workspace already exists and is not empty: ${path}`)
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
