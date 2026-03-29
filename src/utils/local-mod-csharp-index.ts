import { Database } from 'bun:sqlite'
import { buildModSourceIndex, type ModSourceIndexSummary } from '../scripts/index-mod-source'
import { readIndexedCsharpType } from './csharp-type-reader'
import { renderAiTextReport } from './ai-text'

export type LocalModSourceIndexSummary = ModSourceIndexSummary

export async function ensureLocalModSourceIndex(workspaceRoot?: string): Promise<LocalModSourceIndexSummary> {
  return buildModSourceIndex(workspaceRoot)
}

export async function getLocalModSourceStatus(workspaceRoot?: string) {
  const summary = await ensureLocalModSourceIndex(workspaceRoot)

  return {
    content: [
      {
        type: 'text' as const,
        text: renderAiTextReport('local_mod_source_status', 'workspace_root', summary.workspace.workspaceRoot, [
          {
            header: 'workspace_summary',
            fields: [
              { key: 'workspace_root', value: summary.workspace.workspaceRoot },
              { key: 'source_root', value: summary.workspace.sourceRoot },
              { key: 'cache_root', value: summary.workspace.cacheRoot },
              { key: 'csharp_file_count', value: summary.csharpFileCount },
              { key: 'changed_files_reindexed', value: summary.changedFiles },
              { key: 'removed_files_detected', value: summary.removedFiles },
              { key: 'indexed_type_count', value: summary.typeCount },
              { key: 'indexed_member_count', value: summary.memberCount },
              { key: 'indexed_source_localization_count', value: summary.sourceLocalizationCount },
            ],
          },
        ]),
      },
    ],
  }
}

export async function readLocalModType(workspaceRoot: string | undefined, typeName: string) {
  const summary = await ensureLocalModSourceIndex(workspaceRoot)
  const db = new Database(summary.workspace.dbPath, { create: false, readonly: true })

  try {
    return await readIndexedCsharpType({
      db,
      sourcePath: summary.workspace.sourceRoot,
      typeName,
      reportType: 'local_mod_type_read',
      queryLabel: 'query_type_name',
      notFoundText: `Type '${typeName}' was not found in the indexed mod source workspace (${summary.workspace.sourceRoot}).`,
      topFields: [
        { key: 'workspace_root', value: summary.workspace.workspaceRoot },
        { key: 'source_root', value: summary.workspace.sourceRoot },
        { key: 'changed_files_reindexed', value: summary.changedFiles },
        { key: 'removed_files_detected', value: summary.removedFiles },
      ],
    })
  } finally {
    db.close()
  }
}
