import { getDb } from './db'

const TOKEN_REGEX = /^\{=([^}]+)\}(.*)$/
const CANONICAL_LANGUAGE_ALIASES: Record<string, string[]> = {
  english: ['english', 'en'],
  chinese_simplified: [
    'cn',
    'cns',
    'chs',
    'sc',
    'zh',
    'zhcn',
    'zhhans',
    'zh-hans',
    'simplifiedchinese',
    'chinesesimplified',
  ],
  chinese_traditional: [
    'cnt',
    'cht',
    'tc',
    'zhtw',
    'zhhk',
    'zhhant',
    'zh-hant',
    'traditionalchinese',
    'chinesetraditional',
  ],
  portuguese: ['br', 'portuguese', 'pt', 'ptbr'],
  german: ['de', 'german'],
  french: ['fr', 'french'],
  italian: ['it', 'italian'],
  japanese: ['jp', 'japanese'],
  korean: ['ko', 'korean'],
  polish: ['pl', 'polish'],
  russian: ['ru', 'russian'],
  spanish: ['sp', 'es', 'spanish'],
  turkish: ['tr', 'turkish'],
}

export type LocalizationToken = {
  id: string
  fallback: string
}

export type XmlLocalizationEntry = {
  language: string
  text: string
  filePath?: string
}

export type SourceLocalizationEntry = {
  fallbackText: string
  filePath: string
  moduleName: string
  assemblyName: string
  lineNumber: number
  columnNumber: number
  contextKind: string
  sourcePriority: number
}

export type LocalizationDetails = {
  stringId: string
  tokenFallback?: string
  xmlEntries: XmlLocalizationEntry[]
  sourceEntries: SourceLocalizationEntry[]
}

export function parseLocalizationToken(text?: string | null): LocalizationToken | null {
  if (!text) return null
  const match = text.match(TOKEN_REGEX)
  if (!match) return null
  return {
    id: match[1],
    fallback: match[2] || '',
  }
}

export function resolveLocalizationDetails(
  tokenOrId: string,
  preferredLanguages?: string[]
): LocalizationDetails {
  const token = parseLocalizationToken(tokenOrId)
  const id = token?.id || tokenOrId.replace(/[{}=]/g, '').trim()
  const db = getDb()

  const xmlEntries = db
    .query<any, any>(
      `
      SELECT language, text, filePath
      FROM localization_entries
      WHERE stringId = $id
      ORDER BY language, filePath
    `
    )
    .all({
      $id: id,
    }) as XmlLocalizationEntry[]

  const sourceEntries = hasRuntimeTable('source_localization_entries')
    ? (db
        .query<any, any>(
          `
          SELECT fallbackText, filePath, moduleName, assemblyName, lineNumber, columnNumber, contextKind, sourcePriority
          FROM source_localization_entries
          WHERE stringId = $id
          ORDER BY sourcePriority, moduleName, assemblyName, filePath, lineNumber, columnNumber
        `
        )
        .all({ $id: id }) as SourceLocalizationEntry[])
    : []

  xmlEntries.sort((left, right) => {
    const rankDelta =
      getLocalizationLanguageRank(left.language, preferredLanguages) -
      getLocalizationLanguageRank(right.language, preferredLanguages)

    if (rankDelta !== 0) {
      return rankDelta
    }

    const languageDelta = left.language.localeCompare(right.language)
    if (languageDelta !== 0) {
      return languageDelta
    }

    return (left.filePath || '').localeCompare(right.filePath || '')
  })

  return {
    stringId: id,
    tokenFallback: token?.fallback || undefined,
    xmlEntries,
    sourceEntries,
  }
}

export function resolveLocalizationMap(
  tokenOrId: string,
  preferredLanguages?: string[]
): Record<string, string> {
  const details = resolveLocalizationDetails(tokenOrId, preferredLanguages)
  const mapping: Record<string, string> = {}

  for (const row of details.xmlEntries) {
    if (!mapping[row.language]) {
      mapping[row.language] = row.text
    }

    const canonical = getCanonicalLanguage(row.language)
    if (canonical && !mapping[canonical]) {
      mapping[canonical] = row.text
    }
  }

  if (details.sourceEntries[0]?.fallbackText && !mapping.sourceFallback) {
    mapping.sourceFallback = details.sourceEntries[0].fallbackText
  }

  if (details.tokenFallback && !mapping.fallback) {
    mapping.fallback = details.tokenFallback
  }

  return mapping
}

export function resolveMaybeLocalizedText(
  rawText: string | undefined,
  preferredLanguages?: string[]
): string {
  if (!rawText) return 'unknown'
  const token = parseLocalizationToken(rawText)
  if (!token) return rawText

  const mapping = resolveLocalizationMap(rawText, preferredLanguages)
  const preferred = buildPreferredLanguageOrder(preferredLanguages)
    .map(language => mapping[language])
    .find(Boolean)

  const finalText = preferred || mapping.sourceFallback || token.fallback
  if (!finalText) return rawText
  return `${finalText} ({=${token.id}})`
}

function hasRuntimeTable(tableName: string): boolean {
  const db = getDb()
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

function buildPreferredLanguageOrder(preferredLanguages?: string[]): string[] {
  const result: string[] = []

  for (const language of preferredLanguages ?? []) {
    const canonical = getCanonicalLanguage(language)
    if (canonical && !result.includes(canonical)) {
      result.push(canonical)
    }
  }

  for (const fallback of ['chinese_simplified', 'chinese_traditional', 'english']) {
    if (!result.includes(fallback)) {
      result.push(fallback)
    }
  }

  return result
}

function getLocalizationLanguageRank(language: string, preferredLanguages?: string[]): number {
  const canonical = getCanonicalLanguage(language)
  const order = buildPreferredLanguageOrder(preferredLanguages)
  const index = canonical ? order.indexOf(canonical) : -1
  return index === -1 ? order.length + 1 : index
}

function getCanonicalLanguage(language: string): string | null {
  const normalized = normalizeLanguageKey(language)
  if (!normalized) {
    return null
  }

  if (normalized.startsWith('std')) {
    return 'english'
  }

  for (const [canonical, aliases] of Object.entries(CANONICAL_LANGUAGE_ALIASES)) {
    if (matchesLanguage(normalized, aliases)) {
      return canonical
    }
  }

  return normalized
}

function normalizeLanguageKey(language: string | undefined): string {
  return (language || '').trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function matchesLanguage(normalizedLanguage: string, aliases: string[]): boolean {
  return aliases.some(alias => normalizeLanguageKey(alias) === normalizedLanguage)
}
