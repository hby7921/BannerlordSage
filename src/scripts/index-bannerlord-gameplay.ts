import { Database } from 'bun:sqlite'
import { readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { getGamePaths } from '../utils/env'
import { normalizeBannerlordPolicyId } from '../utils/bannerlord-policy-id'

type BannerlordPolicyProjectionRow = {
  policyId: string
  rawPolicyId: string
  filePath: string
  sourceModule: string
  displayName: string | null
  descriptionText: string | null
  proposalText: string | null
  effectsText: string | null
  rulerSupport: number | null
  lordsSupport: number | null
  commonsSupport: number | null
  activeKingdomIdsJson: string
  defaultCultureIdsJson: string
  activeKingdomCount: number
  defaultCultureCount: number
}

type BannerlordPerkProjectionRow = {
  perkId: string
  filePath: string
  sourceModule: string
  skillId: string | null
  tierIndex: number | null
  requiredSkillValue: number | null
  alternativePerkId: string | null
  displayName: string | null
  primaryDescription: string | null
  primaryRole: string | null
  primaryBonus: number | null
  primaryIncrementType: string | null
  primaryTroopUsageMask: string | null
  secondaryDescription: string | null
  secondaryRole: string | null
  secondaryBonus: number | null
  secondaryIncrementType: string | null
  secondaryTroopUsageMask: string | null
  sourceOrder: number
}

const DEFAULT_PERKS_RELATIVE_PATH = join(
  'bin',
  'Win64_Shipping_Client',
  'TaleWorlds.CampaignSystem',
  'TaleWorlds.CampaignSystem.CharacterDevelopment',
  'DefaultPerks.cs'
)

const POLICY_SOURCE_RELATIVE_PATHS = [
  join(
    'bin',
    'Win64_Shipping_Client',
    'TaleWorlds.CampaignSystem',
    'TaleWorlds.CampaignSystem',
    'DefaultPolicies.cs'
  ),
  join('Modules', 'NavalDLC', 'bin', 'Win64_Shipping_Client', 'NavalDLC', 'NavalDLC', 'NavalPolicies.cs'),
]

const DEFAULT_TIER_SKILL_REQUIREMENTS = [25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300]

export async function buildBannerlordGameplayIndex(gameId?: string): Promise<{
  policiesIndexed: number
  perksIndexed: number
}> {
  const { gameId: resolvedGameId, sourcePath, dbPath } = getGamePaths(gameId)
  if (resolvedGameId !== 'bannerlord') {
    return {
      policiesIndexed: 0,
      perksIndexed: 0,
    }
  }

  const db = new Database(dbPath)

  try {
    db.run('PRAGMA busy_timeout = 5000;')
    db.run('PRAGMA journal_mode = WAL;')

    const activeKingdomIdsByPolicy = loadPolicyRefsByEntity(db, 'bannerlord_kingdoms', 'kingdomId', 'policyIdsJson')
    const defaultCultureIdsByPolicy = loadPolicyRefsByEntity(
      db,
      'bannerlord_cultures',
      'cultureId',
      'defaultPolicyIdsJson'
    )

    const [policies, perks] = await Promise.all([
      extractPolicyProjections(sourcePath, activeKingdomIdsByPolicy, defaultCultureIdsByPolicy),
      extractPerkProjections(sourcePath),
    ])

    db.run('DROP TABLE IF EXISTS bannerlord_policies;')
    db.run('DROP TABLE IF EXISTS bannerlord_perks;')

    db.run(`
      CREATE TABLE bannerlord_policies (
        policyId TEXT PRIMARY KEY,
        rawPolicyId TEXT NOT NULL,
        filePath TEXT NOT NULL,
        sourceModule TEXT NOT NULL,
        displayName TEXT,
        descriptionText TEXT,
        proposalText TEXT,
        effectsText TEXT,
        rulerSupport REAL,
        lordsSupport REAL,
        commonsSupport REAL,
        activeKingdomIdsJson TEXT NOT NULL,
        defaultCultureIdsJson TEXT NOT NULL,
        activeKingdomCount INTEGER NOT NULL,
        defaultCultureCount INTEGER NOT NULL
      );
    `)

    db.run(`
      CREATE TABLE bannerlord_perks (
        perkId TEXT PRIMARY KEY,
        filePath TEXT NOT NULL,
        sourceModule TEXT NOT NULL,
        skillId TEXT,
        tierIndex INTEGER,
        requiredSkillValue INTEGER,
        alternativePerkId TEXT,
        displayName TEXT,
        primaryDescription TEXT,
        primaryRole TEXT,
        primaryBonus REAL,
        primaryIncrementType TEXT,
        primaryTroopUsageMask TEXT,
        secondaryDescription TEXT,
        secondaryRole TEXT,
        secondaryBonus REAL,
        secondaryIncrementType TEXT,
        secondaryTroopUsageMask TEXT,
        sourceOrder INTEGER NOT NULL
      );
    `)

    db.run('CREATE INDEX bannerlord_policies_source_module_idx ON bannerlord_policies(sourceModule);')
    db.run('CREATE INDEX bannerlord_perks_skill_id_idx ON bannerlord_perks(skillId);')
    db.run('CREATE INDEX bannerlord_perks_source_order_idx ON bannerlord_perks(sourceOrder);')

    const insertPolicy = db.prepare(`
      INSERT OR REPLACE INTO bannerlord_policies (
        policyId, rawPolicyId, filePath, sourceModule, displayName, descriptionText, proposalText, effectsText,
        rulerSupport, lordsSupport, commonsSupport, activeKingdomIdsJson, defaultCultureIdsJson,
        activeKingdomCount, defaultCultureCount
      ) VALUES (
        $policyId, $rawPolicyId, $filePath, $sourceModule, $displayName, $descriptionText, $proposalText, $effectsText,
        $rulerSupport, $lordsSupport, $commonsSupport, $activeKingdomIdsJson, $defaultCultureIdsJson,
        $activeKingdomCount, $defaultCultureCount
      )
    `)

    const insertPerk = db.prepare(`
      INSERT OR REPLACE INTO bannerlord_perks (
        perkId, filePath, sourceModule, skillId, tierIndex, requiredSkillValue, alternativePerkId,
        displayName, primaryDescription, primaryRole, primaryBonus, primaryIncrementType, primaryTroopUsageMask,
        secondaryDescription, secondaryRole, secondaryBonus, secondaryIncrementType, secondaryTroopUsageMask, sourceOrder
      ) VALUES (
        $perkId, $filePath, $sourceModule, $skillId, $tierIndex, $requiredSkillValue, $alternativePerkId,
        $displayName, $primaryDescription, $primaryRole, $primaryBonus, $primaryIncrementType, $primaryTroopUsageMask,
        $secondaryDescription, $secondaryRole, $secondaryBonus, $secondaryIncrementType, $secondaryTroopUsageMask, $sourceOrder
      )
    `)

    const transaction = db.transaction(() => {
      for (const row of policies) {
        insertPolicy.run({
          $policyId: row.policyId,
          $rawPolicyId: row.rawPolicyId,
          $filePath: row.filePath,
          $sourceModule: row.sourceModule,
          $displayName: row.displayName,
          $descriptionText: row.descriptionText,
          $proposalText: row.proposalText,
          $effectsText: row.effectsText,
          $rulerSupport: row.rulerSupport,
          $lordsSupport: row.lordsSupport,
          $commonsSupport: row.commonsSupport,
          $activeKingdomIdsJson: row.activeKingdomIdsJson,
          $defaultCultureIdsJson: row.defaultCultureIdsJson,
          $activeKingdomCount: row.activeKingdomCount,
          $defaultCultureCount: row.defaultCultureCount,
        })
      }

      for (const row of perks) {
        insertPerk.run({
          $perkId: row.perkId,
          $filePath: row.filePath,
          $sourceModule: row.sourceModule,
          $skillId: row.skillId,
          $tierIndex: row.tierIndex,
          $requiredSkillValue: row.requiredSkillValue,
          $alternativePerkId: row.alternativePerkId,
          $displayName: row.displayName,
          $primaryDescription: row.primaryDescription,
          $primaryRole: row.primaryRole,
          $primaryBonus: row.primaryBonus,
          $primaryIncrementType: row.primaryIncrementType,
          $primaryTroopUsageMask: row.primaryTroopUsageMask,
          $secondaryDescription: row.secondaryDescription,
          $secondaryRole: row.secondaryRole,
          $secondaryBonus: row.secondaryBonus,
          $secondaryIncrementType: row.secondaryIncrementType,
          $secondaryTroopUsageMask: row.secondaryTroopUsageMask,
          $sourceOrder: row.sourceOrder,
        })
      }
    })

    transaction()

    console.log(`Indexed ${policies.length} Bannerlord policies and ${perks.length} Bannerlord perks.`)

    return {
      policiesIndexed: policies.length,
      perksIndexed: perks.length,
    }
  } finally {
    db.close()
  }
}

async function extractPolicyProjections(
  sourcePath: string,
  activeKingdomIdsByPolicy: Map<string, string[]>,
  defaultCultureIdsByPolicy: Map<string, string[]>
): Promise<BannerlordPolicyProjectionRow[]> {
  const rows: BannerlordPolicyProjectionRow[] = []

  for (const relativePath of POLICY_SOURCE_RELATIVE_PATHS) {
    const absolutePath = join(sourcePath, relativePath)
    if (!(await pathExists(absolutePath))) {
      continue
    }

    const sourceText = await readFile(absolutePath, 'utf8')
    const createMap = parseCreateMap(sourceText)
    const sourceModule = inferSourceModule(relativePath)

    for (const { fieldName, argumentsText } of extractInitializeCalls(sourceText)) {
      const rawPolicyId = createMap.get(fieldName)
      if (!rawPolicyId) {
        continue
      }

      const policyId = normalizeBannerlordPolicyId(rawPolicyId)
      if (!policyId) {
        continue
      }

      const args = splitTopLevelArguments(argumentsText)
      if (args.length < 7) {
        continue
      }

      const activeKingdomIds = activeKingdomIdsByPolicy.get(policyId) ?? []
      const defaultCultureIds = defaultCultureIdsByPolicy.get(policyId) ?? []

      rows.push({
        policyId,
        rawPolicyId,
        filePath: normalizeSourceFilePath(sourcePath, absolutePath),
        sourceModule,
        displayName: extractFirstStringLiteral(args[0]),
        descriptionText: extractFirstStringLiteral(args[1]),
        proposalText: extractFirstStringLiteral(args[2]),
        effectsText: extractFirstStringLiteral(args[3]),
        rulerSupport: parseNumericLiteral(args[4]),
        lordsSupport: parseNumericLiteral(args[5]),
        commonsSupport: parseNumericLiteral(args[6]),
        activeKingdomIdsJson: JSON.stringify(activeKingdomIds),
        defaultCultureIdsJson: JSON.stringify(defaultCultureIds),
        activeKingdomCount: activeKingdomIds.length,
        defaultCultureCount: defaultCultureIds.length,
      })
    }
  }

  return dedupePolicies(rows)
}

async function extractPerkProjections(sourcePath: string): Promise<BannerlordPerkProjectionRow[]> {
  const absolutePath = join(sourcePath, DEFAULT_PERKS_RELATIVE_PATH)
  if (!(await pathExists(absolutePath))) {
    return []
  }

  const sourceText = await readFile(absolutePath, 'utf8')
  const createMap = parseCreateMap(sourceText)
  const tierSkillRequirements = parseTierSkillRequirements(sourceText)
  const rows: BannerlordPerkProjectionRow[] = []

  let sourceOrder = 0
  for (const { fieldName, argumentsText } of extractInitializeCalls(sourceText)) {
    const perkId = createMap.get(fieldName)
    if (!perkId) {
      continue
    }

    const args = splitTopLevelArguments(argumentsText)
    if (args.length < 8) {
      continue
    }

    sourceOrder += 1
    const tierInfo = resolveTierRequirement(args[2], tierSkillRequirements)

    rows.push({
      perkId,
      filePath: normalizeSourceFilePath(sourcePath, absolutePath),
      sourceModule: 'CampaignSystem',
      skillId: normalizeMemberAccess(args[1], 'DefaultSkills.'),
      tierIndex: tierInfo.tierIndex,
      requiredSkillValue: tierInfo.requiredSkillValue,
      alternativePerkId: resolveCreatedReference(args[3], createMap),
      displayName: extractFirstStringLiteral(args[0]),
      primaryDescription: extractFirstStringLiteral(args[4]),
      primaryRole: normalizeMemberAccess(args[5], 'PartyRole.'),
      primaryBonus: parseNumericLiteral(args[6]),
      primaryIncrementType: normalizeMemberAccess(args[7], 'EffectIncrementType.'),
      primaryTroopUsageMask: normalizeFlagExpression(args[12], 'TroopUsageFlags.'),
      secondaryDescription: extractFirstStringLiteral(args[8]),
      secondaryRole: normalizeMemberAccess(args[9], 'PartyRole.'),
      secondaryBonus: parseNumericLiteral(args[10]),
      secondaryIncrementType: normalizeMemberAccess(args[11], 'EffectIncrementType.'),
      secondaryTroopUsageMask: normalizeFlagExpression(args[13], 'TroopUsageFlags.'),
      sourceOrder,
    })
  }

  return dedupePerks(rows)
}

function loadPolicyRefsByEntity(
  db: Database,
  tableName: string,
  entityColumn: string,
  jsonColumn: string
): Map<string, string[]> {
  if (!tableExists(db, tableName) || !tableHasColumn(db, tableName, entityColumn) || !tableHasColumn(db, tableName, jsonColumn)) {
    return new Map()
  }

  const rows = db
    .query<Record<string, unknown>, never>(`SELECT ${entityColumn}, ${jsonColumn} FROM ${tableName}`)
    .all()

  const refs = new Map<string, Set<string>>()
  for (const row of rows) {
    const entityId = typeof row[entityColumn] === 'string' ? row[entityColumn] : null
    if (!entityId) {
      continue
    }

    for (const policyId of parseIdList(row[jsonColumn])) {
      if (!refs.has(policyId)) {
        refs.set(policyId, new Set())
      }

      refs.get(policyId)!.add(entityId)
    }
  }

  return new Map(
    [...refs.entries()].map(([policyId, values]) => [policyId, [...values].sort((left, right) => left.localeCompare(right))])
  )
}

function parseCreateMap(sourceText: string): Map<string, string> {
  const result = new Map<string, string>()
  const regex = /^\s*(_[A-Za-z0-9]+)\s*=\s*Create\("([^"]+)"\);/gm

  let match: RegExpExecArray | null
  while ((match = regex.exec(sourceText)) !== null) {
    result.set(match[1], match[2])
  }

  return result
}

