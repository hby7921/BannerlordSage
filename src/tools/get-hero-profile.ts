import { getDb } from '../utils/db'
import { AiTextBlock, renderAiTextReport } from '../utils/ai-text'
import { resolveMaybeLocalizedText } from '../utils/localization'

export async function getHeroProfile(heroId: string) {
  const db = getDb()
  const rows = db
    .query<any, any>(
      `
      SELECT
        h.*,
        t.name AS troopName,
        t.culture AS troopCulture,
        t.occupation AS troopOccupation,
        t.skillTemplate AS troopSkillTemplate,
        t.isFemale AS troopIsFemale
      FROM bannerlord_heroes h
      LEFT JOIN bannerlord_troops t
        ON t.characterId = h.heroId
      WHERE h.heroId = $id
      ORDER BY h.filePath, t.filePath
    `
    )
    .all({ $id: heroId })

  if (rows.length === 0) {
    return { content: [{ type: 'text' as const, text: `Hero not found: ${heroId}` }] }
  }

  const blocks: AiTextBlock[] = rows.map((row, index) => ({
    header: `hero_${index + 1}`,
    fields: [
      { key: 'source_path', value: row.filePath },
      { key: 'hero_id', value: row.heroId },
      { key: 'display_name', value: resolveMaybeLocalizedText(row.troopName) },
      { key: 'faction_ref', value: row.faction },
      { key: 'clan_ref', value: row.clan },
      { key: 'culture_ref', value: row.troopCulture },
      { key: 'occupation', value: row.troopOccupation },
      { key: 'alive', value: formatAlive(row.alive) },
      { key: 'is_template', value: row.isTemplate ? 'true' : 'false' },
      { key: 'gender', value: row.troopIsFemale ? 'female' : 'male_or_unspecified' },
      { key: 'skill_template', value: row.troopSkillTemplate },
      { key: 'spouse_ref', value: row.spouse },
      { key: 'father_ref', value: row.father },
      { key: 'mother_ref', value: row.mother },
    ],
    multilineFields: [{ key: 'biography', value: row.text ? resolveMaybeLocalizedText(row.text) : null }],
  }))

  const output = renderAiTextReport('hero_profile', 'query_hero_id', heroId, blocks)

  return { content: [{ type: 'text' as const, text: output }] }
}

function formatAlive(value: string | null): string {
  if (!value) return 'yes'
  return value.toLowerCase() === 'false' ? 'no' : 'yes'
}
