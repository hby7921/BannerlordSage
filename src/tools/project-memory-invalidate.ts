import { invalidateProjectMemory, renderProjectMemoryReport } from '../utils/project-memory'

export async function projectMemoryInvalidate(memoryId: string, reason?: string) {
  const memory = invalidateProjectMemory(memoryId, reason)

  if (!memory) {
    return { content: [{ type: 'text' as const, text: `Project memory not found: ${memoryId}` }] }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: renderProjectMemoryReport('project_memory_invalidate', 'memory_id', memory.memoryId, [memory]),
      },
    ],
  }
}
