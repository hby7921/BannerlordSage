import { renderAiTextReport } from '../utils/ai-text'
import { ensureLocalModSourceIndex } from '../utils/local-mod-csharp-index'

export async function indexModSource(workspaceRoot?: string) {
  const summary = await ensureLocalModSourceIndex(workspaceRoot)

  return {
    content: [
      {
        type: 'text' as const,
        text: renderAiTextReport('local_mod_source_index', 'workspace_root', summary.workspace.workspaceRoot, [
          {
            header: 'index_summary',
            fields: [
              { key: 'workspace_root', value: summary.workspace.workspaceRoot },
              { key: 'source_root', value: summary.workspace.sourceRoot },
              { key: 'cache_root', value: summary.workspace.cacheRoot },
              { key: 'changed_files_reindexed', value: summary.changedFiles },
              { key: 'removed_files_detected', value: summary.removedFiles },
              { key: 'roslyn_files_scanned', value: summary.filesScanned },
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
