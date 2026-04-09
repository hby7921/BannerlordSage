import { getProjectMemoryWakeup, renderProjectMemoryReport } from '../utils/project-memory'

export async function projectMemoryWakeup(workspace?: string, limit: number = 8) {
  const rows = getProjectMemoryWakeup(workspace, limit)

  if (rows.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `No active wake-up memories found for workspace: ${workspace?.trim() || 'bannerlordsage'}`,
        },
      ],
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: renderProjectMemoryReport('project_memory_wakeup', 'workspace', workspace?.trim() || 'all', rows),
      },
    ],
  }
}
