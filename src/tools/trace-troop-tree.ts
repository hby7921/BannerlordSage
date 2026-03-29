import { getDb } from '../utils/db'
import { AiTextBlock, renderAiTextReport } from '../utils/ai-text'
import { resolveMaybeLocalizedText } from '../utils/localization'

export async function traceTroopTree(characterId: string) {
  const db = getDb()
  const rows = db
    .query<any, any>(
      `
      SELECT *
      FROM bannerlord_troops
      WHERE characterId = $id
      ORDER BY filePath
    `
    )
    .all({ $id: characterId })

  if (rows.length === 0) {
    return { content: [{ type: 'text' as const, text: `Troop not found: ${characterId}` }] }
  }

  const blocks: AiTextBlock[] = rows.map((row, index) => ({
    header: `troop_${index + 1}`,
    fields: [
      { key: 'source_path', value: row.filePath },
      { key: 'character_id', value: row.characterId },
      { key: 'display_name', value: resolveMaybeLocalizedText(row.name) },
      { key: 'level', value: row.level },
      { key: 'culture_ref', value: row.culture },
      { key: 'occupation', value: row.occupation },
      { key: 'skill_template', value: row.skillTemplate || 'custom' },
      { key: 'is_hero', value: Number(row.isHero) ? 'true' : 'false' },
      { key: 'is_female', value: Number(row.isFemale) ? 'true' : 'false' },
    ],
    listFields: [
      {
        key: 'upgrade_target_ids',
        values: parseUpgradeTargets(row.upgradeTargetsJson),
      },
    ],
  }))

  const output = renderAiTextReport('troop_tree', 'query_character_id', characterId, blocks)

  return { content: [{ type: 'text' as const, text: output }] }
}

function parseUpgradeTargets(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
