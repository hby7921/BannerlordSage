import { renderProjectMemoryReport, searchProjectMemories } from '../utils/project-memory'

export async function projectMemorySearch(
  query: string,
  workspace?: string,
  topic?: string,
  kind?: string,
  limit: number = 5,
  includeInactive: boolean = false
) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return { content: [{ type: 'text' as const, text: 'Project memory search query cannot be empty.' }] }
  }

  const rows = searchProjectMemories({
    query: normalizedQuery,
    workspace,
    topic,
    kind,
    limit,
    includeInactive,
  })

  if (rows.length === 0) {
    return {
      content: [{ type: 'text' as const, text: `No project memories matched query: ${normalizedQuery}` }],
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: renderProjectMemoryReport('project_memory_search', 'query_text', normalizedQuery, rows, [
          { key: 'workspace_filter', value: workspace },
          { key: 'topic_filter', value: topic },
          { key: 'kind_filter', value: kind },
          { key: 'include_inactive', value: includeInactive },
        ]),
      },
    ],
  }
}
