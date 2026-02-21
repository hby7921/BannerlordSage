// src/stdio.ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { closeDb } from './utils/db'
import { server } from './server'

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error('🚀 BannerlordSage MCP 启动成功！正在等待 AI 连接...')

  const cleanup = () => {
    console.error('正在关闭服务器...')
    closeDb()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

try {
  main()
} catch (error) {
  console.error('致命错误:', error)
  process.exit(1)
}