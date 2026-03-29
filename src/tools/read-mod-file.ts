import { PathSandbox } from '../utils/path-sandbox'
import { ensureModSourceDir } from '../utils/mod-source'
import { readFile } from './read-file'

export async function readModFile(
  workspaceRoot: string | undefined,
  relativePath: string,
  startLine: number = 0,
  lineCount: number = 400
) {
  const sourceDir = await ensureModSourceDir(workspaceRoot)
  return readFile(new PathSandbox(sourceDir), relativePath, startLine, lineCount)
}
