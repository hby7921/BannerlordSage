import { databaseHasTable, getDb } from '../utils/db'
import { getGamePaths } from '../utils/env'
import { renderAiTextReport, type AiTextBlock } from '../utils/ai-text'
import { loadSetupStateForGame } from '../utils/bannerlord-setup'
import {
  BANNERLORD_API_SECTIONS,
  resolveBannerlordApiVersion,
  type BannerlordApiSection,
} from '../utils/bannerlord-api-docs'

export async function searchApiDocs(
  query: string,
  version?: string,
  section?: BannerlordApiSection,
  limit = 10
) {
  const db = getDb('bannerlord')
  const paths = getGamePaths('bannerlord')
  const state = await loadSetupStateForGame('bannerlord')

  if (!databaseHasTable(paths.dbPath, 'bannerlord_api_entries_fts')) {
    return {
      content: [
        {
          type: 'text' as const,
          text: renderAiTextReport('bannerlord_api_search', 'query_text', query, [], [
            { key: 'index_status', value: 'missing' },
            { key: 'setup_hint', value: 'Run bun run index:api-docs first.' },
            { key: 'installed_game_version', value: state.gameVersion || '(unknown)' },
            { key: 'installed_full_version', value: state.fullVersion || '(unknown)' },
            { key: 'authority', value: 'local_decompiled_source' },
          ]),
        },
      ],
    }
  }

  const resolution = resolveBannerlordApiVersion(db, state, version)
  if (!resolution.selectedApiVersion) {
    return {
      content: [
        {
          type: 'text' as const,
          text: renderAiTextReport('bannerlord_api_search', 'query_text', query, [], [
            { key: 'index_status', value: 'ready' },
            { key: 'installed_game_version', value: resolution.installedGameVersion || '(unknown)' },
            { key: 'installed_full_version', value: resolution.installedFullVersion || '(unknown)' },
            { key: 'requested_api_version', value: resolution.requestedApiVersion || '(none)' },
            { key: 'authority', value: resolution.authority },
            { key: 'version_warning', value: resolution.warning || '(none)' },
            { key: 'available_versions', value: resolution.availableVersions.join(', ') || '(none)' },
          ]),
        },
      ],
    }
  }

  const ftsQuery = buildFtsQuery(query)
  const normalizedSection = normalizeSection(section)
  const rows = db
    .query<any, any>(
      `
      SELECT
        id,
        version,
        section,
        searchKey,
        title,
        scope,
        url,
        snippet(bannerlord_api_entries_fts, 4, '[', ']', ' ... ', 18) AS titleSnippet,
        snippet(bannerlord_api_entries_fts, 5, '[', ']', ' ... ', 18) AS scopeSnippet
      FROM bannerlord_api_entries_fts
      WHERE bannerlord_api_entries_fts MATCH $query
        AND version = $version
        AND ($section IS NULL OR section = $section)
      ORDER BY bm25(bannerlord_api_entries_fts, 0.5, 0.5, 0.5, 4.0, 8.0, 2.0, 0.1, 6.0)
      LIMIT $limit
    `
    )
    .all({
      $query: ftsQuery,
      $version: resolution.selectedApiVersion,
      $section: normalizedSection,
      $limit: clampLimit(limit),
    })

  const effectiveRows = rows.length > 0
    ? rows
    : db
      .query<any, any>(
        `
        SELECT
          id,
          version,
          section,
          searchKey,
          title,
          scope,
          url,
          title AS titleSnippet,
          scope AS scopeSnippet
        FROM bannerlord_api_entries
        WHERE version = $version
          AND ($section IS NULL OR section = $section)
          AND (
            title LIKE $likeQuery ESCAPE '\\'
            OR searchKey LIKE $likeQuery ESCAPE '\\'
            OR scope LIKE $likeQuery ESCAPE '\\'
          )
        ORDER BY
          CASE
            WHEN title = $plainQuery THEN 0
            WHEN title LIKE $prefixQuery THEN 1
            ELSE 2
          END,
          title
        LIMIT $limit
      `
      )
      .all({
        $version: resolution.selectedApiVersion,
        $section: normalizedSection,
        $plainQuery: query.trim(),
        $prefixQuery: `${query.trim()}%`,
        $likeQuery: `%${escapeLikePattern(query.trim())}%`,
        $limit: clampLimit(limit),
      })

  const blocks: AiTextBlock[] = effectiveRows.map((row: any, index: number) => ({
    header: `api_match_${index + 1}`,
    fields: [
      { key: 'api_version', value: row.version },
      { key: 'section', value: row.section },
      { key: 'title', value: row.title },
      { key: 'scope', value: row.scope || '(none)' },
      { key: 'url', value: row.url },
    ],
    multilineFields: [
      { key: 'title_snippet', value: row.titleSnippet || row.title },
      { key: 'scope_snippet', value: row.scopeSnippet || row.scope || '(none)' },
    ],
  }))

  return {
    content: [
      {
        type: 'text' as const,
        text: renderAiTextReport('bannerlord_api_search', 'query_text', query, blocks, [
          { key: 'fts_query', value: ftsQuery },
          { key: 'index_status', value: 'ready' },
          { key: 'installed_game_version', value: resolution.installedGameVersion || '(unknown)' },
          { key: 'installed_full_version', value: resolution.installedFullVersion || '(unknown)' },
          { key: 'requested_api_version', value: resolution.requestedApiVersion || '(none)' },
          { key: 'official_api_version_used', value: resolution.selectedApiVersion },
          { key: 'api_exact_match', value: resolution.exactMatch },
          { key: 'authority', value: resolution.authority },
          { key: 'api_usage', value: resolution.usage },
          { key: 'version_warning', value: resolution.warning || '(none)' },
        ]),
      },
    ],
  }
}

function buildFtsQuery(query: string): string {
  const cleaned = query.trim().replace(/"/g, ' ')
  if (!cleaned) return '""'

  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map(token => `"${token}"*`)
    .join(' AND ')
}

function normalizeSection(section?: BannerlordApiSection): BannerlordApiSection | null {
  if (!section) return null
  return BANNERLORD_API_SECTIONS.includes(section) ? section : null
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 10
  return Math.max(1, Math.min(30, Math.floor(limit)))
}

function escapeLikePattern(value: string): string {
  return value.replace(/[%_]/g, match => `\\${match}`)
}
