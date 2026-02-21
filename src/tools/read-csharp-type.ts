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

function extractCodeBlock(lines: string[], startLine: number) {
  let buffer: string[] = []
  let braceCount = 0
  let foundStart = false
  let inBlockComment = false // 增加一个状态，记住我们是不是在跨行注释里

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]
    buffer.push(line)
    
    let tempLine = line

    // 1. 如果还在跨行块注释里，寻找结束符
    if (inBlockComment) {
      const endIdx = tempLine.indexOf('*/')
      if (endIdx !== -1) {
        inBlockComment = false
        tempLine = tempLine.substring(endIdx + 2)
      } else {
        tempLine = '' // 这一整行都还在注释里，直接清空
      }
    }

    // 2. 处理同行内的 /* */，或者发现新开启的跨行注释 /*
    while (!inBlockComment && tempLine.includes('/*')) {
      const startIdx = tempLine.indexOf('/*')
      const endIdx = tempLine.indexOf('*/', startIdx + 2)
      if (endIdx !== -1) {
        // 同行内结束了，把注释部分挖掉
        tempLine = tempLine.substring(0, startIdx) + tempLine.substring(endIdx + 2)
      } else {
        // 没结束，说明开启了跨行注释
        inBlockComment = true
        tempLine = tempLine.substring(0, startIdx)
      }
    }

    // 3. 终极正则：剔除单行注释 //、双引号字符串 ""、单引号字符 ''
    const sanitizedLine = tempLine.replace(/\/\/.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '')
    
    // 4. 安全地数大括号
    for (const char of sanitizedLine) {
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
        if (!line.includes('}')) output.push('    // ... 实现已隐藏 ...')
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
