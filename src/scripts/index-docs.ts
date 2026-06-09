import { createHash } from 'node:crypto'
import { Database } from 'bun:sqlite'
import { ensureSetupDirectoriesForGame } from '../utils/bannerlord-setup'
import { getGamePaths } from '../utils/env'

type CliArgs = {
  game?: string
  source: 'all' | 'official' | 'community'
}

type OfficialDocEntry = {
  uri?: string
  title?: string
  tags?: string[]
  description?: string
  content?: string
}

type CommunitySearchIndex = {
  docs?: Array<{
    location?: string
    title?: string
    text?: string
  }>
}

type DocRow = {
  id: string
  source: string
  language: string
  category: string
  title: string
  url: string
  content: string
  indexedAt: string
}

const OFFICIAL_SOURCE = {
  id: 'official_moddocs',
  label: 'Official Bannerlord Modding Documentation',
  baseUrl: 'https://moddocs.bannerlord.com/zh_cn/',
  indexUrl: 'https://moddocs.bannerlord.com/zh_cn/index.json',
  language: 'zh_cn',
}

const COMMUNITY_SOURCE = {
  id: 'community_modding_docs',
  label: 'BannerlordModding.LT Community Documentation',
  baseUrl: 'https://docs.bannerlordmodding.lt/',
  indexUrl: 'https://docs.bannerlordmodding.lt/search/search_index.json',
  language: 'en',
}

export async function buildDocsIndex(gameId?: string, source: CliArgs['source'] = 'all'): Promise<{
  officialPages: number
  communityPages: number
  totalPages: number
}> {
  const { dbPath, gameId: resolvedGameId } = getGamePaths(gameId)
  await ensureSetupDirectoriesForGame(resolvedGameId)
  const indexedAt = new Date().toISOString()
  const rows: DocRow[] = []

  if (source === 'all' || source === 'official') {
    rows.push(...await fetchOfficialModDocs(indexedAt))
  }

  if (source === 'all' || source === 'community') {
    rows.push(...await fetchCommunityDocs(indexedAt))
  }

  const db = new Database(dbPath)
  db.run('PRAGMA busy_timeout = 5000;')
  db.run('PRAGMA journal_mode = WAL;')

  try {
    ensureDocsSchema(db)
    if (source === 'all') {
      db.run('DELETE FROM bannerlord_docs_pages;')
      db.run('DELETE FROM bannerlord_docs_fts;')
      db.run('DELETE FROM bannerlord_docs_sources;')
    } else {
      const sourceId = source === 'official' ? OFFICIAL_SOURCE.id : COMMUNITY_SOURCE.id
      db.prepare('DELETE FROM bannerlord_docs_pages WHERE source = $source').run({ $source: sourceId })
      db.prepare('DELETE FROM bannerlord_docs_fts WHERE source = $source').run({ $source: sourceId })
      db.prepare('DELETE FROM bannerlord_docs_sources WHERE source = $source').run({ $source: sourceId })
    }

    upsertSource(db, OFFICIAL_SOURCE.id, OFFICIAL_SOURCE.label, OFFICIAL_SOURCE.baseUrl, OFFICIAL_SOURCE.language, indexedAt)
    upsertSource(db, COMMUNITY_SOURCE.id, COMMUNITY_SOURCE.label, COMMUNITY_SOURCE.baseUrl, COMMUNITY_SOURCE.language, indexedAt)

    const insertPage = db.prepare(`
      INSERT OR REPLACE INTO bannerlord_docs_pages (
        id, source, language, category, title, url, content, indexedAt
      ) VALUES (
        $id, $source, $language, $category, $title, $url, $content, $indexedAt
      )
    `)
    const insertFts = db.prepare(`
      INSERT INTO bannerlord_docs_fts (
        id, source, language, category, title, url, content
      ) VALUES (
        $id, $source, $language, $category, $title, $url, $content
      )
    `)

    const transaction = db.transaction((batch: DocRow[]) => {
      for (const row of batch) {
        insertPage.run({
          $id: row.id,
          $source: row.source,
          $language: row.language,
          $category: row.category,
          $title: row.title,
          $url: row.url,
          $content: row.content,
          $indexedAt: row.indexedAt,
        })
        insertFts.run({
          $id: row.id,
          $source: row.source,
          $language: row.language,
          $category: row.category,
          $title: row.title,
          $url: row.url,
          $content: row.content,
        })
      }
    })
    transaction(rows)
  } finally {
    db.close()
  }

  const officialPages = rows.filter(row => row.source === OFFICIAL_SOURCE.id).length
  const communityPages = rows.filter(row => row.source === COMMUNITY_SOURCE.id).length
  console.log(`Bannerlord docs index built for ${resolvedGameId}.`)
  console.log(`Official moddocs pages: ${officialPages}`)
  console.log(`Community docs pages: ${communityPages}`)
  console.log(`Total docs pages: ${rows.length}`)

  return {
    officialPages,
    communityPages,
    totalPages: rows.length,
  }
}

