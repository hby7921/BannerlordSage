import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { PathSandbox } from './utils/path-sandbox'
import { activeGameId, assetsPath } from './utils/env'
import { getBannerlordToolsetMode } from './utils/bannerlord-toolset'
import { bannerlordIndexStatus } from './tools/bannerlord-index-status'
import { bannerlordDoctor } from './tools/bannerlord-doctor'
import { createModWorkspace } from './tools/create-mod-workspace'
import { generateHarmonyPatch } from './tools/generate-harmony-patch'
import { generateXsltPatch } from './tools/generate-xslt-patch'
import { getClanSummary } from './tools/get-clan-summary'
import { getCultureSummary } from './tools/get-culture-summary'
import { getHeroProfile } from './tools/get-hero-profile'
import { getItemStats } from './tools/get-item-stats'
import { getKingdomSummary } from './tools/get-kingdom-summary'
import { getPerkData } from './tools/get-perk-data'
import { getPolicySummary } from './tools/get-policy-summary'
import { getSettlementSummary } from './tools/get-settlement-summary'
import { getSkillData } from './tools/get-skill-data'
import { indexModSource } from './tools/index-mod-source'
import { listDirectory } from './tools/list-directory'
import { listModDirectory } from './tools/list-mod-directory'
import { modSourceStatus } from './tools/mod-source-status'
import { readCsharpType } from './tools/read-csharp-type'
import { readFile } from './tools/read-file'
import { readGauntletUi } from './tools/read-gauntlet-ui'
import { readModFile } from './tools/read-mod-file'
import { readModType } from './tools/read-mod-type'
import { resolveLocalization } from './tools/resolve-localization'
import { searchModSource } from './tools/search-mod-source'
import { searchSource } from './tools/search-source'
import { searchXml } from './tools/search-xml'
import { traceTroopTree } from './tools/trace-troop-tree'

const sandbox = new PathSandbox(assetsPath)
const bannerlordToolsetMode = getBannerlordToolsetMode()

export const server = new McpServer({
  name: 'bannerlord-sage',
  version: '1.0.0',
})

