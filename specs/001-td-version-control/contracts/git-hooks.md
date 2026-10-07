# Contract: Git Hooks

Installed by `hooks/install.sh <project-repo>`; scripts are POSIX `sh` and require `git` and `curl` only.

| Hook | Trigger | Arguments from Git | Changed files computed with |
|------|---------|--------------------|-----------------------------|
| `post-checkout` | checkout / switch / clone | `<prev> <new> <branch-flag>` | `git diff --name-only <prev> <new>`; skipped when `<branch-flag>` is 0 (file checkout) |
| `post-merge` | merge / `git pull` (merge) | `<squash-flag>` | `git diff --name-only ORIG_HEAD HEAD` |
| `post-rewrite` | rebase / amend (`git pull --rebase`) | `<command>` | `git diff --name-only ORIG_HEAD HEAD` when command is `rebase` |

Common behavior:

1. Read `difftd.config.json` (see [config](config.md)); if missing, use defaults.
2. Keep only files under `snapshotDir` ending in `.json`. If none, exit 0 silently.
3. `curl --silent --max-time 15 -X POST http://127.0.0.1:<reloadPort>/reload -d '{"files":[...],"source":"<hook>"}'`.
4. If `curl` fails or TD does not answer: print `DiffTD: TouchDesigner not reachable, skipped reload.` to stderr.
5. If the response contains `errors` or `backups`, print a one-line summary each.
6. **Always exit 0.** A hook MUST NOT make the Git operation fail (FR-015).

Installation:

- Existing hooks are preserved: the installer appends a marked block (`# >>> difftd >>>` … `# <<< difftd <<<`) instead of overwriting; re-running is idempotent.
- `install.sh --uninstall` removes only the marked block.
- Also ensures `.gitignore` contains `.difftd/`.
