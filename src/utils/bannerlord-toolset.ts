export type BannerlordToolsetMode = 'query-first' | 'full'

export const QUERY_FIRST_BANNERLORD_TOOL_NAMES = [
  'bannerlord_doctor',
  'bannerlord_index_status',
  'mod_source_status',
  'index_mod_source',
  'search_mod_source',
  'read_mod_file',
  'list_mod_directory',
  'read_mod_type',
  'read_csharp_type',
  'search_source',
  'read_file',
  'list_directory',
  'search_xml',
  'trace_troop_tree',
  'get_item_stats',
  'get_clan_summary',
  'get_policy_summary',
  'get_hero_profile',
  'get_perk_data',
  'get_kingdom_summary',
  'get_culture_summary',
  'get_settlement_summary',
  'get_skill_data',
  'generate_harmony_patch',
  'resolve_localization',
  'read_gauntlet_ui',
] as const

export const AUTHORING_BANNERLORD_TOOL_NAMES = [
  'create_mod_workspace',
  'generate_xslt_patch',
] as const

export function getBannerlordToolsetMode(): BannerlordToolsetMode {
  const configured = process.env.BANNERSAGE_TOOLSET?.trim().toLowerCase()
  return configured === 'query-first' ? 'query-first' : 'full'
}

export function getActiveBannerlordToolNames(): string[] {
  if (getBannerlordToolsetMode() === 'query-first') {
    return [...QUERY_FIRST_BANNERLORD_TOOL_NAMES]
  }

  return [...QUERY_FIRST_BANNERLORD_TOOL_NAMES, ...AUTHORING_BANNERLORD_TOOL_NAMES]
}
