import { getDb } from '../utils/db'
import { AiTextBlock, renderAiTextReport } from '../utils/ai-text'
import {
  formatReferenceLabel,
  lookupCultureName,
  lookupHeroName,
  lookupPolicyName,
  lookupSettlementInfo,
} from '../utils/bannerlord-entity-resolver'
import { resolveMaybeLocalizedText } from '../utils/localization'

export async function getKingdomSummary(kingdomId: string) {
  const db = getDb()
  const rows = db
    .query<any, any>(
      `
      SELECT *
      FROM bannerlord_kingdoms
      WHERE kingdomId = $id
      ORDER BY filePath
    `
    )
    .all({ $id: kingdomId })

  if (rows.length === 0) {
    return { content: [{ type: 'text' as const, text: `Kingdom not found: ${kingdomId}` }] }
  }

  const blocks: AiTextBlock[] = rows.map((row, index) => {
    const cultureName = lookupCultureName(db, row.culture)
    const ownerName = lookupHeroName(db, row.owner)
    const homeSettlement = lookupSettlementInfo(db, row.initialHomeSettlement)
    const activePolicies = parseIdList(row.policyIdsJson).map(policyId =>
      formatReferenceLabel(policyId, lookupPolicyName(db, policyId))
    )

    return {
      header: `kingdom_${index + 1}`,
      fields: [
        { key: 'source_path', value: row.filePath },
        { key: 'kingdom_id', value: row.kingdomId },
        { key: 'display_name', value: resolveMaybeLocalizedText(row.name) },
        { key: 'short_name', value: row.shortName ? resolveMaybeLocalizedText(row.shortName) : null },
        { key: 'title', value: row.title ? resolveMaybeLocalizedText(row.title) : null },
        { key: 'ruler_title', value: row.rulerTitle ? resolveMaybeLocalizedText(row.rulerTitle) : null },
        { key: 'culture_ref', value: formatReferenceLabel(row.culture, cultureName) },
        { key: 'owner_hero_ref', value: formatReferenceLabel(row.owner, ownerName) },
        { key: 'home_settlement_ref', value: formatReferenceLabel(row.initialHomeSettlement, homeSettlement?.name) },
        { key: 'color_primary', value: row.color },
        { key: 'color_secondary', value: row.color2 },
        { key: 'banner_color_primary', value: row.primaryBannerColor },
        { key: 'banner_color_secondary', value: row.secondaryBannerColor },
        { key: 'relationship_count', value: row.relationshipCount },
        { key: 'policy_count', value: row.policyCount },
      ],
      listFields: [{ key: 'active_policy_refs', values: activePolicies }],
      multilineFields: [{ key: 'description', value: row.descriptionText ? resolveMaybeLocalizedText(row.descriptionText) : null }],
    }
  })

  const output = renderAiTextReport('kingdom_summary', 'query_kingdom_id', kingdomId, blocks)

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
