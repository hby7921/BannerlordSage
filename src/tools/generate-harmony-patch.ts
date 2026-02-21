// src/tools/generate-harmony-patch.ts
import { getDb } from '../utils/db'
import { file } from 'bun'
import { join } from 'path'
import { sourcePath } from '../utils/env'

type FoundSig = {
  sig: string
  isStatic: boolean
  params: string
  typeHint: string
}

export async function generateHarmonyPatch(className: string, methodName: string) {
  const db = getDb()
  const row = db
    .query<any, any>('SELECT filePath FROM csharp_index WHERE typeName = $name LIMIT 1')
    .get({ $name: className })

  if (!row) return { content: [{ type: 'text' as const, text: `未找到类: ${className}` }] }

  const fullPath = join(sourcePath, row.filePath)
  const content = await file(fullPath).text()
  const lines = content.split(/\r?\n/)

  const escapedMethod = escapeRegExp(methodName)

  /**
   * 尽量“像方法声明”的行：
   * - 允许 0~多个修饰符
   * - 允许返回类型包含: 命名空间/泛型/数组/nullable/指针/global::
   * - 允许显式接口实现前缀: IFoo.
   * - 允许构造函数（返回类型为空）吗？这里不特别支持构造函数；构造函数通常 methodName=className 时也能部分匹配
   */
  const declRe = new RegExp(
    '^\\s*' +
      // 0~多个修饰符（顺序随意）
      '(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|async|unsafe|extern|new|partial)\\s+)*' +
      // 返回类型（尽量放宽）：允许 global::System.Collections.Generic.List<int?>[]* 这类
      '(?:[\\w\\s<>,\\.\\?\\*:\\[\\]]+\\s+)?' +
      // 显式接口实现前缀（可多个层级）
      '(?:\\w+\\.)*' +
      // 方法名 + 左括号
      `\\b${escapedMethod}\\s*\\(`
  )

  let signatures: FoundSig[] = []
  let inBlockComment = false

  for (let i = 0; i < lines.length; i++) {
    let rawLine = lines[i]

    // 1) 处理块注释（状态机）+ 剔除行内 /*...*/
    const commentProcessed = stripBlockComments(rawLine, () => inBlockComment, (v) => (inBlockComment = v))
    if (commentProcessed == null) continue // 整行都在块注释里
    rawLine = commentProcessed

    const trimmed = rawLine.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('//')) continue

    // 2) 过滤明显的“不是声明”的情况：行中没有 '(' 也不用看
    if (!trimmed.includes('(')) continue

    // 3) 只匹配声明
    if (!declRe.test(rawLine)) continue

    // 4) 排除明显的赋值/委托/lambda：= 出现在方法名前（不是 == ）
    const eqIdx = indexOfSingleEqualsBefore(trimmed, methodName)
    if (eqIdx !== -1) continue

    // 5) 拼接多行签名：直到行尾以 { 或 ; 结束，或出现 =>
    //    注意：这里不做 split('//')，避免误伤字符串里的 URL。
    let fullSig = trimmed
    let j = i
    while (j < lines.length - 1 && !/[{;]\s*$/.test(fullSig) && !/=>/.test(fullSig)) {
      j++
      let nextLine = lines[j]
      const nextProcessed = stripBlockComments(nextLine, () => inBlockComment, (v) => (inBlockComment = v))
      if (nextProcessed == null) continue
      nextLine = nextProcessed.trim()
      if (!nextLine) continue
      if (nextLine.startsWith('//')) continue
      fullSig += ' ' + nextLine
    }

    // 6) 参数提取（括号计数）
    const params = extractParenContent(fullSig, '(' , ')')

    // 7) 如果括号都不完整，说明误判，跳过
    if (params == null) continue

    const isStatic = /\bstatic\b/.test(fullSig)

    // 8) 生成 Type[] hint（尽力而为：对复杂 tuple/多维数组/泛型嵌套尽量不炸）
    const typeHint = extractTypesForHint(params)

    // 9) 去重
    if (!signatures.find((s) => s.sig === fullSig)) {
      signatures.push({ sig: fullSig, isStatic, params, typeHint })
    }

    // i 可以跳到 j（省点时间，避免重复扫描同一签名的后续行）
    i = Math.max(i, j)
  }

  // instance 参数提示（确保复制模板也能直接编译）
  let instanceParamHint = ''
  if (signatures.length === 1) {
    instanceParamHint = signatures[0].isStatic ? '' : `${className} __instance, `
  } else if (signatures.length > 1) {
    instanceParamHint = `/* 若为实例方法，请在此加: ${className} __instance, */ `
  } else {
    instanceParamHint = `/* 若为实例方法，请在此加: ${className} __instance, */ `
  }

  const sigText =
    signatures.length > 0
      ? signatures
          .map((s, idx) => {
            const hintLine = s.typeHint ? `// 重载提示: new Type[] { ${s.typeHint} }` : ''
            return `// [${idx + 1}] ${s.sig}\n// 参数提取: (${s.params})\n${hintLine}`.trimEnd()
          })
          .join('\n// \n')
      : '// ⚠️ 未能提取到精准签名：可能是非常规写法（局部函数/生成代码/宏风格换行/奇特格式），请手动检查原 C# 文件。'

  const patchTemplate = `
// 🚀 AI 自动生成的 Harmony 补丁模板
// 目标类: ${className}
// 文件路径: ${row.filePath}

// 📌 找到的方法签名:
${sigText}

using HarmonyLib;
using System;

namespace YourModNamespace.Patches
{
    // 💡 如果存在多个同名重载，请解除下行注释并填入参数类型（可参考上方“重载提示”）:
    // [HarmonyPatch(typeof(${className}), "${methodName}", new Type[] { /* typeof(int), typeof(float) ... */ })]
    [HarmonyPatch(typeof(${className}), "${methodName}")]
    public class ${className}_${methodName}_Patch
    {
        // Prefix：方法执行前
        // 默认 void，保证模板可直接编译。
        // 若需跳过原方法：改成 static bool Prefix(...) 并 return false;
        static void Prefix(${instanceParamHint}/* 请在此按序填入原方法参数 */ /*, ref ReturnType __result */)
        {
            // TODO: 前置逻辑
        }

        // Postfix：方法执行后
        static void Postfix(${instanceParamHint}/* 请在此按序填入原方法参数 */ /*, ref ReturnType __result */)
        {
            // TODO: 后置逻辑
        }
    }
}
`

  return { content: [{ type: 'text' as const, text: patchTemplate }] }
}

