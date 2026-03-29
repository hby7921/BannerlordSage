import { getDb } from '../utils/db'

type MethodRow = {
  filePath: string
  signature: string
  isStatic: number
  memberKind: string
}

export async function generateHarmonyPatch(className: string, methodName: string) {
  const db = getDb()
  const typeRow = db
    .query<any, any>(
      `
      SELECT fullName, filePath
      FROM csharp_types
      WHERE typeName = $name
      ORDER BY LENGTH(fullName), filePath
      LIMIT 1
    `
    )
    .get({ $name: className })

  if (!typeRow) {
    return { content: [{ type: 'text' as const, text: `Type not found: ${className}` }] }
  }

  const methods = db
    .query<any, any>(
      `
      SELECT filePath, signature, isStatic, memberKind
      FROM csharp_methods
      WHERE typeFullName = $typeFullName
        AND memberName = $methodName
      ORDER BY startLine
    `
    )
    .all({
      $typeFullName: typeRow.fullName,
      $methodName: methodName,
    }) as MethodRow[]

  const instanceParamHint =
    methods.length === 1 && methods[0].isStatic === 0
      ? `${className} __instance, `
      : methods.some(method => method.isStatic === 0)
        ? `/* If this is an instance method, add ${className} __instance here. */ `
        : ''

  const overloadHints =
    methods.length > 0
      ? methods
          .map((method, index) => {
            const typeHint = buildTypeHint(method.signature)
            return [
              `// [${index + 1}] ${method.signature}`,
              typeHint ? `// Overload hint: new Type[] { ${typeHint} }` : '',
            ]
              .filter(Boolean)
              .join('\n')
          })
          .join('\n// \n')
      : '// Method signature was not found in the AST index. Run bun run setup to rebuild the index first.'

  const patchTemplate = `// Auto-generated Harmony patch template
// Target type: ${typeRow.fullName}
// Source file: ${typeRow.filePath}

${overloadHints}

using HarmonyLib;
using System;

namespace YourModNamespace.Patches
{
    // If there are multiple overloads, switch to the HarmonyPatch overload
    // that includes a parameter type array.
    // [HarmonyPatch(typeof(${className}), "${methodName}", new Type[] { /* typeof(int), typeof(string) */ })]
    [HarmonyPatch(typeof(${className}), "${methodName}")]
    public static class ${sanitizeIdentifier(className)}_${sanitizeIdentifier(methodName)}_Patch
    {
        static void Prefix(${instanceParamHint}/* original method args */, /* ref ReturnType __result */)
        {
            // TODO: prefix logic
        }

        static void Postfix(${instanceParamHint}/* original method args */, /* ref ReturnType __result */)
        {
            // TODO: postfix logic
        }
    }
}
`

  return { content: [{ type: 'text' as const, text: patchTemplate }] }
}

function buildTypeHint(signature: string): string {
  const start = signature.indexOf('(')
  const end = signature.lastIndexOf(')')
  if (start === -1 || end === -1 || end <= start + 1) return ''

  const paramsSection = signature.slice(start + 1, end).trim()
  if (!paramsSection) return ''

  return splitTopLevel(paramsSection)
    .map(extractTypeFromParam)
    .filter(Boolean)
    .map(typeName => `typeof(${typeName})`)
    .join(', ')
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = []
  let current = ''
  let angle = 0
  let paren = 0
  let bracket = 0

  for (const char of input) {
    if (char === '<') angle += 1
    else if (char === '>') angle = Math.max(0, angle - 1)
    else if (char === '(') paren += 1
    else if (char === ')') paren = Math.max(0, paren - 1)
    else if (char === '[') bracket += 1
    else if (char === ']') bracket = Math.max(0, bracket - 1)

    if (char === ',' && angle === 0 && paren === 0 && bracket === 0) {
      if (current.trim()) parts.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  if (current.trim()) parts.push(current.trim())
  return parts
}

function extractTypeFromParam(param: string): string {
  const withoutDefault = param.split('=').shift()?.trim() || ''
  const cleaned = withoutDefault.replace(/^\s*(ref|out|in|params|this|scoped|readonly)\s+/g, '')
  const lastSpace = cleaned.lastIndexOf(' ')
  return lastSpace === -1 ? cleaned : cleaned.slice(0, lastSpace).trim()
}

function sanitizeIdentifier(input: string): string {
  return input.replace(/[^A-Za-z0-9_]/g, '_')
}
