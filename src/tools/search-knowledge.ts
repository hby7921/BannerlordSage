import { PathSandbox } from '../utils/path-sandbox'
import { renderAiTextReport, type AiTextBlock } from '../utils/ai-text'
import { searchApiDocs } from './search-api-docs'
import { searchDocs } from './search-docs'
import { searchSource } from './search-source'

type KnowledgeIntent = 'auto' | 'make_mod' | 'api' | 'docs' | 'source'

export async function searchKnowledge(
  sandbox: PathSandbox,
  query: string,
  intent: KnowledgeIntent = 'auto',
  limit = 5
) {
  const normalizedQuery = query.trim()
  const resolvedIntent = resolveIntent(normalizedQuery, intent)
  const officialDocsQuery = buildOfficialDocsQuery(normalizedQuery, resolvedIntent)
  const communityDocsQuery = buildCommunityDocsQuery(normalizedQuery, resolvedIntent)
  const apiQuery = buildApiQuery(normalizedQuery, resolvedIntent)
  const sourceQuery = buildSourceQuery(normalizedQuery, resolvedIntent)

  const officialDocs = shouldSearchDocs(resolvedIntent)
    ? await safeSearch('official_docs', () => searchDocs(officialDocsQuery, 'official', clampLimit(limit)))
    : undefined
  const communityDocs = shouldSearchDocs(resolvedIntent)
    ? await safeSearch('community_docs', () => searchDocs(communityDocsQuery, 'community', clampLimit(limit)))
    : undefined
  const apiDocs = shouldSearchApi(resolvedIntent)
    ? await safeSearch('official_api_docs', () => searchApiDocs(apiQuery, undefined, undefined, clampLimit(limit)))
    : undefined
  const sourceMatches = shouldSearchSource(resolvedIntent)
    ? await safeSearch('local_decompiled_source', () => searchSource(sandbox, sourceQuery, false, '*.cs'))
    : undefined

  const blocks: AiTextBlock[] = [
    buildResultBlock('official_docs', officialDocs),
    buildResultBlock('community_docs', communityDocs),
    buildResultBlock('official_api_docs', apiDocs),
    buildResultBlock('local_decompiled_source', sourceMatches),
  ].filter((block): block is AiTextBlock => Boolean(block))

  const text = renderAiTextReport('bannerlord_knowledge_search', 'request_text', normalizedQuery, blocks, [
    { key: 'resolved_intent', value: resolvedIntent },
    { key: 'official_docs_query', value: shouldSearchDocs(resolvedIntent) ? officialDocsQuery : '(skipped)' },
    { key: 'community_docs_query', value: shouldSearchDocs(resolvedIntent) ? communityDocsQuery : '(skipped)' },
    { key: 'api_query', value: shouldSearchApi(resolvedIntent) ? apiQuery : '(skipped)' },
    { key: 'source_query', value: shouldSearchSource(resolvedIntent) ? sourceQuery : '(skipped)' },
    { key: 'docs_scope', value: shouldSearchDocs(resolvedIntent) ? 'official_and_community' : 'skipped' },
    { key: 'api_scope', value: shouldSearchApi(resolvedIntent) ? 'official_api_symbols_reference_only_if_version_mismatch' : 'skipped' },
    { key: 'source_scope', value: shouldSearchSource(resolvedIntent) ? 'local_decompiled_source_authority' : 'skipped' },
    {
      key: 'usage_rule',
      value: 'For Bannerlord mod implementation decisions, prefer local decompiled source when official API version does not exactly match the installed game.',
    },
  ])

  return { content: [{ type: 'text' as const, text }] }
}

async function safeSearch(label: string, search: () => Promise<{ content: Array<{ type: 'text'; text: string }> }>): Promise<{
  label: string
  ok: boolean
  text: string
}> {
  try {
    const result = await search()
    return {
      label,
      ok: true,
      text: result.content.map(item => item.text).join('\n\n').trim(),
    }
  } catch (error) {
    return {
      label,
      ok: false,
      text: error instanceof Error ? error.message : String(error),
    }
  }
}

function buildResultBlock(resultLabel: string, result?: Awaited<ReturnType<typeof safeSearch>>): AiTextBlock | undefined {
  if (!result) return undefined

  return {
    header: resultLabel,
    fields: [
      { key: 'search_ok', value: result.ok },
      { key: 'source', value: result.label },
    ],
    multilineFields: [
      {
        key: result.ok ? 'results' : 'error',
        value: trimNestedReport(result.text),
      },
    ],
  }
}

