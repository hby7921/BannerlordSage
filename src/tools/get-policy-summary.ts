import { getDb } from '../utils/db'
import { AiTextBlock, renderAiTextReport } from '../utils/ai-text'
import {
  formatReferenceLabel,
  lookupCultureName,
  lookupKingdomInfo,
} from '../utils/bannerlord-entity-resolver'
import { normalizeBannerlordPolicyId } from '../utils/bannerlord-policy-id'
import { resolveMaybeLocalizedText } from '../utils/localization'

export async function getPolicySummary(policyId: string) {
  const db = getDb()
  const normalizedPolicyId = normalizeBannerlordPolicyId(policyId) ?? policyId
  const rows = db
    .query<any, any>(
      `
      SELECT *
      FROM bannerlord_policies
      WHERE policyId = $policyId
      LIMIT 1
    `
    )
    .all({ $policyId: normalizedPolicyId })

  if (rows.length === 0) {
    return { content: [{ type: 'text' as const, text: `Policy not found: ${policyId}` }] }
  }

  const blocks: AiTextBlock[] = rows.map((row, index) => {
    const activeKingdomRefs = parseIdList(row.activeKingdomIdsJson).map(kingdomId => {
      const kingdom = lookupKingdomInfo(db, kingdomId)
      return formatReferenceLabel(kingdomId, kingdom?.name)
    })
    const defaultCultureRefs = parseIdList(row.defaultCultureIdsJson).map(cultureId =>
      formatReferenceLabel(cultureId, lookupCultureName(db, cultureId))
    )

    return {
      header: `policy_${index + 1}`,
      fields: [
        { key: 'source_path', value: row.filePath },
        { key: 'policy_id', value: row.policyId },
        { key: 'source_object_id', value: row.rawPolicyId },
        { key: 'source_module', value: row.sourceModule },
        { key: 'display_name', value: row.displayName ? resolveMaybeLocalizedText(row.displayName) : null },
        { key: 'ruler_support', value: row.rulerSupport },
        { key: 'lords_support', value: row.lordsSupport },
        { key: 'commons_support', value: row.commonsSupport },
        { key: 'active_kingdom_count', value: row.activeKingdomCount },
        { key: 'default_culture_count', value: row.defaultCultureCount },
      ],
      listFields: [
        { key: 'active_kingdom_refs', values: activeKingdomRefs },
        { key: 'default_culture_refs', values: defaultCultureRefs },
      ],
      multilineFields: [
        { key: 'description', value: row.descriptionText ? resolveMaybeLocalizedText(row.descriptionText) : null },
        { key: 'proposal_text', value: row.proposalText ? resolveMaybeLocalizedText(row.proposalText) : null },
        { key: 'effect_summary', value: row.effectsText ? resolveMaybeLocalizedText(row.effectsText) : null },
      ],
    }
  })

  const output = renderAiTextReport('policy_summary', 'query_policy_id', policyId, blocks, [
    { key: 'normalized_policy_id', value: normalizedPolicyId },
  ])

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
