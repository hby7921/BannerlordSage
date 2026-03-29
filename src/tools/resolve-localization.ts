import { renderAiTextReport } from '../utils/ai-text'
import { parseLocalizationToken, resolveLocalizationDetails } from '../utils/localization'

export async function resolveLocalization(text: string, languages?: string[]) {
  const token = parseLocalizationToken(text)
  if (!token) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Input text is not a Bannerlord localization token. Expected format: {=str_id}Fallback Text',
        },
      ],
    }
  }

  const details = resolveLocalizationDetails(text, languages)
  const blocks = [
    {
      header: 'localization_summary',
      fields: [
        { key: 'localization_id', value: token.id },
        { key: 'query_text', value: text },
        { key: 'token_fallback', value: token.fallback || '(empty)' },
        { key: 'preferred_languages', value: languages?.join(', ') || 'default' },
        { key: 'xml_entry_count', value: details.xmlEntries.length },
        { key: 'source_entry_count', value: details.sourceEntries.length },
      ],
      listFields: [
        {
          key: 'xml_entries',
          values: details.xmlEntries.map(row => `language=${row.language} | text=${row.text} | file_path=${row.filePath || 'unknown'}`),
        },
        {
          key: 'source_entries',
          values: details.sourceEntries
            .slice(0, 10)
            .map(
              row =>
                `fallback_text=${row.fallbackText} | context_kind=${row.contextKind} | assembly=${row.assemblyName} | file_path=${row.filePath}:${row.lineNumber + 1}:${row.columnNumber + 1}`
            ),
        },
      ],
    },
  ]

  if (details.sourceEntries.length > 10) {
    blocks[0].fields?.push({ key: 'source_entries_omitted', value: details.sourceEntries.length - 10 })
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: renderAiTextReport('localization_resolution', 'query_localization_token', text, blocks),
      },
    ],
  }
}
