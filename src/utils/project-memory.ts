import { randomUUID } from 'node:crypto'
import { type AiTextBlock, renderAiTextReport } from './ai-text'
import { getMemoryDb } from './memory-db'

export type ProjectMemoryRecord = {
  memoryId: string
  workspace: string
  topic: string
  kind: string
  summary: string
  text: string
  source: string
  tags: string[]
  importance: number
  status: string
  invalidationReason: string
  createdAt: string
  updatedAt: string
  invalidatedAt: string
}

export type AddProjectMemoryInput = {
  workspace?: string
  topic?: string
  kind?: string
  summary?: string
  text: string
  source?: string
  tags?: string[]
  importance?: number
}

export type CaptureProjectMemorySessionInput = {
  workspace?: string
  topic?: string
  source?: string
  summary?: string
  decisions?: string[]
  pitfalls?: string[]
  preferences?: string[]
  todos?: string[]
  notes?: string[]
  sessionImportance?: number
}

type SearchProjectMemoryInput = {
  query: string
  workspace?: string
  topic?: string
  kind?: string
  limit?: number
  includeInactive?: boolean
}

type ListProjectMemoryInput = {
  workspace?: string
  topic?: string
  kind?: string
  limit?: number
  includeInactive?: boolean
}

type RawProjectMemoryRow = {
  public_id: string
  workspace: string
  topic: string
  kind: string
  summary: string | null
  text: string
  source: string | null
  tags_json: string
  importance: number
  status: string
  invalidation_reason: string | null
  created_at: string
  updated_at: string
  invalidated_at: string | null
  snippet?: string | null
  rank?: number | null
}

const DEFAULT_WORKSPACE = 'bannerlordsage'
const DEFAULT_TOPIC = 'general'
const DEFAULT_KIND = 'note'

