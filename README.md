# BannerlordSage
[![Bannerlord](https://img.shields.io/badge/Game-Bannerlord_II-8B0000?style=flat&logo=target)](https://www.taleworlds.com/en/Games/Bannerlord)
[![ILSpy](https://img.shields.io/badge/Tool-ILSpy-blue?style=flat&logo=c-sharp)](https://github.com/icsharpcode/ILSpy)
[![bun](https://img.shields.io/badge/Bun-%23000000.svg?style=flat&logo=bun&logoColor=white)](https://bun.com/)
[![ripgrep](https://img.shields.io/badge/ripgrep-%23000000.svg?style=flat&logo=rust&logoColor=white)](https://github.com/BurntSushi/ripgrep)

[English](./README.md) | [简体中文](./README_zh.md)

An MCP server for **Mount & Blade II: Bannerlord** that provides source code search and data browsing.

It reads your local Bannerlord installation, imports XML, decompiles official DLLs, builds a SQLite index, and exposes MCP tools for AI coding agents. Use cases:

- Mod development
- Reverse engineering
- Structured gameplay lookups
- Reading local mod source code

## AI-Assisted Install

To have a coding agent (Codex, Claude, Gemini, Copilot, etc.) install and configure this for you:

1. Send the repository URL to the AI
2. Tell it to read `AGENTS.md` first
3. Tell it to follow `AI_QUICKSTART.md`
4. Provide your `<BANNERLORD_GAME_DIR>` when asked

## Tool Overview

BannerlordSage provides **34 tools** across two entrypoints:

| Entrypoint | Tools | Notes |
|------------|-------|-------|
| `bun run start:bannerlord` | 32 | Default toolset for query, analysis, mod-source work, and project memory |
| `bun run start:bannerlord:full` | 34 | Adds workspace creation and XSLT patch generation |

Basic workflow: **run setup → start MCP → let the model call tools**

## Tool List

### Diagnostics

| Tool | Description |
|------|-------------|
| `bannerlord_doctor` | Check module health: missing dependencies, duplicate DLLs, load order issues |
| `bannerlord_index_status` | Check whether BannerlordSage is initialized and the local index is ready |

### Project Memory

| Tool | Description |
|------|-------------|
| `project_memory_add` | Store one project memory entry |
| `project_memory_capture_session` | Store a session summary plus decisions, pitfalls, preferences, TODOs, and notes in one call |
| `project_memory_search` | Search project memory before answering questions about past work |
| `project_memory_recent` | Show recent project memory entries |
| `project_memory_wakeup` | Load key active memory at session start |
| `project_memory_invalidate` | Mark an old memory as inactive |

### Official Source & XML

| Tool | Description |
|------|-------------|
| `search_source` | Full-text search across decompiled official source — use this when you don't know which file to look in |
| `read_csharp_type` | Read the decompiled definition of a C# type by name |
| `read_file` | Read a specific line range from a known file path |
| `list_directory` | Browse the imported official asset directory |
| `search_xml` | Search official XML files for an ID, field, token, or concept |
| `resolve_localization` | Resolve in-game localization tokens like `{=abc123}` to actual text |
| `read_gauntlet_ui` | Inspect Gauntlet UI file bindings and interaction logic |

### Structured Gameplay Lookups

| Tool | Description |
|------|-------------|
| `trace_troop_tree` | Query the full upgrade path for a troop type |
| `get_item_stats` | Query detailed stats for a weapon, equipment, or smithing piece |
| `get_hero_profile` | Query a hero's skills, traits, and background |
| `get_clan_summary` | Query a clan or faction's members, strength, and relations |
| `get_kingdom_summary` | Query a kingdom's territories, policies, and current state |
| `get_culture_summary` | Query a culture's unique units, bonuses, and style |
| `get_settlement_summary` | Query a town, village, or castle |
| `get_skill_data` | Query a skill's attributes, bonuses, and related perks |
| `get_policy_summary` | Query a policy's description, support info, and cross-references |
| `get_perk_data` | Query a perk's skill tree, paired perk, character bonuses, and description |

### Local Mod Source

> These tools read your own local mod source code, not the official imported source.

| Tool | Description |
|------|-------------|
| `mod_source_status` | Check whether a mod source workspace is configured and indexed |
| `index_mod_source` | Index a local mod source directory for search and type lookup |
| `search_mod_source` | Search across your local mod source code |
| `read_mod_file` | Read a specific source file from your local mod |
| `list_mod_directory` | Browse your local mod's directory structure |
| `read_mod_type` | Read a C# type definition from your local mod by name |

### Patch & Code Generation

| Tool | Description |
|------|-------------|
| `generate_harmony_patch` | Generate a Harmony patch code scaffold with method signature hints — parameter types need manual completion |
| `create_mod_workspace` ⁺ | Generate a new mod project structure (SubModule.xml, .csproj, C# entry point) — ready to `dotnet build`; refuses to overwrite non-empty directories |
| `generate_xslt_patch` ⁺ | Generate an XSLT patch template for modifying official XML — does not validate XPath or fragment syntax, treat as a starting template |

> ⁺ Only available in `start:bannerlord:full`.

## Common Workflows

**Browse official source:**
1. `search_source` — locate the file
2. `read_file` — read the relevant section
3. `read_csharp_type` — inspect the type definition

**Browse XML or localization:**
1. `search_xml` — locate the file
2. `read_file` — read the content
3. `resolve_localization` — resolve tokens

**Known game ID, direct lookup:**
- Use the structured query tools directly: `get_item_stats`, `trace_troop_tree`, `get_hero_profile`, etc.

**Read local mod source:**
1. `mod_source_status` — confirm the workspace
2. `search_mod_source` — search the code
3. `read_mod_file` / `read_mod_type` — read the details

**Resume work with project memory:**
1. `project_memory_wakeup` — load the key active context for the workspace
2. `project_memory_search` — check whether a similar decision, pitfall, or preference already exists
3. `project_memory_capture_session` — store the useful session output near the end of the task

## Daily MCP Usage

Once BannerlordSage is installed and connected to your AI client, the normal daily loop is:

1. Start or resume a task and call `project_memory_wakeup`
2. Explore official behavior with `search_source`, `read_file`, and `read_csharp_type`
3. Explore your own mod with `mod_source_status`, `search_mod_source`, `read_mod_file`, and `read_mod_type`
4. Use the structured query tools when you already know an in-game id
5. Before stating project history, call `project_memory_search`
6. Near the end of the task, call `project_memory_capture_session`

## Project Memory Workflow

Project memory is a local recall layer. It does not change the model's context window. It gives the agent a place to store decisions, pitfalls, preferences, and follow-up state.

Use it like this:

- start a resumed task with `project_memory_wakeup`
- search memory before claiming project history
- store only durable conclusions
- prefer `project_memory_capture_session` near task completion
- invalidate old memories when they are no longer true

## Installation

### 1. Prerequisites

- Windows
- A legitimately owned local Bannerlord installation
- [Bun](https://bun.com/)
- [ripgrep](https://github.com/BurntSushi/ripgrep)
- [.NET SDK 8+](https://dotnet.microsoft.com/)
- [ILSpyCmd](https://github.com/icsharpcode/ILSpy)

One-liner to install all dependencies:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
winget install BurntSushi.ripgrep.MSVC
winget install Microsoft.DotNet.SDK.8
dotnet tool install --global ilspycmd
```

### 2. Install packages

```bash
bun install
```

### 3. Run setup

```bash
bun run setup:bannerlord -- --game-dir "<BANNERLORD_GAME_DIR>"
```

Replace `<BANNERLORD_GAME_DIR>` with the absolute path to your local Bannerlord installation. The first run takes a while; subsequent runs are incremental.

Common flags:

| Flag | Description |
|------|-------------|
| `--dll-scope core` | Decompile core TaleWorlds DLLs only (fastest) |
| `--dll-scope modding` | Core + modding support libs (Newtonsoft.Json, etc.) |
| `--dll-scope official` | All official module DLLs |
| `--dll-scope all` | Official + third-party module DLLs (most complete, slowest) |
| `--xml-scope official` | Import official module XML only |
| `--xml-scope all` | Official + all locally installed third-party module XML |
| `--accept-disclaimer` | Skip the interactive disclaimer prompt |
| `--clean` | Wipe and rebuild the index from scratch |

### 4. Start MCP

```bash
# Default (recommended)
bun run start:bannerlord

# Full toolset
bun run start:bannerlord:full
```

## MCP Client Configuration

```toml
[mcp_servers.bannerlordsage]
command = "bun"
args = ["run", "src/entrypoints/bannerlord-stdio.ts"]
cwd = "<REPO_DIR>"
enabled = true
```

Full toolset:

```toml
[mcp_servers.bannerlordsage]
command = "bun"
args = ["run", "src/entrypoints/bannerlord-full-stdio.ts"]
cwd = "<REPO_DIR>"
enabled = true
```

Replace `<REPO_DIR>` with the absolute path to this repository on your machine.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BANNERSAGE_GAME` | Active game profile — currently always `bannerlord` |
| `BANNERSAGE_BANNERLORD_GAME_DIR` | Default Bannerlord installation path |
| `BANNERSAGE_GAME_DIR` | Generic default game path |
| `BANNERSAGE_ILSPYCMD_EXE` | Override the `ilspycmd` executable path |
| `BANNERSAGE_EULA_ACCEPTED=true` | Skip the interactive disclaimer prompt |

## Scripts

```bash
bun run setup:bannerlord -- --game-dir "<BANNERLORD_GAME_DIR>"   # initialize / update index
bun run start:bannerlord                                         # start default MCP
bun run start:bannerlord:full                                    # start full MCP
bun run verify:memory                                            # verify native project-memory tools
bun run index:gameplay                                           # rebuild gameplay index only
bun run index:mod-source -- --source-dir "<MOD_SOURCE_DIR>"     # index local mod source
bun run verify:bannerlord -- --game-dir "<BANNERLORD_GAME_DIR>" # local regression check
bun run smoke:release                                            # quick build validation
bun run report:scopes -- --game-dir "<BANNERLORD_GAME_DIR>"     # output scope report
```

## Project Structure

| Path | Description |
|------|-------------|
| `src/entrypoints/` | MCP and setup entrypoints |
| `src/scripts/` | Setup, indexing, verification, and release scripts |
| `src/tools/` | MCP tool implementations |
| `src/utils/` | Shared runtime and indexing logic |
| `tools/BannerlordSage.CSharpIndexer/` | Roslyn-based C# indexer |
| `dist/` | Locally generated runtime data (not committed) |
| `AGENTS.md` | Installation instructions for AI coding agents |
| `AI_QUICKSTART.md` | Copy-paste install prompt template for users |

## Disclaimer

This project is for personal learning, research, and mod development with a legitimately owned copy of the game.

1. The repository does not include or redistribute Bannerlord game assets.
2. Users are responsible for complying with the game EULA and applicable local law.
3. Decompiled and indexed content remains local by default.
