# GPTNime Workflow

These notes capture the expected project hygiene after changes or updates.

## GitHub Updates

- After completing a scoped change, run the relevant checks before committing. For normal app updates, use `npm run build` and `npm run lint`.
- Commit with a detailed message that names the user-facing change, not a vague checkpoint.
- Push the finished commit to GitHub on `main` after verification.
- If work ever happens on a temporary branch, merge it back into `main` after review/checks, then push `main` so GitHub reflects the current project state.
- Keep unrelated local changes out of commits unless they are part of the same requested update.
