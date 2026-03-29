import { Glob } from 'bun'
import { basename } from 'path'
import { renderAiTextReport, type AiTextBlock } from '../utils/ai-text'
import { PathSandbox } from '../utils/path-sandbox'
import { readTextFileLines } from '../utils/text-file-cache'
import { ensureRuntimeRevisionFresh, registerRuntimeInvalidator } from '../utils/runtime-revision'

const XML_GLOB = new Glob('**/*.xml')
const uiPathCache = new Map<string, string | null>()
const uiIndexCache = new Map<string, Promise<string[]>>()

export async function readGauntletUi(sandbox: PathSandbox, uiFileName: string) {
  ensureRuntimeRevisionFresh()
  const normalizedQuery = uiFileName.trim()
  if (!normalizedQuery) {
    return {
      content: [
        {
          type: 'text' as const,
          text: renderAiTextReport('gauntlet_ui', 'ui_file_name', uiFileName, [], [
            { key: 'error', value: 'ui_file_name is required' },
          ]),
        },
      ],
    }
  }

  const foundPath = await resolveUiPath(sandbox, normalizedQuery)
  if (!foundPath) {
    return {
      content: [
        {
          type: 'text' as const,
          text: renderAiTextReport('gauntlet_ui', 'ui_file_name', normalizedQuery, [], [
            { key: 'found', value: false },
          ]),
        },
      ],
    }
  }

  const fullPath = sandbox.validateAndResolve(foundPath)
  const content = (await readTextFileLines(fullPath)).join('\n')

  const dataSources = collectMatches(content, /DataSource="{([^}]+)}"/g)
  const clickCommands = collectMatches(content, /Command\.Click="([^"]+)"/g)

  const blocks: AiTextBlock[] = [
    {
      fields: [
        { key: 'file_path', value: foundPath },
        { key: 'file_name', value: basename(foundPath) },
        { key: 'data_source_count', value: dataSources.length },
        { key: 'click_command_count', value: clickCommands.length },
      ],
      listFields: [
        { key: 'data_sources', values: dataSources },
        { key: 'click_commands', values: clickCommands },
      ],
    },
  ]

  return {
    content: [
      {
        type: 'text' as const,
        text: renderAiTextReport('gauntlet_ui', 'ui_file_name', normalizedQuery, blocks, [
          { key: 'found', value: true },
        ]),
      },
    ],
  }
}

async function resolveUiPath(sandbox: PathSandbox, uiFileName: string): Promise<string | null> {
  const cacheKey = `${sandbox.basePath}::${uiFileName.toLowerCase()}`
  if (uiPathCache.has(cacheKey)) {
    return uiPathCache.get(cacheKey) ?? null
  }

  const candidates = await getUiIndex(sandbox.basePath)
  const normalizedQuery = uiFileName.toLowerCase()

  const exactMatches = candidates.filter(path => getXmlStem(path) === normalizedQuery)
  const prefixMatches =
    exactMatches.length > 0
      ? exactMatches
      : candidates.filter(path => getXmlStem(path).startsWith(normalizedQuery))

  const bestMatch = rankUiMatches(prefixMatches)[0] ?? null
  uiPathCache.set(cacheKey, bestMatch)
  return bestMatch
}

async function getUiIndex(basePath: string): Promise<string[]> {
  const cached = uiIndexCache.get(basePath)
  if (cached) {
    return await cached
  }

  const pending = buildUiIndex(basePath)
  uiIndexCache.set(basePath, pending)
  return await pending
}

async function buildUiIndex(basePath: string): Promise<string[]> {
  const results: string[] = []
  for await (const relativePath of XML_GLOB.scan({ cwd: basePath })) {
    results.push(relativePath.replaceAll('\\', '/'))
  }
  return results
}

function rankUiMatches(paths: string[]): string[] {
  return [...paths].sort((left, right) => {
    const scoreDelta = getUiMatchScore(right) - getUiMatchScore(left)
    return scoreDelta !== 0 ? scoreDelta : left.localeCompare(right)
  })
}

function getUiMatchScore(path: string): number {
  const normalized = path.toLowerCase()
  if (normalized.includes('/gui/prefabs/')) return 30
  if (normalized.includes('/gui/')) return 20
  if (normalized.includes('/prefabs/')) return 10
  return 0
}

function getXmlStem(path: string): string {
  const fileName = basename(path).toLowerCase()
  return fileName.endsWith('.xml') ? fileName.slice(0, -4) : fileName
}

function collectMatches(content: string, regex: RegExp): string[] {
  const values = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const value = match[1]?.trim()
    if (value) {
      values.add(value)
    }
  }

  return [...values]
}

function clearGauntletUiCaches(): void {
  uiPathCache.clear()
  uiIndexCache.clear()
}

registerRuntimeInvalidator(() => {
  clearGauntletUiCaches()
})
