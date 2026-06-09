import { createHash } from 'node:crypto'
import { Database } from 'bun:sqlite'
import {
  BANNERLORD_API_BASE_URL,
  BANNERLORD_API_SECTIONS,
  compareApiVersions,
  normalizeApiVersion,
  type BannerlordApiSection,
} from '../utils/bannerlord-api-docs'
import { ensureSetupDirectoriesForGame } from '../utils/bannerlord-setup'
import { getGamePaths } from '../utils/env'

type CliArgs = {
  game?: string
  versions: string[]
}

type ApiEntry = {
  id: string
  version: string
  section: BannerlordApiSection
  searchKey: string
  title: string
  scope: string
  url: string
  indexedAt: string
}

type SearchFileJob = {
  section: BannerlordApiSection
  suffix: string
  url: string
}

export async function buildApiDocsIndex(gameId?: string, requestedVersions: string[] = []): Promise<{
  versionsIndexed: number
  entriesIndexed: number
}> {
  const { dbPath, gameId: resolvedGameId } = getGamePaths(gameId)
  await ensureSetupDirectoriesForGame(resolvedGameId)
  const availableVersions = await fetchAvailableApiVersions()
  const versionsToIndex = resolveVersionsToIndex(availableVersions, requestedVersions)
  const indexedAt = new Date().toISOString()
  const rows: ApiEntry[] = []

  for (const version of versionsToIndex) {
    console.log(`Indexing official API ${version}...`)
    rows.push(...await fetchApiVersionEntries(version, indexedAt))
  }

  const db = new Database(dbPath)
  db.run('PRAGMA busy_timeout = 5000;')
  db.run('PRAGMA journal_mode = WAL;')

  try {
    resetApiSchema(db)

    const insertVersion = db.prepare(`
      INSERT INTO bannerlord_api_versions (version, baseUrl, indexedAt)
      VALUES ($version, $baseUrl, $indexedAt)
    `)
    const insertEntry = db.prepare(`
      INSERT OR IGNORE INTO bannerlord_api_entries (
        id, version, section, searchKey, title, scope, url, indexedAt
      ) VALUES (
        $id, $version, $section, $searchKey, $title, $scope, $url, $indexedAt
      )
    `)
    const insertFts = db.prepare(`
      INSERT INTO bannerlord_api_entries_fts (
        id, version, section, searchKey, title, scope, url, tokens
      ) VALUES (
        $id, $version, $section, $searchKey, $title, $scope, $url, $tokens
      )
    `)

    const transaction = db.transaction((entries: ApiEntry[]) => {
      for (const version of versionsToIndex) {
        insertVersion.run({
          $version: version,
          $baseUrl: `${BANNERLORD_API_BASE_URL}v/${version}/`,
          $indexedAt: indexedAt,
        })
      }

      const seenIds = new Set<string>()
      for (const entry of entries) {
        if (seenIds.has(entry.id)) continue
        seenIds.add(entry.id)
        insertEntry.run({
          $id: entry.id,
          $version: entry.version,
          $section: entry.section,
          $searchKey: entry.searchKey,
          $title: entry.title,
          $scope: entry.scope,
          $url: entry.url,
          $indexedAt: entry.indexedAt,
        })
        insertFts.run({
          $id: entry.id,
          $version: entry.version,
          $section: entry.section,
          $searchKey: entry.searchKey,
          $title: entry.title,
          $scope: entry.scope,
          $url: entry.url,
          $tokens: buildSearchTokens(entry),
        })
      }
    })
    transaction(rows)
  } finally {
    db.close()
  }

  console.log(`Bannerlord official API index built for ${resolvedGameId}.`)
  console.log(`API versions indexed: ${versionsToIndex.length}`)
  console.log(`API entries indexed: ${rows.length}`)

  return {
    versionsIndexed: versionsToIndex.length,
    entriesIndexed: rows.length,
  }
}

