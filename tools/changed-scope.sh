#!/usr/bin/env bash
# Classifies changed paths (one per line on stdin) as `docs` or `code` (owner request 2026-11-01).
# Used by .github/actions/changes (CI skips build and test lanes on docs) and tools/pr-gate.sh
# (fails a code PR whose required lane was skipped). Conservative: a PR is docs only when every
# path is under docs/ or adr/, or ends in .md outside .serena/, .claude/ and .github/; docs that code or tests read are code
# (docs/contracts/**: OpenAPI, errors.md, permissions.yaml; docs/architecture/domain-model.md:
# packages/contracts/scripts/unions.ts). Add a path here when a script starts reading a doc.
# Empty input prints `code`, so an unreadable file list never skips anything.
set -euo pipefail
seen=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  seen=1
  case "$f" in
    docs/contracts/* | docs/architecture/domain-model.md) echo code; exit 0 ;;
    # Markdown that steers tooling or agents is code: memories, agent files, CI templates.
    .serena/* | .claude/* | .github/*) echo code; exit 0 ;;
    docs/* | adr/* | *.md) ;;
    *) echo code; exit 0 ;;
  esac
done
[ "$seen" = 1 ] && echo docs || echo code