function extractInitializeCalls(sourceText: string): Array<{ fieldName: string; argumentsText: string }> {
  const rows: Array<{ fieldName: string; argumentsText: string }> = []
  const regex = /^\s*(_[A-Za-z0-9]+)\.Initialize\((.+)\);\s*$/gm

  let match: RegExpExecArray | null
  while ((match = regex.exec(sourceText)) !== null) {
    rows.push({
      fieldName: match[1],
      argumentsText: match[2],
    })
  }

  return rows
}

function splitTopLevelArguments(argumentsText: string): string[] {
  const parts: string[] = []
  let current = ''
  let parenDepth = 0
  let bracketDepth = 0
  let braceDepth = 0
  let inString = false
  let escaping = false

  for (const char of argumentsText) {
    current += char

    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }

      if (char === '\\') {
        escaping = true
        continue
      }

      if (char === '"') {
        inString = false
      }

      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '(') parenDepth += 1
    if (char === ')') parenDepth -= 1
    if (char === '[') bracketDepth += 1
    if (char === ']') bracketDepth -= 1
    if (char === '{') braceDepth += 1
    if (char === '}') braceDepth -= 1

    if (char === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      parts.push(current.slice(0, -1).trim())
      current = ''
    }
  }

  if (current.trim().length > 0) {
    parts.push(current.trim())
  }

  return parts
}