async function fetchOfficialModDocs(indexedAt: string): Promise<DocRow[]> {
  const entries = await fetchJson<OfficialDocEntry[]>(OFFICIAL_SOURCE.indexUrl)

  return entries
    .map(entry => {
      const title = cleanText(entry.title)
      const url = entry.uri?.trim()
      const content = cleanText([entry.description, entry.content, entry.tags?.join(' ')].filter(Boolean).join('\n'))
      if (!title || !url || !content) return undefined

      return {
        id: makeDocId(OFFICIAL_SOURCE.id, url),
        source: OFFICIAL_SOURCE.id,
        language: OFFICIAL_SOURCE.language,
        category: inferUrlCategory(url, OFFICIAL_SOURCE.baseUrl),
        title,
        url,
        content,
        indexedAt,
      }
    })
    .filter((row): row is DocRow => Boolean(row))
}

async function fetchCommunityDocs(indexedAt: string): Promise<DocRow[]> {
  const index = await fetchJson<CommunitySearchIndex>(COMMUNITY_SOURCE.indexUrl)

  return (index.docs ?? [])
    .map(entry => {
      const title = cleanText(entry.title)
      const location = entry.location?.trim() || ''
      const url = new URL(location, COMMUNITY_SOURCE.baseUrl).toString()
      const content = cleanText(stripHtml(entry.text || ''))
      if (!title || !content) return undefined

      return {
        id: makeDocId(COMMUNITY_SOURCE.id, url),
        source: COMMUNITY_SOURCE.id,
        language: COMMUNITY_SOURCE.language,
        category: inferUrlCategory(url, COMMUNITY_SOURCE.baseUrl),
        title,
        url,
        content,
        indexedAt,
      }
    })
    .filter((row): row is DocRow => Boolean(row))
}

function ensureDocsSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS bannerlord_docs_sources (
      source TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      baseUrl TEXT NOT NULL,
      language TEXT NOT NULL,
      indexedAt TEXT NOT NULL
    );
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS bannerlord_docs_pages (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      language TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      content TEXT NOT NULL,
      indexedAt TEXT NOT NULL
    );
  `)
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS bannerlord_docs_fts USING fts5(
      id UNINDEXED,
      source UNINDEXED,
      language UNINDEXED,
      category,
      title,
      url UNINDEXED,
      content,
      tokenize = 'unicode61',
      prefix = '2 3 4'
    );
  `)
  db.run('CREATE INDEX IF NOT EXISTS bannerlord_docs_pages_source_idx ON bannerlord_docs_pages(source);')
  db.run('CREATE INDEX IF NOT EXISTS bannerlord_docs_pages_category_idx ON bannerlord_docs_pages(category);')
}

function upsertSource(
  db: Database,
  source: string,
  label: string,
  baseUrl: string,
  language: string,
  indexedAt: string
): void {
  db.prepare(`
    INSERT INTO bannerlord_docs_sources (source, label, baseUrl, language, indexedAt)
    VALUES ($source, $label, $baseUrl, $language, $indexedAt)
    ON CONFLICT(source) DO UPDATE SET
      label = excluded.label,
      baseUrl = excluded.baseUrl,
      language = excluded.language,
      indexedAt = excluded.indexedAt
  `).run({
    $source: source,
    $label: label,
    $baseUrl: baseUrl,
    $language: language,
    $indexedAt: indexedAt,
  })
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`)
  }

  return await response.json() as T
}

function makeDocId(source: string, url: string): string {
  return createHash('sha1').update(`${source}|${url}`).digest('hex')
}

function inferUrlCategory(url: string, baseUrl: string): string {
  const path = new URL(url, baseUrl).pathname
  const basePath = new URL(baseUrl).pathname
  const relativePath = path.startsWith(basePath) ? path.slice(basePath.length) : path.replace(/^\/+/, '')
  return relativePath.split('/').filter(Boolean)[0] || 'home'
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
}

function cleanText(value?: string): string {
  return decodeHtmlEntities(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
}

function parseCliArgs(argv: string[]): CliArgs {
  const result: CliArgs = {
    source: 'all',
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

    if (arg === '--source' && next) {
      result.source = parseSource(next)
      index += 1
      continue
    }

    if (arg.startsWith('--source=')) {
      result.source = parseSource(arg.slice('--source='.length))
      continue
    }

    if (arg === '--help' || arg === '-h') {
      printHelpAndExit()
    }
  }

  return result
}

function parseSource(value: string): CliArgs['source'] {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'all' || normalized === 'official' || normalized === 'community') {
    return normalized
  }

  throw new Error(`Unsupported --source '${value}'. Use all, official, or community.`)
}

function printHelpAndExit(): never {
  console.log(`
Usage:
  bun run index:docs
  bun run index:docs -- --source official
  bun run index:docs -- --source community

Options:
  --game <id>                Game profile to index into. Default: bannerlord.
  --source <all|official|community>
                             Select which docs source to refresh. Default: all.
`)
  process.exit(0)
}

if (import.meta.main) {
  const cli = parseCliArgs(process.argv.slice(2))
  buildDocsIndex(cli.game, cli.source).catch(error => {
    console.error(`Fatal error while building the Bannerlord docs index: ${error instanceof Error ? error.stack || error.message : String(error)}`)
    process.exit(1)
  })
}
