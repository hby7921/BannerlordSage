import { Database } from 'bun:sqlite'
import { file } from 'bun'
import { basename, relative } from 'node:path'
import { renderAiTextReport, type AiTextBlock } from '../utils/ai-text'
import { loadSetupStateForGame, type SetupState } from '../utils/bannerlord-setup'
import { getActiveBannerlordToolNames, getBannerlordToolsetMode } from '../utils/bannerlord-toolset'
import { getGamePaths, normalizeGameId } from '../utils/env'
import { getGameProfile } from '../utils/game-profiles'
import { readRuntimeRevision } from '../utils/runtime-revision'

const CORE_TABLES = [
  'csharp_types',
  'csharp_methods',
  'source_localization_entries',
  'xml_entities',
  'localization_entries',
  'bannerlord_items',
  'bannerlord_troops',
  'bannerlord_heroes',
  'bannerlord_clans',
  'bannerlord_kingdoms',
  'bannerlord_settlements',
  'bannerlord_cultures',
  'bannerlord_skills',
  'bannerlord_policies',
  'bannerlord_perks',
] as const

export async function bannerlordIndexStatus(gameId?: string) {
  const resolvedGameId = normalizeGameId(gameId)
  const paths = getGamePaths(resolvedGameId)
  const state = await loadSetupStateForGame(resolvedGameId)
  const runtimeRevision = readRuntimeRevision(resolvedGameId) || '(missing)'
  const dbExists = await file(paths.dbPath).exists()
  const parseSummary = await readXmlParseSummary(paths.xmlParseReportPath)
  const tableCounts = dbExists ? readCoreTableCounts(paths.dbPath) : {}
  const missingOfficialDlls = await getMissingOfficialDlls(resolvedGameId, state)
  const toolsetMode = getBannerlordToolsetMode()
  const activeTools = getActiveBannerlordToolNames()

  const blocks: AiTextBlock[] = [
    {
      header: 'runtime_summary',
      fields: [
        { key: 'game_id', value: resolvedGameId },
        { key: 'runtime_revision', value: runtimeRevision },
        { key: 'game_dir', value: state.gameDir || '(missing)' },
        { key: 'dll_scope', value: state.dllScope || '(unset)' },
        { key: 'xml_scope', value: state.xmlScope || '(unset)' },
        { key: 'decompiled_dll_count', value: Object.keys(state.dlls).length },
        { key: 'xml_file_count', value: Object.keys(state.xmlFiles).length },
        { key: 'db_present', value: dbExists ? 'true' : 'false' },
        { key: 'xml_parse_failure_count', value: parseSummary.failureCount },
        { key: 'toolset_mode', value: toolsetMode },
      ],
      listFields: [
        { key: 'missing_official_dlls', values: missingOfficialDlls },
        { key: 'active_tool_names', values: activeTools },
      ],
    },
    {
      header: 'core_table_counts',
      fields: Object.entries(tableCounts).map(([tableName, count]) => ({
        key: tableName,
        value: count,
      })),
    },
    {
      header: 'tool_categories',
      listFields: [
        {
          key: 'decompiled_source_tools',
          values: ['read_csharp_type', 'search_source', 'read_file', 'list_directory'],
        },
        {
          key: 'xml_tools',
          values: ['search_xml', 'read_file', 'read_gauntlet_ui', 'resolve_localization'],
        },
        {
          key: 'structured_query_tools',
          values: [
            'trace_troop_tree',
            'get_item_stats',
            'get_hero_profile',
            'get_clan_summary',
            'get_kingdom_summary',
            'get_culture_summary',
            'get_settlement_summary',
            'get_skill_data',
            'get_policy_summary',
            'get_perk_data',
          ],
        },
        {
          key: 'diagnostic_tools',
          values: ['bannerlord_doctor', 'bannerlord_index_status'],
        },
        {
          key: 'authoring_tools',
          values: toolsetMode === 'full' ? ['create_mod_workspace', 'generate_xslt_patch'] : [],
        },
      ],
    },
  ]

  return {
    content: [
      {
        type: 'text' as const,
        text: renderAiTextReport('bannerlord_index_status', 'query_target', resolvedGameId, blocks),
      },
    ],
  }
}

function readCoreTableCounts(dbPath: string): Record<string, number> {
  const db = new Database(dbPath, { create: false, readonly: true })

  try {
    const counts: Record<string, number> = {}
    for (const tableName of CORE_TABLES) {
      counts[tableName] = Number(
        db.query<{ count: number }, never>(`SELECT COUNT(*) AS count FROM ${tableName}`).get()?.count || 0
      )
    }

    return counts
  } finally {
    db.close()
  }
}

async function readXmlParseSummary(reportPath: string): Promise<{ failureCount: number }> {
  if (!(await file(reportPath).exists())) {
    return { failureCount: 0 }
  }

  try {
    const raw = await file(reportPath).text()
    const parsed = JSON.parse(raw) as { parseFailureCount?: number; failures?: unknown[] }
    return {
      failureCount: Number(parsed.parseFailureCount ?? parsed.failures?.length ?? 0),
    }
  } catch {
    return { failureCount: 0 }
  }
}

async function getMissingOfficialDlls(gameId: string, state: SetupState): Promise<string[]> {
  if (!state.gameDir || state.dllScope !== 'official') {
    return []
  }

  const profile = getGameProfile(gameId)
  const officialCandidates = await profile.collectDllCandidates(state.gameDir, { dllScope: 'official' })
  const indexedRelativePaths = new Set(Object.keys(state.dlls).map(key => key.replaceAll('\\', '/').toLowerCase()))

  return officialCandidates
    .filter(dllPath => {
      const relativePath = relative(state.gameDir!, dllPath).replaceAll('\\', '/').toLowerCase()
      return !indexedRelativePaths.has(relativePath)
    })
    .map(dllPath => basename(dllPath))
}
