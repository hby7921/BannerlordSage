import { runSetup } from '../scripts/setup'

function mergeBannerlordDefaults(args: string[]): string[] {
  const nextArgs = [...args]

  if (!hasFlag(nextArgs, '--game')) {
    nextArgs.unshift('bannerlord')
    nextArgs.unshift('--game')
  }

  if (!hasFlag(nextArgs, '--dll-scope')) {
    nextArgs.unshift('core')
    nextArgs.unshift('--dll-scope')
  }

  if (!hasFlag(nextArgs, '--xml-scope')) {
    nextArgs.unshift('official')
    nextArgs.unshift('--xml-scope')
  }

  return nextArgs
}

function hasFlag(args: string[], flagName: string): boolean {
  return args.some(arg => arg === flagName || arg.startsWith(`${flagName}=`))
}

if (import.meta.main) {
  process.env.BANNERSAGE_GAME = 'bannerlord'
  runSetup(mergeBannerlordDefaults(process.argv.slice(2))).catch(error => {
    console.error('Bannerlord setup failed:', error)
    process.exit(1)
  })
}
