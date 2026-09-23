---
name: ship
description: Type-check, build, commit, push, and deploy to Railway (dev or production), then independently verify the deploy is actually live
---

Standard end-of-task sequence for this repo (euroleague-app). Follow every
step — don't skip the verify step, and don't ask which environment if the
conversation already makes it obvious (a risky/unconfirmed UI or feature
change → `dev`; an explicit "deploy to main"/"deploy to prod" → `production`,
after `dev` already has it).

1. **Type-check both sides.** `cd backend && npx tsc -p tsconfig.json --noEmit`
   and `cd frontend && npx ng build --configuration development`. Stop and
   report if either fails — don't proceed to commit broken code.
2. **Stage only the intended files by name** — never `git add -A` or
   `git add .`. Run `git status` first and check for unrelated local
   changes (e.g. an in-progress experiment on a file you didn't touch) that
   should stay out of this commit/deploy; stash them with
   `git stash push --include-untracked -- <path>` before committing, and
   `git stash pop` after the deploy completes.
3. **Commit** with a concise message explaining *why*, not just what
   changed (matches this repo's existing commit style — see `git log`).
   Include the `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
   trailer as usual.
4. **Push** the current branch to `origin`.
5. **Deploy**: `railway up --service euroleague-app --environment
   <dev|production>` — never a bare `railway up` in this repo, since two
   environments share one service and the CLI's locally-linked default can
   silently point at the wrong one.
6. **Verify the deploy is actually live** — `railway status` has reported
   a stale "Building" state for a deployment that had already finished
   building and been superseded by a newer one; don't trust it alone.
   Instead:
   - Capture the deployment id from the `railway up` output's Build Logs
     URL (`...?id=<deployment-id>&`).
   - Poll `railway logs <deployment-id> --deployment --service
     euroleague-app --environment <dev|production>` until it shows a real
     `... listening on http://localhost:8080` line (or an error) — do this
     as a single background wait-loop, not a manual repeated check.
   - For a frontend change, independently confirm the *served* bundle has
     the change: `curl` the deployed URL for the current `main-*.js`
     filename, then grep the chunk that contains the component you changed
     for a string unique to your edit (a new class name, a new i18n key,
     etc.). This has caught a deploy that reported success but was still
     serving the previous build.
   - Report the result in one line (deployment id + what was confirmed).
     Do not poll deploy status in a loop beyond the single wait above.

If deploying to `dev` first: after verifying, switch the local checkout
back to whatever branch the user was working from before this sequence
started (commonly `main`), unless a local dev server is actively running
against `dev` for the user to test against — in that case, stay on `dev`
locally so the running server keeps reflecting what was just shipped.
