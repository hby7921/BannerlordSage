import { Database } from 'bun:sqlite'
import { getGamePaths } from '../utils/env'
import { runSetup as runBannerlordSetup } from './setup'

type VerifyOptions = {
  gameDir?: string
  dllScope: 'core' | 'modding' | 'official' | 'all'
  xmlScope: 'official' | 'all'
  decompileJobs?: number
  full: boolean
  clean: boolean
  help: boolean
}

export async function runBannerlordVerification(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args)
  if (options.help) {
    printHelpAndExit()
  }

  if (!options.gameDir) {
    throw new Error('Missing --game-dir "<Bannerlord install path>".')
  }

  await runVerificationSetup(options)
  await runDatabaseAssertions()
  await runToolAssertions()

  console.log('\nBannerlord verification passed.')
}

function parseArgs(args: string[]): VerifyOptions {
  const result: VerifyOptions = {
    dllScope: 'core',
    xmlScope: 'official',
    full: false,
    clean: false,
    help: false,
    decompileJobs: undefined,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]

    if (arg === '--game-dir' && next) {
      result.gameDir = next
      index += 1
      continue
    }

    if (arg.startsWith('--game-dir=')) {
      result.gameDir = arg.slice('--game-dir='.length)
      continue
    }

    if (arg === '--dll-scope' && next && isDllScope(next)) {
      result.dllScope = next
      result.full = next === 'modding'
      index += 1
      continue
    }

    if (arg.startsWith('--dll-scope=')) {
      const value = arg.slice('--dll-scope='.length)
      if (isDllScope(value)) {
        result.dllScope = value
        result.full = value === 'modding'
        continue
      }
    }

    if (arg === '--xml-scope' && next && isXmlScope(next)) {
      result.xmlScope = next
      index += 1
      continue
    }

    if (arg.startsWith('--xml-scope=')) {
      const value = arg.slice('--xml-scope='.length)
      if (isXmlScope(value)) {
        result.xmlScope = value
        continue
      }
    }

    if (arg === '--decompile-jobs' && next) {
      result.decompileJobs = parsePositiveInteger(next, '--decompile-jobs')
      index += 1
      continue
    }

    if (arg.startsWith('--decompile-jobs=')) {
      result.decompileJobs = parsePositiveInteger(arg.slice('--decompile-jobs='.length), '--decompile-jobs')
      continue
    }

    if (arg === '--help' || arg === '-h') {
      result.help = true
      continue
    }

    if (arg === '--clean') {
      result.clean = true
      continue
    }

    if (arg === '--full') {
      result.dllScope = 'modding'
      result.full = true
      continue
    }
  }

  return result
}

async function runVerificationSetup(options: VerifyOptions): Promise<void> {
  console.log(`[verify] Running ${options.clean ? 'clean ' : ''}setup against the real Bannerlord install...`)
  console.log(
    `[verify] Verification scope: dll-scope=${options.dllScope}${options.full ? ' (full)' : ' (default fast path)'} xml-scope=${options.xmlScope}${options.decompileJobs ? ` decompile-jobs=${options.decompileJobs}` : ''}${options.clean ? ' clean=true' : ' clean=false'}`
  )

  const setupArgs = [
    '--accept-disclaimer',
    '--game-dir',
    options.gameDir!,
    '--dll-scope',
    options.dllScope,
    '--xml-scope',
    options.xmlScope,
  ]

  if (options.clean) {
    setupArgs.push('--clean')
  }

  if (options.decompileJobs) {
    setupArgs.push('--decompile-jobs', String(options.decompileJobs))
  }

  await runBannerlordSetup(setupArgs)
}

async function runDatabaseAssertions(): Promise<void> {
  console.log('[verify] Checking rebuilt SQLite tables...')
  const { dbPath } = getGamePaths('bannerlord')
  const db = new Database(dbPath, { create: false, readonly: true })

  try {
    assertCount(db, 'csharp_types', 'C# types')
    assertCount(db, 'csharp_methods', 'C# members')
    assertCount(db, 'source_localization_entries', 'source localization entries')
    assertCount(db, 'xml_entities', 'XML entities')
    assertCount(db, 'localization_entries', 'XML localization entries')
    assertCount(db, 'bannerlord_items', 'item projections')
    assertCount(db, 'bannerlord_troops', 'troop projections')
    assertCount(db, 'bannerlord_heroes', 'hero projections')
    assertCount(db, 'bannerlord_clans', 'clan projections')
    assertCount(db, 'bannerlord_kingdoms', 'kingdom projections')
    assertCount(db, 'bannerlord_settlements', 'settlement projections')
    assertCount(db, 'bannerlord_cultures', 'culture projections')
    assertCount(db, 'bannerlord_skills', 'skill projections')
    assertCount(db, 'bannerlord_policies', 'policy projections')
    assertCount(db, 'bannerlord_perks', 'perk projections')
  } finally {
    db.close()
  }
}

