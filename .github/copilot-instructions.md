# BannerlordSage Copilot Instructions

This repository is a Windows-first MCP server for **Mount & Blade II: Bannerlord**.

Before suggesting install or usage steps:

1. Read `AGENTS.md`
2. Read `README.md`
3. Read `package.json`
4. Read `src/server.ts`

Important rules:

- Use the repo's real scripts and entrypoints
- Do not invent local file paths
- Treat `<BANNERLORD_GAME_DIR>` as the user's local Bannerlord install path
- Treat `<REPO_DIR>` as the local checkout path of this repository
- Keep docs and examples free of private machine-specific paths

Recommended install flow:

```bash
bun install
bun run setup:bannerlord -- --game-dir "<BANNERLORD_GAME_DIR>"
bun run start:bannerlord
```
