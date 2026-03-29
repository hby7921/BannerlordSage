import { readdir } from 'node:fs/promises'
import { PathSandbox } from '../utils/path-sandbox'

export async function listDirectory(sandbox: PathSandbox, relativePath: string = '') {
  try {
    const fullPath = sandbox.validateAndResolve(relativePath)
    const files = await readdir(fullPath, { withFileTypes: true })

    const formatted = files
      .map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort()
      .join('\n')

    return { content: [{ type: 'text' as const, text: formatted || 'Directory is empty.' }] }
  } catch {
    throw new Error(`Failed to list directory: ${relativePath}`)
  }
}