// =====================================================
// helpers
// =====================================================

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 去掉块注释：支持
 * - 行内 /* ... *\/
 * - 跨行块注释状态机
 * 返回：
 * - null：整行都在块注释里，应跳过
 * - string：剔除块注释后的行（可能为空）
 */
function stripBlockComments(
  line: string,
  getState: () => boolean,
  setState: (v: boolean) => void
): string | null {
  let raw = line

  // 如果处于块注释中，先找结束
  if (getState()) {
    const endIdx = raw.indexOf('*/')
    if (endIdx === -1) return null
    setState(false)
    raw = raw.slice(endIdx + 2)
  }

  // 反复剔除行内块注释
  while (true) {
    const startIdx = raw.indexOf('/*')
    if (startIdx === -1) break

    const endIdx = raw.indexOf('*/', startIdx + 2)
    if (endIdx !== -1) {
      raw = raw.slice(0, startIdx) + raw.slice(endIdx + 2)
      continue
    } else {
      // 开始了一个跨行块注释
      setState(true)
      raw = raw.slice(0, startIdx)
      break
    }
  }

  return raw
}

/**
 * 找到“单个 =”且在方法名之前出现的情况，用于排除赋值/lambda/委托等。
 * 规则：存在 '='，且不是 '==', '=>', '>=', '<=', '!='，并且 '=' 的位置在 methodName 之前
 */
function indexOfSingleEqualsBefore(line: string, methodName: string): number {
  const mIdx = line.indexOf(methodName)
  if (mIdx === -1) return -1

  for (let i = 0; i < Math.min(mIdx, line.length); i++) {
    if (line[i] !== '=') continue
    const prev = line[i - 1] ?? ''
    const next = line[i + 1] ?? ''
    // 排除 == => >= <= !=
    if (next === '=' || next === '>' || prev === '>' || prev === '<' || prev === '!') continue
    return i
  }
  return -1
}

/**
 * 提取匹配括号内容（支持嵌套），例如从 "Foo(a, Bar(b))" 提取 "a, Bar(b)"
 * 若括号不完整返回 null
 */
function extractParenContent(text: string, open: '(' | '<' | '[', close: ')' | '>' | ']'): string | null {
  const start = text.indexOf(open)
  if (start === -1) return ''

  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        return text.slice(start + 1, i).trim()
      }
    }
  }
  return null
}

/**
 * 将参数字符串转成 typeof() 数组提示：
 * - 分割参数时忽略 < > ( ) [ ] 深度内部的逗号
 * - 从每个参数中剥离出“类型”：
 *   1) 去掉默认值 "= ..."
 *   2) 去掉前缀 ref/out/in/params/this/scoped/readonly（尽力处理）
 *   3) 从右侧剥离参数名（最后一个标识符），剩余即类型串
 */
function extractTypesForHint(paramsStr: string): string {
  if (!paramsStr) return ''

  const args = splitParamsTopLevel(paramsStr)
  const typeExprs: string[] = []

  for (const arg of args) {
    const t = extractTypeFromParam(arg)
    if (!t) continue
    typeExprs.push(`typeof(${t})`)
  }

  return typeExprs.join(', ')
}

