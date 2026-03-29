# BannerlordSage

[![Bannerlord](https://img.shields.io/badge/Game-Bannerlord_II-8B0000?style=flat&logo=target)](https://www.taleworlds.com/en/Games/Bannerlord)
[![ILSpy](https://img.shields.io/badge/Tool-ILSpy-blue?style=flat&logo=c-sharp)](https://github.com/icsharpcode/ILSpy)
[![bun](https://img.shields.io/badge/Bun-%23000000.svg?style=flat&logo=bun&logoColor=white)](https://bun.com/)
[![ripgrep](https://img.shields.io/badge/ripgrep-%23000000.svg?style=flat&logo=rust&logoColor=white)](https://github.com/BurntSushi/ripgrep)

[English](./README.md) | [简体中文](./README_zh.md)

一个提供《骑马与砍杀2：霸主》源代码搜索和数据浏览功能的 MCP 服务器。

它读取你本机的 Bannerlord 安装目录，导入 XML，反编译官方 DLL，建立 SQLite 索引，并通过 MCP 工具暴露给 AI coding agent 使用。适用场景：

- Mod 开发
- 逆向分析
- 结构化玩法查询
- 读取本地 Mod 源码

## 用 AI 完成安装

如果你想直接把仓库扔给 Codex、Claude、Gemini、Copilot 等 coding agent 来帮你安装配置，按这个流程：

1. 把仓库地址发给 AI
2. 让它先读 `AGENTS.md`
3. 再让它按 `AI_QUICKSTART.md` 执行安装
4. 当它询问时，提供你的 `<BANNERLORD_GAME_DIR>`

## 工具总览

BannerlordSage 共提供 **28 个工具**，分两个入口：

| 入口 | 工具数 | 说明 |
|------|--------|------|
| `bun run start:bannerlord` | 26 | 推荐默认，适合查询、分析、读取资料 |
| `bun run start:bannerlord:full` | 28 | 额外提供工作区创建和 XSLT Patch 生成 |

基本使用流程：**运行 setup → 启动 MCP → 让模型调用工具**

## 工具列表

### 运行与诊断

| 工具 | 功能说明 |
|------|----------|
| `bannerlord_doctor` | 检查本地 Bannerlord 安装的模块健康状况：依赖缺失、重复 DLL、加载顺序异常等 |
| `bannerlord_index_status` | 查看 BannerlordSage 当前是否初始化完成、本地索引是否可用 |

### 官方源码与 XML

| 工具 | 功能说明 |
|------|----------|
| `search_source` | 在官方反编译源码中全文搜索，不知道东西在哪个文件时用这个 |
| `read_csharp_type` | 已知 C# 类型名时，直接读取该类型的反编译定义 |
| `read_file` | 已知文件路径时，读取指定行范围的内容 |
| `list_directory` | 浏览已导入的官方资源目录结构 |
| `search_xml` | 在官方 XML 中搜索某个 ID、字段、token 或概念 |
| `resolve_localization` | 将游戏内本地化 token（如 `{=abc123}`）解析为实际文本 |
| `read_gauntlet_ui` | 查看 Gauntlet UI 界面文件的绑定关系和交互逻辑 |

### 结构化玩法查询

| 工具 | 功能说明 |
|------|----------|
| `trace_troop_tree` | 查询某个兵种的完整升级路线 |
| `get_item_stats` | 查询武器、装备或锻造部件的详细属性 |
| `get_hero_profile` | 查询某个英雄的技能、特质和背景信息 |
| `get_clan_summary` | 查询某个家族或派系的成员、势力和关系 |
| `get_kingdom_summary` | 查询某个王国的领土、政策和当前状态 |
| `get_culture_summary` | 查询某个文化的特色单位、加成和风格 |
| `get_settlement_summary` | 查询城镇、村庄或城堡的信息 |
| `get_skill_data` | 查询某个技能的属性、加成和相关 perk |
| `get_policy_summary` | 查询某条王国政策的效果、条件和交叉引用 |
| `get_perk_data` | 查询某个 perk 的所属技能树、配对 perk 和角色加成 |

### 本地 Mod 源码

> 这组工具操作的是你自己的本地 Mod 源码，不是官方导入源码。

| 工具 | 功能说明 |
|------|----------|
| `mod_source_status` | 检查本地 Mod 工作区是否可用、索引是否建立 |
| `index_mod_source` | 建立或刷新本地 Mod 源码的搜索索引 |
| `search_mod_source` | 在本地 Mod 源码中全文搜索 |
| `read_mod_file` | 读取本地 Mod 中的指定源码文件 |
| `list_mod_directory` | 浏览本地 Mod 的目录结构 |
| `read_mod_type` | 按类型名读取本地 Mod 中的 C# 类型定义 |

### Patch 与代码生成

| 工具 | 功能说明 |
|------|----------|
| `generate_harmony_patch` | 生成 Harmony Patch 代码骨架，含目标方法签名提示，参数类型需手动对照补全 |
| `create_mod_workspace` ⁺ | 生成基础 Mod 项目结构（SubModule.xml、.csproj、C# 入口），可直接 `dotnet build`；目标目录非空时拒绝覆盖 |
| `generate_xslt_patch` ⁺ | 生成 XSLT Patch 模板，辅助修改官方 XML；不校验 XPath 合法性，不验证 fragment 格式，仅作模板参考 |

> ⁺ 仅 `start:bannerlord:full` 提供。

## 常用工作流

**查官方源码：**
1. `search_source` 定位文件
2. `read_file` 读取片段
3. `read_csharp_type` 查类型定义

**查 XML 或本地化：**
1. `search_xml` 定位文件
2. `read_file` 读取内容
3. `resolve_localization` 解析 token

**已知游戏 ID，直接查：**
- 直接调用对应的结构化查询工具，如 `get_item_stats`、`trace_troop_tree`、`get_hero_profile` 等

**读本地 Mod 源码：**
1. `mod_source_status` 确认工作区
2. `search_mod_source` 搜索代码
3. `read_mod_file` / `read_mod_type` 读取详情

## 安装

### 1. 环境要求

- Windows
- 合法拥有的 Bannerlord 本地安装
- [Bun](https://bun.com/)
- [ripgrep](https://github.com/BurntSushi/ripgrep)
- [.NET SDK 8+](https://dotnet.microsoft.com/)
- [ILSpyCmd](https://github.com/icsharpcode/ILSpy)

一键安装依赖：

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
winget install BurntSushi.ripgrep.MSVC
winget install Microsoft.DotNet.SDK.8
dotnet tool install --global ilspycmd
```

### 2. 安装依赖

```bash
bun install
```

### 3. 运行 setup

```bash
bun run setup:bannerlord -- --game-dir "<BANNERLORD_GAME_DIR>"
```

`<BANNERLORD_GAME_DIR>` 替换为你本机的 Bannerlord 安装路径。首次运行较慢，后续增量执行。

常用参数：

| 参数 | 说明 |
|------|------|
| `--dll-scope core` | 只反编译核心 TaleWorlds DLL（最快） |
| `--dll-scope modding` | 核心 + modding 支持库（Newtonsoft.Json 等） |
| `--dll-scope official` | 所有官方模块 DLL |
| `--dll-scope all` | 官方 + 第三方模块 DLL（最全，最慢） |
| `--xml-scope official` | 只导入官方模块的 XML |
| `--xml-scope all` | 官方 + 本地所有第三方模块 XML |
| `--accept-disclaimer` | 跳过交互式免责声明 |
| `--clean` | 清理后重新建立索引 |

### 4. 启动 MCP

```bash
# 默认（推荐）
bun run start:bannerlord

# 完整工具集
bun run start:bannerlord:full
```

## MCP 客户端配置

```toml
[mcp_servers.bannerlordsage]
command = "bun"
args = ["run", "src/entrypoints/bannerlord-stdio.ts"]
cwd = "<REPO_DIR>"
enabled = true
```

完整版：

```toml
[mcp_servers.bannerlordsage]
command = "bun"
args = ["run", "src/entrypoints/bannerlord-full-stdio.ts"]
cwd = "<REPO_DIR>"
enabled = true
```

`<REPO_DIR>` 替换为本仓库在你电脑上的绝对路径。

## 可选环境变量

| 变量 | 说明 |
|------|------|
| `BANNERSAGE_GAME` | 当前活动游戏 profile，目前固定为 `bannerlord` |
| `BANNERSAGE_BANNERLORD_GAME_DIR` | 默认 Bannerlord 安装路径 |
| `BANNERSAGE_GAME_DIR` | 通用默认游戏路径 |
| `BANNERSAGE_ILSPYCMD_EXE` | 覆盖 `ilspycmd` 可执行文件路径 |
| `BANNERSAGE_EULA_ACCEPTED=true` | 跳过交互式免责声明确认 |

## 可用脚本

```bash
bun run setup:bannerlord -- --game-dir "<BANNERLORD_GAME_DIR>"   # 初始化/更新索引
bun run start:bannerlord                                         # 启动默认 MCP
bun run start:bannerlord:full                                    # 启动完整版 MCP
bun run index:gameplay                                           # 单独重建玩法索引
bun run index:mod-source -- --source-dir "<MOD_SOURCE_DIR>"     # 索引本地 Mod 源码
bun run verify:bannerlord -- --game-dir "<BANNERLORD_GAME_DIR>" # 本机回归验证
bun run smoke:release                                            # 快速验证构建产物
bun run report:scopes -- --game-dir "<BANNERLORD_GAME_DIR>"     # 输出 scope 报告
```

## 项目结构

| 路径 | 说明 |
|------|------|
| `src/entrypoints/` | MCP 和 setup 入口 |
| `src/scripts/` | setup、索引、验证和发布脚本 |
| `src/tools/` | MCP 工具实现 |
| `src/utils/` | 共用运行时和索引逻辑 |
| `tools/BannerlordSage.CSharpIndexer/` | 基于 Roslyn 的 C# 索引器 |
| `dist/` | 本地生成的运行时数据（不提交） |
| `AGENTS.md` | AI coding agent 安装说明 |
| `AI_QUICKSTART.md` | 供用户复制给 AI 的安装提示模板 |

## 免责声明

本项目仅用于在合法拥有游戏副本前提下进行个人学习、研究和 Mod 开发。

1. 仓库本身不包含也不分发 Bannerlord 游戏资源。
2. 使用者需自行遵守游戏 EULA 和所在地法律。
3. 反编译和索引出的内容默认仅保留在本地。
