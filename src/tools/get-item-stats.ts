// src/tools/get-item-stats.ts
import { getDb } from '../utils/db'
import { parser } from '../utils/xml-utils'

export async function getItemStats(itemId: string) {
  const db = getDb()
  const rows = db.query<any, any>("SELECT filePath, content FROM xml_data WHERE content LIKE $id")
    .all({ $id: `%id="${itemId}"%` })

  if (rows.length === 0) return { content: [{ type: 'text' as const, text: `未找到物品或配件 ID: ${itemId}` }] }

  let output = `⚔️ [${itemId}] 精准数据面板：\n\n`
  let found = false

  for (const row of rows) {
    try {
      const xmlObj = parser.parse(row.content)

      // ==========================================
      // 1. 尝试解析常规物品 (武器、防具、马匹、盾牌)
      // ==========================================
      if (xmlObj?.Items?.Item) {
        const items = Array.isArray(xmlObj.Items.Item) ? xmlObj.Items.Item : [xmlObj.Items.Item]
        const targetItem = items.find((i: any) => i['@_id'] === itemId)

        if (targetItem) {
          found = true
          output += `📄 文件: ${row.filePath}\n`
          output += `🏷️ 名称: ${targetItem['@_name'] || '未知'}\n`
          output += `⚖️ 重量: ${targetItem['@_weight'] || '未知'} | 💰 价值: ${targetItem['@_value'] || '未知'}\n`
          output += `📦 类型: ${targetItem['@_Type'] || '未知'}\n`

          // 解析 ItemComponent 里的具体战斗数值
          const component = targetItem.ItemComponent
          if (component) {
            // 解析武器/盾牌
            if (component.Weapon) {
              const wp = Array.isArray(component.Weapon) ? component.Weapon[0] : component.Weapon
              output += `\n🗡️ [武器/盾牌属性]\n`
              output += `- 长度: ${wp['@_weapon_length'] || '未知'}\n`
              if (wp['@_swing_damage']) output += `- 挥砍伤害: ${wp['@_swing_damage']} (${wp['@_swing_damage_type'] || '无'})\n`
              if (wp['@_thrust_damage']) output += `- 刺击伤害: ${wp['@_thrust_damage']} (${wp['@_thrust_damage_type'] || '无'})\n`
              output += `- 速度: ${wp['@_speed_rating'] || '未知'}\n`
              output += `- 操控性/耐久: ${wp['@_weapon_balance'] || wp['@_hit_points'] || '未知'}\n`
            }
            // 解析护甲
            if (component.Armor) {
              const ar = Array.isArray(component.Armor) ? component.Armor[0] : component.Armor
              output += `\n🛡️ [护甲属性]\n`
              if (ar['@_head_armor']) output += `- 头部护甲: ${ar['@_head_armor']}\n`
              if (ar['@_body_armor']) output += `- 身体护甲: ${ar['@_body_armor']}\n`
              if (ar['@_leg_armor']) output += `- 腿部护甲: ${ar['@_leg_armor']}\n`
              if (ar['@_arm_armor']) output += `- 手臂护甲: ${ar['@_arm_armor']}\n`
            }
            // 解析马匹
            if (component.Horse) {
              const hr = Array.isArray(component.Horse) ? component.Horse[0] : component.Horse
              output += `\n🐎 [马匹属性]\n`
              output += `- 冲撞伤害: ${hr['@_charge_damage'] || 0}\n`
              output += `- 速度: ${hr['@_speed'] || 0}\n`
              output += `- 机动性: ${hr['@_maneuver'] || 0}\n`
            }
          }
          output += `\n`
        }
      }

      // ==========================================
      // 2. 尝试解析锻造配件 (CraftingPiece)
      // ==========================================
      if (xmlObj?.CraftingPieces?.CraftingPiece) {
        const pieces = Array.isArray(xmlObj.CraftingPieces.CraftingPiece) ? xmlObj.CraftingPieces.CraftingPiece : [xmlObj.CraftingPieces.CraftingPiece]
        const targetPiece = pieces.find((p: any) => p['@_id'] === itemId)

        if (targetPiece) {
          found = true
          output += `📄 文件: ${row.filePath}\n`
          output += `🔨 配件名称: ${targetPiece['@_name'] || '未知'}\n`
          output += `⭐ 等级 (Tier): ${targetPiece['@_tier'] || '未知'}\n`
          output += `🧩 部位: ${targetPiece['@_piece_type'] || '未知'}\n`
          output += `📏 长度: ${targetPiece['@_length'] || '未知'} | ⚖️ 重量: ${targetPiece['@_weight'] || '未知'}\n`
          
          if (targetPiece.Materials?.Material) {
            output += `🧱 所需材料: 包含 ${Array.isArray(targetPiece.Materials.Material) ? targetPiece.Materials.Material.length : 1} 种材料\n`
          }
          output += `\n`
        }
      }

    } catch (err) {
      console.error(`解析 XML 文件 ${row.filePath} 失败`, err)
    }
  }

  if (!found) {
    output += `数据库中存在该 ID，但未能通过解析器精准提取数据。可能是该节点并非标准的 Item 或 CraftingPiece。\n`
  }

  return { content: [{ type: 'text' as const, text: output }] }
}