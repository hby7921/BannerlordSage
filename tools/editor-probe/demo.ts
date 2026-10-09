import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { z } from 'zod'
import { loadEditorSession } from '../../src/utils/bannerlord-editor-client'

const repoRoot = resolve(import.meta.dir, '../..')
const sceneOutputs = {
  bannersage_agent_camp: 'camp-demo',
  bannersage_agent_harbor: 'harbor-demo',
} as const
const executeFile = promisify(execFile)
const coordinate = z.number().finite().min(-100).max(100)
const angle = z.number().finite().min(-360).max(360).default(0)
const scale = z.number().finite().min(0.05).max(20).default(1)
const layoutEntity = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
  prefab: z.string().min(1).max(128),
  x: coordinate, y: coordinate, z: coordinate,
  rx: angle, ry: angle, rz: angle,
  sx: scale, sy: scale, sz: scale,
}).strict()
const view = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  x: coordinate, y: coordinate, z: coordinate,
  targetX: coordinate, targetY: coordinate, targetZ: coordinate,
}).strict()
const blueprintSchema = z.object({
  schemaVersion: z.literal(1),
  sceneName: z.enum(['bannersage_agent_camp', 'bannersage_agent_harbor']),
  title: z.string().min(1),
  description: z.string().min(1),
  entities: z.array(layoutEntity).min(1).max(64),
  views: z.array(view).min(1).max(4),
}).strict().superRefine((blueprint, context) => {
  for (const key of ['entities', 'views'] as const) {
    const names = blueprint[key].map(item => 'id' in item ? item.id : item.name)
    if (new Set(names).size !== names.length)
      context.addIssue({ code: 'custom', path: [key], message: `Duplicate ${key === 'entities' ? 'entity ID' : 'view name'}` })
  }
})

export type Blueprint = z.infer<typeof blueprintSchema>
export function validateBlueprint(input: unknown): Blueprint { return blueprintSchema.parse(input) }

const observedEntitySchema = z.object({
  id: z.string(), prefab: z.string(), guid: z.union([z.string().min(1), z.number()]),
  x: z.number().finite(), y: z.number().finite(), z: z.number().finite(),
  rx: z.number().finite(), ry: z.number().finite(), rz: z.number().finite(),
  sx: z.number().finite(), sy: z.number().finite(), sz: z.number().finite(),
  rotation: z.array(z.number().finite()).length(9),
})
type ObservedEntity = z.infer<typeof observedEntitySchema>
type Reply = { ok: boolean; result?: any; error?: string; mainThread?: number; executedThread?: number }
type Evidence = { step: string; at: string; response?: Reply; detail?: unknown }
const transformFields = ['x', 'y', 'z', 'sx', 'sy', 'sz'] as const
const epsilon = 0.003

function entitiesFrom(reply: Reply): ObservedEntity[] {
  const entities = z.array(observedEntitySchema).parse(reply.result?.entities)
  if (new Set(entities.map(entity => entity.id)).size !== entities.length)
    throw new Error('The editor returned duplicate managed entity IDs')
  if (reply.result.count !== entities.length) throw new Error('Managed entity count was truncated or inconsistent')
  return entities.sort((a, b) => a.id.localeCompare(b.id))
}

export function assertExpected(blueprint: Blueprint, observed: ObservedEntity[]) {
  if (observed.length !== blueprint.entities.length)
    throw new Error(`Expected ${blueprint.entities.length} managed entities, found ${observed.length}`)
  const byId = new Map(observed.map(entity => [entity.id, entity]))
  for (const desired of blueprint.entities) {
    const actual = byId.get(desired.id)
    if (!actual || actual.prefab !== desired.prefab) throw new Error(`${desired.id}: prefab or stable ID mismatch`)
    for (const field of transformFields)
      if (Math.abs(actual[field] - desired[field]) > epsilon)
        throw new Error(`${desired.id}: ${field} expected ${desired[field]}, found ${actual[field]}`)
    for (const field of ['rx', 'ry', 'rz'] as const) {
      const delta = ((actual[field] - desired[field] + 540) % 360 + 360) % 360 - 180
      if (Math.abs(delta) > 0.05) throw new Error(`${desired.id}: ${field} orientation mismatch (${actual[field]} vs ${desired[field]})`)
    }
  }
}

export function assertPersisted(before: ObservedEntity[], after: ObservedEntity[]) {
  if (before.length !== after.length) throw new Error('Managed entity count changed')
  const byId = new Map(after.map(entity => [entity.id, entity]))
  for (const entity of before) {
    const current = byId.get(entity.id)
    if (!current || current.prefab !== entity.prefab || String(current.guid) !== String(entity.guid))
      throw new Error(`${entity.id}: stable ID, prefab or GUID changed`)
    for (const field of transformFields)
      if (Math.abs(current[field] - entity[field]) > epsilon) throw new Error(`${entity.id}: ${field} changed`)
    for (let index = 0; index < 9; index++)
      if (Math.abs(current.rotation[index] - entity.rotation[index]) > epsilon)
        throw new Error(`${entity.id}: transform basis changed at element ${index}`)
  }
}

