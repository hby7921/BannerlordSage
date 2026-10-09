import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { EDITOR_MAX_SESSION_BYTES, EDITOR_PROBE_ACTIONS, editorToolResult, requestEditor, type EditorAction, type EditorReply } from '../../src/utils/bannerlord-editor-client'

const sessionPath = resolve(process.env.BANNERSAGE_EDITOR_PROBE_SESSION || resolve(import.meta.dir, '../../dist/editor-probe/session.json'))
const actions = EDITOR_PROBE_ACTIONS
type Action = EditorAction
type Session = { gameDir: string; outputDir: string; sceneDir: string; token: string; port: number }
type Reply = EditorReply

async function session(): Promise<Session> {
  // prepare may read an existing session before the module is deployed.
  // Its config-only read keeps the same bound as the validated shared client.
  let json: string
  try {
    const handle = await open(sessionPath, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > EDITOR_MAX_SESSION_BYTES) throw new Error('Invalid session file')
      const buffer = Buffer.alloc(EDITOR_MAX_SESSION_BYTES + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
        if (!bytesRead) break
        length += bytesRead
      }
      if (length > EDITOR_MAX_SESSION_BYTES) throw new Error('Invalid session file')
      json = buffer.subarray(0, length).toString('utf8')
    } finally { await handle.close() }
  } catch (error: any) {
    const safe = new Error('The local editor session is missing, oversized or unreadable') as Error & { code?: string }
    if (error.code === 'ENOENT') safe.code = 'ENOENT'
    throw safe
  }
  try { return JSON.parse(json.replace(/^\uFEFF/, '')) }
  catch { throw new Error('The local editor session JSON is invalid') }
}

async function request(action: Action, args: Record<string, unknown> = {}): Promise<Reply> {
  return requestEditor(action, args, sessionPath)
}

async function prepare(gameDir: string) {
  if (!gameDir) throw new Error('prepare requires the real game directory')
  gameDir = resolve(gameDir)
  const versions = await Promise.all(['Win64_Shipping_Client', 'Win64_Shipping_wEditor'].map(async variant => {
    const xml = await readFile(join(gameDir, 'bin', variant, 'Version.xml'), 'utf8')
    return xml.match(/Singleplayer\s+Value="([^"]+)"/)?.[1]
  }))
  if (versions.some(v => v !== 'v1.4.8')) throw new Error(`Probe targets aligned v1.4.8; found ${versions.join(', ')}`)
  const outputDir = dirname(sessionPath)
  const sceneDir = join(gameDir, 'Modules', 'BannerlordSage.EditorProbe', 'SceneObj', 'bannersage_editor_probe')
  await mkdir(outputDir, { recursive: true })
  // Existing sessions are preserved; credentials never go to stdout or Git.
  let config: Session
  try { config = await session(); if (config.gameDir !== gameDir) throw new Error('Existing probe session uses a different game directory') }
  catch (error: any) {
    if (error.code !== 'ENOENT') throw error
    config = { gameDir, outputDir, sceneDir, token: crypto.randomUUID(), port: 17748 }
    await writeFile(sessionPath, JSON.stringify(config, null, 2))
  }
  console.log(JSON.stringify({ alignedVersion: versions[0], outputDir, sceneDir, port: config.port }))
}

async function serve() {
  const server = new McpServer({ name: 'bannerlordsage-editor-probe', version: '0.0.1' })
  server.registerTool('editor_probe', {
    description: 'Experimental local editor probe. Every write is restricted to the dedicated copied test scene.',
    inputSchema: {
      action: z.enum(actions),
      args: z.object({ prefab: z.string().optional(), mesh: z.string().optional(), x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
        targetX: z.number().optional(), targetY: z.number().optional(), targetZ: z.number().optional(),
        entities: z.array(z.object({id:z.string(),prefab:z.string(),x:z.number(),y:z.number(),z:z.number(),
          rx:z.number().optional(),ry:z.number().optional(),rz:z.number().optional(),sx:z.number().optional(),sy:z.number().optional(),sz:z.number().optional()})).max(64).optional(),
      }).optional(),
    },
  }, async ({ action, args }) => editorToolResult(action, args ?? {}, sessionPath))
  await server.connect(new StdioServerTransport())
}

async function viaMcp(action: Action, args: Record<string, unknown> = {}) {
  const client = new Client({ name: 'editor-probe-verifier', version: '0.0.1' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['run', import.meta.path, 'mcp'], cwd: resolve(import.meta.dir, '../..'),
    env: process.env.BANNERSAGE_EDITOR_PROBE_SESSION ? { BANNERSAGE_EDITOR_PROBE_SESSION: process.env.BANNERSAGE_EDITOR_PROBE_SESSION } : undefined }))
  try {
    const result = await client.callTool({ name: 'editor_probe', arguments: { action, args } })
    const first = (result.content as Array<{ type: string; text?: string }>).find(x => x.type === 'text')
    if (!first?.text) throw new Error('MCP did not return a text response')
    return JSON.parse(first.text) as Reply
  } finally { await client.close() }
}

