# Project Memory Workflow

Use project memory for information that should survive context loss.

Good candidates:

- design decisions
- pitfalls and confirmed fixes
- stable user preferences
- follow-up tasks worth keeping
- short session summaries with reuse value

Do not store:

- raw logs
- command history
- temporary guesses
- facts already covered by source or XML indexing

## Default usage

1. Start a resumed task with `project_memory_wakeup`.
2. Before claiming project history, call `project_memory_search`.
3. Use `project_memory_add` for a single important entry.
4. Near the end of a substantial task, prefer `project_memory_capture_session`.
5. If an old conclusion is no longer true, call `project_memory_invalidate`.

## What to write

Use these `kind` values by default:

- `decision`
- `pitfall`
- `preference`
- `todo`
- `session`
- `note`

Write one memory per conclusion when possible.

- `summary`: one short line
- `text`: concrete and self-contained
- `source`: add a file, issue, or session label when useful

## Rule of thumb

Store it if a future engineer would otherwise need to ask:

- Why was this done?
- Why did this fail?
- What did the user want here?
- What is still pending?
