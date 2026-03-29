import { getDb } from '../utils/db'
import { AiTextBlock, renderAiTextReport } from '../utils/ai-text'

export async function getSkillData(skillId: string) {
  const db = getDb()
  const rows = db
    .query<any, any>(
      `
      SELECT *
      FROM bannerlord_skills
      WHERE skillId = $id
      ORDER BY filePath
    `
    )
    .all({ $id: skillId })

  if (rows.length === 0) {
    return { content: [{ type: 'text' as const, text: `Skill data not found: ${skillId}` }] }
  }

  const blocks: AiTextBlock[] = rows.map((row, index) => ({
    header: `skill_${index + 1}`,
    fields: [
      { key: 'source_path', value: row.filePath },
      { key: 'skill_id', value: row.skillId },
      { key: 'display_name', value: row.name },
      { key: 'modifier_count', value: row.modifierCount },
    ],
    listFields: [
      {
        key: 'modifiers',
        values: parseModifiers(row.modifiersJson).map(
          modifier =>
            `attrib_code=${modifier.attribCode || 'unknown'} | modification=${modifier.modification || 'unknown'} | value=${modifier.value || 'unknown'}`
        ),
      },
    ],
    multilineFields: [{ key: 'documentation', value: row.documentation }],
  }))

  const output = renderAiTextReport('skill_data', 'query_skill_id', skillId, blocks)

  return { content: [{ type: 'text' as const, text: output }] }
}

type SkillModifier = {
  attribCode?: string | null
  modification?: string | null
  value?: string | null
}

function parseModifiers(raw: string): SkillModifier[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
