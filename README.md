# BannerlordSage — Bannerlord Source MCP Server

[![bun](https://img.shields.io/badge/Bun-%23000000.svg?style=flat&logo=bun&logoColor=white)](https://bun.com/) [![ripgrep](https://img.shields.io/badge/ripgrep-%23000000.svg?style=flat&logo=rust&logoColor=white)](https://github.com/BurntSushi/ripgrep)
[![Bannerlord](https://img.shields.io/badge/Game-Bannerlord_II-8B0000?style=flat&logo=target)](https://www.taleworlds.com/en/Games/Bannerlord)
[![ILSpy](https://img.shields.io/badge/Tool-ILSpy-blue?style=flat&logo=c-sharp)](https://github.com/icsharpcode/ILSpy)

一个提供《骑马与砍杀2：霸主》源代码搜索和数据浏览功能的 MCP 服务器。

## 前言

本项目受 [RimSage](https://github.com/realloon/rimsage) 启发，针对《骑马与砍杀 2：霸主》的源码结构、XML 数据以及 Harmony 补丁开发需求进行了重构与定制。

## 可用工具

服务器提供以下工具：

- `search_source` - 搜索霸主源代码
- `read_file` - 读取特定文件内容
- `list_directory` - 列出目录结构
- `search_xml` - 搜索 XML 数据文件
- `get_item_stats` - 获取装备与物品的属性数据
- `read_csharp_type` - 读取 C# 类/结构体/接口定义
- `generate_harmony_patch` - 生成 Harmony 补丁代码模板
- `trace_troop_tree` - 追踪兵种升级树与基础属性
- `read_gauntlet_ui` - 解析 UI 界面与 ViewModel 的绑定关系

## 本地部署

BannerlordSage 支持本地部署的 stdio 传输。

1. 安装依赖

```sh
bun install
```

2. 准备游戏数据

在项目根目录下，确保存在以下目录结构，并将游戏文件放入对应位置：

- **C# 源代码**: 使用 ILSpy 反编译《骑砍2》官方 DLL。将反编译出的所有 `.cs` 文件放置于 `dist/assets/Source/` 目录中。
- **XML 数据**: 将游戏目录（如 `Modules/Native/ModuleData` 等）中的 XML 配置文件，放置于 `dist/assets/Xmls/` 目录中。

3. 构建索引

数据准备完毕后，运行以下命令生成 SQLite 索引数据库：

```sh
bun run src/scripts/index-csharp.ts
bun run src/scripts/index-xml.ts
bun run build
```

4. 添加这个 MCP 服务器

**以VS Code 中搭配 Cline 插件为例**
1.打开 VS Code，搜索cline并安装。

正常登录，找到底部的Manage MCP Servers，点击⚙️打开 cline_mcp_settings.json 文件。

在该文件中添加以下配置：
```json
{
  "mcpServers": {
    "bannerlord-sage": {
      "command": "bun",
      "args": ["run", "你的路径/BannerlordSage/src/stdio.ts"]
    }
  }
}
```
## 环境依赖

- Bun 运行时
- Ripgrep

## 本地调试

```sh
bun run start # stdio
```
