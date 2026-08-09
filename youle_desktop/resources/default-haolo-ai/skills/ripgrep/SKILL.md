---
name: "ripgrep"
displayName: "ripgrep"
description: "Use ripgrep (`rg`) for fast recursive text and code search. Prefer it over PowerShell `Get-ChildItem | Select-String`, `findstr`, or broad file reads when searching repositories, logs, and workspace files. ripgrep respects `.gitignore` by default and Haolo Desktop provides a generated config that excludes heavy generated folders such as `.git`, `node_modules`, `dist`, `build`, `target`, and `tmp`."
shortDescription: "Use rg for fast code and text search"
---

# ripgrep Skill

Use this skill when the user asks to search files, find code references, inspect logs, locate strings, or understand where behavior is implemented in a local workspace.

ripgrep is the `rg` command from BurntSushi/ripgrep. It recursively searches directories for a regex pattern while respecting `.gitignore` by default, which makes it a safer first choice than recursively reading every file.

## Default Tool Choice

- Prefer `rg` for text search: `rg -n "pattern"`.
- Prefer `rg --files` for file discovery.
- Prefer `rg --files -g "*.ts"` or `rg -n "pattern" -g "*.ts"` to scope searches.
- Use `rg -F` for literal strings that contain regex punctuation.
- Use `rg -i` for case-insensitive searches.
- Use `rg -C 2` for a small amount of context.
- Use `rg --json` only when structured output is useful.

## Windows Notes

Haolo Desktop may expose the resolved ripgrep binary through `RIPGREP_PATH`. If `rg` is not on `PATH`, run the command through that variable:

```powershell
& $env:RIPGREP_PATH -n "pattern"
```

The desktop runtime also writes `RIPGREP_CONFIG_PATH`, which excludes large generated folders. Do not bypass it for broad searches unless the user explicitly needs generated or dependency output.

## Guardrails

- Do not search generated dependency folders unless explicitly requested. Avoid `.git`, `node_modules`, `dist`, `build`, `target`, `out`, `.next`, `.nuxt`, `.vite`, `.turbo`, `.cache`, `coverage`, `tmp`, and `temp`.
- Do not pipe a huge recursive file list into another shell for destructive actions.
- Do not read minified bundles or binary assets into the model when a targeted `rg` search can answer the question.
- If a search could produce a very large result set, add globs, fixed strings, or context limits first.

## Examples

```powershell
rg -n "renderComposer" src test
rg -n -F "data-action=\"toggle-new-thread-group-picker\"" src
rg --files -g "*.mjs" -g "*.ts"
rg -n "poll\\.error|request timeout" logs -C 2
```

## Source

- Project: https://github.com/BurntSushi/ripgrep
