export type AiScalar = string | number | boolean | null | undefined

export type AiTextField = {
  key: string
  value: AiScalar
}

export type AiTextListField = {
  key: string
  values: AiScalar[]
}

export type AiTextMultilineField = {
  key: string
  value: string | null | undefined
}

export type AiTextBlock = {
  header?: string
  fields?: AiTextField[]
  listFields?: AiTextListField[]
  multilineFields?: AiTextMultilineField[]
}

export function renderAiTextReport(
  reportType: string,
  queryKey: string,
  queryValue: string,
  blocks: AiTextBlock[],
  topFields: AiTextField[] = []
): string {
  const lines = [
    `report_type: ${reportType}`,
    `${queryKey}: ${queryValue}`,
    `result_count: ${blocks.length}`,
  ]

  for (const field of topFields) {
    lines.push(`${field.key}: ${formatAiScalar(field.value)}`)
  }

  lines.push('')

  blocks.forEach((block, index) => {
    lines.push(`[result_${index + 1}]`)
    if (block.header) {
      lines.push(`result_label: ${block.header}`)
    }

    for (const field of block.fields ?? []) {
      lines.push(`${field.key}: ${formatAiScalar(field.value)}`)
    }

    for (const listField of block.listFields ?? []) {
      lines.push(`${listField.key}:`)
      if (listField.values.length === 0) {
        lines.push('- none')
        continue
      }

      for (const item of listField.values) {
        lines.push(`- ${formatAiScalar(item)}`)
      }
    }

    for (const field of block.multilineFields ?? []) {
      lines.push(`${field.key}:`)
      const value = field.value?.trim()
      if (!value) {
        lines.push('  unknown')
        continue
      }

      for (const line of value.split(/\r?\n/)) {
        lines.push(`  ${line}`)
      }
    }

    if (index < blocks.length - 1) {
      lines.push('')
    }
  })

  return lines.join('\n')
}

export function formatAiScalar(value: AiScalar, fallback = 'unknown'): string {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'boolean') return value ? 'true' : 'false'

  const text = String(value).trim()
  return text.length > 0 ? text : fallback
}