function splitParamsTopLevel(paramsStr: string): string[] {
  const out: string[] = []
  let current = ''

  let angle = 0 // < >
  let paren = 0 // ( )
  let bracket = 0 // [ ]

  for (let i = 0; i < paramsStr.length; i++) {
    const c = paramsStr[i]

    if (c === '<') angle++
    else if (c === '>') angle = Math.max(0, angle - 1)
    else if (c === '(') paren++
    else if (c === ')') paren = Math.max(0, paren - 1)
    else if (c === '[') bracket++
    else if (c === ']') bracket = Math.max(0, bracket - 1)

    if (c === ',' && angle === 0 && paren === 0 && bracket === 0) {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }

    current += c
  }

  if (current.trim()) out.push(current.trim())
  return out
}

function extractTypeFromParam(param: string): string {
  if (!param) return ''

  // 去默认值
  let s = param
  const eq = findTopLevelEquals(s)
  if (eq !== -1) s = s.slice(0, eq).trim()

  // 去 attribute（参数上可以有 [Attr]，粗略去掉最前面一段或多段）
  while (s.trim().startsWith('[')) {
    const inside = extractBracketBlock(s.trim(), '[', ']')
    if (!inside) break
    // 删除首个 [...] 块
    const firstClose = s.trim().indexOf(']') // 粗略；括号嵌套很少见
    if (firstClose === -1) break
    s = s.trim().slice(firstClose + 1).trim()
  }

  // 去一些可能的前缀关键字（多 token）
  s = removeLeadingKeywords(s, ['ref', 'out', 'in', 'params', 'this', 'scoped', 'readonly'])

  // 去掉末尾的参数名：最后一个标识符（a-zA-Z_ 开头，后续含数字/下划线）
  // 注意：类型可能以 "]" ">" ")" "?" "*" 结尾，但参数名一定是标识符
  const lastIdent = findLastIdentifier(s)
  if (!lastIdent) return s.trim()

  const { start, end } = lastIdent
  // 如果标识符前面有点号（说明可能是命名空间/嵌套类型的一部分），那它不一定是参数名
  // 但“参数名”一般前面是空白或 * 或 ? 或 ] 或 > 或 )，不会是 '.'
  const before = s[start - 1] ?? ''
  if (before === '.') {
    // 可能是类型末尾的一部分（例如 global::System.String），这里不剥离
    return s.trim()
  }

  // 判断它是不是参数名：标识符后面应当是字符串末尾（因为默认值已剥离）
  const tail = s.slice(end).trim()
  if (tail.length !== 0) {
    // 后面还有东西，不像参数名（比如 "T where ..." 这种本来也不是参数列表）
    return s.trim()
  }

  const typePart = s.slice(0, start).trim()
  return typePart || s.trim()
}

function removeLeadingKeywords(s: string, keywords: string[]): string {
  let t = s.trim()
  while (true) {
    const m = t.match(/^(\w+)\b/)
    if (!m) break
    const kw = m[1]
    if (!keywords.includes(kw)) break
    t = t.slice(kw.length).trim()
  }
  return t
}

function findLastIdentifier(s: string): { start: number; end: number } | null {
  // 从右往左找最后一个标识符
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i]
    if (!isIdentChar(c)) continue

    // 找到标识符末尾
    let end = i + 1
    let start = i
    while (start - 1 >= 0 && isIdentChar(s[start - 1])) start--

    // 要求首字符是字母或 _
    const first = s[start]
    if (!isIdentStart(first)) {
      i = start - 1
      continue
    }
    return { start, end }
  }
  return null
}

function isIdentStart(c: string) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_'
}

function isIdentChar(c: string) {
  return isIdentStart(c) || (c >= '0' && c <= '9')
}

function findTopLevelEquals(s: string): number {
  // 找 “顶层 =”，忽略 < > ( ) [ ] 内部
  let angle = 0, paren = 0, bracket = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '<') angle++
    else if (c === '>') angle = Math.max(0, angle - 1)
    else if (c === '(') paren++
    else if (c === ')') paren = Math.max(0, paren - 1)
    else if (c === '[') bracket++
    else if (c === ']') bracket = Math.max(0, bracket - 1)
    else if (c === '=' && angle === 0 && paren === 0 && bracket === 0) {
      const prev = s[i - 1] ?? ''
      const next = s[i + 1] ?? ''
      if (next === '=' || next === '>' || prev === '>' || prev === '<' || prev === '!') continue
      return i
    }
  }
  return -1
}

function extractBracketBlock(s: string, open: '[' , close: ']' ): string | null {
  return extractParenContent(s, open, close)
}