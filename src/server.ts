// src/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { PathSandbox } from './utils/path-sandbox'

// 统一在顶部导入所有工具函数
import { readCsharpType } from './tools/read-csharp-type'
import { searchSource } from './tools/search-source'
import { readFile } from './tools/read-file'
import { listDirectory } from './tools/list-directory'
import { searchXml } from './tools/search-xml'
import { traceTroopTree } from './tools/trace-troop-tree'
import { getItemStats } from './tools/get-item-stats'
import { generateHarmonyPatch } from './tools/generate-harmony-patch'
import { readGauntletUi } from './tools/read-gauntlet-ui'

// 初始化安全沙箱，指向你的源码根目录
const sandbox = new PathSandbox('dist/assets') 

export const server = new McpServer({
  name: 'bannerlord-sage',
  version: '0.9.0',
})

// --- 1. C# 类型查询工具 (原 read_csharp_type) ---
server.registerTool(
  'read_csharp_type',
  {
    description: '查询《骑马与砍杀2》C# 类的完整定义和源码。',
    inputSchema: {
      typeName: z.string().describe('准确的类型名称 (如: "MobileParty", "Hero")。'),
    },
  },
  async ({ typeName }) => await readCsharpType(typeName),
)

// --- 2. 全文源码搜索工具 ---
server.registerTool(
  'search_source',
  {
    description: '在骑砍2源码中进行正则表达式全文搜索。',
    inputSchema: {
      query: z.string().describe('搜索关键词或正则表达式'),
      filePattern: z.string().optional().describe('文件名过滤，如 "*.cs"'),
    },
  },
  async ({ query, filePattern }) => await searchSource(sandbox, query, false, filePattern),
)

// --- 3. 读取指定文件工具 ---
server.registerTool(
  'read_file',
  {
    description: '读取具体的源码或 XML 文件内容。',
    inputSchema: {
      path: z.string().describe('相对于 dist/assets 的路径'),
      startLine: z.number().optional().default(0).describe('起始行号'),
    },
  },
  async ({ path, startLine }) => await readFile(sandbox, path, startLine),
)

// --- 4. 列出目录工具 ---
server.registerTool(
  'list_directory',
  {
    description: '查看源码或 XML 文件夹下的目录结构。',
    inputSchema: {
      path: z.string().optional().default('').describe('文件夹相对路径'),
    },
  },
  async ({ path }) => await listDirectory(sandbox, path),
)

// --- 5. XML 数据查询工具 ---
server.registerTool(
  'search_xml',
  {
    description: '在骑砍2的 XML 数据文件（兵种、物品、设置）中搜索关键词。',
    inputSchema: { 
      query: z.string().describe('搜索关键词') 
    },
  },
  async ({ query }) => await searchXml(query),
)

// --- 6. 兵种树追踪器 ---
server.registerTool(
  'trace_troop_tree',
  {
    description: '追踪骑砍2兵种的升级路线和基础属性。',
    inputSchema: { characterId: z.string().describe('兵种 ID，如 vlandian_recruit') },
  },
  async ({ characterId }) => await traceTroopTree(characterId),
)

// --- 7. 装备属性提取器 ---
server.registerTool(
  'get_item_stats',
  {
    description: '快速提取骑砍2装备/武器的核心数据面板。',
    inputSchema: { itemId: z.string().describe('物品 ID，如 western_sword_t3') },
  },
  async ({ itemId }) => await getItemStats(itemId),
)

// --- 8. Harmony 补丁生成器 ---
server.registerTool(
  'generate_harmony_patch',
  {
    description: '为骑砍2的 C# 方法自动生成 Harmony Prefix/Postfix 补丁代码模板。',
    inputSchema: {
      className: z.string().describe('目标类名 (如 MobileParty)'),
      methodName: z.string().describe('目标方法名 (如 CalculateSpeed)'),
    },
  },
  async ({ className, methodName }) => await generateHarmonyPatch(className, methodName),
)

// --- 9. UI 界面解析器 ---
server.registerTool(
  'read_gauntlet_ui',
  {
    description: '解析骑砍2的 Gauntlet UI XML，提取 ViewModel 需要绑定的 DataSource 和 Click 事件。',
    inputSchema: { uiFileName: z.string().describe('UI 文件名 (如 InventoryScreen)') },
  },
  async ({ uiFileName }) => await readGauntletUi(sandbox, uiFileName),
)