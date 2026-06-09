import type { Database } from 'bun:sqlite'
import type { SetupState } from './bannerlord-setup'

export const BANNERLORD_API_BASE_URL = 'https://apidoc.bannerlord.com/'

export const BANNERLORD_API_SECTIONS = [
  'classes',
  'functions',
  'properties',
  'events',
  'enums',
  'enumvalues',
  'variables',
] as const

export type BannerlordApiSection = (typeof BANNERLORD_API_SECTIONS)[number]

export type BannerlordApiVersionResolution = {
  installedGameVersion?: string
  installedFullVersion?: string
  requestedApiVersion?: string
  selectedApiVersion?: string
  exactMatch: boolean
  authority: 'official_api_reference' | 'local_decompiled_source'
  usage: 'reference' | 'historical_reference_only'
  warning?: string
  availableVersions: string[]
}

export function normalizeApiVersion(value?: string): string | undefined {
  const cleaned = value?.trim().replace(/^v/i, '')
  if (!cleaned) return undefined

  const parts = cleaned
    .split('.')
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length < 3) {
    return parts.join('.') || undefined
  }

  return parts.slice(0, 3).join('.')
}

export function compareApiVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left)
  const rightParts = parseVersionParts(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (delta !== 0) return delta
  }

  return 0
}

export function readIndexedApiVersions(db: Database): string[] {
  if (!hasTable(db, 'bannerlord_api_versions')) {
    return []
  }

  return db
    .query<{ version: string }, never>(
      `
      SELECT version
      FROM bannerlord_api_versions
      ORDER BY version
    `
    )
    .all()
    .map(row => row.version)
    .sort((left, right) => compareApiVersions(right, left))
}

export function resolveBannerlordApiVersion(
  db: Database,
  state: SetupState,
  requestedVersion?: string
): BannerlordApiVersionResolution {
  const availableVersions = readIndexedApiVersions(db)
  const normalizedRequested = normalizeApiVersion(requestedVersion)
  const installedGameVersion = state.gameVersion
  const installedFullVersion = state.fullVersion
  const normalizedInstalled = normalizeApiVersion(installedGameVersion || installedFullVersion)

  if (availableVersions.length === 0) {
    return {
      installedGameVersion,
      installedFullVersion,
      requestedApiVersion: normalizedRequested,
      exactMatch: false,
      authority: 'local_decompiled_source',
      usage: 'historical_reference_only',
      warning: 'Official API index is missing. Run bun run index:api-docs first.',
      availableVersions,
    }
  }

  if (normalizedRequested) {
    const selected = availableVersions.find(version => version === normalizedRequested)
    return {
      installedGameVersion,
      installedFullVersion,
      requestedApiVersion: normalizedRequested,
      selectedApiVersion: selected,
      exactMatch: Boolean(selected && normalizedInstalled && selected === normalizedInstalled),
      authority: selected && normalizedInstalled && selected === normalizedInstalled
        ? 'official_api_reference'
        : 'local_decompiled_source',
      usage: selected && normalizedInstalled && selected === normalizedInstalled
        ? 'reference'
        : 'historical_reference_only',
      warning: selected
        ? buildVersionWarning(normalizedInstalled, selected)
        : `Requested official API version ${normalizedRequested} is not indexed.`,
      availableVersions,
    }
  }

  const exactInstalled = normalizedInstalled
    ? availableVersions.find(version => version === normalizedInstalled)
    : undefined
  const selected = exactInstalled || availableVersions[0]

  return {
    installedGameVersion,
    installedFullVersion,
    selectedApiVersion: selected,
    exactMatch: Boolean(exactInstalled),
    authority: exactInstalled ? 'official_api_reference' : 'local_decompiled_source',
    usage: exactInstalled ? 'reference' : 'historical_reference_only',
    warning: exactInstalled ? undefined : buildVersionWarning(normalizedInstalled, selected),
    availableVersions,
  }
}

function buildVersionWarning(installedVersion: string | undefined, selectedApiVersion: string | undefined): string | undefined {
  if (!selectedApiVersion) return undefined

  if (!installedVersion) {
    return `Installed game version is unknown; official API ${selectedApiVersion} is reference-only.`
  }

  if (installedVersion === selectedApiVersion) {
    return undefined
  }

  return `Installed game version ${installedVersion} does not match official API ${selectedApiVersion}; use local decompiled source as authority.`
}

function parseVersionParts(value: string): number[] {
  return value
    .replace(/^v/i, '')
    .split('.')
    .map(part => Number.parseInt(part, 10))
    .map(part => (Number.isFinite(part) ? part : 0))
}

function hasTable(db: Database, tableName: string): boolean {
  try {
    const row = db
      .query<{ name: string }, { $tableName: string }>(
        `
        SELECT name
        FROM sqlite_master
        WHERE type IN ('table', 'virtual') AND name = $tableName
      `
      )
      .get({ $tableName: tableName })

    return Boolean(row)
  } catch {
    return false
  }
}
