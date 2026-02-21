// src/scripts/index-xml.ts
import { file, Glob } from 'bun'
import { join } from 'path'
import { defsPath, dbPath } from '../utils/env'
import { Database } from 'bun:sqlite'

async function main() {
  console.log('正在索引 XML 文件...')
  const db = new Database(dbPath)
  
  db.run(`
    CREATE TABLE IF NOT EXISTS xml_data (
      name TEXT,
      type TEXT,
      content TEXT,
      filePath TEXT,
      PRIMARY KEY (name, type)
    );
  `)

  const insert = db.prepare('INSERT OR REPLACE INTO xml_data (name, type, content, filePath) VALUES ($name, $type, $content, $path)')
  const glob = new Glob('**/*.xml')

  for await (const path of glob.scan({ cwd: defsPath })) {
    const text = await file(join(defsPath, path)).text()
    // 简单的解析逻辑，实际可根据骑砍 XML 结构优化
    insert.run({
      $name: path.split('/').pop() || path,
      $type: 'XML_FILE',
      $content: text,
      $path: path
    })
  }
  
  db.close()
  console.log('XML 索引完成！')
}

main().catch(console.error)