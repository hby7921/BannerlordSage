import { connect } from 'node:net'
import { open, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'

export const EDITOR_PROBE_ACTIONS = ['status', 'enter_editor', 'open_scene', 'entities', 'place_probe', 'move_probe', 'save_scene', 'close_scene', 'quit', 'capture', 'apply_layout', 'layout_entities', 'focus', 'camera', 'prefab_info'] as const
export type EditorAction = typeof EDITOR_PROBE_ACTIONS[number]
export const EDITOR_REQUEST_TIMEOUT_MS = 50000
export const EDITOR_MAX_REPLY_BYTES = 1024 * 1024
export const EDITOR_MAX_REQUEST_CHARACTERS = 16384
export const EDITOR_MAX_SESSION_BYTES = 16384
export const EDITOR_MAX_CAPTURE_BYTES = 10 * 1024 * 1024

const errorMessages = {
  not_configured: 'Set BANNERSAGE_EDITOR_PROBE_SESSION or provide the local editor sessionPath.',
  invalid_session: 'The local editor session is missing, malformed or outside the dedicated module scope.',
  version_mismatch: 'The game and editor must both be the validated v1.4.8 installation.',
  disconnected: 'Cannot connect to the local editor bridge. Check that its configured editor process is running.',
  timeout: 'The editor request timed out. Inspect its state before retrying; an operation may still be running.',
  invalid_response: 'The editor bridge returned an invalid or oversized response.',
  request_too_large: 'The request exceeds the editor bridge limit. Shorten the batch; it has not been sent.',
  invalid_request: 'The editor request is invalid.',
  wrong_scene: 'The active editor scene must match the configured dedicated scene. Open it manually before calling this tool.',
  wrong_thread: 'The editor operation did not execute on its main thread.',
  bridge_error: 'The local editor bridge rejected the operation.',
  invalid_capture: 'The editor did not return a completed, bounded PNG inside its configured output directory.',
} as const
export type EditorErrorCode = keyof typeof errorMessages

export class EditorClientError extends Error {
  readonly executionMayBeRunning: boolean
  constructor(readonly code: EditorErrorCode, executionMayBeRunning = false) {
    super(errorMessages[code])
    this.name = 'EditorClientError'
    this.executionMayBeRunning = executionMayBeRunning
  }
}

export type EditorSession = {
  gameDir: string; outputDir: string; sceneDir: string; token: string; port: number; sceneName: string; moduleDir: string
}
export type EditorReply = {
  ok: boolean; result?: any; error?: string; code?: string; mainThread?: number; executedThread?: number
  executionMayBeRunning?: boolean; [key: string]: unknown
}

const sessionSchema = z.object({
  gameDir: z.string().min(1).max(4096), outputDir: z.string().min(1).max(4096), sceneDir: z.string().min(1).max(4096),
  token: z.string().min(8).max(256), port: z.number().int().min(1).max(65535),
})

async function readBoundedFile(path: string, maxBytes: number, code: EditorErrorCode): Promise<Buffer> {
  try {
    const handle = await open(path, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > maxBytes) throw new EditorClientError(code)
      const buffer = Buffer.alloc(maxBytes + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
        if (!bytesRead) break
        length += bytesRead
      }
      if (length > maxBytes) throw new EditorClientError(code)
      return buffer.subarray(0, length)
    } finally { await handle.close() }
  } catch { throw new EditorClientError(code) }
}

function samePath(a: string, b: string) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function localAbsolutePath(path: string) {
  return isAbsolute(path) && !path.includes('\0') && !path.startsWith('\\\\') && !path.startsWith('//')
}

