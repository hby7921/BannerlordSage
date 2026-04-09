import { captureProjectMemorySession, renderProjectMemoryReport } from '../utils/project-memory'

export async function projectMemoryCaptureSession(
  workspace?: string,
  topic?: string,
  source?: string,
  summary?: string,
  decisions?: string[],
  pitfalls?: string[],
  preferences?: string[],
  todos?: string[],
  notes?: string[],
  sessionImportance: number = 3
) {
  const rows = captureProjectMemorySession({
    workspace,
    topic,
    source,
    summary,
    decisions,
    pitfalls,
    preferences,
    todos,
    notes,
    sessionImportance,
  })

  if (rows.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'No durable session memories were provided. Add at least one summary, decision, pitfall, preference, todo, or note.',
        },
      ],
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: renderProjectMemoryReport('project_memory_capture_session', 'workspace', workspace?.trim() || 'bannerlordsage', rows, [
          { key: 'topic', value: topic },
          { key: 'source', value: source },
        ]),
      },
    ],
  }
}
