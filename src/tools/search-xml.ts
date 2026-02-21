// src/tools/search-xml.ts
import { getDb } from '../utils/db'

export async function searchXml(query: string) {
  const db = getDb()
  const rows = db.query<any, any>("SELECT name, filePath FROM xml_data WHERE content LIKE $q LIMIT 10")
    .all({ $q: `%${query}%` })

  if (rows.length === 0) return { content: [{ type: 'text' as const, text: '未在 XML 中找到相关内容。' }] }

  const text = rows.map(r => `文件: ${r.filePath}`).join('\n')
  return { content: [{ type: 'text' as const, text: `找到相关 XML 文件：\n${text}` }] }
}