export function addProjectMemory(input: AddProjectMemoryInput): ProjectMemoryRecord {
  const db = getMemoryDb()
  const prepared = normalizeMemoryInput(input)
  const existing = findExactActiveMemory(db, prepared)
  if (existing) {
    return existing
  }
  const memoryId = `pmem_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const now = new Date().toISOString()

  db.transaction(() => {
    db.query(
      `
        INSERT INTO project_memories (
          public_id,
          workspace,
          topic,
          kind,
          summary,
          text,
          source,
          tags_json,
          tags_text,
          importance,
          status,
          created_at,
          updated_at
        )
        VALUES (
          $memoryId,
          $workspace,
          $topic,
          $kind,
          $summary,
          $text,
          $source,
          $tagsJson,
          $tagsText,
          $importance,
          'active',
          $createdAt,
          $updatedAt
        )
      `
    ).run({
      $memoryId: memoryId,
      $workspace: prepared.workspace,
      $topic: prepared.topic,
      $kind: prepared.kind,
      $summary: prepared.summary || null,
      $text: prepared.text,
      $source: prepared.source || null,
      $tagsJson: JSON.stringify(prepared.tags),
      $tagsText: prepared.tags.join(' '),
      $importance: prepared.importance,
      $createdAt: now,
      $updatedAt: now,
    })

    db.query(
      `
        INSERT INTO project_memories_fts (
          public_id,
          workspace,
          topic,
          kind,
          summary,
          text,
          tags_text
        )
        VALUES (
          $memoryId,
          $workspace,
          $topic,
          $kind,
          $summary,
          $text,
          $tagsText
        )
      `
    ).run({
      $memoryId: memoryId,
      $workspace: prepared.workspace,
      $topic: prepared.topic,
      $kind: prepared.kind,
      $summary: prepared.summary,
      $text: prepared.text,
      $tagsText: prepared.tags.join(' '),
    })
  })()

  return getProjectMemoryById(memoryId)!
}

export function captureProjectMemorySession(input: CaptureProjectMemorySessionInput): ProjectMemoryRecord[] {
  const workspace = input.workspace?.trim() || DEFAULT_WORKSPACE
  const source = input.source?.trim() || ''
  const baseTopic = input.topic?.trim() || DEFAULT_TOPIC
  const records: ProjectMemoryRecord[] = []

  if (input.summary?.trim()) {
    records.push(
      addProjectMemory({
        workspace,
        topic: baseTopic,
        kind: 'session',
        summary: input.summary.trim(),
        text: input.summary.trim(),
        source,
        tags: ['session'],
        importance: clampLimit(input.sessionImportance, 3, 1, 5),
      })
    )
  }

  for (const text of normalizeCaptureLines(input.decisions)) {
    records.push(
      addProjectMemory({
        workspace,
        topic: baseTopic,
        kind: 'decision',
        summary: buildSummaryFromText(text),
        text,
        source,
        tags: ['session', 'decision'],
        importance: 5,
      })
    )
  }

  for (const text of normalizeCaptureLines(input.pitfalls)) {
    records.push(
      addProjectMemory({
        workspace,
        topic: baseTopic,
        kind: 'pitfall',
        summary: buildSummaryFromText(text),
        text,
        source,
        tags: ['session', 'pitfall'],
        importance: 4,
      })
    )
  }

  for (const text of normalizeCaptureLines(input.preferences)) {
    records.push(
      addProjectMemory({
        workspace,
        topic: baseTopic,
        kind: 'preference',
        summary: buildSummaryFromText(text),
        text,
        source,
        tags: ['session', 'preference'],
        importance: 4,
      })
    )
  }

  for (const text of normalizeCaptureLines(input.todos)) {
    records.push(
      addProjectMemory({
        workspace,
        topic: baseTopic,
        kind: 'todo',
        summary: buildSummaryFromText(text),
        text,
        source,
        tags: ['session', 'todo'],
        importance: 4,
      })
    )
  }

  for (const text of normalizeCaptureLines(input.notes)) {
    records.push(
      addProjectMemory({
        workspace,
        topic: baseTopic,
        kind: 'note',
        summary: buildSummaryFromText(text),
        text,
        source,
        tags: ['session', 'note'],
        importance: 3,
      })
    )
  }

  return dedupeRecords(records)
}

export function searchProjectMemories(input: SearchProjectMemoryInput): ProjectMemoryRecord[] {
  const query = input.query.trim()
  if (!query) return []

  const db = getMemoryDb()
  const params: Record<string, string | number> = {
    $query: query,
    $limit: clampLimit(input.limit, 5, 1, 20),
  }
  const whereClauses = buildMetadataFilters(input, params, 'm')

  const sql = `
    SELECT
      m.public_id,
      m.workspace,
      m.topic,
      m.kind,
      m.summary,
      m.text,
      m.source,
      m.tags_json,
      m.importance,
      m.status,
      m.invalidation_reason,
      m.created_at,
      m.updated_at,
      m.invalidated_at,
      snippet(project_memories_fts, 5, '[', ']', ' ... ', 18) AS snippet,
      bm25(project_memories_fts, 0.2, 1.0, 1.0, 1.0, 2.0, 0.5) AS rank
    FROM project_memories_fts
    JOIN project_memories AS m
      ON m.public_id = project_memories_fts.public_id
    WHERE project_memories_fts MATCH $query
      ${whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : ''}
    ORDER BY rank ASC, m.importance DESC, m.updated_at DESC
    LIMIT $limit
  `

  const rows = db.query<RawProjectMemoryRow, Record<string, string | number>>(sql).all(params)
  return rows.map(row => mapRowToRecord(row))
}

export function listRecentProjectMemories(input: ListProjectMemoryInput): ProjectMemoryRecord[] {
  const db = getMemoryDb()
  const params: Record<string, string | number> = {
    $limit: clampLimit(input.limit, 8, 1, 30),
  }
  const whereClauses = buildMetadataFilters(input, params)
  const sql = `
    SELECT
      public_id,
      workspace,
      topic,
      kind,
      summary,
      text,
      source,
      tags_json,
      importance,
      status,
      invalidation_reason,
      created_at,
      updated_at,
      invalidated_at
    FROM project_memories
    ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''}
    ORDER BY updated_at DESC, importance DESC
    LIMIT $limit
  `

  const rows = db.query<RawProjectMemoryRow, Record<string, string | number>>(sql).all(params)
  return rows.map(row => mapRowToRecord(row))
}

export function getProjectMemoryWakeup(workspace?: string, limit?: number): ProjectMemoryRecord[] {
  const db = getMemoryDb()
  const params: Record<string, string | number> = {
    $limit: clampLimit(limit, 8, 1, 20),
  }
  const whereClauses = ["status = 'active'"]
  if (workspace?.trim()) {
    whereClauses.push('workspace = $workspace')
    params.$workspace = workspace.trim()
  }

  const sql = `
    SELECT
      public_id,
      workspace,
      topic,
      kind,
      summary,
      text,
      source,
      tags_json,
      importance,
      status,
      invalidation_reason,
      created_at,
      updated_at,
      invalidated_at
    FROM project_memories
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY
      CASE kind
        WHEN 'decision' THEN 0
        WHEN 'pitfall' THEN 1
        WHEN 'preference' THEN 2
        WHEN 'todo' THEN 3
        ELSE 4
      END ASC,
      importance DESC,
      updated_at DESC
    LIMIT $limit
  `

  const rows = db.query<RawProjectMemoryRow, Record<string, string | number>>(sql).all(params)
  return rows.map(row => mapRowToRecord(row))
}

export function invalidateProjectMemory(memoryId: string, reason?: string): ProjectMemoryRecord | null {
  const normalizedId = memoryId.trim()
  if (!normalizedId) return null

  const db = getMemoryDb()
  const now = new Date().toISOString()
  const update = db.query(
    `
      UPDATE project_memories
      SET
        status = 'inactive',
        invalidation_reason = $reason,
        invalidated_at = $invalidatedAt,
        updated_at = $updatedAt
      WHERE public_id = $memoryId
    `
  )

  update.run({
    $memoryId: normalizedId,
    $reason: reason?.trim() || 'Superseded',
    $invalidatedAt: now,
    $updatedAt: now,
  })

  return getProjectMemoryById(normalizedId)
}

export function renderProjectMemoryReport(
  reportType: string,
  queryKey: string,
  queryValue: string,
  rows: ProjectMemoryRecord[],
  topFields: { key: string; value: string | number | boolean | null | undefined }[] = []
): string {
  const blocks: AiTextBlock[] = rows.map(memory => ({
    header: memory.memoryId,
    fields: [
      { key: 'workspace', value: memory.workspace },
      { key: 'topic', value: memory.topic },
      { key: 'kind', value: memory.kind },
      { key: 'importance', value: memory.importance },
      { key: 'status', value: memory.status },
      { key: 'source', value: memory.source },
      { key: 'created_at', value: memory.createdAt },
      { key: 'updated_at', value: memory.updatedAt },
      { key: 'invalidated_at', value: memory.invalidatedAt },
      { key: 'invalidation_reason', value: memory.invalidationReason },
    ],
    listFields: [{ key: 'tags', values: memory.tags }],
    multilineFields: [
      { key: 'summary', value: memory.summary },
      { key: 'text', value: memory.text },
    ],
  }))

  return renderAiTextReport(reportType, queryKey, queryValue, blocks, topFields)
}

function getProjectMemoryById(memoryId: string): ProjectMemoryRecord | null {
  const db = getMemoryDb()
  const row = db
    .query<RawProjectMemoryRow, { $memoryId: string }>(
      `
        SELECT
          public_id,
          workspace,
          topic,
          kind,
          summary,
          text,
          source,
          tags_json,
          importance,
          status,
          invalidation_reason,
          created_at,
          updated_at,
          invalidated_at
        FROM project_memories
        WHERE public_id = $memoryId
      `
    )
    .get({ $memoryId: memoryId })

  return row ? mapRowToRecord(row) : null
}

function findExactActiveMemory(
  db: ReturnType<typeof getMemoryDb>,
  input: ReturnType<typeof normalizeMemoryInput>
): ProjectMemoryRecord | null {
  const row = db
    .query<RawProjectMemoryRow, Record<string, string>>(
      `
        SELECT
          public_id,
          workspace,
          topic,
          kind,
          summary,
          text,
          source,
          tags_json,
          importance,
          status,
          invalidation_reason,
          created_at,
          updated_at,
          invalidated_at
        FROM project_memories
        WHERE workspace = $workspace
          AND topic = $topic
          AND kind = $kind
          AND summary = $summary
          AND text = $text
          AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1
      `
    )
    .get({
      $workspace: input.workspace,
      $topic: input.topic,
      $kind: input.kind,
      $summary: input.summary,
      $text: input.text,
    })

  return row ? mapRowToRecord(row) : null
}

function buildMetadataFilters(
  input: {
    workspace?: string
    topic?: string
    kind?: string
    includeInactive?: boolean
  },
  params: Record<string, string | number>,
  tableAlias?: string
): string[] {
  const whereClauses: string[] = []
  const qualify = (column: string) => (tableAlias ? `${tableAlias}.${column}` : column)

  if (!input.includeInactive) {
    whereClauses.push(`${qualify('status')} = 'active'`)
  }

  if (input.workspace?.trim()) {
    whereClauses.push(`${qualify('workspace')} = $workspace`)
    params.$workspace = input.workspace.trim()
  }

  if (input.topic?.trim()) {
    whereClauses.push(`${qualify('topic')} = $topic`)
    params.$topic = input.topic.trim()
  }

  if (input.kind?.trim()) {
    whereClauses.push(`${qualify('kind')} = $kind`)
    params.$kind = input.kind.trim()
  }

  return whereClauses
}

function normalizeMemoryInput(input: AddProjectMemoryInput) {
  return {
    workspace: input.workspace?.trim() || DEFAULT_WORKSPACE,
    topic: input.topic?.trim() || DEFAULT_TOPIC,
    kind: input.kind?.trim() || DEFAULT_KIND,
    summary: input.summary?.trim() || '',
    text: input.text.trim(),
    source: input.source?.trim() || '',
    tags: normalizeTags(input.tags),
    importance: clampLimit(input.importance, 3, 1, 5),
  }
}

function normalizeTags(tags?: string[]): string[] {
  return [...new Set((tags || []).map(tag => tag.trim()).filter(Boolean))]
}

function normalizeCaptureLines(values?: string[]): string[] {
  return [...new Set((values || []).map(value => value.trim()).filter(Boolean))]
}

function buildSummaryFromText(text: string, maxLength: number = 96): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`
}

function dedupeRecords(records: ProjectMemoryRecord[]): ProjectMemoryRecord[] {
  const seen = new Set<string>()
  return records.filter(record => {
    if (seen.has(record.memoryId)) {
      return false
    }

    seen.add(record.memoryId)
    return true
  })
}

function mapRowToRecord(row: RawProjectMemoryRow): ProjectMemoryRecord {
  return {
    memoryId: row.public_id,
    workspace: row.workspace,
    topic: row.topic,
    kind: row.kind,
    summary: row.summary?.trim() || '',
    text: row.text,
    source: row.source?.trim() || '',
    tags: parseTags(row.tags_json),
    importance: Number(row.importance || 0),
    status: row.status,
    invalidationReason: row.invalidation_reason?.trim() || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    invalidatedAt: row.invalidated_at?.trim() || '',
  }
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(value => String(value).trim()).filter(Boolean)
  } catch {
    return []
  }
}

function clampLimit(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const normalized = Number.isFinite(value) ? Number(value) : fallback
  return Math.max(min, Math.min(max, normalized))
}