async function fetchAvailableApiVersions(): Promise<string[]> {
  const html = await fetchText(BANNERLORD_API_BASE_URL)
  const versions = [...html.matchAll(/href\s*=\s*["']v\/([0-9]+(?:\.[0-9]+)+)\//gi)]
    .map(match => normalizeApiVersion(match[1]))
    .filter((version): version is string => Boolean(version))

  return [...new Set(versions)].sort((left, right) => compareApiVersions(right, left))
}

function resolveVersionsToIndex(availableVersions: string[], requestedVersions: string[]): string[] {
  if (requestedVersions.length === 0) {
    return availableVersions
  }

  const requested = requestedVersions
    .map(normalizeApiVersion)
    .filter((version): version is string => Boolean(version))
  const availableSet = new Set(availableVersions)
  const missing = requested.filter(version => !availableSet.has(version))
  if (missing.length > 0) {
    throw new Error(`Official API versions are not available: ${missing.join(', ')}. Available: ${availableVersions.join(', ')}`)
  }

  return [...new Set(requested)].sort((left, right) => compareApiVersions(right, left))
}

async function fetchApiVersionEntries(version: string, indexedAt: string): Promise<ApiEntry[]> {
  const baseUrl = `${BANNERLORD_API_BASE_URL}v/${version}/`
  const suffixesBySection = await fetchSearchFileSuffixes(baseUrl)
  const jobs: SearchFileJob[] = []

  for (const section of BANNERLORD_API_SECTIONS) {
    for (const suffix of suffixesBySection.get(section) ?? []) {
      jobs.push({
        section,
        suffix,
        url: `${baseUrl}search/${section}_${suffix}.js`,
      })
    }
  }

  const batches = await mapWithConcurrency(jobs, 12, async job => {
    const raw = await fetchTextIfPresent(job.url)
    if (!raw) return []
    return parseSearchData(raw, version, job.section, baseUrl, indexedAt)
  })

  return dedupeEntries(batches.flat())
}

async function fetchSearchFileSuffixes(baseUrl: string): Promise<Map<BannerlordApiSection, string[]>> {
  const raw = await fetchText(`${baseUrl}search/searchdata.js`)
  const sectionNames = parseSearchDataMap(raw, 'indexSectionNames')
  const sectionContent = parseSearchDataMap(raw, 'indexSectionsWithContent')
  const result = new Map<BannerlordApiSection, string[]>()

  for (const [index, name] of sectionNames.entries()) {
    if (!isApiSection(name)) continue

    const content = sectionContent.get(index) || ''
    const suffixes = [...content]
      .map(toDoxygenSearchSuffix)
      .filter((suffix): suffix is string => Boolean(suffix))
    result.set(name, [...new Set(suffixes)])
  }

  return result
}

function parseSearchDataMap(raw: string, variableName: string): Map<number, string> {
  const map = new Map<number, string>()
  const block = raw.match(new RegExp(`var\\s+${variableName}\\s*=\\s*\\{([\\s\\S]*?)\\};`, 'm'))?.[1] || ''
  const pattern = /(\d+)\s*:\s*"([^"]*)"/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(block))) {
    map.set(Number(match[1]), match[2])
  }

  return map
}

function isApiSection(value: string): value is BannerlordApiSection {
  return (BANNERLORD_API_SECTIONS as readonly string[]).includes(value)
}

function toDoxygenSearchSuffix(value: string): string | undefined {
  const lower = value.toLowerCase()
  if (/^[a-z0-9]$/.test(lower)) return lower
  if (value === '_' || value === '[') return '0'
  return undefined
}

function parseSearchData(
  raw: string,
  version: string,
  section: BannerlordApiSection,
  baseUrl: string,
  indexedAt: string
): ApiEntry[] {
  const entries: ApiEntry[] = []

  for (const line of raw.split(/\r?\n/)) {
    if (!line.includes("['")) continue

    const strings = extractSingleQuotedStrings(line).map(decodeJsString)
    if (strings.length < 3) continue

    const [searchKey, title, href, ...rest] = strings
    if (!href.includes('.html')) continue

    const url = new URL(href, `${baseUrl}search/`).toString()
    const scope = selectScope(rest)
    entries.push({
      id: makeApiEntryId(version, section, title, url),
      version,
      section,
      searchKey: normalizeSearchText(searchKey),
      title: normalizeSearchText(title),
      scope: normalizeSearchText(scope),
      url,
      indexedAt,
    })
  }

  return entries
}

