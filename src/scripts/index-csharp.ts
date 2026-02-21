// src/scripts/index-csharp.ts
import { Database } from 'bun:sqlite'
import { file, Glob } from 'bun'
import { join } from 'path'
import { dbPath, sourcePath } from '../utils/env'

// 这个正则表达式可以精准抓取 C# 中的类、结构体、接口和枚举
const typeRegex =
  /^\s*(?:public|private|protected|internal|abstract|sealed|static|partial|readonly|unsafe|\s)*\s+(class|struct|interface|enum)\s+([a-zA-Z0-9_]+)/

async function main() {
  console.log(`开始扫描骑砍2 C# 源码，路径: ${sourcePath}`)

  const db = new Database(dbPath)

  try {
    // 创建一个名为 csharp_index 的表来充当我们的“API户口本”
    db.run(`
      CREATE TABLE IF NOT EXISTS csharp_index (
        typeName TEXT,
        filePath TEXT,
        startLine INTEGER,
        typeKind TEXT,
        PRIMARY KEY (typeName, filePath) 
      );
    `)

    const insert = db.prepare(`
      INSERT OR REPLACE INTO csharp_index (typeName, filePath, startLine, typeKind)
      VALUES ($typeName, $filePath, $startLine, $typeKind)
    `)

    const glob = new Glob('**/*.cs')

    let fileCount = 0
    let typeCount = 0
    const batch: any[] = []

    // 遍历 Source 目录下的所有 .cs 文件
    for await (const relativePath of glob.scan({
      cwd: sourcePath,
      onlyFiles: true,
    })) {
      fileCount += 1
      const absolutePath = join(sourcePath, relativePath)

      try {
        const content = await file(absolutePath).text()
        const lines = content.split(/\r?\n/)
        const normalizedPath = relativePath.replaceAll('\\', '/')

        lines.forEach((line, index) => {
          if (line.length < 10) return

          const match = line.match(typeRegex)
          if (match) {
            const typeKind = match[1]
            const typeName = match[2]

            batch.push({
              $typeName: typeName,
              $filePath: normalizedPath,
              $startLine: index, // 0-indexed 行号
              $typeKind: typeKind,
            })
            typeCount++
          }
        })
      } catch (error) {
        console.warn(`读取文件失败 ${relativePath}:`, error)
      }
    }

    console.log(`共扫描了 ${fileCount} 个文件. 正在将 ${typeCount} 个类型写入本地数据库...`)

    // 使用事务批量写入，速度极快
    const transaction = db.transaction((entries: any[]) => {
      for (const entry of entries) {
        insert.run(entry)
      }
    })

    transaction(batch)
    console.log(`太棒了！索引建立完成。`)
  } finally {
    db.close()
  }
}

try {
  main()
} catch (error) {
  console.log('致命错误:', error)
  process.exit(1)
}