async function runToolAssertions(): Promise<void> {
  console.log('[verify] Running tool-level assertions...')
  process.env.BANNERSAGE_GAME = 'bannerlord'

  const { dbPath } = getGamePaths('bannerlord')
  const db = new Database(dbPath, { create: false, readonly: true })

  try {
    const sampleType = pickScalar(
      db,
      `SELECT typeName FROM csharp_types ORDER BY CASE WHEN typeName = 'Hero' THEN 0 ELSE 1 END, typeName LIMIT 1`
    )
    const sampleItem = pickScalar(db, 'SELECT entityId FROM bannerlord_items ORDER BY entityId LIMIT 1')
    const sampleTroop = pickScalar(db, 'SELECT characterId FROM bannerlord_troops ORDER BY characterId LIMIT 1')
    const sampleHero = pickScalar(db, 'SELECT heroId FROM bannerlord_heroes ORDER BY heroId LIMIT 1')
    const sampleClan = pickScalar(
      db,
      'SELECT clanId FROM bannerlord_clans ORDER BY CASE WHEN isNoble = 1 THEN 0 ELSE 1 END, clanId LIMIT 1'
    )
    const sampleKingdom = pickScalar(db, 'SELECT kingdomId FROM bannerlord_kingdoms ORDER BY kingdomId LIMIT 1')
    const sampleSettlement = pickScalar(
      db,
      "SELECT settlementId FROM bannerlord_settlements ORDER BY CASE settlementType WHEN 'town' THEN 0 WHEN 'castle' THEN 1 WHEN 'village' THEN 2 ELSE 3 END, settlementId LIMIT 1"
    )
    const sampleCulture = pickScalar(db, 'SELECT cultureId FROM bannerlord_cultures ORDER BY cultureId LIMIT 1')
    const sampleSkill = pickScalar(db, 'SELECT skillId FROM bannerlord_skills ORDER BY skillId LIMIT 1')
    const samplePolicy = pickScalar(db, 'SELECT policyId FROM bannerlord_policies ORDER BY policyId LIMIT 1')
    const samplePerk = pickScalar(db, 'SELECT perkId FROM bannerlord_perks ORDER BY sourceOrder LIMIT 1')
    const sampleToken =
      pickScalar(db, "SELECT '{=' || stringId || '}' || text FROM localization_entries ORDER BY language, stringId LIMIT 1") ||
      pickScalar(
        db,
        "SELECT '{=' || stringId || '}' || fallbackText FROM source_localization_entries ORDER BY sourcePriority, stringId LIMIT 1"
      )

    if (
      !sampleType ||
      !sampleItem ||
      !sampleTroop ||
      !sampleHero ||
      !sampleClan ||
      !sampleKingdom ||
      !sampleSettlement ||
      !sampleCulture ||
      !sampleSkill ||
      !samplePolicy ||
      !samplePerk ||
      !sampleToken
    ) {
      throw new Error('Failed to discover sample records for tool assertions.')
    }

    const [
      { readCsharpType },
      { getClanSummary },
      { getCultureSummary },
      { getHeroProfile },
      { getItemStats },
      { getKingdomSummary },
      { getPerkData },
      { getPolicySummary },
      { getSettlementSummary },
      { getSkillData },
      { traceTroopTree },
      { resolveLocalization },
    ] = await Promise.all([
      import('../tools/read-csharp-type'),
      import('../tools/get-clan-summary'),
      import('../tools/get-culture-summary'),
      import('../tools/get-hero-profile'),
      import('../tools/get-item-stats'),
      import('../tools/get-kingdom-summary'),
      import('../tools/get-perk-data'),
      import('../tools/get-policy-summary'),
      import('../tools/get-settlement-summary'),
      import('../tools/get-skill-data'),
      import('../tools/trace-troop-tree'),
      import('../tools/resolve-localization'),
    ])

    const [
      typeResult,
      clanResult,
      cultureResult,
      heroResult,
      itemResult,
      kingdomResult,
      perkResult,
      policyResult,
      settlementResult,
      skillResult,
      troopResult,
      localizationResult,
    ] = await Promise.all([
      readCsharpType(sampleType),
      getClanSummary(sampleClan),
      getCultureSummary(sampleCulture),
      getHeroProfile(sampleHero),
      getItemStats(sampleItem),
      getKingdomSummary(sampleKingdom),
      getPerkData(samplePerk),
      getPolicySummary(samplePolicy),
      getSettlementSummary(sampleSettlement),
      getSkillData(sampleSkill),
      traceTroopTree(sampleTroop),
      resolveLocalization(sampleToken, ['English', 'CN']),
    ])

    assertToolText(typeResult, sampleType, 'read_csharp_type')
    assertToolText(clanResult, sampleClan, 'get_clan_summary')
    assertToolText(cultureResult, sampleCulture, 'get_culture_summary')
    assertToolText(heroResult, sampleHero, 'get_hero_profile')
    assertToolText(itemResult, sampleItem, 'get_item_stats')
    assertToolText(kingdomResult, sampleKingdom, 'get_kingdom_summary')
    assertToolText(perkResult, samplePerk, 'get_perk_data')
    assertToolText(policyResult, samplePolicy, 'get_policy_summary')
    assertToolText(settlementResult, sampleSettlement, 'get_settlement_summary')
    assertToolText(skillResult, sampleSkill, 'get_skill_data')
    assertToolText(troopResult, sampleTroop, 'trace_troop_tree')
    assertToolText(localizationResult, 'localization_id:', 'resolve_localization')
  } finally {
    db.close()
  }
}

