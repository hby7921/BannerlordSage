import { databaseHasTable, getDb } from '../utils/db'
import { getGamePaths } from '../utils/env'
import { renderAiTextReport, type AiTextBlock } from '../utils/ai-text'

type DocsSourceFilter = 'all' | 'official' | 'community'

export async function searchDocs(query: string, source: DocsSourceFilter = 'all', limit = 8) {
  const db = getDb()
  const paths = getGamePaths()

  if (!databaseHasTable(paths.dbPath, 'bannerlord_docs_fts')) {
    return {
      content: [
        {
          type: 'text' as const,
          text: renderAiTextReport('bannerlord_docs_search', 'query_text', query, [], [
            { key: 'index_status', value: 'missing' },
            { key: 'setup_hint', value: 'Run bun run index:docs first.' },
          ]),
        },
      ],
    }
  }

  const ftsQuery = buildFtsQuery(query)
  const normalizedSource = normalizeSourceFilter(source)
  const rows = db
    .query<any, any>(
      `
      SELECT
        id,
        source,
        language,
        category,
        title,
        url,
        snippet(bannerlord_docs_fts, 6, '[', ']', ' ... ', 28) AS snippet
      FROM bannerlord_docs_fts
      WHERE bannerlord_docs_fts MATCH $query
        AND ($source IS NULL OR source = $source)
      ORDER BY bm25(bannerlord_docs_fts, 0.5, 0.5, 0.5, 2.0, 8.0, 0.1, 1.0)
      LIMIT $limit
    `
    )
    .all({
      $query: ftsQuery,
      $source: normalizedSource,
      $limit: clampLimit(limit),
    })

  const blocks: AiTextBlock[] = rows.map((row: any, index: number) => ({
    header: `doc_match_${index + 1}`,
    fields: [
      { key: 'source', value: row.source },
      { key: 'language', value: row.language },
      { key: 'category', value: row.category },
      { key: 'title', value: row.title },
      { key: 'url', value: row.url },
    ],
    multilineFields: [{ key: 'snippet', value: row.snippet || '(no snippet)' }],
  }))

  return {
    content: [
      {
        type: 'text' as const,
        text: renderAiTextReport('bannerlord_docs_search', 'query_text', query, blocks, [
          { key: 'fts_query', value: ftsQuery },
          { key: 'source_filter', value: source },
          { key: 'index_status', value: 'ready' },
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

function normalizeSourceFilter(source: DocsSourceFilter): string | null {
  if (source === 'official') return 'official_moddocs'
  if (source === 'community') return 'community_modding_docs'
  return null
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 8
  return Math.max(1, Math.min(25, Math.floor(limit)))
}
