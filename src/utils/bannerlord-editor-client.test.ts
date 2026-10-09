import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadEditorSession, requestEditor, editorStatus, editorToolResult } from './bannerlord-editor-client'
import { registerBannerlordEditorTools } from '../tools/bannerlord-editor'

type Fixture = { root: string; sessionPath: string; gameDir: string; sceneDir: string; outputDir: string;
  token: string; server: Server; sockets: Set<Socket>; requests: any[]; config: Record<string, unknown> }
const fixtures: Fixture[] = []
const transports: Array<{ client: Client; server: McpServer }> = []
const originalSession = process.env.BANNERSAGE_EDITOR_PROBE_SESSION
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1cAAAAASUVORK5CYII=', 'base64')

afterEach(async () => {
  if (originalSession === undefined) delete process.env.BANNERSAGE_EDITOR_PROBE_SESSION
  else process.env.BANNERSAGE_EDITOR_PROBE_SESSION = originalSession
  for (const transport of transports.splice(0)) { await transport.client.close(); await transport.server.close() }
  for (const fixture of fixtures.splice(0)) {
    for (const socket of fixture.sockets) socket.destroy()
    if (fixture.server.listening) await new Promise<void>(done => fixture.server.close(() => done()))
    if (!resolve(fixture.root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test cleanup path')
    await rm(fixture.root, { recursive: true, force: true })
  }
})

async function makeFixture(reply?: (request: any, fixture: Fixture) => unknown): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'bannersage-editor-client-test-'))
  const gameDir = join(root, 'game')
  const sceneDir = join(gameDir, 'Modules/BannerlordSage.EditorProbe/SceneObj/bannersage_agent_harbor')
  const outputDir = join(root, 'output')
  await mkdir(sceneDir, { recursive: true }); await mkdir(outputDir)
  await writeFile(join(sceneDir, 'scene.xscene'), '<scene name="bannersage_agent_harbor"/>')
  for (const variant of ['Win64_Shipping_Client', 'Win64_Shipping_wEditor']) {
    const dir = join(gameDir, 'bin', variant); await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'Version.xml'), '<Version><Singleplayer Value="v1.4.8"/></Version>')
  }
  const sockets = new Set<Socket>(), requests: any[] = []
  let fixture: Fixture
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket))
    let buffer = ''
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')
      if (!buffer.includes('\n')) return
      const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
      requests.push(request)
      const response = reply?.(request, fixture) ?? { ok: true, result: {
        editMode: true, probeScene: 'bannersage_agent_harbor', scene: 'bannersage_agent_harbor',
        resolvedSceneModule: join(gameDir, 'Modules/BannerlordSage.EditorProbe'),
      } }
      socket.end(typeof response === 'string' ? response + '\n' : JSON.stringify(response) + '\n')
    })
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const token = 'test-secret-' + crypto.randomUUID()
  const config = { gameDir, outputDir, sceneDir, sceneName: 'bannersage_agent_harbor', token, port: address.port }
  const sessionPath = join(root, 'session.json')
  await writeFile(sessionPath, JSON.stringify(config))
  fixture = { root, gameDir, sceneDir, outputDir, sessionPath, token, config, server, sockets, requests }
  fixtures.push(fixture)
  return fixture
}

