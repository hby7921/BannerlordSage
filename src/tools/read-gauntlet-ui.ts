// src/tools/read-gauntlet-ui.ts
import { file, Glob } from 'bun'
import { join } from 'path'
import { PathSandbox } from '../utils/path-sandbox'

export async function readGauntletUi(sandbox: PathSandbox, uiFileName: string) {
  // 由于 UI 通常存在于 GUI/Prefabs 文件夹，我们全局搜索匹配的 xml
  const glob = new Glob(`**/${uiFileName}*.xml`)
  let foundPath = ''
  
  for await (const p of glob.scan({ cwd: sandbox.basePath })) {
    foundPath = p
    break
  }

  if (!foundPath) return { content: [{ type: 'text' as const, text: `未找到 UI 文件: ${uiFileName}` }] }

  const fullPath = sandbox.validateAndResolve(foundPath)
  const content = await file(fullPath).text()

  let output = `🖥️ UI 文件解析报告: ${foundPath}\n\n`
  
  // 提取 DataSource 绑定 (ViewModel 中的属性)
  const dataSources = new Set()
  const dsRegex = /DataSource="{([^}]+)}"/g
  let match
  while ((match = dsRegex.exec(content)) !== null) {
    dataSources.add(match[1])
  }

  // 提取点击事件 (ViewModel 中的 Execute 方法)
  const commands = new Set()
  const cmdRegex = /Command\.Click="([^"]+)"/g
  while ((match = cmdRegex.exec(content)) !== null) {
    commands.add(match[1])
  }

  output += `📦 需要在 C# ViewModel 中定义的属性 (DataSource):\n`
  dataSources.forEach(ds => output += `  public string/bool/int ${ds} { get; set; }\n`)
  
  output += `\n🖱️ 需要在 C# ViewModel 中定义的方法 (Command.Click):\n`
  commands.forEach(cmd => output += `  public void ${cmd}() { }\n`)

  return { content: [{ type: 'text' as const, text: output }] }
}