function extractFirstStringLiteral(expression: string | undefined): string | null {
  if (!expression) return null

  const match = expression.match(/"((?:\\.|[^"])*)"/)
  if (!match) return null

  return match[1]
    .replaceAll('\\"', '"')
    .replaceAll('\\n', '\n')
    .replaceAll('\\r', '\r')
    .replaceAll('\\\\', '\\')
}

function parseNumericLiteral(expression: string | undefined): number | null {
  if (!expression) return null

  const normalized = expression.trim().replace(/f$/i, '')
  if (!normalized || /^null$/i.test(normalized)) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeMemberAccess(expression: string | undefined, prefix: string): string | null {
  if (!expression) return null

  const trimmed = expression.trim()
  if (!trimmed || /^null$/i.test(trimmed)) {
    return null
  }

  if (trimmed.startsWith(prefix)) {
    return trimmed.slice(prefix.length)
  }

  return trimmed
}

function normalizeFlagExpression(expression: string | undefined, prefix: string): string | null {
  if (!expression) return null

  const trimmed = expression.trim()
  if (!trimmed || /^null$/i.test(trimmed)) {
    return null
  }

  return trimmed
    .split('|')
    .map(part => normalizeMemberAccess(part.trim(), prefix))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' | ')
}

function resolveCreatedReference(expression: string | undefined, createMap: Map<string, string>): string | null {
  if (!expression) return null

  const trimmed = expression.trim()
  if (!trimmed || /^null$/i.test(trimmed)) {
    return null
  }

  return createMap.get(trimmed) ?? null
}

