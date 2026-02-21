// src/tools/search-source.ts
import { $ } from 'bun'
import { PathSandbox } from '../utils/path-sandbox'

const MAX_RESULT_LINES = 400

export async function searchSource(sandbox: PathSandbox, query: string, caseSensitive: boolean = false, filePattern?: string) {
  const args = ['--line-number', '--heading', '--color', 'never']
  if (caseSensitive) args.push('-s')
  else args.push('-i')
  
  if (filePattern) args.push('-g', filePattern)
  args.push('-e', query)

  try {
    const res = await $`rg ${args} .`.cwd(sandbox.basePath).text()
    const result = res.trim()
    
    if (result.length === 0) return { content: [{ type: 'text' as const, text: '未找到结果。' }] }

    const lines = result.split(/\r?\n/)
    if (lines.length > MAX_RESULT_LINES) {
      return { content: [{ type: 'text' as const, text: lines.slice(0, MAX_RESULT_LINES).join('\n') + `\n\n[已折叠] 结果过多，仅显示前 400 行。` }] }
    }

    return { content: [{ type: 'text' as const, text: result }] }
  } catch (error: any) {
    if (error.exitCode === 1) return { content: [{ type: 'text' as const, text: '未找到匹配项。' }] }
    throw error
  }
}
