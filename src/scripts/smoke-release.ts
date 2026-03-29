type SmokeOptions = {
  gameDir?: string
  quick: boolean
  skipStart: boolean
  help: boolean
}

type SmokeCheck = {
  name: string
  command: string[]
  timeoutMs?: number
  expectText?: string
}

export async function runReleaseSmoke(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args)
  if (options.help) {
    printHelpAndExit()
  }

  const checks: SmokeCheck[] = [
    {
      name: 'setup help',
      command: ['bun', 'run', 'setup', '--', '--help'],
      timeoutMs: 30000,
    },
    {
      name: 'bannerlord setup help',
      command: ['bun', 'run', 'setup:bannerlord', '--', '--help'],
      timeoutMs: 30000,
    },
    {
      name: 'start import',
      command: ['bun', '-e', "import('./src/stdio.ts').then(() => console.log('stdio import ok'))"],
      timeoutMs: 30000,
      expectText: 'stdio import ok',
    },
  ]

  if (options.gameDir) {
    checks.push({
      name: 'scope report',
      command: ['bun', 'run', 'report:scopes', '--', '--game-dir', options.gameDir],
      timeoutMs: 2 * 60_000,
      expectText: 'DLL scopes',
    })

    checks.push({
      name: options.quick ? 'quick setup flow' : 'documented setup flow',
      command: buildSetupCommand(options.gameDir, options.quick),
      timeoutMs: options.quick ? 10 * 60_000 : 60 * 60_000,
      expectText: 'Setup complete.',
    })

    if (!options.skipStart && !options.quick) {
      checks.push({
        name: 'start readiness',
        command: ['bun', 'run', 'start'],
        timeoutMs: 15000,
        expectText: 'BannerlordSage MCP is ready and waiting for a client connection.',
      })
    }
  }

  let passed = 0
  for (const check of checks) {
    console.log(`\n[smoke] ${check.name}`)
    const result = await runCheck(check)
    if (!result.ok) {
      throw new Error(
        [
          `Smoke check failed: ${check.name}`,
          result.output.trim(),
        ]
          .filter(Boolean)
          .join('\n')
      )
    }

    passed += 1
    console.log(`[smoke] passed: ${check.name}`)
  }

  if (!options.gameDir) {
    console.log('\nSmoke checks passed. No --game-dir was provided, so the full local install flow was skipped.')
    console.log('Run `bun run smoke:release -- --game-dir "<path>"` to validate the documented local setup flow.')
    return
  }

  console.log(`\nSmoke checks passed: ${passed}`)
}

function parseArgs(args: string[]): SmokeOptions {
  const result: SmokeOptions = {
    quick: false,
    skipStart: false,
    help: false,
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

    if (arg === '--quick') {
      result.quick = true
      continue
    }

    if (arg === '--skip-start') {
      result.skipStart = true
      continue
    }

    if (arg === '--help' || arg === '-h') {
      result.help = true
      continue
    }
  }

  return result
}

function printHelpAndExit(): never {
  console.log(`
Usage:
  bun run smoke:release
  bun run smoke:release -- --game-dir "<BANNERLORD_GAME_DIR>"
  bun run smoke:release -- --game-dir "<BANNERLORD_GAME_DIR>" --quick

Options:
  --game-dir <path>  Run the documented setup flow against a real game installation.
  --quick            Validate a one-DLL setup flow without XML import, SQLite rebuild, or final start check.
  --skip-start       Skip the final start readiness check during a full smoke run.
  --help, -h         Show this help text.
`)
  process.exit(0)
}

function buildSetupCommand(gameDir: string, quick: boolean): string[] {
  const base = ['bun', 'run', 'setup', '--', '--accept-disclaimer', '--game-dir', gameDir]
  if (!quick) {
    return base
  }

  return [
    ...base,
    '--dll',
    'TaleWorlds.CampaignSystem.dll',
    '--skip-xml',
    '--no-index',
  ]
}

async function runCheck(check: SmokeCheck): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(check.command, {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const buffers = { stdout: '', stderr: '' }
  const stdoutPump = pumpStream(proc.stdout, chunk => {
    buffers.stdout += chunk
  })
  const stderrPump = pumpStream(proc.stderr, chunk => {
    buffers.stderr += chunk
  })

  const timeoutMs = check.timeoutMs ?? 30000
  const start = Date.now()

  while (true) {
    const combined = `${buffers.stdout}\n${buffers.stderr}`

    if (check.expectText && combined.includes(check.expectText)) {
      proc.kill()
      await Promise.allSettled([stdoutPump, stderrPump, proc.exited])
      return { ok: true, output: combined }
    }

    const exitCode = await Promise.race([
      proc.exited.then(code => ({ done: true as const, code })),
      sleep(200).then(() => ({ done: false as const, code: -1 })),
    ])

    if (exitCode.done) {
      await Promise.allSettled([stdoutPump, stderrPump])
      const output = `${buffers.stdout}\n${buffers.stderr}`
      return {
        ok: exitCode.code === 0 && (!check.expectText || output.includes(check.expectText)),
        output,
      }
    }

    if (Date.now() - start > timeoutMs) {
      proc.kill()
      await Promise.allSettled([stdoutPump, stderrPump, proc.exited])
      return {
        ok: false,
        output: `${buffers.stdout}\n${buffers.stderr}\nTimed out after ${timeoutMs}ms.`,
      }
    }
  }
}

async function pumpStream(
  stream: ReadableStream<Uint8Array> | null,
  onChunk: (chunk: string) => void
): Promise<void> {
  if (!stream) return

  const reader = stream.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        const tail = decoder.decode()
        if (tail) onChunk(tail)
        break
      }

      onChunk(decoder.decode(value, { stream: true }))
    }
  } finally {
    reader.releaseLock()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

if (import.meta.main) {
  runReleaseSmoke().catch(error => {
    console.error('Release smoke failed:', error)
    process.exit(1)
  })
}
