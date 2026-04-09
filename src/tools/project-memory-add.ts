import { addProjectMemory, renderProjectMemoryReport } from '../utils/project-memory'

export async function projectMemoryAdd(
  text: string,
  workspace?: string,
  topic?: string,
  kind?: string,
  summary?: string,
  source?: string,
  tags?: string[],
  importance: number = 3
) {
  const normalizedText = text.trim()
  if (!normalizedText) {
    return { content: [{ type: 'text' as const, text: 'Cannot store an empty project memory.' }] }
  }

  const memory = addProjectMemory({
    text: normalizedText,
    workspace,
    topic,
    kind,
    summary,
    source,
    tags,
    importance,
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: renderProjectMemoryReport('project_memory_add', 'stored_memory_id', memory.memoryId, [memory]),
      },
    ],
  }
}