async function verify(baseline = false) {
  const config = await session()
  const evidence: Array<{ step: string; response: Reply }> = []
  const record = async (step: string, response: Reply) => {
    evidence.push({ step, response })
    await writeFile(join(config.outputDir, 'verification.json'), JSON.stringify({ evidence }, null, 2))
    if (!response.ok) throw new Error(`${step}: ${response.error}`)
    if (response.mainThread !== response.executedThread) throw new Error(`${step}: wrong execution thread`)
    console.log(`${step}: PASS`)
    return response
  }
  await record('CLI connection', await request('status'))
  const client = new Client({ name: 'editor-probe-e2e', version: '0.0.1' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['run', import.meta.path, 'mcp'], cwd: resolve(import.meta.dir, '../..'),
    env: { BANNERSAGE_EDITOR_PROBE_SESSION: sessionPath } }))
  const call = async (action: Action, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name: 'editor_probe', arguments: { action, args } })
    const content = (result.content as Array<{ type: string; text?: string }>).find(x => x.type === 'text')
    if (!content?.text) throw new Error('Missing MCP text result')
    return JSON.parse(content.text) as Reply
  }
  const waitForScene = async (name?: string) => {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      const reply = await call('status')
      if (!reply.ok) throw new Error(reply.error)
      if (reply.result.editMode && (!name || reply.result.scene === name)) return reply
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error(`Timed out waiting for editor scene ${name ?? '(editor)'}`)
  }
  try {
    const initial = await record('MCP connection', await call('status'))
    if (!initial.result.editMode) await record('Enter editor request', await call('enter_editor'))
    await record('Editor active', await waitForScene())
    await record('Open dedicated scene', await call('open_scene'))
    await record('Dedicated scene active', await waitForScene('bannersage_editor_probe'))
    const before = await record('Read entities', await call('entities'))
    if (!baseline) {
      if (before.result.entities.some((entity: any) => entity.name === 'bannersage_probe_marker'))
        throw new Error('The probe marker already exists; preserve it and inspect before rerunning')
      await record('Place prefab', await call('place_probe', { prefab: 'market_apple_crate', x: 3, y: 4, z: 1 }))
      await record('Move prefab', await call('move_probe', { x: 5, y: 6, z: 2 }))
    }
    await record('Save scene', await call('save_scene'))
    if (baseline) {
      await writeFile(join(config.outputDir, 'verification.json'), JSON.stringify({ passed: true, baseline: true, evidence }, null, 2))
      return
    }
    const xml = await readFile(join(config.sceneDir, 'scene.xscene'), 'utf8')
    if (!xml.includes('bannersage_probe_marker')) throw new Error('The saved scene does not contain the marker')
    console.log('Marker in saved XML: PASS')
    await record('Close scene', await call('close_scene'))
    await record('Reopen scene', await call('open_scene'))
    await record('Reopened scene active', await waitForScene('bannersage_editor_probe'))
    const reopened = await record('Read reopened entities', await call('entities'))
    const marker = reopened.result.entities.find((entity: any) => entity.name === 'bannersage_probe_marker')
    if (!marker || marker.prefab !== 'market_apple_crate' || Math.abs(marker.x - 5) > 0.001 || Math.abs(marker.y - 6) > 0.001 || Math.abs(marker.z - 2) > 0.001)
      throw new Error('The prefab or its transform did not survive close/reopen')
    await writeFile(join(config.outputDir, 'verification.json'), JSON.stringify({ passed: true, marker, evidence }, null, 2))
    console.log('Prefab persisted after close/reopen: PASS')
  } catch (error) {
    await writeFile(join(config.outputDir, 'verification.json'), JSON.stringify({ passed: false, error: String(error), evidence }, null, 2))
    throw error
  } finally { await client.close() }
}

async function main() {
  const [mode, actionOrDir, rawArgs] = process.argv.slice(2)
  if (mode === 'prepare') return prepare(actionOrDir)
  if (mode === 'mcp') return serve()
  if (mode === 'verify') return verify(actionOrDir === '--baseline')
  if (!['call', 'mcp-call'].includes(mode) || !actions.includes(actionOrDir as Action))
    throw new Error('Usage: bun run tools/editor-probe/probe.ts prepare <game-dir> | mcp | call|mcp-call <action> [JSON args]')
  let args: Record<string, unknown> = {}
  try { args = rawArgs ? JSON.parse(rawArgs) : {} }
  catch { throw new Error('The CLI action arguments must be valid JSON') }
  const result = await (mode === 'mcp-call' ? viaMcp : request)(actionOrDir as Action, args)
  const config = await session()
  await writeFile(join(config.outputDir, `last-${actionOrDir}.json`), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}

if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
