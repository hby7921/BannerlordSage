import { PathSandbox } from '../utils/path-sandbox'
import { renderAiTextReport } from '../utils/ai-text'
import { readTextFileSlice } from '../utils/text-file-cache'

export async function readFile(
  sandbox: PathSandbox,
  relativePath: string,
  startLine: number = 0,
  lineCount: number = 400
) {
  try {
    const fullPath = sandbox.validateAndResolve(relativePath)
    const slice = await readTextFileSlice(fullPath, startLine, lineCount)
    const text = renderAiTextReport(
      'file_read',
      'query_relative_path',
      relativePath,
      [
        {
          header: 'file_slice',
          fields: [
            { key: 'resolved_path', value: relativePath },
            { key: 'start_line_0based', value: startLine },
            { key: 'requested_line_count', value: lineCount },
            { key: 'returned_line_count', value: slice.endLineExclusive - startLine },
            { key: 'end_line_exclusive_0based', value: slice.endLineExclusive },
            { key: 'has_more', value: slice.hasMore ? 'true' : 'false' },
          ],
          multilineFields: [{ key: 'file_content', value: slice.text }],
        },
      ]
    )

    return {
      content: [
        {
          type: 'text' as const,
          text,
        },
      ],
    }
  } catch {
    throw new Error(`Failed to read file: ${relativePath}`)
  }
}
