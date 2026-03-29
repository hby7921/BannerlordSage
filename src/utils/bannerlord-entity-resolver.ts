import type { Database } from 'bun:sqlite'
import { normalizeBannerlordPolicyId } from './bannerlord-policy-id'
import { resolveMaybeLocalizedText } from './localization'

export type BannerlordClanInfo = {
  clanId: string
  name: string | null
  superFaction: string | null
  isNoble: number
  isMinorFaction: number
  isBandit: number
  isMercenary: number
}

export type BannerlordKingdomInfo = {
  kingdomId: string
  name: string | null
}

export type BannerlordSettlementInfo = {
  settlementId: string
  name: string | null
  owner: string | null
  boundSettlement: string | null
  settlementType: string | null
}

export function normalizeReference(value: string | null | undefined, prefixes: string[]): string | null {
  if (!value) return null
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) {
      return value.slice(prefix.length)
    }
  }
  return value
}

export function lookupCultureName(db: Database, reference: string | null | undefined): string | null {
  const cultureId = normalizeReference(reference, ['Culture.'])
  if (!cultureId) return null

  const row = db
    .query<{ name: string | null } | null, { $id: string }>(
      `
      SELECT name
      FROM bannerlord_cultures
      WHERE cultureId = $id
      ORDER BY
        (maleNameCount + femaleNameCount) DESC,
        CASE WHEN descriptionText IS NOT NULL AND descriptionText <> '' THEN 0 ELSE 1 END,
        filePath
      LIMIT 1
    `
    )
    .get({ $id: cultureId })

  return row?.name ?? null
}

export function lookupHeroName(db: Database, reference: string | null | undefined): string | null {
  const heroId = normalizeReference(reference, ['Hero.', 'NPCCharacter.'])
  if (!heroId) return null

  const row = db
    .query<{ name: string | null } | null, { $id: string }>(
      `
      SELECT name
      FROM bannerlord_troops
      WHERE characterId = $id
      ORDER BY filePath
      LIMIT 1
    `
    )
    .get({ $id: heroId })

  return row?.name ?? null
}

export function lookupClanInfo(db: Database, reference: string | null | undefined): BannerlordClanInfo | null {
  const clanId = normalizeReference(reference, ['Faction.', 'Clan.'])
  if (!clanId) return null

  return (
    db
      .query<BannerlordClanInfo | null, { $id: string }>(
        `
        SELECT clanId, name, superFaction, isNoble, isMinorFaction, isBandit, isMercenary
        FROM bannerlord_clans
        WHERE clanId = $id
        ORDER BY
          CASE WHEN isNoble = 1 THEN 0 WHEN isMinorFaction = 1 THEN 1 ELSE 2 END,
          filePath
        LIMIT 1
      `
      )
      .get({ $id: clanId }) ?? null
  )
}

export function lookupKingdomInfo(db: Database, reference: string | null | undefined): BannerlordKingdomInfo | null {
  const kingdomId = normalizeReference(reference, ['Faction.', 'Kingdom.'])
  if (!kingdomId) return null

  return (
    db
      .query<BannerlordKingdomInfo | null, { $id: string }>(
        `
        SELECT kingdomId, name
        FROM bannerlord_kingdoms
        WHERE kingdomId = $id
        ORDER BY filePath
        LIMIT 1
      `
      )
      .get({ $id: kingdomId }) ?? null
  )
}

export function lookupPolicyName(db: Database, reference: string | null | undefined): string | null {
  const policyId = normalizeBannerlordPolicyId(reference)
  if (!policyId) return null

  const row = db
    .query<{ displayName: string | null } | null, { $id: string }>(
      `
      SELECT displayName
      FROM bannerlord_policies
      WHERE policyId = $id
      LIMIT 1
    `
    )
    .get({ $id: policyId })

  return row?.displayName ?? null
}

export function lookupSettlementInfo(db: Database, reference: string | null | undefined): BannerlordSettlementInfo | null {
  const settlementId = normalizeReference(reference, ['Settlement.'])
  if (!settlementId) return null

  return (
    db
      .query<BannerlordSettlementInfo | null, { $id: string }>(
        `
        SELECT settlementId, name, owner, boundSettlement, settlementType
        FROM bannerlord_settlements
        WHERE settlementId = $id
        ORDER BY filePath
        LIMIT 1
      `
      )
      .get({ $id: settlementId }) ?? null
  )
}

export function formatReferenceLabel(
  rawReference: string | null | undefined,
  displayName: string | null | undefined,
  preferredLanguages?: string[]
): string {
  if (displayName) {
    const localized = resolveMaybeLocalizedText(displayName, preferredLanguages)
    return rawReference ? `${localized} [${rawReference}]` : localized
  }

  return rawReference || 'unknown'
}