async function mcp(mode: 'query-first' | 'full') {
  const server = new McpServer({ name: 'editor-integration-test', version: '0.0.1' })
  registerBannerlordEditorTools(server, mode)
  const client = new Client({ name: 'editor-test', version: '0.0.1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport); await client.connect(clientTransport)
  transports.push({ server, client })
  return client
}

function textOf(result: any) { return result.content.find((item: any) => item.type === 'text')?.text ?? '' }

describe('editor session and transport boundaries', () => {
  test('unconfigured status is diagnostic and never includes credentials', async () => {
    delete process.env.BANNERSAGE_EDITOR_PROBE_SESSION
    const status = await editorStatus()
    expect(status.state).toBe('not_configured')
    expect(JSON.stringify(status)).not.toContain('token')
  })

  test('malformed session JSON errors cannot reveal its token text', async () => {
    const fixture = await makeFixture()
    await writeFile(fixture.sessionPath, '{"token":"' + fixture.token)
    let error: unknown
    try { await loadEditorSession(fixture.sessionPath) } catch (caught) { error = caught }
    expect(error).toBeDefined(); expect(String(error)).not.toContain(fixture.token)
    expect(fixture.requests).toHaveLength(0)
  })

  test('scene directories outside the owned module are rejected before connecting', async () => {
    const fixture = await makeFixture()
    const outside = join(fixture.root, 'foreign/bannersage_agent_harbor'); await mkdir(outside, { recursive: true })
    await writeFile(fixture.sessionPath, JSON.stringify({ ...fixture.config, sceneDir: outside }))
    await expect(requestEditor('status', {}, fixture.sessionPath)).rejects.toThrow()
    expect(fixture.requests).toHaveLength(0)
  })

  test('unsupported or mismatched installed versions cannot use the bridge', async () => {
    const fixture = await makeFixture()
    await writeFile(join(fixture.gameDir, 'bin/Win64_Shipping_wEditor/Version.xml'), '<Version><Singleplayer Value="v1.5.2"/></Version>')
    await expect(requestEditor('status', {}, fixture.sessionPath)).rejects.toThrow()
    expect(fixture.requests).toHaveLength(0)
  })

  test('requests authenticate locally and oversized requests never enter the network', async () => {
    const fixture = await makeFixture()
    expect((await requestEditor('status', {}, fixture.sessionPath)).ok).toBe(true)
    expect(fixture.requests[0].token).toBe(fixture.token)
    await expect(requestEditor('apply_layout', { padding: 'x'.repeat(17000) }, fixture.sessionPath)).rejects.toThrow()
    expect(fixture.requests).toHaveLength(1)
  })

  test('malformed and oversized bridge replies are bounded and sanitized', async () => {
    const malformed = await makeFixture((_request, fixture) => fixture.token + ' not JSON')
    let error: unknown
    try { await requestEditor('status', {}, malformed.sessionPath) } catch (caught) { error = caught }
    expect(error).toBeDefined(); expect(String(error)).not.toContain(malformed.token)
    const oversized = await makeFixture(() => 'x'.repeat(1024 * 1024 + 1))
    await expect(requestEditor('status', {}, oversized.sessionPath)).rejects.toThrow()
  })

  test('capture reads a real PNG and rejects a reply escaping outputDir', async () => {
    let capturePath: string
    const fixture = await makeFixture(request => request.action === 'capture'
      ? { ok: true, result: { completed: true, pngPath: capturePath, width: 1, height: 1 } }
      : undefined)
    capturePath = join(fixture.outputDir, 'capture.png')
    await writeFile(join(fixture.outputDir, 'capture.png'), png)
    const result = await editorToolResult('capture', {}, fixture.sessionPath, true)
    expect(result.isError).not.toBe(true)
    expect(result.content.some(item => item.type === 'image' && item.mimeType === 'image/png')).toBe(true)
    await writeFile(capturePath, Buffer.alloc(32))
    const invalid = await editorToolResult('capture', {}, fixture.sessionPath, true)
    expect(invalid.isError).toBe(true)
    expect(invalid.content.some(item => item.type === 'image')).toBe(false)
    const outside = join(fixture.root, 'outside.png'); await writeFile(outside, png)
    capturePath = outside
    const escaped = await editorToolResult('capture', {}, fixture.sessionPath, true)
    expect(escaped.isError).toBe(true)
    expect(escaped.content.some(item => item.type === 'image')).toBe(false)
  })

  test('active-scene preflight prevents save without retry or scene replacement', async () => {
    const fixture = await makeFixture(() => ({ ok: true, result: {
      editMode: true, probeScene: 'bannersage_agent_harbor', scene: '__default_new_editor_scene_',
    } }))
    const result = await editorToolResult('save_scene', {}, fixture.sessionPath, true)
    expect(result.isError).toBe(true)
    expect(fixture.requests.map(request => request.action)).toEqual(['status'])
  })

  test('missing module proof cannot authorize writes even if scene names match', async () => {
    const fixture = await makeFixture(() => ({ ok: true, result: {
      editMode: true, probeScene: 'bannersage_agent_harbor', scene: 'bannersage_agent_harbor',
    } }))
    const result = await editorToolResult('save_scene', {}, fixture.sessionPath, true)
    expect(result.isError).toBe(true)
    expect(fixture.requests.map(request => request.action)).toEqual(['status'])
  })
})

describe('public editor MCP schemas and registry', () => {
  test('default only exposes status; full exposes six tools without lifecycle operations', async () => {
    expect((await (await mcp('query-first')).listTools()).tools.map(tool => tool.name)).toEqual(['bannerlord_editor_status'])
    const full = (await (await mcp('full')).listTools()).tools.map(tool => tool.name).sort()
    expect(full).toEqual(['bannerlord_editor_status', 'bannerlord_editor_entities', 'bannerlord_editor_prefab_info',
      'bannerlord_editor_apply_layout', 'bannerlord_editor_save_scene', 'bannerlord_editor_capture'].sort())
  })

  test('invalid layout IDs, transforms, extra fields and overlong batches cannot reach the engine', async () => {
    const fixture = await makeFixture(), client = await mcp('full')
    const entity = { id: 'dock', prefab: 'wooden_platform_a', x: 0, y: 0, z: 1 }
    const invalid = [ [{ ...entity, x: 101 }], [{ ...entity, sx: 0 }], [{ ...entity, rx: 3601 }],
      [{ ...entity, id: '../foreign' }], [{ ...entity, delete: true }], [entity, entity], Array.from({ length: 65 }, () => entity) ]
    for (const entities of invalid) {
      const reply = await client.callTool({ name: 'bannerlord_editor_apply_layout', arguments: { sessionPath: fixture.sessionPath, entities } })
      expect(reply.isError).toBe(true)
    }
    expect(fixture.requests).toHaveLength(0)
  })

  test('public layout returns native partial state without automatically retrying', async () => {
    const fixture = await makeFixture(request => request.action === 'apply_layout'
      ? { ok: false, error: 'native creation failed', partial: true, appliedIds: ['dock'] } : undefined)
    const client = await mcp('full')
    const result = await client.callTool({ name: 'bannerlord_editor_apply_layout', arguments: {
      sessionPath: fixture.sessionPath, entities: [{ id: 'dock', prefab: 'wooden_platform_a', x: 0, y: 0, z: 1 }],
    } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('partial')
    expect(fixture.requests.map(request => request.action)).toEqual(['status', 'apply_layout'])
  })
})
