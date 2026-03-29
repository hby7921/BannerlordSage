import { getDb } from '../utils/db'
import { AiTextBlock, renderAiTextReport } from '../utils/ai-text'
import {
  formatReferenceLabel,
  lookupClanInfo,
  lookupCultureName,
  lookupKingdomInfo,
  lookupSettlementInfo,
} from '../utils/bannerlord-entity-resolver'
import { resolveMaybeLocalizedText } from '../utils/localization'

export async function getSettlementSummary(settlementId: string) {
  const db = getDb()
  const rows = db
    .query<any, any>(
      `
      SELECT *
      FROM bannerlord_settlements
      WHERE settlementId = $id
      ORDER BY
        CASE settlementType
          WHEN 'town' THEN 0
          WHEN 'castle' THEN 1
          WHEN 'village' THEN 2
          ELSE 3
        END,
        filePath
    `
    )
    .all({ $id: settlementId })

  if (rows.length === 0) {
    return { content: [{ type: 'text' as const, text: `Settlement not found: ${settlementId}` }] }
  }

  const blocks: AiTextBlock[] = rows.map((row, index) => {
    const cultureName = lookupCultureName(db, row.culture)
    const owner = resolveSettlementOwner(db, row.owner, row.boundSettlement)
    const boundSettlement = lookupSettlementInfo(db, row.boundSettlement)

    return {
      header: `settlement_${index + 1}`,
      fields: [
        { key: 'source_path', value: row.filePath },
        { key: 'settlement_id', value: row.settlementId },
        { key: 'display_name', value: resolveMaybeLocalizedText(row.name) },
        { key: 'settlement_type', value: row.settlementType },
        { key: 'culture_ref', value: formatReferenceLabel(row.culture, cultureName) },
        { key: 'owner_faction_ref', value: owner.ownerLabel },
        { key: 'derived_kingdom_ref', value: owner.kingdomLabel },
        { key: 'bound_settlement_ref', value: row.boundSettlement || boundSettlement?.name ? formatReferenceLabel(row.boundSettlement, boundSettlement?.name) : null },
        { key: 'component_id', value: row.componentId },
        { key: 'village_type', value: row.villageType },
        { key: 'prosperity_or_hearth', value: row.prosperityOrHearth },
        { key: 'map_pos_x', value: row.positionX },
        { key: 'map_pos_y', value: row.positionY },
        { key: 'primary_scene', value: row.sceneName },
        { key: 'location_node_count', value: row.locationCount },
        { key: 'building_node_count', value: row.buildingCount },
      ],
      multilineFields: [{ key: 'description', value: row.descriptionText ? resolveMaybeLocalizedText(row.descriptionText) : null }],
    }
  })

  const output = renderAiTextReport('settlement_summary', 'query_settlement_id', settlementId, blocks)

  return { content: [{ type: 'text' as const, text: output }] }
}

function resolveSettlementOwner(
  db: ReturnType<typeof getDb>,
  ownerReference: string | null,
  boundSettlementReference: string | null
): { ownerLabel: string; kingdomLabel: string | null } {
  const directOwner = describeFactionReference(db, ownerReference)
  if (directOwner.ownerLabel !== 'unknown') {
    return directOwner
  }

  const boundSettlement = lookupSettlementInfo(db, boundSettlementReference)
  if (boundSettlement?.owner) {
    return describeFactionReference(db, boundSettlement.owner)
  }

  return { ownerLabel: 'unknown', kingdomLabel: null }
}

function describeFactionReference(
  db: ReturnType<typeof getDb>,
  reference: string | null
): { ownerLabel: string; kingdomLabel: string | null } {
  const clan = lookupClanInfo(db, reference)
  if (clan) {
    const kingdom = lookupKingdomInfo(db, clan.superFaction)
    return {
      ownerLabel: formatReferenceLabel(reference, clan.name),
      kingdomLabel: kingdom ? formatReferenceLabel(clan.superFaction, kingdom.name) : null,
    }
  }

  const kingdom = lookupKingdomInfo(db, reference)
  if (kingdom) {
    return {
      ownerLabel: formatReferenceLabel(reference, kingdom.name),
      kingdomLabel: formatReferenceLabel(reference, kingdom.name),
    }
  }

  return {
    ownerLabel: reference || 'unknown',
    kingdomLabel: null,
  }
}
