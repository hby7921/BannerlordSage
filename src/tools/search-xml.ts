import { getDb } from '../utils/db'
import { AiTextBlock, renderAiTextReport } from '../utils/ai-text'

export async function searchXml(query: string) {
  const db = getDb()
  const ftsQuery = buildFtsQuery(query)
  const rows = db
    .query<any, any>(
      `
      SELECT
        filePath,
        moduleName,
        snippet(xml_documents_fts, 2, '[', ']', ' ... ', 18) AS snippet
      FROM xml_documents_fts
      WHERE xml_documents_fts MATCH $query
      ORDER BY bm25(xml_documents_fts, 8.0, 4.0, 1.0)
      LIMIT 10
    `
    )
    .all({ $query: ftsQuery })

  if (rows.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: renderAiTextReport('xml_search', 'query_text', query, [], [
            { key: 'fts_query', value: ftsQuery },
          ]),
        },
      ],
    }
  }

  const blocks: AiTextBlock[] = rows.map((row: any, index: number) => ({
    header: `match_${index + 1}`,
    fields: [
      { key: 'module_name', value: row.moduleName },
      { key: 'file_path', value: row.filePath },
    ],
    multilineFields: [{ key: 'snippet', value: row.snippet || '(no snippet)' }],
  }))

  const text = renderAiTextReport('xml_search', 'query_text', query, blocks, [{ key: 'fts_query', value: ftsQuery }])

  return { content: [{ type: 'text' as const, text }] }
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