export async function loadEditorSession(sessionPath?: string): Promise<EditorSession> {
  const selectedPath = sessionPath ?? process.env.BANNERSAGE_EDITOR_PROBE_SESSION
  if (!selectedPath?.trim()) throw new EditorClientError('not_configured')
  if (selectedPath.length > 4096 || !localAbsolutePath(selectedPath)) throw new EditorClientError('invalid_session')
  let config: z.infer<typeof sessionSchema>
  try {
    const json = (await readBoundedFile(selectedPath, EDITOR_MAX_SESSION_BYTES, 'invalid_session')).toString('utf8').replace(/^\uFEFF/, '')
    config = sessionSchema.parse(JSON.parse(json))
    if (![config.gameDir, config.outputDir, config.sceneDir].every(localAbsolutePath)) throw new Error('Invalid path')
  } catch { throw new EditorClientError('invalid_session') }
  let gameDir: string, outputDir: string, sceneDir: string, moduleDir: string
  try {
    ;[gameDir, outputDir, sceneDir] = await Promise.all([realpath(config.gameDir), realpath(config.outputDir), realpath(config.sceneDir)])
    moduleDir = await realpath(join(gameDir, 'Modules', 'BannerlordSage.EditorProbe'))
    const expectedSceneRoot = join(moduleDir, 'SceneObj')
    const sceneRoot = await realpath(expectedSceneRoot)
    // Runtime aliases may resolve to the module; SceneObj must remain in it.
    if (!samePath(sceneRoot, expectedSceneRoot) || !samePath(dirname(sceneDir), sceneRoot) || !/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(basename(sceneDir)))
      throw new Error('Scene escaped the dedicated module')
  } catch { throw new EditorClientError('invalid_session') }
  const versions = await Promise.all(['Win64_Shipping_Client', 'Win64_Shipping_wEditor'].map(async variant => {
    const xml = (await readBoundedFile(join(gameDir, 'bin', variant, 'Version.xml'), 32768, 'version_mismatch')).toString('utf8')
    return xml.match(/\bSingleplayer\s+Value\s*=\s*["']([^"']+)["']/)?.[1]
  }))
  if (versions.some(version => version !== 'v1.4.8')) throw new EditorClientError('version_mismatch')
  return { ...config, gameDir, outputDir, sceneDir, moduleDir, sceneName: basename(sceneDir) }
}

function sanitizeValue(value: any, token: string, depth = 0): any {
  if (depth > 32) throw new EditorClientError('invalid_response')
  if (typeof value === 'string') return value.replaceAll(token, '[redacted]').replaceAll(JSON.stringify(token).slice(1, -1), '[redacted]')
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, token, depth + 1))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (['token', 'authorization', 'password', 'secret'].includes(key.toLowerCase())) continue
      const sanitizedKey = key.replaceAll(token, '[redacted]')
      Object.defineProperty(result, sanitizedKey, { value: sanitizeValue(item, token, depth + 1), enumerable: true })
    }
    return result
  }
  return value
}

async function sendRequest(session: EditorSession, action: EditorAction, args: Record<string, unknown>): Promise<EditorReply> {
  if (!EDITOR_PROBE_ACTIONS.includes(action)) throw new EditorClientError('invalid_request')
  let line: string
  try { line = JSON.stringify({ token: session.token, action, args }) }
  catch { throw new EditorClientError('invalid_request') }
  if (line.length > EDITOR_MAX_REQUEST_CHARACTERS) throw new EditorClientError('request_too_large')
  return new Promise((resolveReply, reject) => {
    const socket = connect({ host: '127.0.0.1', port: session.port })
    let settled = false
    let buffer = Buffer.alloc(0)
    let sent = false
    const finish = (error?: EditorClientError, reply?: EditorReply) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      socket.destroy()
      if (error) reject(error)
      else resolveReply(reply!)
    }
    const deadline = setTimeout(() => finish(new EditorClientError('timeout', sent)), EDITOR_REQUEST_TIMEOUT_MS)
    socket.on('connect', () => { sent = true; socket.write(line + '\n') })
    socket.on('data', (chunk: Buffer) => {
      if (buffer.length + chunk.length > EDITOR_MAX_REPLY_BYTES) return finish(new EditorClientError('invalid_response', sent))
      buffer = Buffer.concat([buffer, chunk])
      const end = buffer.indexOf(10)
      if (end < 0) return
      try {
        const parsed = JSON.parse(buffer.subarray(0, end).toString('utf8'))
        if (!parsed || typeof parsed.ok !== 'boolean') throw new Error('Invalid reply envelope')
        finish(undefined, sanitizeValue(parsed, session.token) as EditorReply)
      } catch { finish(new EditorClientError('invalid_response', sent)) }
    })
    socket.on('error', () => finish(new EditorClientError('disconnected', sent)))
    socket.on('close', () => { if (!settled) finish(new EditorClientError('disconnected', sent)) })
  })
}

