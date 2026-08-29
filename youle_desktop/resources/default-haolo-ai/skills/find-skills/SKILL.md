---
name: find-skills
description: Discover trustworthy free or open-source agent skills when users ask for a skill, want new capabilities, or a task appears to need a capability that is not currently installed. Search the open skills ecosystem, verify source, license, security signals, dependencies, and likely costs, then recommend options. Install only after the user explicitly approves a specific candidate.
---

# Find Skills

Find the smallest trustworthy skill that covers the user's goal. Prefer an already installed skill when one matches.

This Haolo-bundled workflow is adapted from Vercel Labs' MIT-licensed `find-skills` skill and follows the Codex skill format. It searches the open ecosystem; it is not an OpenAI endorsement of third-party code.

## Discover

1. Identify the domain, concrete task, expected output, operating system, and any required service.
2. Check the available-skills list first. If an installed skill matches, use it instead of proposing another installation.
3. Search [skills.sh](https://skills.sh/) with specific keywords. Prefer the Skills CLI when Haolo's managed Node runtime is ready:

   ```powershell
   & $env:PNPM dlx skills find "<specific query>"
   ```

   If `PNPM` is unavailable, use `npx skills find "<specific query>"` only when `npx` already exists on `PATH`. Do not install or modify a system-wide Node.js runtime just to search.
4. Try focused synonyms or `--owner <trusted-owner>` when the initial search is noisy. Use the website as the fallback when the CLI is unavailable.

## Vet candidates

Do not recommend a candidate from rank or install count alone. For every finalist:

1. Open its skills.sh page and upstream repository.
2. Prefer the official author of the underlying technology, then established organizations and maintainers.
3. Confirm an explicit license permits the user's intended personal or commercial use. “Free to install” does not mean its APIs, models, SaaS accounts, or data sources are free.
4. Review the candidate `SKILL.md`, scripts, hooks, dependencies, requested credentials, network destinations, and filesystem effects. Flag executable or destructive behavior.
5. Check available security-audit results and repository health. Treat automated audits as signals, not guarantees.
6. Prefer focused skills with clear triggers, recent maintenance, reproducible scripts, and meaningful adoption. Treat unknown authors and very low adoption cautiously.

Reject or warn clearly about candidates that hide their source, lack a usable license, request unrelated secrets or broad permissions, disable safeguards, download mutable executables without verification, or misrepresent paid dependencies as free.

## Present results

Return up to three strong options with:

- Skill name and exact capability.
- Author and source repository.
- License and whether commercial use appears permitted.
- Install count and available audit signals.
- External accounts, APIs, models, binaries, or possible costs.
- Recommended choice and why.
- Exact install command, but do not run it yet.

Say when no candidate meets the bar. Offer to complete the task with existing capabilities or use `$skill-creator` to author a focused skill.

## Install after approval

Searching and recommending are read-only. Install only when the user explicitly approves one named candidate or has already given a scoped instruction to install it.

Before installation, restate the source, selected skill, license, executable content, external dependencies, and destination scope. Then prefer a copied Codex user installation:

```powershell
& $env:PNPM dlx skills add <owner/repository@skill> --agent codex --global --yes --copy
```

If `PNPM` is unavailable but `npx` already exists, use the equivalent `npx skills add` command. Do not guess a destination, bypass a failed security check, or write into Haolo's managed `.system` directory.

After installation:

1. Verify it with `skills list --global --agent codex --json` through the same CLI launcher.
2. Report the installed name and source.
3. Tell the user Haolo will load it on the next turn; if it is not detected, refresh skills or start a new task before retrying.

## Provenance

The discovery workflow is adapted from `vercel-labs/skills/skills/find-skills`, copyright Vercel, Inc., under the MIT License in `LICENSE.txt`. Haolo adds license, cost, security, explicit-consent, and managed-runtime requirements.
