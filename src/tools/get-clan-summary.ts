import { getDb } from '../utils/db'
import { AiTextBlock, renderAiTextReport } from '../utils/ai-text'
import {
  formatReferenceLabel,
  lookupCultureName,
  lookupHeroName,
  lookupKingdomInfo,
  lookupSettlementInfo,
} from '../utils/bannerlord-entity-resolver'
import { resolveMaybeLocalizedText } from '../utils/localization'

export async function getClanSummary(clanId: string) {
  const db = getDb()
  const rows = db
    .query<any, any>(
      `
      SELECT *
      FROM bannerlord_clans
      WHERE clanId = $id
      ORDER BY
        CASE WHEN isNoble = 1 THEN 0 WHEN isMinorFaction = 1 THEN 1 ELSE 2 END,
        filePath
    `
    )
    .all({ $id: clanId })

  if (rows.length === 0) {
    return { content: [{ type: 'text' as const, text: `Clan or faction not found: ${clanId}` }] }
  }

  const blocks: AiTextBlock[] = rows.map((row, index) => {
    const cultureName = lookupCultureName(db, row.culture)
    const ownerName = lookupHeroName(db, row.owner)
    const homeSettlement = lookupSettlementInfo(db, row.initialHomeSettlement)
    const superFaction = lookupKingdomInfo(db, row.superFaction)

    return {
      header: `clan_${index + 1}`,
      fields: [
        { key: 'source_path', value: row.filePath },
        { key: 'clan_id', value: row.clanId },
        { key: 'display_name', value: resolveMaybeLocalizedText(row.name) },
        { key: 'short_name', value: row.shortName ? resolveMaybeLocalizedText(row.shortName) : null },
        { key: 'kind', value: describeClanKind(row) },
        { key: 'culture_ref', value: formatReferenceLabel(row.culture, cultureName) },
        { key: 'owner_hero_ref', value: formatReferenceLabel(row.owner, ownerName) },
        { key: 'home_settlement_ref', value: formatReferenceLabel(row.initialHomeSettlement, homeSettlement?.name) },
        { key: 'super_faction_ref', value: row.superFaction || superFaction?.name ? formatReferenceLabel(row.superFaction, superFaction?.name) : null },
        { key: 'tier', value: row.tier },
        { key: 'color_primary', value: row.color },
        { key: 'color_secondary', value: row.color2 },
        { key: 'template_count', value: row.templateCount },
        { key: 'flag_is_noble', value: toYesNo(row.isNoble) },
        { key: 'flag_is_minor_faction', value: toYesNo(row.isMinorFaction) },
        { key: 'flag_is_bandit', value: toYesNo(row.isBandit) },
        { key: 'flag_is_outlaw', value: toYesNo(row.isOutlaw) },
        { key: 'flag_is_mafia', value: toYesNo(row.isMafia) },
        { key: 'flag_is_mercenary', value: toYesNo(row.isMercenary) },
      ],
      multilineFields: [{ key: 'description', value: row.descriptionText ? resolveMaybeLocalizedText(row.descriptionText) : null }],
    }
  })

  const output = renderAiTextReport('clan_summary', 'query_clan_id', clanId, blocks)

  return { content: [{ type: 'text' as const, text: output }] }
}

function describeClanKind(row: any): string {
  if (row.isNoble) return 'noble clan'
  if (row.isMinorFaction) {
    if (row.isMercenary) return 'minor mercenary faction'
    return 'minor faction'
  }
  if (row.isBandit) return 'bandit faction'
  if (row.clanId === 'player_faction') return 'player faction'
  return 'faction'
}

function toYesNo(value: unknown): string {
  return Number(value) ? 'yes' : 'no'
}