export async function requestEditor(action: EditorAction, args: Record<string, unknown> = {}, sessionPath?: string): Promise<EditorReply> {
  return sendRequest(await loadEditorSession(sessionPath), action, args)
}

function errorReply(error: unknown): EditorReply {
  const safe = error instanceof EditorClientError ? error : new EditorClientError('invalid_response')
  return { ok: false, code: safe.code, error: safe.message, ...(safe.executionMayBeRunning ? { executionMayBeRunning: true, retryAutomatically: false } : {}) }
}

export async function editorStatus(sessionPath?: string): Promise<EditorReply> {
  try {
    const session = await loadEditorSession(sessionPath)
    const reply = await sendRequest(session, 'status', {})
    return sanitizeValue({ ...reply, state: reply.ok ? 'ready' : 'bridge_error', configured: true, connected: true,
      configuredScene: session.sceneName, validatedVersion: 'v1.4.8',
      activeSceneMatches: reply.result?.editMode === true && reply.result?.scene === session.sceneName }, session.token) as EditorReply
  } catch (error) {
    const reply = errorReply(error)
    return { ...reply, state: reply.code, configured: reply.code !== 'not_configured', connected: false }
  }
}

async function requireActiveScene(session: EditorSession) {
  const reply = await sendRequest(session, 'status', {})
  if (!reply.ok) throw new EditorClientError('bridge_error')
  if (reply.result?.editMode !== true || reply.result?.scene !== session.sceneName || reply.result?.probeScene !== session.sceneName)
    throw new EditorClientError('wrong_scene')
  if (typeof reply.result?.resolvedSceneModule !== 'string') throw new EditorClientError('wrong_scene')
  let modulePath: string
  try { modulePath = await realpath(reply.result.resolvedSceneModule) }
  catch { throw new EditorClientError('wrong_scene') }
  if (!samePath(modulePath, session.moduleDir)) throw new EditorClientError('wrong_scene')
}

async function capturePng(session: EditorSession, reply: EditorReply) {
  if (!reply.result?.completed || typeof reply.result.pngPath !== 'string') throw new EditorClientError('invalid_capture')
  let path: string
  try {
    path = await realpath(resolve(reply.result.pngPath))
    const inside = relative(session.outputDir, path)
    if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) throw new Error('Escaped capture directory')
  } catch { throw new EditorClientError('invalid_capture') }
  const png = await readBoundedFile(path, EDITOR_MAX_CAPTURE_BYTES, 'invalid_capture')
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new EditorClientError('invalid_capture')
  return png
}

export async function editorToolResult(action: EditorAction, args: Record<string, unknown> = {}, sessionPath?: string, activeSceneRequired = false) {
  try {
    const session = await loadEditorSession(sessionPath)
    if (activeSceneRequired) await requireActiveScene(session)
    const reply = await sendRequest(session, action, args)
    if (action === 'apply_layout' && !reply.ok) {
      reply.partialChangesPossible = true
      reply.retryAutomatically = false
    }
    if (reply.ok && reply.mainThread !== undefined && reply.mainThread !== reply.executedThread)
      throw new EditorClientError('wrong_thread')
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
      { type: 'text', text: JSON.stringify(reply) },
    ]
    if (action === 'capture' && reply.ok) {
      const png = await capturePng(session, reply)
      content.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' })
    }
    return { content, isError: !reply.ok }
  } catch (error) { return { content: [{ type: 'text' as const, text: JSON.stringify(errorReply(error)) }], isError: true } }
}
