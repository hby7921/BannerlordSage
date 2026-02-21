// src/tools/list-directory.ts
import { readdir } from 'fs/promises'
import { join } from 'path'
import { PathSandbox } from '../utils/path-sandbox'

export async function listDirectory(sandbox: PathSandbox, relativePath: string = '') {
  try {
    const fullPath = sandbox.validateAndResolve(relativePath)
    const files = await readdir(fullPath, { withFileTypes: true })
    
    const formatted = files
      .map(f => (f.isDirectory() ? `${f.name}/` : f.name))
      .sort()
      .join('\n')

    return { content: [{ type: 'text' as const, text: formatted || '目录为空' }] }
  } catch (error) {
    throw new Error(`无法列出目录: ${relativePath}`)
  }
}