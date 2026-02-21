// src/tools/trace-troop-tree.ts
import { getDb } from '../utils/db'
import { parser } from '../utils/xml-utils'

export async function traceTroopTree(characterId: string) {
  const db = getDb()
  const rows = db.query<any, any>("SELECT filePath, content FROM xml_data WHERE content LIKE $id")
    .all({ $id: `%id="${characterId}"%` })

  if (rows.length === 0) {
    return { content: [{ type: 'text' as const, text: `未找到兵种 ID: ${characterId}` }] }
  }

  let output = `🔍 兵种 [${characterId}] 的精准追踪报告：\n\n`
  let found = false

  for (const row of rows) {
    try {
      // 使用项目自带的 fast-xml-parser 进行 100% 准确解析
      const xmlObj = parser.parse(row.content)
      if (!xmlObj || !xmlObj.NPCCharacters || !xmlObj.NPCCharacters.NPCCharacter) continue

      const npcs = xmlObj.NPCCharacters.NPCCharacter
      // 确保转化为数组，方便遍历
      const npcArray = Array.isArray(npcs) ? npcs : [npcs]

      // 寻找完全匹配的兵种 ID (fast-xml-parser 会将属性加上 @_ 前缀)
      const targetNpc = npcArray.find((n: any) => n['@_id'] === characterId)

      if (targetNpc) {
        found = true
        output += `📄 文件来源: ${row.filePath}\n`
        output += `🏷️ 游戏内名称: ${targetNpc['@_name'] || '未知'}\n`
        output += `⭐ 等级: ${targetNpc['@_level'] || '未知'}\n`
        output += `🌍 文化阵营: ${targetNpc['@_culture'] || '未知'}\n`
        output += `⚔️ 技能模板: ${targetNpc['@_skill_template'] || '独立技能'}\n`

        // 精准处理升级树
        const upgradeTargets = targetNpc.upgrade_targets?.upgrade_target
        if (upgradeTargets) {
          const upgArray = Array.isArray(upgradeTargets) ? upgradeTargets : [upgradeTargets]
          const upgIds = upgArray.map((u: any) => u['@_id'])
          output += `📈 升级路线: ➔ ${upgIds.join(' ➔ ')}\n\n`
        } else {
          output += `📈 升级路线: 无 (已是顶级或无法升级)\n\n`
        }
      }
    } catch (err) {
      console.error(`解析 XML 文件 ${row.filePath} 失败`, err)
    }
  }

  if (!found) {
    output += `在包含该 ID 的文件中，未能通过解析器精准定位到 <NPCCharacter> 标签。可能是 XML 格式不规范或 ID 仅为部分匹配。\n`
  }

  return { content: [{ type: 'text' as const, text: output }] }
}