function parseTierSkillRequirements(sourceText: string): number[] {
  const match = sourceText.match(/TierSkillRequirements\s*=\s*new int\[\d+\]\s*\{([\s\S]*?)\};/m)
  if (!match) {
    return DEFAULT_TIER_SKILL_REQUIREMENTS
  }

  const values = match[1]
    .split(',')
    .map(part => Number(part.trim()))
    .filter(value => Number.isFinite(value))

  return values.length > 0 ? values : DEFAULT_TIER_SKILL_REQUIREMENTS
}

function resolveTierRequirement(
  expression: string | undefined,
  tierSkillRequirements: number[]
): { tierIndex: number | null; requiredSkillValue: number | null } {
  if (!expression) {
    return {
      tierIndex: null,
      requiredSkillValue: null,
    }
  }

  const tierMatch = expression.match(/GetTierCost\((\d+)\)/)
  if (tierMatch) {
    const tierIndex = Number(tierMatch[1])
    const requiredSkillValue = tierSkillRequirements[tierIndex - 1] ?? null
    return { tierIndex, requiredSkillValue }
  }

  const directValue = parseNumericLiteral(expression)
  if (directValue === null) {
    return {
      tierIndex: null,
      requiredSkillValue: null,
    }
  }

  return {
    tierIndex: tierSkillRequirements.indexOf(directValue) + 1 || null,
    requiredSkillValue: directValue,
  }
}

