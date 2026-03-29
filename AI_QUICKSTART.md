# AI Quickstart For BannerlordSage

If you want an AI coding agent to help you install and configure this repository, give it:

1. the repository URL
2. this instruction:

```text
Please read AGENTS.md and README.md in this repository first.

Then help me install and configure BannerlordSage on this machine.

Your goals:
1. Inspect the repo instead of guessing
2. Install dependencies
3. Ask me for my real Bannerlord install path if you cannot discover it
4. Run the correct setup command
5. Configure the MCP client if needed
6. Explain which server entrypoint I should use
7. If I want my own mod source indexed, help me configure BANNERSAGE_MOD_SOURCE_DIR or workspaceRoot

Important constraints:
- Do not invent local file paths
- Use the repo's actual scripts and entrypoints
- Treat <BANNERLORD_GAME_DIR> as my real local game install path
- Treat <REPO_DIR> as the absolute path of this repository on my machine
```

## Recommended human follow-up

If the AI asks for your local Bannerlord path, provide something like:

```text
My Bannerlord install path is: <BANNERLORD_GAME_DIR>
```

If you want the AI to configure your own mod source too, provide:

```text
My local mod workspace is: <MOD_SOURCE_DIR>
```

## Canonical Repo Files

If the AI supports repo instruction files, the main ones are:

- `AGENTS.md`
- `README.md`
- `package.json`
