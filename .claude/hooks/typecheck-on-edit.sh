#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): type-checks whichever half of this monorepo
# the edited file belongs to. There is no root tsconfig.json here -- backend/
# and frontend/ each have their own -- so the check is scoped per project
# rather than run from the repo root, and skipped entirely for non-.ts files
# (CSS/HTML/markdown edits would otherwise trigger a pointless full check).
# jq isn't reliably available in this environment, so plain Node parses the
# hook's stdin JSON instead. Assumes the hook runs with CWD = repo root,
# same as every other relative-path example in Claude Code's own hook docs.

file=$(node -e '
  const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
  process.stdout.write((j.tool_input && j.tool_input.file_path) || "");
')
file=$(printf '%s' "$file" | tr '\134' '/')

case "$file" in
  */backend/*.ts)
    (cd backend && npx tsc -p tsconfig.json --noEmit 2>&1 | head -30)
    ;;
  */frontend/*.ts)
    # Plain tsc misses Angular template type errors (a component property
    # only referenced from an .html binding) -- ng build catches those, and
    # doing so is what actually surfaced real bugs earlier in this project's
    # history (an [ngClass] ternary reading an optional-chained property
    # tsc alone never flagged). Slower (~10-15s) than a bare tsc pass, but
    # that's the real coverage tradeoff.
    (cd frontend && npx ng build --configuration development 2>&1 | head -30)
    ;;
esac

exit 0
