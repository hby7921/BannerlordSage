import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { editorStatus, editorToolResult } from '../utils/bannerlord-editor-client'

const sessionPath = z.string().min(1).max(4096).optional().describe('Optional absolute path to the local editor bridge session JSON; defaults to BANNERSAGE_EDITOR_PROBE_SESSION.')
export const bannerlordEditorLayoutEntitySchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
  prefab: z.string().min(1).max(128),
  x: z.number().finite().min(-100).max(100),
  y: z.number().finite().min(-100).max(100),
  z: z.number().finite().min(-100).max(100),
  rx: z.number().finite().min(-3600).max(3600).optional(),
  ry: z.number().finite().min(-3600).max(3600).optional(),
  rz: z.number().finite().min(-3600).max(3600).optional(),
  sx: z.number().finite().min(0.05).max(20).optional(),
  sy: z.number().finite().min(0.05).max(20).optional(),
  sz: z.number().finite().min(0.05).max(20).optional(),
}).strict()
export const bannerlordEditorLayoutSchema = z.array(bannerlordEditorLayoutEntitySchema).min(1).max(64).superRefine((entities, ctx) => {
  if (new Set(entities.map(entity => entity.id)).size !== entities.length)
    ctx.addIssue({ code: 'custom', message: 'Layout entity IDs must be unique.' })
})

export function registerBannerlordEditorTools(server: McpServer, mode: 'query-first' | 'full') {
  server.registerTool('bannerlord_editor_status', {
    title: 'Bannerlord Editor Status',
    description: 'Inspect the configured local editor bridge, version alignment and active scene. Returns a diagnostic when the bridge is unconfigured or disconnected.',
    inputSchema: { sessionPath }, annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionPath }) => ({ content: [{ type: 'text' as const, text: JSON.stringify(await editorStatus(sessionPath)) }] }))
  if (mode !== 'full') return
  server.registerTool('bannerlord_editor_entities', {
    title: 'Bannerlord Editor Managed Entities',
    description: 'Read the managed layout objects in the active configured scene, including stable IDs, prefabs, GUIDs and transforms.',
    inputSchema: { sessionPath }, annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionPath }) => editorToolResult('layout_entities', {}, sessionPath, true))
  server.registerTool('bannerlord_editor_prefab_info', {
    title: 'Bannerlord Editor Prefab Info',
    description: 'Check a Native prefab in the active configured scene and read mesh bounds when available. Does not instantiate objects.',
    inputSchema: { sessionPath, prefab: z.string().min(1).max(128), mesh: z.string().min(1).max(128).optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionPath, prefab, mesh }) => editorToolResult('prefab_info', { prefab, ...(mesh ? { mesh } : {}) }, sessionPath, true))
  server.registerTool('bannerlord_editor_apply_layout', {
    title: 'Bannerlord Editor Apply Layout',
    description: 'Create or update up to 64 managed prefab roots in the active configured scene. Repeated IDs preserve objects and GUIDs; prefab conflicts are rejected. This changes the scene in memory; call save_scene explicitly to persist it.',
    inputSchema: { sessionPath, entities: bannerlordEditorLayoutSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionPath, entities }) => editorToolResult('apply_layout', { entities }, sessionPath, true))
  server.registerTool('bannerlord_editor_save_scene', {
    title: 'Bannerlord Editor Save Scene',
    description: 'Save the active configured dedicated scene. Does not close, replace or reload the scene.',
    inputSchema: { sessionPath }, annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionPath }) => editorToolResult('save_scene', {}, sessionPath, true))
  server.registerTool('bannerlord_editor_capture', {
    title: 'Bannerlord Editor Capture',
    description: 'Return the native editor screenshot as a PNG image plus metadata. Captures its current view without moving the camera, changing scene metadata or reloading.',
    inputSchema: { sessionPath }, annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionPath }) => editorToolResult('capture', {}, sessionPath, true))
}
