import { getDb } from '../utils/db'
import { AiTextBlock, renderAiTextReport } from '../utils/ai-text'
import { resolveMaybeLocalizedText } from '../utils/localization'

export async function getItemStats(itemId: string) {
  const db = getDb()
  const rows = db
    .query<any, any>(
      `
      SELECT *
      FROM bannerlord_items
      WHERE entityId = $id
      ORDER BY entityKind, filePath
    `
    )
    .all({ $id: itemId })

  if (rows.length === 0) {
    return { content: [{ type: 'text' as const, text: `Item or crafting piece not found: ${itemId}` }] }
  }

  const blocks: AiTextBlock[] = rows.map((row, index) => ({
    header: `${row.entityKind || 'entity'}_${index + 1}`,
    fields: [
      { key: 'source_path', value: row.filePath },
      { key: 'entity_kind', value: row.entityKind },
      { key: 'entity_id', value: row.entityId },
      { key: 'display_name', value: resolveMaybeLocalizedText(row.name) },
      { key: 'item_type', value: row.itemType },
      { key: 'weight', value: row.weight },
      { key: 'value', value: row.value },
      { key: 'weapon_length', value: row.weaponLength },
      { key: 'swing_damage', value: row.swingDamage },
      { key: 'swing_damage_type', value: row.swingDamageType },
      { key: 'thrust_damage', value: row.thrustDamage },
      { key: 'thrust_damage_type', value: row.thrustDamageType },
      { key: 'speed_rating', value: row.speedRating },
      { key: 'balance_or_hit_points', value: row.balanceOrHitPoints },
      { key: 'head_armor', value: row.headArmor },
      { key: 'body_armor', value: row.bodyArmor },
      { key: 'leg_armor', value: row.legArmor },
      { key: 'arm_armor', value: row.armArmor },
      { key: 'horse_charge_damage', value: row.horseChargeDamage },
      { key: 'horse_speed', value: row.horseSpeed },
      { key: 'horse_maneuver', value: row.horseManeuver },
      { key: 'tier', value: row.tier },
      { key: 'piece_type', value: row.pieceType },
      { key: 'piece_length', value: row.length },
      { key: 'material_count', value: row.materialCount },
    ],
  }))

  const output = renderAiTextReport('item_stats', 'query_item_id', itemId, blocks)

  return { content: [{ type: 'text' as const, text: output }] }
}