async function run(blueprint: Blueprint, captureOnly: boolean) {
  const sceneLabel = blueprint.sceneName === 'bannersage_agent_harbor' ? 'harbor' : 'camp'
  const outputDir = join(repoRoot, 'dist/editor-probe', sceneOutputs[blueprint.sceneName])
  const sessionPath = process.env.BANNERSAGE_EDITOR_PROBE_SESSION
  if (!sessionPath) throw new Error(`BANNERSAGE_EDITOR_PROBE_SESSION must point to the dedicated ${sceneLabel} session`)
  const config = await loadEditorSession(resolve(sessionPath))
  const expectedSceneDir = await realpath(join(config.moduleDir, 'SceneObj', blueprint.sceneName))
  if (config.sceneDir.toLowerCase() !== expectedSceneDir.toLowerCase())
    throw new Error(`The configured scene directory is not the dedicated ${sceneLabel} scene`)
  const scenePath = join(expectedSceneDir, 'scene.xscene')
  await mkdir(outputDir, { recursive: true })
  const evidence: Evidence[] = []
  const started = new Date().toISOString()
  let saved = false
  let reopened: ObservedEntity[] = []
  const cameraSource = 'saved_scene_metadata'
  const captures: Array<{ view: string; path: string; width: number; height: number; cameraSource: string }> = []
  const evidencePath = join(outputDir, captureOnly ? 'capture-verification.json' : 'verification.json')
  const persistEvidence = async (passed: boolean, error?: string) => {
    await writeFile(evidencePath, JSON.stringify({ passed, started, finished: new Date().toISOString(),
      mode: captureOnly ? 'capture' : 'apply', sceneName: blueprint.sceneName,
      entityCount: blueprint.entities.length, saved, reopened, cameraSource, captures, error, evidence,
    }, null, 2))
  }
  const record = async (step: string, response?: Reply, detail?: unknown) => {
    evidence.push({ step, at: new Date().toISOString(), response, detail })
    await persistEvidence(false)
    if (response && !response.ok) throw new Error(`${step}: ${response.error ?? 'editor rejected request'}`)
    if (response?.mainThread !== undefined && response.mainThread !== response.executedThread)
      throw new Error(`${step}: the action did not execute on the editor main thread`)
    console.log(`${step}: PASS`)
  }
  const client = new Client({ name: `bannerlordsage-${sceneLabel}-demo`, version: '0.0.1' })
  const transport = new StdioClientTransport({
    command: process.execPath, args: ['run', join(import.meta.dir, 'probe.ts'), 'mcp'], cwd: repoRoot,
    env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
  })
  const call = async (action: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name: 'editor_probe', arguments: { action, args } }, undefined, { timeout: 90000 })
    const text = response.content.find(content => content.type === 'text')
    if (!text || text.type !== 'text') throw new Error(`${action}: missing MCP text response`)
    const reply = JSON.parse(text.text) as Reply
    if (response.isError && reply.ok) throw new Error(`${action}: inconsistent MCP error result`)
    return { reply, content: response.content }
  }
  const step = async (name: string, action: string, args: Record<string, unknown> = {}) => {
    const result = await call(action, args)
    await record(name, result.reply)
    return result.reply
  }
  const waitForEditor = async (sceneName?: string) => {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      const { reply } = await call('status')
      if (!reply.ok) throw new Error(reply.error ?? 'Cannot read editor state')
      if (reply.result?.editMode && (!sceneName || reply.result.scene === sceneName)) return reply
      await new Promise(resolveDelay => setTimeout(resolveDelay, 500))
    }
    throw new Error(`Timed out waiting for ${sceneName ?? 'the editor'}`)
  }
  try {
    await client.connect(transport)
    const status = await step('MCP connection', 'status')
    if (status.result?.probeScene !== blueprint.sceneName)
      throw new Error(`Bridge targets ${status.result?.probeScene ?? 'unknown scene'}; expected ${blueprint.sceneName}`)
    if (!status.result.editMode) {
      await step('Enter editor', 'enter_editor')
      await record('Editor ready', await waitForEditor())
    }
    if (status.result.scene !== blueprint.sceneName) await step(`Open dedicated ${sceneLabel} scene`, 'open_scene')
    await record(`Dedicated ${sceneLabel} scene ready`, await waitForEditor(blueprint.sceneName))
    if (!captureOnly) {
      for (const prefab of new Set(blueprint.entities.map(entity => entity.prefab))) {
        const info = await step(`Check prefab: ${prefab}`, 'prefab_info', { prefab })
        if (info.result?.exists !== true) throw new Error(`Prefab ${prefab} does not exist in the running editor`)
      }
      const initial = entitiesFrom(await step('Read initial managed entities', 'layout_entities'))
      const desiredIds = new Set(blueprint.entities.map(entity => entity.id))
      if (initial.some(entity => !desiredIds.has(entity.id)))
        throw new Error('The scene has other managed objects; preserve them and inspect the layout before rerunning')
      const first = await step(`Apply ${sceneLabel} blueprint`, 'apply_layout', { entities: blueprint.entities })
      const applied = entitiesFrom(first)
      assertExpected(blueprint, applied)
      await record('Blueprint transforms match', undefined, { count: applied.length })
      const second = await step('Apply identical blueprint again', 'apply_layout', { entities: blueprint.entities })
      const repeated = entitiesFrom(await step('Read complete layout after repeated apply', 'layout_entities'))
      if (second.result.created !== 0 || second.result.updated !== blueprint.entities.length)
        throw new Error('Repeated apply created objects or failed to update every managed object')
      assertExpected(blueprint, repeated)
      assertPersisted(applied, repeated)
      await record('Idempotent apply preserves IDs and GUIDs', undefined, { created: 0, count: repeated.length })
      await step(`Save ${sceneLabel} scene`, 'save_scene')
      saved = true
      await step(`Reopen saved ${sceneLabel} scene`, 'open_scene')
      await record(`Reopened ${sceneLabel} scene ready`, await waitForEditor(blueprint.sceneName))
      reopened = entitiesFrom(await step(`Read persisted ${sceneLabel} layout`, 'layout_entities'))
      assertExpected(blueprint, reopened)
      assertPersisted(repeated, reopened)
      await record('All prefabs, GUIDs and transforms survive reopen', undefined, { count: reopened.length })
      await writeFile(join(outputDir, 'applied-blueprint.json'), JSON.stringify(blueprint, null, 2))
    } else {
      reopened = entitiesFrom(await step(`Read ${sceneLabel} layout for capture`, 'layout_entities'))
      assertExpected(blueprint, reopened)
    }
    // Capture overview last so the saved scene opens on the overall layout.
    const orderedViews = blueprint.views.toSorted((a, b) => Number(a.name === 'overview') - Number(b.name === 'overview'))
    for (const { name, ...camera } of orderedViews) {
      await executeFile('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-File', join(import.meta.dir, 'set-view.ps1'),
        '-GameDir', config.gameDir,
        '-ScenePath', scenePath,
        '-X', String(camera.x), '-Y', String(camera.y), '-Z', String(camera.z),
        '-TargetX', String(camera.targetX), '-TargetY', String(camera.targetY), '-TargetZ', String(camera.targetZ),
      ], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 })
      await record(`Write ${name} view metadata`, undefined, { cameraSource, scenePath, camera })
      await step(`Open scene with ${name} view`, 'open_scene')
      await record(`Scene ready with ${name} view`, await waitForEditor(blueprint.sceneName))
      await new Promise(resolveDelay => setTimeout(resolveDelay, 1500))
      const cameraStatus = await step(`Read settled ${name} camera position`, 'status')
      if (cameraStatus.result?.scene !== blueprint.sceneName)
        throw new Error(`${name}: the active scene changed before capture`)
      const viewed = entitiesFrom(await step(`Read layout after ${name} metadata reopen`, 'layout_entities'))
      assertExpected(blueprint, viewed)
      assertPersisted(reopened, viewed)
      await record(`Camera metadata preserves ${name} layout`, undefined, { count: viewed.length })
      const capture = await call('capture')
      await record(`Capture ${name} through MCP`, capture.reply)
      const image = capture.content.find(content => content.type === 'image')
      if (!image || image.type !== 'image' || image.mimeType !== 'image/png')
        throw new Error(`${name}: MCP did not return a PNG image`)
      const png = Buffer.from(image.data, 'base64')
      if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
        throw new Error(`${name}: invalid PNG content`)
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
      if (width < 100 || height < 100) throw new Error(`${name}: screenshot is too small (${width}x${height})`)
      const path = join(outputDir, `${name}.png`)
      await writeFile(path, png)
      captures.push({ view: name, path, width, height, cameraSource })
      await record(`PNG ${name} saved`, undefined, captures[captures.length - 1])
    }
    await persistEvidence(true)
    console.log(JSON.stringify({ passed: true, sceneName: blueprint.sceneName, entityCount: blueprint.entities.length,
      saved, evidencePath, captures }, null, 2))
  } catch (error) {
    await persistEvidence(false, error instanceof Error ? error.message : String(error))
    throw error
  } finally { await client.close() }
}

async function main() {
  const [mode, blueprintArg] = process.argv.slice(2)
  if (!['validate', 'apply', 'capture'].includes(mode))
    throw new Error('Usage: bun run tools/editor-probe/demo.ts validate|apply|capture [blueprint.json]')
  const blueprintPath = resolve(blueprintArg ?? join(import.meta.dir, 'camp.blueprint.json'))
  const blueprint = validateBlueprint(JSON.parse((await readFile(blueprintPath, 'utf8')).replace(/^\uFEFF/, '')))
  if (mode === 'validate') {
    console.log(JSON.stringify({ valid: true, sceneName: blueprint.sceneName, entityCount: blueprint.entities.length,
      prefabs: [...new Set(blueprint.entities.map(entity => entity.prefab))], views: blueprint.views.map(view => view.name) }, null, 2))
    return
  }
  await run(blueprint, mode === 'capture')
}

if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