function resetApiSchema(db: Database): void {
  db.run('DROP TABLE IF EXISTS bannerlord_api_entries_fts;')
  db.run('DROP TABLE IF EXISTS bannerlord_api_entries;')
  db.run('DROP TABLE IF EXISTS bannerlord_api_versions;')
  db.run(`
    CREATE TABLE bannerlord_api_versions (
      version TEXT PRIMARY KEY,
      baseUrl TEXT NOT NULL,
      indexedAt TEXT NOT NULL
    );
  `)
  db.run(`
    CREATE TABLE bannerlord_api_entries (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      section TEXT NOT NULL,
      searchKey TEXT NOT NULL,
      title TEXT NOT NULL,
      scope TEXT NOT NULL,
      url TEXT NOT NULL,
      indexedAt TEXT NOT NULL
    );
  `)
  db.run(`
    CREATE VIRTUAL TABLE bannerlord_api_entries_fts USING fts5(
      id UNINDEXED,
      version UNINDEXED,
      section UNINDEXED,
      searchKey,
      title,
      scope,
      url UNINDEXED,
      tokens,
      tokenize = 'unicode61',
      prefix = '2 3 4'
    );
  `)
  db.run('CREATE INDEX bannerlord_api_entries_version_idx ON bannerlord_api_entries(version);')
  db.run('CREATE INDEX bannerlord_api_entries_section_idx ON bannerlord_api_entries(section);')
  db.run('CREATE INDEX bannerlord_api_entries_title_idx ON bannerlord_api_entries(title);')
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`)
  }

  return await response.text()
}

async function fetchTextIfPresent(url: string): Promise<string | undefined> {
  const response = await fetch(url)
  if (response.status === 404) {
    return undefined
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`)
  }

  return await response.text()
}

function extractSingleQuotedStrings(input: string): string[] {
  const values: string[] = []
  const pattern = /'((?:\\.|[^'\\])*)'/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(input))) {
    values.push(match[1])
  }

  return values
}

function decodeJsString(value: string): string {
  return value
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function normalizeSearchText(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function selectScope(values: string[]): string {
  const candidates = values
    .map(normalizeSearchText)
    .filter(value => value && !value.includes('.html') && !value.startsWith('../'))

  return candidates[candidates.length - 1] || ''
}

function makeApiEntryId(version: string, section: BannerlordApiSection, title: string, url: string): string {
  return createHash('sha1').update(`${version}|${section}|${title}|${url}`).digest('hex')
}

function dedupeEntries(entries: ApiEntry[]): ApiEntry[] {
  const seen = new Set<string>()
  const result: ApiEntry[] = []

  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    result.push(entry)
  }

  return result
}

function buildSearchTokens(entry: ApiEntry): string {
  return [
    splitIdentifierWords(entry.searchKey),
    splitIdentifierWords(entry.title),
    splitIdentifierWords(entry.scope),
  ].flat().join(' ')
}

function splitIdentifierWords(value: string): string[] {
  const normalized = value
    .replace(/::/g, ' ')
    .replace(/[._\-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\d+/g, ' ')
    .toLowerCase()

  return normalized
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex
      if (currentIndex >= items.length) {
        return
      }

      nextIndex += 1
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}

function parseCliArgs(argv: string[]): CliArgs {
  const result: CliArgs = {
    versions: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === '--game' && next) {
      result.game = next.trim().toLowerCase()
      index += 1
      continue
    }

    if (arg.startsWith('--game=')) {
      result.game = arg.slice('--game='.length).trim().toLowerCase()
      continue
    }

    if ((arg === '--version' || arg === '--versions') && next) {
      result.versions.push(...splitCliList(next))
      index += 1
      continue
    }

    if (arg.startsWith('--version=')) {
      result.versions.push(...splitCliList(arg.slice('--version='.length)))
      continue
    }

    if (arg.startsWith('--versions=')) {
      result.versions.push(...splitCliList(arg.slice('--versions='.length)))
      continue
    }

    if (arg === '--help' || arg === '-h') {
      printHelpAndExit()
    }
  }

  return result
}

function splitCliList(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function printHelpAndExit(): never {
  console.log(`
Usage:
  bun run index:api-docs
  bun run index:api-docs -- --version 1.3.14
  bun run index:api-docs -- --versions 1.3.14,1.2.12

Options:
  --game <id>                Game profile to index into. Default: bannerlord.
  --version <version>        Official API version to index. Can be repeated.
  --versions <list>          Comma-separated official API versions to index.
`)
  process.exit(0)
}

if (import.meta.main) {
  const cli = parseCliArgs(process.argv.slice(2))
  buildApiDocsIndex(cli.game, cli.versions).catch(error => {
    console.error(`Fatal error while building the Bannerlord API docs index: ${error instanceof Error ? error.stack || error.message : String(error)}`)
    process.exit(1)
  })
}
