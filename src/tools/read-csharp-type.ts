// src/tools/read-csharp-type.ts
import { file } from 'bun'
import { join } from 'path'
import { getDb } from '../utils/db'
import { sourcePath } from '../utils/env'

const MAX_LINES_THRESHOLD = 400

export async function readCsharpType(typeName: string) {
  const db = getDb()
  const rows = db.query<any, any>('SELECT filePath, startLine FROM csharp_index WHERE typeName = $name').all({ $name: typeName })

  if (rows.length === 0) {
    return {
      content: [{ type: 'text' as const, text: `未在索引中找到类型 '${typeName}'。请检查拼写是否正确。` }],
    }
  }

  const parts: string[] = []
  let isTruncatedMode = false

  for (const row of rows) {
    const fullPath = join(sourcePath, row.filePath)
    if (!(await file(fullPath).exists())) continue

    const content = await file(fullPath).text()
    const allLines = content.split(/\r?\n/)
    
    // 这里就是大括号计数魔法！
    const { code, lineCount } = extractCodeBlock(allLines, row.startLine)
    
    let finalCode = code
    let header = `// 文件: ${row.filePath} (行号 ${row.startLine + 1}-${row.startLine + lineCount})`

    if (lineCount > MAX_LINES_THRESHOLD) {
      isTruncatedMode = true
      finalCode = generateSignature(code)
      header += ` [自动折叠: 代码过长，已隐藏内部实现]`
    }

    parts.push(`${header}\n${finalCode}`)
  }

  let output = parts.join('\n\n')
  if (isTruncatedMode) {
    output += `\n\n[系统提示] 由于代码过长，部分方法的内部实现已被折叠。`
  }

  return { content: [{ type: 'text' as const, text: output }] }
}

// 大括号截取核心算法
function extractCodeBlock(lines: string[], startLine: number) {
  let buffer: string[] = []
  let braceCount = 0
  let foundStart = false

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]
    buffer.push(line)
    for (const char of line) {
      if (char === '{') { braceCount += 1; foundStart = true } 
      else if (char === '}') { braceCount -= 1 }
    }
    if (foundStart && braceCount === 0) break
  }
  return { code: buffer.join('\n'), lineCount: buffer.length }
}

// 代码太长时的自动摘要算法
function generateSignature(code: string): string {
  const lines = code.split('\n')
  const output: string[] = []
  let depth = 0

  for (const line of lines) {
    let depthChange = 0
    for (const char of line) {
      if (char === '{') depthChange++
      if (char === '}') depthChange--
    }

    if (depth <= 1) {
      if (depth === 1 && depthChange > 0) {
        output.push(line)
        if (!line.includes('}')) output.push('    // ... 实现已隐藏 ...')
      } else {
        output.push(line)
      }
    } else if (depth + depthChange <= 1) {
      const indent = line.match(/^\s*/)?.[0] || ''
      output.push(`${indent}}`)
    }
    depth += depthChange
  }
  return output.join('\n')
}