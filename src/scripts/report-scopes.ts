import { getGameProfile, type DllImportScope, type XmlImportScope } from '../utils/game-profiles'

type Options = {
  game: string
  gameDir?: string
  json: boolean
}

type ScopeReport = {
  game: string
  gameDir: string
  dllScopes: Record<DllImportScope, number>
  xmlScopes: Record<XmlImportScope, { files: number; includedModules: string[]; skippedModules: string[] }>
}

const DLL_SCOPES: DllImportScope[] = ['core', 'modding', 'official', 'all']
const XML_SCOPES: XmlImportScope[] = ['official', 'all']

export async function runScopeReport(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args)
  const profile = getGameProfile(options.game)
  const gameDir = options.gameDir ?? (await profile.detectGameDir())

  if (!gameDir) {
    throw new Error(
      `Could not detect a game directory for '${options.game}'. Pass --game-dir "<path>" explicitly.`
    )
  }

  if (!(await profile.looksLikeGameDir(gameDir))) {
    throw new Error(`Game directory does not match the '${options.game}' profile: ${gameDir}`)
  }

  const report: ScopeReport = {
    game: options.game,
    gameDir,
    dllScopes: {
      core: 0,
      modding: 0,
      official: 0,
      all: 0,
    },
    xmlScopes: {
      official: { files: 0, includedModules: [], skippedModules: [] },
      all: { files: 0, includedModules: [], skippedModules: [] },
    },
  }

  for (const scope of DLL_SCOPES) {
    const files = await profile.collectDllCandidates(gameDir, { dllScope: scope })
    report.dllScopes[scope] = files.length
  }

  for (const scope of XML_SCOPES) {
    const result = await profile.collectXmlFiles(gameDir, { xmlScope: scope })
    report.xmlScopes[scope] = {
      files: result.files.length,
      includedModules: result.includedModules.map(item => item.moduleName),
      skippedModules: result.skippedModules.map(item => item.moduleName),
    }
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  printHumanReport(report)
}

function parseArgs(args: string[]): Options {
  const result: Options = {
    game: 'bannerlord',
    json: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]

    if (arg === '--game' && next) {
      result.game = next
      index += 1
      continue
    }

    if (arg.startsWith('--game=')) {
      result.game = arg.slice('--game='.length)
      continue
    }

    if (arg === '--game-dir' && next) {
      result.gameDir = next
      index += 1
      continue
    }

    if (arg.startsWith('--game-dir=')) {
      result.gameDir = arg.slice('--game-dir='.length)
      continue
    }

    if (arg === '--json') {
      result.json = true
      continue
    }
  }

  return result
}

function printHumanReport(report: ScopeReport): void {
  console.log(`Game profile: ${report.game}`)
  console.log(`Game directory: ${report.gameDir}`)
  console.log('')
  console.log('DLL scopes')
  for (const scope of DLL_SCOPES) {
    console.log(`- ${scope}: ${report.dllScopes[scope]}`)
  }

  console.log('')
  console.log('XML scopes')
  for (const scope of XML_SCOPES) {
    const xml = report.xmlScopes[scope]
    console.log(`- ${scope}: files=${xml.files}, includedModules=${xml.includedModules.length}, skippedModules=${xml.skippedModules.length}`)
    if (xml.includedModules.length > 0) {
      console.log(`  included: ${xml.includedModules.join(', ')}`)
    }
    if (xml.skippedModules.length > 0) {
      console.log(`  skipped: ${xml.skippedModules.join(', ')}`)
    }
  }
}

if (import.meta.main) {
  runScopeReport().catch(error => {
    console.error('Scope report failed:', error)
    process.exit(1)
  })
}
