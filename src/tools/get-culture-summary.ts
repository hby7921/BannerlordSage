import { getDb } from '../utils/db'
import { AiTextBlock, renderAiTextReport } from '../utils/ai-text'
import { formatReferenceLabel, lookupPolicyName } from '../utils/bannerlord-entity-resolver'
import { resolveMaybeLocalizedText } from '../utils/localization'

export async function getCultureSummary(cultureId: string) {
  const db = getDb()
  const rows = db
    .query<any, any>(
      `
      SELECT *
      FROM bannerlord_cultures
      WHERE cultureId = $id
      ORDER BY
        (maleNameCount + femaleNameCount) DESC,
        CASE WHEN descriptionText IS NOT NULL AND descriptionText <> '' THEN 0 ELSE 1 END,
        filePath
    `
    )
    .all({ $id: cultureId })

  if (rows.length === 0) {
    return { content: [{ type: 'text' as const, text: `Culture not found: ${cultureId}` }] }
  }

  const blocks: AiTextBlock[] = rows.map((row, index) => {
    const defaultPolicies = parseIdList(row.defaultPolicyIdsJson).map(policyId =>
      formatReferenceLabel(policyId, lookupPolicyName(db, policyId))
    )

    return {
      header: `culture_${index + 1}`,
      fields: [
        { key: 'source_path', value: row.filePath },
        { key: 'culture_id', value: row.cultureId },
        { key: 'display_name', value: resolveMaybeLocalizedText(row.name) },
        { key: 'is_main_culture', value: row.isMainCulture ? 'true' : 'false' },
        { key: 'can_have_settlement', value: row.canHaveSettlement },
        { key: 'color_primary', value: row.color },
        { key: 'color_secondary', value: row.color2 },
        { key: 'basic_troop_ref', value: row.basicTroop },
        { key: 'elite_basic_troop_ref', value: row.eliteBasicTroop },
        { key: 'board_game_type', value: row.boardGameType },
        { key: 'male_name_count', value: row.maleNameCount },
        { key: 'female_name_count', value: row.femaleNameCount },
        { key: 'default_policy_count', value: row.defaultPolicyCount },
      ],
      listFields: [{ key: 'default_policy_refs', values: defaultPolicies }],
      multilineFields: [{ key: 'description', value: row.descriptionText ? resolveMaybeLocalizedText(row.descriptionText) : null }],
    }
  })

  const output = renderAiTextReport('culture_summary', 'query_culture_id', cultureId, blocks)

  return { content: [{ type: 'text' as const, text: output }] }
}

function parseIdList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
