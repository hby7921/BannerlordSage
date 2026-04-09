import { listRecentProjectMemories, renderProjectMemoryReport } from '../utils/project-memory'

export async function projectMemoryRecent(
  workspace?: string,
  topic?: string,
  kind?: string,
  limit: number = 8,
  includeInactive: boolean = false
) {
  const rows = listRecentProjectMemories({
    workspace,
    topic,
    kind,
    limit,
    includeInactive,
  })

  if (rows.length === 0) {
    return { content: [{ type: 'text' as const, text: 'No project memories found.' }] }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: renderProjectMemoryReport('project_memory_recent', 'scope', workspace?.trim() || 'all', rows, [
          { key: 'topic_filter', value: topic },
          { key: 'kind_filter', value: kind },
          { key: 'include_inactive', value: includeInactive },
        ]),
      },
    ],
  }
}