function resolveIntent(query: string, intent: KnowledgeIntent): Exclude<KnowledgeIntent, 'auto'> {
  if (intent !== 'auto') return intent

  const lower = query.toLowerCase()
  if (/[a-z_][a-z0-9_.]*\s*\(/i.test(query) || /\b(api|class|method|property|event|enum|interface)\b/i.test(query)) {
    return 'api'
  }

  if (/\b(harmony|patch|mod|module|submodule|gauntlet|ui|xml|asset|editor|campaignbehavior|behavior)\b/i.test(lower)) {
    return 'make_mod'
  }

  if (/制作|开发|创建|做一个|做个|模组|mod|补丁|功能|界面|资源|编辑器|战役|行为/.test(query)) {
    return 'make_mod'
  }

  return 'make_mod'
}

function shouldSearchDocs(intent: Exclude<KnowledgeIntent, 'auto'>): boolean {
  return intent === 'make_mod' || intent === 'docs'
}

function shouldSearchApi(intent: Exclude<KnowledgeIntent, 'auto'>): boolean {
  return intent === 'make_mod' || intent === 'api'
}

function shouldSearchSource(intent: Exclude<KnowledgeIntent, 'auto'>): boolean {
  return intent === 'make_mod' || intent === 'source' || intent === 'api'
}

function buildOfficialDocsQuery(query: string, intent: Exclude<KnowledgeIntent, 'auto'>): string {
  if (intent === 'docs' || intent === 'make_mod') {
    if (/gauntlet|ui|界面|菜单|窗口|按钮/i.test(query)) return 'Gauntlet UI'
    if (/asset|资源|模型|材质|覆盖|替换/i.test(query)) return '资产'
    if (/xml|数据|兵种|物品|文化|王国/i.test(query)) return 'XML'
    if (/submodule|模块|模组|mod|制作|创建|开发|quick/i.test(query)) return '快速入门'
  }

  return query
}

function buildCommunityDocsQuery(query: string, intent: Exclude<KnowledgeIntent, 'auto'>): string {
  if (intent === 'docs' || intent === 'make_mod') {
    if (/gauntlet|ui|界面|菜单|窗口|按钮/i.test(query)) return 'Gauntlet UI'
    if (/xml|数据|兵种|物品|文化|王国/i.test(query)) return 'SubModule XML'
    if (/harmony|patch|补丁|修改方法/i.test(query)) return 'Harmony'
    if (/asset|资源|模型|材质|覆盖|替换/i.test(query)) return 'asset'
    if (/submodule|模块|模组|mod|制作|创建|开发|quick/i.test(query)) return 'SubModule'
  }

  return query
}

function buildApiQuery(query: string, intent: Exclude<KnowledgeIntent, 'auto'>): string {
  const symbol = extractLikelySymbol(query)
  if (symbol) return symbol

  if (intent === 'make_mod' || intent === 'api') {
    if (/gauntlet|ui|界面|菜单|窗口|按钮/i.test(query)) return 'Gauntlet'
    if (/xml|数据|读取|注册/i.test(query)) return 'MBObjectManager'
    if (/party|队伍|部队|俘虏|招募|士兵/i.test(query)) return 'MobileParty'
    if (/hero|领主|英雄|家族|clan/i.test(query)) return 'Hero'
    return 'CampaignBehavior'
  }

  return query
}

function buildSourceQuery(query: string, intent: Exclude<KnowledgeIntent, 'auto'>): string {
  const symbol = extractLikelySymbol(query)
  if (symbol) return symbol

  if (intent === 'make_mod' || intent === 'source' || intent === 'api') {
    if (/gauntlet|ui|界面|菜单|窗口|按钮/i.test(query)) return 'Gauntlet'
    if (/xml|数据|读取|注册/i.test(query)) return 'MBObjectManager'
    if (/party|队伍|部队|俘虏|招募|士兵/i.test(query)) return 'MobileParty'
    if (/hero|领主|英雄|家族|clan/i.test(query)) return 'Hero'
    return 'CampaignBehavior'
  }

  const englishWords = query.match(/[A-Za-z][A-Za-z0-9_.]{2,}/g)
  if (englishWords?.length) return englishWords[0]

  return query
}

function extractLikelySymbol(query: string): string | undefined {
  const candidates = query.match(/\b[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*\b/g) ?? []
  return candidates
    .filter(candidate => !['Bannerlord', 'MCP', 'API', 'XML', 'UI'].includes(candidate))
    .sort((left, right) => right.length - left.length)[0]
}

function trimNestedReport(text: string): string {
  const lines = text.trim().split(/\r?\n/)
  const maxLines = 80
  const trimmed = lines.slice(0, maxLines).join('\n')
  return lines.length > maxLines ? `${trimmed}\n... truncated nested report ...` : trimmed
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 5
  return Math.max(1, Math.min(10, Math.floor(limit)))
}
