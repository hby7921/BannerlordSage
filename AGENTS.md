# BannerlordSage Agent Guide

This repository is a Windows-first MCP server for **Mount & Blade II: Bannerlord**.

Use this file when an AI coding agent is asked to inspect, install, configure, verify, or run this repo.

## Primary Goal

Help the user get BannerlordSage installed and running against a **local Bannerlord installation**.

## What This Repo Does

- imports Bannerlord XML from a local game install
- decompiles official Bannerlord DLLs
- builds SQLite indexes
- exposes MCP tools for Bannerlord querying, modding, and reverse engineering
- can also index and read the user's own local mod source workspace

## Important Constraints

- This repo does **not** include Bannerlord assets
- The user must have a legitimate local Bannerlord installation
- Commands that use `--game-dir` require the user's **real local path**
- Never invent a game path; ask for it or discover it from local context
- Do not commit `dist/`, extracted game assets, SQLite databases, or local secrets

## First Files To Read

When you first open this repo, read these files before making assumptions:

1. `README.md`
2. `package.json`
3. `src/server.ts`
4. `src/entrypoints/bannerlord-stdio.ts`
5. `src/entrypoints/bannerlord-full-stdio.ts`
6. `src/entrypoints/bannerlord-setup.ts`

## Standard Human Install Flow

If the user wants a normal install, use this order:

1. Install prerequisites:
   - Bun
   - ripgrep
   - .NET SDK 8+
   - ILSpyCmd
2. Install repo dependencies:
   - `bun install`
3. Run Bannerlord setup:
   - `bun run setup:bannerlord -- --game-dir "<BANNERLORD_GAME_DIR>"`
4. Start the MCP server:
   - `bun run start:bannerlord`

If the user needs the authoring helpers too:

- `bun run start:bannerlord:full`

## MCP Client Config

Recommended MCP entry:

```toml
[mcp_servers.bannerlordsage]
command = "bun"
args = ["run", "src/entrypoints/bannerlord-stdio.ts"]
cwd = "<REPO_DIR>"
enabled = true
```

If the user wants the full toolset:

```toml
[mcp_servers.bannerlordsage]
command = "bun"
args = ["run", "src/entrypoints/bannerlord-full-stdio.ts"]
cwd = "<REPO_DIR>"
enabled = true
```

## If The User Wants Their Own Mod Source Indexed

Use one of these:

- pass `workspaceRoot` directly to the mod-source tools
- set `BANNERSAGE_MOD_SOURCE_DIR`
- set `BANNERSAGE_BANNERLORD_MOD_SOURCE_DIR`

If the workspace contains `src/`, the repo automatically uses that as the effective source root.

## Important Commands

- `bun run setup:bannerlord`
- `bun run start:bannerlord`
- `bun run start:bannerlord:full`
- `bun run index:gameplay`
- `bun run index:mod-source -- --source-dir "<MOD_SOURCE_DIR>"`
- `bun run verify:bannerlord -- --game-dir "<BANNERLORD_GAME_DIR>"`
- `bun run smoke:release`
- `bun run report:scopes -- --game-dir "<BANNERLORD_GAME_DIR>"`

## Validation

Minimum pre-release check:

- `bun run smoke:release`

Stronger local validation:

- `bun run verify:bannerlord -- --game-dir "<BANNERLORD_GAME_DIR>"`

## If You Are An AI Agent

- Prefer using the repo's real scripts instead of inventing new setup steps
- Prefer placeholder paths in docs and examples
- Explain clearly that `workspaceRoot?` means an optional local workspace path
- Explain clearly that `--game-dir` points to the user's local Bannerlord install
- If asked to improve the docs, keep the README focused on:
  - tool list
  - install/configure steps
  - MCP client setup
  - mod-source setup