function assertCount(db: Database, tableName: string, label: string): void {
  const row = db.query<{ count: number }, never>(`SELECT COUNT(*) AS count FROM ${tableName}`).get()
  const count = Number(row?.count || 0)
  if (count <= 0) {
    throw new Error(`Expected ${label} in ${tableName}, but the table is empty.`)
  }

  console.log(`[verify] ${label}: ${count}`)
}

function pickScalar(db: Database, sql: string): string | null {
  const row = db.query<Record<string, unknown>, never>(sql).get()
  if (!row) return null
  const value = Object.values(row)[0]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function assertToolText(result: unknown, expectedText: string, toolName: string): void {
  const text = extractToolText(result)
  if (!text.includes(expectedText)) {
    throw new Error(`${toolName} did not include the expected text: ${expectedText}`)
  }

  console.log(`[verify] ${toolName}: ok`)
}

function extractToolText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content
  if (!Array.isArray(content)) {
    throw new Error('Tool result did not include a content array.')
  }

  return content
    .filter(item => item?.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n')
}

function isDllScope(value: string): value is VerifyOptions['dllScope'] {
  return value === 'core' || value === 'modding' || value === 'official' || value === 'all'
}

function isXmlScope(value: string): value is VerifyOptions['xmlScope'] {
  return value === 'official' || value === 'all'
}

function printHelpAndExit(): never {
  console.log(`
Usage:
  bun run verify:bannerlord -- --game-dir "<BANNERLORD_GAME_DIR>"
  bun run verify:bannerlord -- --game-dir "<BANNERLORD_GAME_DIR>" --full
  bun run verify:bannerlord -- --game-dir "<BANNERLORD_GAME_DIR>" --dll-scope core

Options:
  --game-dir <path>           Real Bannerlord install path.
  --dll-scope <scope>         DLL scope for the verification rebuild. Default: core
  --xml-scope <scope>         XML scope for the verification rebuild. Default: official
  --decompile-jobs <count>    Parallel ILSpy decompile workers to pass through to setup.
  --clean                     Force a clean rebuild before verification. Slower but stricter.
  --full                      Shorthand for --dll-scope modding.
  --help, -h                  Show this help text.
`)
  process.exit(0)
}

function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Unsupported ${flagName} '${value}'. Use a positive integer.`)
  }

  return parsed
}

if (import.meta.main) {
  runBannerlordVerification().catch(error => {
    console.error('Bannerlord verification failed:', error)
    process.exit(1)
  })
}
