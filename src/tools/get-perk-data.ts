import { getDb } from '../utils/db'
import { AiTextBlock, renderAiTextReport } from '../utils/ai-text'
import { resolveMaybeLocalizedText } from '../utils/localization'

export async function getPerkData(perkId: string) {
  const db = getDb()
  const rows = db
    .query<any, any>(
      `
      SELECT *
      FROM bannerlord_perks
      WHERE perkId = $perkId OR lower(perkId) = lower($perkId)
      ORDER BY sourceOrder
    `
    )
    .all({ $perkId: perkId })

  if (rows.length === 0) {
    return { content: [{ type: 'text' as const, text: `Perk not found: ${perkId}` }] }
  }

  const blocks: AiTextBlock[] = rows.map((row, index) => {
    const alternativePerkName = lookupPerkName(db, row.alternativePerkId)

    return {
      header: `perk_${index + 1}`,
      fields: [
        { key: 'source_path', value: row.filePath },
        { key: 'perk_id', value: row.perkId },
        { key: 'source_module', value: row.sourceModule },
        { key: 'skill_id', value: row.skillId },
        { key: 'tier_index', value: row.tierIndex },
        { key: 'required_skill_value', value: row.requiredSkillValue },
        { key: 'display_name', value: row.displayName ? resolveMaybeLocalizedText(row.displayName) : null },
        {
          key: 'alternative_perk_ref',
          value: row.alternativePerkId
            ? alternativePerkName
              ? `${resolveMaybeLocalizedText(alternativePerkName)} [${row.alternativePerkId}]`
              : row.alternativePerkId
            : null,
        },
        { key: 'primary_role', value: row.primaryRole },
        { key: 'primary_bonus', value: row.primaryBonus },
        { key: 'primary_increment_type', value: row.primaryIncrementType },
        { key: 'primary_troop_usage_mask', value: row.primaryTroopUsageMask },
        { key: 'secondary_role', value: row.secondaryRole },
        { key: 'secondary_bonus', value: row.secondaryBonus },
        { key: 'secondary_increment_type', value: row.secondaryIncrementType },
        { key: 'secondary_troop_usage_mask', value: row.secondaryTroopUsageMask },
        { key: 'source_order', value: row.sourceOrder },
      ],
      multilineFields: [
        { key: 'primary_description', value: row.primaryDescription ? resolveMaybeLocalizedText(row.primaryDescription) : null },
        {
          key: 'secondary_description',
          value: row.secondaryDescription ? resolveMaybeLocalizedText(row.secondaryDescription) : null,
        },
      ],
    }
  })

  const output = renderAiTextReport('perk_data', 'query_perk_id', perkId, blocks)

  return { content: [{ type: 'text' as const, text: output }] }
}

function lookupPerkName(db: ReturnType<typeof getDb>, perkId: string | null): string | null {
  if (!perkId) return null

  const row = db
    .query<{ displayName: string | null } | null, { $perkId: string }>(
      `
      SELECT displayName
      FROM bannerlord_perks
      WHERE perkId = $perkId
      LIMIT 1
    `
    )
    .get({ $perkId: perkId })

  return row?.displayName ?? null
}
