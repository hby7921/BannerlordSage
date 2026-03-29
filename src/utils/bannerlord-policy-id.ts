const POLICY_ID_ALIASES: Record<string, string> = {
  policy_land_grands_for_veteran: 'policy_land_grants_for_veterans',
}

export function normalizeBannerlordPolicyId(value: string | null | undefined): string | null {
  if (!value) return null

  const normalized = value.trim().replace(/^Policy\./i, '').toLowerCase()
  if (!normalized) return null

  return POLICY_ID_ALIASES[normalized] ?? normalized
}