server.registerTool(
  'bannerlord_doctor',
  {
    title: 'Bannerlord Doctor',
    description:
      'Use this to scan a real Bannerlord install for module dependency problems, duplicate shared libraries, missing SubModule DLLs, and suspicious load-order declarations. It reads installed modules directly from the local game directory and emits an AI-friendly report with focused issues and a recommended load order.',
    inputSchema: {
      gameDir: z
        .string()
        .optional()
        .describe('Optional Bannerlord install path. If omitted, the tool falls back to the saved setup-state game directory.'),
      moduleId: z
        .string()
        .optional()
        .describe('Optional exact module id, such as MercenaryGuild or Bannerlord.UIExtenderEx.'),
      modulePath: z
        .string()
        .optional()
        .describe('Optional absolute module directory path. Use this when duplicate ids exist or when the folder name matters more than the id.'),
      includeOfficialDetails: z
        .boolean()
        .optional()
        .default(false)
        .describe('When true, include detailed blocks for official modules in the focused output.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ gameDir, moduleId, modulePath, includeOfficialDetails }) =>
    await bannerlordDoctor(gameDir, moduleId, modulePath, includeOfficialDetails),
)

server.registerTool(
  'bannerlord_index_status',
  {
    title: 'Bannerlord Index Status',
    description:
      'Use this to inspect the current BannerlordSage runtime state, including active scopes, indexed table counts, XML parse failures, missing official DLL coverage, and the active query-first or full toolset mode.',
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async () => await bannerlordIndexStatus('bannerlord'),
)

server.registerTool(
  'mod_source_status',
  {
    title: 'Local Mod Source Status',
    description:
      'Use this to inspect a frequently changing local Bannerlord mod source workspace. It resolves the workspace root, chooses the effective source root, refreshes the local Roslyn-backed cache if needed, and reports indexed type/member counts.',
    inputSchema: {
      workspaceRoot: z
        .string()
        .optional()
        .describe('Absolute path to your local mod workspace root or src directory. If omitted, the tool uses BANNERSAGE_MOD_SOURCE_DIR.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ workspaceRoot }) => await modSourceStatus(workspaceRoot),
)

server.registerTool(
  'index_mod_source',
  {
    title: 'Index Local Mod Source',
    description:
      'Use this to build or refresh an incremental local C# index for your own Bannerlord mod source directory. It is intended for frequently edited workspaces and reindexes only changed files.',
    inputSchema: {
      workspaceRoot: z
        .string()
        .optional()
        .describe('Absolute path to your local mod workspace root or src directory. If omitted, the tool uses BANNERSAGE_MOD_SOURCE_DIR.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ workspaceRoot }) => await indexModSource(workspaceRoot),
)

server.registerTool(
  'search_mod_source',
  {
    title: 'Search Local Mod Source',
    description:
      'Use this to run ripgrep directly against your own local mod source tree instead of the imported Bannerlord decompile tree. This is the fastest way to inspect frequently changing mod code.',
    inputSchema: {
      workspaceRoot: z
        .string()
        .optional()
        .describe('Absolute path to your local mod workspace root or src directory. If omitted, the tool uses BANNERSAGE_MOD_SOURCE_DIR.'),
      query: z.string().describe('Keyword or regex pattern to search for.'),
      caseSensitive: z.boolean().optional().default(false).describe('When true, perform a case-sensitive search.'),
      filePattern: z.string().optional().describe('Optional ripgrep glob such as *.cs or *Patch*.cs.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ workspaceRoot, query, caseSensitive, filePattern }) =>
    await searchModSource(workspaceRoot, query, caseSensitive, filePattern),
)

server.registerTool(
  'read_mod_file',
  {
    title: 'Read Local Mod File',
    description:
      'Use this to read a slice from your own local mod source tree. It resolves paths relative to the effective mod source root and reads live files, so frequent edits are immediately visible.',
    inputSchema: {
      workspaceRoot: z
        .string()
        .optional()
        .describe('Absolute path to your local mod workspace root or src directory. If omitted, the tool uses BANNERSAGE_MOD_SOURCE_DIR.'),
      path: z.string().describe('Path relative to the effective mod source root.'),
      startLine: z.number().optional().default(0).describe('Zero-based starting line number.'),
      lineCount: z.number().optional().default(400).describe('Maximum number of lines to return.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ workspaceRoot, path, startLine, lineCount }) => await readModFile(workspaceRoot, path, startLine, lineCount),
)

server.registerTool(
  'list_mod_directory',
  {
    title: 'List Local Mod Directory',
    description:
      'Use this to inspect the current local mod source tree and discover which files and subdirectories are present under your frequently edited workspace.',
    inputSchema: {
      workspaceRoot: z
        .string()
        .optional()
        .describe('Absolute path to your local mod workspace root or src directory. If omitted, the tool uses BANNERSAGE_MOD_SOURCE_DIR.'),
      path: z.string().optional().default('').describe('Directory path relative to the effective mod source root.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ workspaceRoot, path }) => await listModDirectory(workspaceRoot, path),
)

server.registerTool(
  'read_mod_type',
  {
    title: 'Read Local Mod Type',
    description:
      'Use this when you know a class, struct, interface, or enum name from your own local mod source. The tool automatically refreshes an incremental Roslyn-backed cache when files changed, then returns the matching type definition.',
    inputSchema: {
      workspaceRoot: z
        .string()
        .optional()
        .describe('Absolute path to your local mod workspace root or src directory. If omitted, the tool uses BANNERSAGE_MOD_SOURCE_DIR.'),
      typeName: z.string().describe('Exact simple type name from your local mod source, such as SubModule or MyCampaignBehavior.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ workspaceRoot, typeName }) => await readModType(workspaceRoot, typeName),
)

if (bannerlordToolsetMode === 'full') {
  server.registerTool(
    'create_mod_workspace',
    {
      title: 'Create Mod Workspace',
      description:
        'Use this to scaffold a local Bannerlord mod workspace under a target parent directory. It generates a modern community-style SubModule.xml, English localization files, a compilable C# project wired against the local game install, and optional CampaignBehavior or Harmony sample code.',
      inputSchema: {
        workspaceRoot: z
          .string()
          .describe('Parent directory that will receive the generated <moduleId> folder. The tool refuses to overwrite a non-empty target module directory.'),
        moduleId: z
          .string()
          .regex(/^[A-Za-z0-9_.]+$/)
          .describe('Bannerlord module id and generated folder name, for example MercenaryGuild or MyCompany.MyMod.'),
        moduleName: z.string().optional().describe('Human-readable module name written into SubModule.xml and README.md.'),
        namespace: z.string().optional().describe('Optional root C# namespace. Defaults to a sanitized version of moduleId.'),
        authors: z.string().optional().describe('Optional author string written into the generated .csproj and README.md.'),
        version: z.string().optional().describe('Optional module version. Accepts either 1.0.0 or v1.0.0 style input.'),
        url: z.string().optional().describe('Optional community metadata URL written into SubModule.xml.'),
        updateInfo: z.string().optional().describe('Optional community metadata update descriptor, such as NexusMods:1234.'),
        gameDir: z
          .string()
          .optional()
          .describe('Optional Bannerlord install path. If omitted, the tool falls back to the saved setup-state game directory.'),
        includeCampaignBehavior: z
          .boolean()
          .optional()
          .default(true)
          .describe('Generate a CampaignBehavior scaffold and wire it into the generated SubModule class.'),
        includeHarmonyExample: z
          .boolean()
          .optional()
          .default(false)
          .describe('Generate a no-op Harmony postfix example and add a local 0Harmony reference if Bannerlord.Harmony is installed.'),
        includeButterLib: z
          .boolean()
          .optional()
          .default(false)
          .describe('Declare Bannerlord.ButterLib as a dependency and add a project reference if the local module is installed.'),
        includeUiExtenderEx: z
          .boolean()
          .optional()
          .default(false)
          .describe('Declare Bannerlord.UIExtenderEx as a dependency and add a project reference if the local module is installed.'),
        includeMcm: z
          .boolean()
          .optional()
          .default(false)
          .describe('Declare Bannerlord.MBOptionScreen plus its prerequisite community libraries when those local modules are installed.'),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async input => await createModWorkspace(input),
  )
}

server.registerTool(
  'read_csharp_type',
  {
    title: 'Read C# Type',
    description:
      'Use this when you already know the Bannerlord type name and need the actual decompiled definition. Prefer this over broad text search for classes, structs, interfaces, enums, or nested types because it jumps straight to the indexed declaration and returns a focused code block.',
    inputSchema: {
      typeName: z
        .string()
        .describe('Exact simple type name, for example MobileParty, Hero, CharacterObject, or an enum name.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ typeName }) => await readCsharpType(typeName),
)

server.registerTool(
  'search_source',
  {
    title: 'Search Decompiled Source',
    description:
      'Use this when you do not yet know the exact type or method location. It runs a fast ripgrep search across the decompiled C# source tree and is best for hunting symbols, comments, string literals, XML references, or patterns before drilling into a specific file or type.',
    inputSchema: {
      query: z
        .string()
        .describe('Keyword or regex pattern. Keep it narrow for better results, for example CalculateSpeed or upgrade_targets.'),
      filePattern: z
        .string()
        .optional()
        .describe('Optional ripgrep glob like *.cs, *Party*.cs, or */CampaignSystem/*.cs to cut noise.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ query, filePattern }) => await searchSource(sandbox, query, false, filePattern),
)

server.registerTool(
  'read_file',
  {
    title: 'Read Indexed File Slice',
    description:
      'Use this after search_source or search_xml when you already know the relative file path and need a contiguous slice of source or XML. Best practice is to read only the relevant region instead of the whole file to save context.',
    inputSchema: {
      path: z
        .string()
        .describe(
          `Path relative to dist/games/${activeGameId}/assets, such as Source/bin/Win64_Shipping_Client/TaleWorlds.CampaignSystem/Foo.cs or Xmls/Modules/Native/ModuleData/crafting_pieces.xml.`
        ),
      startLine: z.number().optional().default(0).describe('Zero-based starting line number.'),
      lineCount: z.number().optional().default(400).describe('Maximum number of lines to return.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, startLine, lineCount }) => await readFile(sandbox, path, startLine, lineCount),
)

server.registerTool(
  'list_directory',
  {
    title: 'List Indexed Directory',
    description:
      `Use this to explore what has been imported into dist/games/${activeGameId}/assets before deciding which file to open. It is especially useful when you know the module or source subtree but not the exact filename.`,
    inputSchema: {
      path: z
        .string()
        .optional()
        .default('')
        .describe(`Directory relative to dist/games/${activeGameId}/assets. Leave empty to list the top-level imported folders.`),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ path }) => await listDirectory(sandbox, path),
)

server.registerTool(
  'search_xml',
  {
    title: 'Search XML Data',
    description:
      'Use this for fast full-text lookup across imported XML data, including ModuleData and Languages content. Prefer it when you need to discover which XML files mention an entity, token, field, or gameplay concept before opening a file or querying a specific item/troop tool.',
    inputSchema: {
      query: z.string().describe('One or more keywords. Phrase-like searches work best with 1-4 focused terms.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ query }) => await searchXml(query),
)

server.registerTool(
  'trace_troop_tree',
  {
    title: 'Trace Troop Tree',
    description:
      'Use this when you already know a troop character ID and want a focused upgrade-tree summary without manually traversing NPCCharacter XML. This reads the precomputed troop projection table, so it is faster and more reliable than reparsing XML fragments for each request.',
    inputSchema: {
      characterId: z.string().describe('Exact troop ID such as vlandian_recruit or imperial_infantryman.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ characterId }) => await traceTroopTree(characterId),
)

server.registerTool(
  'get_item_stats',
  {
    title: 'Get Item Stats',
    description:
      'Use this when you already know an item ID or crafting-piece ID and need a condensed gameplay-facing summary. Prefer this over raw XML reading for weapons, armor, horses, and smithing parts because it reads the precomputed item projection table and formats the key stats directly.',
    inputSchema: {
      itemId: z.string().describe('Exact item or crafting piece ID, for example saddle_horse or sword_blade_4_t3.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ itemId }) => await getItemStats(itemId),
)

server.registerTool(
  'get_clan_summary',
  {
    title: 'Get Clan Summary',
    description:
      'Use this when you already know a clan or faction ID from spclans.xml and want its resolved culture, owner hero, home settlement, and super-faction without manually joining multiple XML files. This reads the precomputed clan projection table and is especially useful for noble clans, minor factions, mercenaries, and bandit groups.',
    inputSchema: {
      clanId: z.string().describe('Exact clan or faction ID such as clan_empire_north_3, player_faction, or ghilman.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ clanId }) => await getClanSummary(clanId),
)

server.registerTool(
  'get_policy_summary',
  {
    title: 'Get Policy Summary',
    description:
      'Use this when you know a kingdom policy ID and want the fully resolved policy text, support weights, current active kingdoms, and default cultures without manually stitching source-defined policy objects to XML kingdom and culture references. This reads the hybrid gameplay index built from both decompiled source and XML projections.',
    inputSchema: {
      policyId: z.string().describe('Exact policy ID such as policy_feudal_inheritance or policy_royal_privilege.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ policyId }) => await getPolicySummary(policyId),
)

server.registerTool(
  'get_hero_profile',
  {
    title: 'Get Hero Profile',
    description:
      'Use this when you already know a hero ID and want the merged relationship and character summary without manually joining Heroes XML and NPCCharacter XML. This reads the precomputed hero projection table and joins it with indexed troop data.',
    inputSchema: {
      heroId: z.string().describe('Exact hero ID such as lord_1_1 or main_hero.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ heroId }) => await getHeroProfile(heroId),
)

server.registerTool(
  'get_perk_data',
  {
    title: 'Get Perk Data',
    description:
      'Use this when you know a single-player perk ID and want its skill tree placement, paired alternative perk, role bonuses, increment types, and localized descriptions without searching the large DefaultPerks source file manually. This reads the hybrid gameplay index extracted from decompiled campaign source.',
    inputSchema: {
      perkId: z.string().describe('Exact perk ID such as OneHandedWrappedHandles, BowBowControl, or LeadershipFerventAttacker.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ perkId }) => await getPerkData(perkId),
)

server.registerTool(
  'get_kingdom_summary',
  {
    title: 'Get Kingdom Summary',
    description:
      'Use this when you know a kingdom ID and want a focused summary of ruler, culture, capital/home settlement, colors, and policy counts without reparsing spkingdoms.xml. This reads the precomputed kingdom projection table.',
    inputSchema: {
      kingdomId: z.string().describe('Exact kingdom ID such as empire, battania, or aserai.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ kingdomId }) => await getKingdomSummary(kingdomId),
)

server.registerTool(
  'get_culture_summary',
  {
    title: 'Get Culture Summary',
    description:
      'Use this when you already know a culture ID and want a fast summary of core culture metadata, localized description text, troop roots, and name pools. This reads the precomputed culture projection table instead of reparsing the large cultures XML file.',
    inputSchema: {
      cultureId: z.string().describe('Exact culture ID such as empire, battania, or khuzait.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ cultureId }) => await getCultureSummary(cultureId),
)

server.registerTool(
  'get_settlement_summary',
  {
    title: 'Get Settlement Summary',
    description:
      'Use this when you know a settlement ID and want a fast summary of settlement type, owner faction, derived kingdom, village bindings, scenes, and prosperity/hearth values. This reads the precomputed settlement projection table instead of reparsing settlements.xml and related faction XML.',
    inputSchema: {
      settlementId: z.string().describe('Exact settlement ID such as town_B1, castle_EN1, or castle_village_EN1_1.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ settlementId }) => await getSettlementSummary(settlementId),
)

server.registerTool(
  'get_skill_data',
  {
    title: 'Get Skill Data',
    description:
      'Use this when you know a skill XML ID and want its modifier list and documentation without opening the full skills XML. This reads the precomputed skill projection table and is best for quickly understanding attribute modifiers.',
    inputSchema: {
      skillId: z.string().describe('Exact skill XML ID such as IronFlesh1 or PowerStrike1.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ skillId }) => await getSkillData(skillId),
)

server.registerTool(
  'generate_harmony_patch',
  {
    title: 'Generate Harmony Patch',
    description:
      'Use this after you have identified the target class and method and want a safe Harmony patch scaffold. It relies on the AST-based method index, so it is better than hand-writing a patch when overloads or static-vs-instance details matter.',
    inputSchema: {
      className: z.string().describe('Simple class name, such as MobileParty or Hero.'),
      methodName: z.string().describe('Exact method name, such as CalculateSpeed, Tick, or Initialize.'),
    },
  },
  async ({ className, methodName }) => await generateHarmonyPatch(className, methodName),
)

if (bannerlordToolsetMode === 'full') {
  server.registerTool(
    'generate_xslt_patch',
    {
      title: 'Generate XSLT Patch',
      description:
        'Use this when you need to modify Bannerlord XML through an XSLT patch instead of editing source XML directly. Provide the target XPath and choose insert, replace, or delete based on whether you are appending a new node, overwriting an existing node, or removing one.',
      inputSchema: {
        targetXPath: z.string().describe('XPath that matches the target node, for example /Items/Item[@id=\'saddle_horse\'].'),
        operation: z.enum(['insert', 'replace', 'delete']).describe('Patch mode: insert appends inside the target node, replace swaps the target node, delete removes it.'),
        fragment: z.string().optional().describe('Optional XML fragment to insert or replace with. Omit it for delete.'),
      },
    },
    async ({ targetXPath, operation, fragment }) =>
      await generateXsltPatch(targetXPath, operation, fragment),
  )
}

server.registerTool(
  'resolve_localization',
  {
    title: 'Resolve Localization Token',
    description:
      'Use this whenever you encounter Bannerlord text in the form {=token}Fallback and need the actual localized strings. It reads both indexed Languages XML entries and source-derived fallback literals extracted from the decompiled C# source, which is especially useful for item names, troop names, UI labels, and hardcoded gameplay text.',
    inputSchema: {
      text: z.string().describe('A Bannerlord localization token like {=P1rL28RT}Sumpter Horse.'),
      languages: z.array(z.string()).optional().describe('Optional preferred language order, for example ["English", "CN"].'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ text, languages }) => await resolveLocalization(text, languages),
)

server.registerTool(
  'read_gauntlet_ui',
  {
    title: 'Read Gauntlet UI',
    description:
      'Use this when you know the Gauntlet XML name and need a quick ViewModel binding checklist. It is best for discovering DataSource fields and click handlers before implementing or patching the matching ViewModel class.',
    inputSchema: {
      uiFileName: z.string().describe('UI XML filename stem such as InventoryScreen or EncyclopediaHeroPage.'),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ uiFileName }) => await readGauntletUi(sandbox, uiFileName),
)