function parseIdList(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }

    return [...new Set(parsed.map(item => normalizeBannerlordPolicyId(String(item))).filter(Boolean) as string[])].sort(
      (left, right) => left.localeCompare(right)
    )
  } catch {
    return []
  }
}

function dedupePolicies(rows: BannerlordPolicyProjectionRow[]): BannerlordPolicyProjectionRow[] {
  const seen = new Set<string>()
  const result: BannerlordPolicyProjectionRow[] = []

  for (const row of rows) {
    if (seen.has(row.policyId)) {
      continue
    }

    seen.add(row.policyId)
    result.push(row)
  }

  return result.sort((left, right) => left.policyId.localeCompare(right.policyId))
}

function dedupePerks(rows: BannerlordPerkProjectionRow[]): BannerlordPerkProjectionRow[] {
  const seen = new Set<string>()
  const result: BannerlordPerkProjectionRow[] = []

  for (const row of rows) {
    if (seen.has(row.perkId)) {
      continue
    }

    seen.add(row.perkId)
    result.push(row)
  }

  return result.sort((left, right) => left.sourceOrder - right.sourceOrder)
}

function inferSourceModule(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/')
  if (normalized.startsWith('Modules/')) {
    return normalized.split('/')[1] || 'Modules'
  }

  return 'CampaignSystem'
}

function normalizeSourceFilePath(sourcePath: string, absolutePath: string): string {
  return relative(sourcePath, absolutePath).replaceAll('\\', '/')
}

function tableExists(db: Database, tableName: string): boolean {
  const row = db
    .query<{ name: string } | null, { $tableName: string }>(
      `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = $tableName
      LIMIT 1
    `
    )
    .get({ $tableName: tableName })

  return Boolean(row)
}

function tableHasColumn(db: Database, tableName: string, columnName: string): boolean {
  const rows = db.query<{ name: string }, never>(`PRAGMA table_info("${tableName.replaceAll('"', '""')}")`).all()
  return rows.some(row => row.name === columnName)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

if (import.meta.main) {
  buildBannerlordGameplayIndex().catch(error => {
    console.error('Fatal error while building the Bannerlord gameplay index:', error)
    process.exit(1)
  })
}
