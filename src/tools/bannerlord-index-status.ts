import { Database } from 'bun:sqlite'
import { file } from 'bun'
import { basename, relative } from 'node:path'
import { renderAiTextReport, type AiTextBlock } from '../utils/ai-text'
import { loadSetupStateForGame, type SetupState } from '../utils/bannerlord-setup'
import { resolveBannerlordApiVersion } from '../utils/bannerlord-api-docs'
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
  const coreTableStatus = dbExists ? readCoreTableCounts(paths.dbPath) : { counts: {} }
  const tableCounts = coreTableStatus.counts
  const docsCounts = dbExists ? readDocsTableCounts(paths.dbPath) : {}
  const apiCounts = dbExists ? readApiTableCounts(paths.dbPath, state) : undefined
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
        { key: 'game_version', value: state.gameVersion || '(unknown)' },
        { key: 'build_changeset', value: state.buildChangeset || '(unknown)' },
        { key: 'full_version', value: state.fullVersion || '(unknown)' },
        { key: 'version_source', value: state.versionSource || '(unknown)' },
        { key: 'dll_scope', value: state.dllScope || '(unset)' },
        { key: 'xml_scope', value: state.xmlScope || '(unset)' },
        { key: 'decompiled_dll_count', value: Object.keys(state.dlls).length },
        { key: 'xml_file_count', value: Object.keys(state.xmlFiles).length },
        { key: 'db_present', value: dbExists ? 'true' : 'false' },
        { key: 'xml_parse_failure_count', value: parseSummary.failureCount },
        { key: 'toolset_mode', value: toolsetMode },
        { key: 'core_table_status_warning', value: coreTableStatus.warning || '(none)' },
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
      header: 'docs_api_status',
      fields: [
        { key: 'official_docs_pages', value: docsCounts.officialDocsPages || 0 },
        { key: 'community_docs_pages', value: docsCounts.communityDocsPages || 0 },
        { key: 'api_versions_indexed', value: apiCounts?.apiVersionsIndexed || 0 },
        { key: 'api_entries_indexed', value: apiCounts?.apiEntriesIndexed || 0 },
        { key: 'official_api_version_used', value: apiCounts?.selectedApiVersion || '(missing)' },
        { key: 'api_exact_match', value: apiCounts?.exactMatch || false },
        { key: 'api_authority', value: apiCounts?.authority || 'local_decompiled_source' },
        { key: 'api_version_warning', value: apiCounts?.warning || '(none)' },
        { key: 'docs_status_warning', value: docsCounts.warning || '(none)' },
      ],
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
          key: 'docs_api_tools',
          values: ['search_bannerlord_knowledge', 'search_bannerlord_docs', 'search_bannerlord_api_docs'],
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
          key: 'project_memory_tools',
          values: [
            'project_memory_add',
            'project_memory_capture_session',
            'project_memory_search',
            'project_memory_recent',
            'project_memory_wakeup',
            'project_memory_invalidate',
          ],
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

function readCoreTableCounts(dbPath: string): { counts: Record<string, number>; warning?: string } {
  let db: Database | undefined

  try {
    db = new Database(dbPath, { create: false, readonly: true })
    db.run('PRAGMA busy_timeout = 5000;')

    const counts: Record<string, number> = {}
    for (const tableName of CORE_TABLES) {
      counts[tableName] = tableExists(db, tableName) ? countRows(db, tableName) : 0
    }

    return { counts }
  } catch (error) {
    return {
      counts: Object.fromEntries(CORE_TABLES.map(tableName => [tableName, 0])),
      warning: `Could not read core table counts: ${formatStatusReadError(error)}`,
    }
  } finally {
    db?.close()
  }
}

function readDocsTableCounts(dbPath: string): {
  officialDocsPages: number
  communityDocsPages: number
  warning?: string
} {
  let db: Database | undefined

  try {
    db = new Database(dbPath, { create: false, readonly: true })
    db.run('PRAGMA busy_timeout = 5000;')

    if (!tableExists(db, 'bannerlord_docs_pages')) {
      return { officialDocsPages: 0, communityDocsPages: 0 }
    }

    const officialDocsPages = countRowsWhere(db, 'bannerlord_docs_pages', 'source', 'official_moddocs')
    const communityDocsPages = countRowsWhere(db, 'bannerlord_docs_pages', 'source', 'community_modding_docs')
    return { officialDocsPages, communityDocsPages }
  } catch (error) {
    return {
      officialDocsPages: 0,
      communityDocsPages: 0,
      warning: `Could not read docs index status: ${formatStatusReadError(error)}`,
    }
  } finally {
    db?.close()
  }
}

function tableExists(db: Database, tableName: string): boolean {
  const row = db
    .query<{ name: string } | null, { $tableName: string }>(
      `
      SELECT name
      FROM sqlite_master
      WHERE type IN ('table', 'virtual') AND name = $tableName
      LIMIT 1
    `
    )
    .get({ $tableName: tableName })

  return Boolean(row)
}

function countRows(db: Database, tableName: string): number {
  return Number(
    db.query<{ count: number }, never>(`SELECT COUNT(*) AS count FROM ${escapeSqlIdentifier(tableName)}`).get()?.count || 0
  )
}

function countRowsWhere(db: Database, tableName: string, columnName: string, value: string): number {
  return Number(
    db
      .query<{ count: number }, { $value: string }>(
        `
        SELECT COUNT(*) AS count
        FROM ${escapeSqlIdentifier(tableName)}
        WHERE ${escapeSqlIdentifier(columnName)} = $value
      `
      )
      .get({ $value: value })?.count || 0
  )
}

function escapeSqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function readApiTableCounts(dbPath: string, state: SetupState): {
  apiVersionsIndexed: number
  apiEntriesIndexed: number
  selectedApiVersion?: string
  exactMatch: boolean
  authority: string
  warning?: string
} {
  let db: Database | undefined

  try {
    db = new Database(dbPath, { create: false, readonly: true })
    db.run('PRAGMA busy_timeout = 5000;')

    if (!tableExists(db, 'bannerlord_api_versions') || !tableExists(db, 'bannerlord_api_entries')) {
      return {
        apiVersionsIndexed: 0,
        apiEntriesIndexed: 0,
        exactMatch: false,
        authority: 'local_decompiled_source',
      }
    }

    const resolution = resolveBannerlordApiVersion(db, state)
    return {
      apiVersionsIndexed: countRows(db, 'bannerlord_api_versions'),
      apiEntriesIndexed: countRows(db, 'bannerlord_api_entries'),
      selectedApiVersion: resolution.selectedApiVersion,
      exactMatch: resolution.exactMatch,
      authority: resolution.authority,
      warning: resolution.warning,
    }
  } catch (error) {
    return {
      apiVersionsIndexed: 0,
      apiEntriesIndexed: 0,
      exactMatch: false,
      authority: 'local_decompiled_source',
      warning: `Could not read API index status: ${formatStatusReadError(error)}`,
    }
  } finally {
    db?.close()
  }
}

function formatStatusReadError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
